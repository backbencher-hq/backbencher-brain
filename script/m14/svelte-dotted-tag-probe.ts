/**
 * SVELTE — THE DOTTED COMPONENT TAG. How many `instantiates` targets name a thing
 * no symbol can hold, and can the file's own imports tell us which are real?
 *
 * THE DEFECT. shadcn-svelte writes components the namespaced way:
 *
 *     import * as Card from '$lib/registry/ui/card'
 *     <Card.Root> <Card.Header> <Field.Label>
 *
 * The SFC grammar's `tag_name` for that element is the text `Card.Root`, and the
 * lane's documented convention is "leaf tag name AS WRITTEN", so the analyzer
 * publishes `instantiates -> "Card.Root"`. No symbol is named `Card.Root` anywhere:
 * the module exports `Root`, and the file's import binding is `Card`. The edge is
 * therefore unfollowable, and `bb_graph` / `bb_impact` / `bb_migrate` all consume it
 * as if the target existed.
 *
 * WHY THIS IS NOT THE SAME AS THE ORACLE DISAGREEING. `deriveSvelteComponentUsages`
 * in `script/m14/differential.ts` reads `tag_name` and pushes it verbatim too. Both
 * sides agree, so the differential reports the lane clean — the shared-premise class
 * the ontology workstream names, where two readings of one spec cannot disagree about
 * a construct both forgot to check against the language's own rules.
 *
 * WHAT IS PROVABLE, AND WHAT IS NOT. Svelte resolves `<Card.Root>` by reading the
 * NAMESPACE OBJECT bound to `Card`, so segment 0 must be a namespace import or the
 * compiler rejects the file. That is a fact about the FILE and it is checkable here:
 * every dotted tag's first segment can be joined against the file's own import
 * records. What is NOT checkable here is the exported member name, because the
 * module lives outside the corpus — so naming `Root` would assert a symbol the
 * analyzer has not seen, which is the fabrication class this lane refuses.
 *
 * MEASURED, then reported. This file writes nothing.
 *
 * CLI: npx tsx script/m14/svelte-dotted-tag-probe.ts [--repo shadcn-svelte] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "shadcn-svelte") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024
let _sp: any
const svelteParser = async (): Promise<any> => {
  if (!_sp) _sp = await (ASTEngine as any).getParser("svelte")
  return _sp
}

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seenAbs = new Set<string>()
for (const repo of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".svelte")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "svelte") continue
    if (seenAbs.has(abs)) continue
    seenAbs.add(abs)
    files.push({ repo, dir, rel, abs, text })
  }
}
console.log(`svelte dotted-tag probe — ${files.length} .svelte files, repos ${REPOS.join(", ")}`)

type Row = {
  label: string
  file: string
  dotted: boolean
  /** segment 0 of a dotted tag; "" for a plain one */
  ns: string
  nsIsNamespaceImport: boolean
  nsIsAnyImport: boolean
  nsModule: string
  targetResolvesToLocalSymbol: boolean
}
const rows: Row[] = []
const targetCounts = new Map<string, number>()
const nsCounts = new Map<string, number>()
let parseFail = 0
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; return }

      // The file's own import records, in BOTH spellings the codebase emits.
      const nsImports = new Map<string, string>()
      const anyImports = new Set<string>()
      for (const imp of r?.imports ?? []) {
        const mod = String(imp?.module ?? imp?.path ?? imp?.modulePath ?? imp?.source ?? "")
        if (imp?.isNamespaceImport === true || imp?.type === "namespace") {
          const n = String(imp?.name ?? imp?.localName ?? imp?.alias ?? "")
          if (n) nsImports.set(n, mod)
        }
        for (const n of [imp?.name, imp?.localName, imp?.alias]) if (typeof n === "string" && n) anyImports.add(n)
        for (const it of imp?.items ?? []) if (it) anyImports.add(String(it))
      }
      const localNames = new Set<string>()
      for (const s of r?.symbols ?? []) { const n = String(s?.name ?? ""); if (n) localNames.add(n) }

      for (const x of r?.relationships ?? []) {
        if (String(x.type ?? x.relationshipType ?? "") !== "instantiates") continue
        const target = String(x.target ?? "")
        targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1)
        const dotted = target.includes(".")
        const ns = dotted ? target.slice(0, target.indexOf(".")) : ""
        if (ns) nsCounts.set(ns, (nsCounts.get(ns) ?? 0) + 1)
        rows.push({
          label: `${f.repo}/${f.rel}`, file: f.abs, dotted, ns,
          nsIsNamespaceImport: dotted ? nsImports.has(ns) : false,
          nsIsAnyImport: dotted ? anyImports.has(ns) : false,
          nsModule: dotted ? (nsImports.get(ns) ?? "") : "",
          targetResolvesToLocalSymbol: localNames.has(target),
        })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}

const dotted = rows.filter((r) => r.dotted)
const plain = rows.filter((r) => !r.dotted)
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log("\n" + "=".repeat(112))
console.log("THE MEASUREMENT")
console.log("=".repeat(112))
console.log(`  instantiates edges total:                 ${rows.length}  (parseFail ${parseFail})`)
console.log(`  plain tags  <Button/>:                   ${plain.length}  (${pct(plain.length, rows.length)})`)
console.log(`  DOTTED tags <Card.Root/>:                ${dotted.length}  (${pct(dotted.length, rows.length)})`)
console.log(`  distinct dotted TARGET strings:          ${new Set(rows.filter((r) => r.dotted).map((r) => r.label.split("/").pop() + "|" + r.ns)).size}`)
console.log(`  distinct NAMESPACE segment-0 values:      ${nsCounts.size}`)
console.log("")
console.log(`  of the DOTTED edges, segment 0 IS a namespace import:   ${dotted.filter((r) => r.nsIsNamespaceImport).length}  (${pct(dotted.filter((r) => r.nsIsNamespaceImport).length, dotted.length)})`)
console.log(`  of the DOTTED edges, segment 0 is SOME import:          ${dotted.filter((r) => r.nsIsAnyImport).length}  (${pct(dotted.filter((r) => r.nsIsAnyImport).length, dotted.length)})`)
console.log(`  of the DOTTED edges, segment 0 is NOT imported at all:   ${dotted.filter((r) => !r.nsIsAnyImport).length}  (${pct(dotted.filter((r) => !r.nsIsAnyImport).length, dotted.length)})`)
console.log(`  DOTTED edges whose TARGET string is a local symbol:      ${dotted.filter((r) => r.targetResolvesToLocalSymbol).length}  (${pct(dotted.filter((r) => r.targetResolvesToLocalSymbol).length, dotted.length)})`)
console.log(`  PLAIN edges whose TARGET string is a local symbol:        ${plain.filter((r) => r.targetResolvesToLocalSymbol).length}  (${pct(plain.filter((r) => r.targetResolvesToLocalSymbol).length, plain.length)})`)

console.log("\n  namespaces carrying dotted tags (top 20), with the module they bind:")
const nsSample: string[] = []
for (const r of dotted) {
  if (nsSample.length < 20 && r.nsIsNamespaceImport) {
    const s = `${r.ns} -> ${r.nsModule || "(unresolved)"}  in ${r.label.split("/").pop()}`
    if (!nsSample.includes(s)) nsSample.push(s)
  }
}
for (const s of nsSample) console.log(`     ${s}`)

console.log("\n  top dotted targets as emitted (target string -> count):")
for (const [t, n] of [...targetCounts.entries()].filter(([t]) => t.includes(".")).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`     ${String(n).padStart(5)}  ${t}`)
}

console.log("\n  top namespaces (segment 0) by edge count:")
for (const [n, c] of [...nsCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`     ${String(c).padStart(5)}  ${n}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: {
      files: files.length, repos: REPOS, parseFail,
      commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => {
        let c = "unknown"
        try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { /* not a repo */ }
        return [path.basename(d), c]
      })),
    },
    measurement: {
      instantiatesEdges: rows.length,
      plainTags: plain.length,
      dottedTags: dotted.length,
      dottedTargetIsLocalSymbol: dotted.filter((r) => r.targetResolvesToLocalSymbol).length,
      plainTargetIsLocalSymbol: plain.filter((r) => r.targetResolvesToLocalSymbol).length,
      dottedNsIsNamespaceImport: dotted.filter((r) => r.nsIsNamespaceImport).length,
      dottedNsIsAnyImport: dotted.filter((r) => r.nsIsAnyImport).length,
      dottedNsNotImported: dotted.filter((r) => !r.nsIsAnyImport).length,
    },
    dottedTargets: Object.fromEntries([...targetCounts.entries()].filter(([t]) => t.includes(".")).sort((a, b) => b[1] - a[1])),
    namespaces: Object.fromEntries([...nsCounts.entries()].sort((a, b) => b[1] - a[1])),
    rows: rows.filter((r) => r.dotted).slice(0, 400),
    instrument: "production ASTEngine.parseFile via src/ast/pool-worker; namespace membership joined against the file's own import records",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}