/**
 * SVELTE — ONTOLOGY CENSUS. Does the label fire, at what count, in which files,
 * and do BOTH endpoints bind?
 *
 * WHY A LANE-LOCAL INSTRUMENT. `ontology-coverage-gate.ts` has ruling tables for
 * two languages (bash, json) and refuses to run without one — correctly, because
 * an empty table would call every un-emitted type RULED-UNJUSTIFIED and that is a
 * verdict about the TABLE. That file is MASTER-owned, so this lane measures
 * itself and reports the numbers; adding a `svelte` table to the shared gate is a
 * need for master, recorded in the lane report.
 *
 * NOTHING here is claimed from source derivation. Every number is a count taken
 * from production `parseFile` (src/ast/pool-worker) over the corpus, or from the
 * corpus's own text, or from the parse tree.
 *
 * CLI: npx tsx script/m14/svelte-ontology-census.ts [--repo shadcn-svelte] [--dir a,b] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "shadcn-svelte") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seenAbs = new Set<string>()
const admit = (dir: string, repo: string): void => {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { return }
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
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
for (const e of REPOS) admit(path.join(CR, e), e)
for (const d of EXTRA) admit(d, path.basename(d))
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`svelte ontology census — ${files.length} .svelte files, repos ${[...new Set(files.map((f) => f.repo))].join(",")}`)

// ── pass 1: production parseFile ──────────────────────────────────────────────
type Rel = { t: string; s: string; g: string; conf: number; line?: number; md: Record<string, unknown> }
type FileOut = { label: string; names: Set<string>; comps: Set<string>; owned: Set<string>; rels: Rel[]; written: Set<string> }
const out: FileOut[] = []
let parseFail = 0, symbolTotal = 0, relTotal = 0
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
      const fo: FileOut = { label: `${f.repo}/${f.rel}`, names: new Set(), comps: new Set(), owned: new Set(), rels: [], written: new Set() }
      for (const s of r?.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (!n) continue
        fo.names.add(n)
        if (String(s?.kind ?? "").toLowerCase() === "class") fo.comps.add(n)
        if (s?.ownerName) fo.owned.add(n)
        symbolTotal++
      }
      for (const x of r?.relationships ?? []) {
        fo.rels.push({
          t: String(x.type ?? x.relationshipType ?? ""),
          s: String(x.source ?? ""),
          g: String(x.target ?? ""),
          conf: typeof x.confidence === "number" ? x.confidence : 1,
          line: typeof x.line_number === "number" ? x.line_number : undefined,
          md: (x.metadata ?? {}) as Record<string, unknown>,
        })
        relTotal++
      }
      for (const m of f.text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) fo.written.add(m[0])
      out.push(fo)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}
const corpusNames = new Set<string>(), corpusComps = new Set<string>()
for (const fo of out) { for (const n of fo.names) corpusNames.add(n); for (const c of fo.comps) corpusComps.add(c) }
console.log(`parsed ${out.length} files (parseFail ${parseFail}) — ${symbolTotal} symbols, ${relTotal} relationships, ${corpusNames.size} distinct symbol names`)

// ── THE TABLE: every type, count, file count, first files ────────────────────
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const perType = new Map<Type, { n: number; files: Set<string>; first: string[]; conf: Map<number, number> }>()
for (const t of ALL_TYPES) perType.set(t, { n: 0, files: new Set(), first: [], conf: new Map() })
const OTHER = new Map<string, number>()
for (const fo of out) {
  for (const r of fo.rels) {
    const t = r.t as Type
    const row = perType.get(t)
    if (!row) { OTHER.set(r.t, (OTHER.get(r.t) ?? 0) + 1); continue }
    row.n++
    row.files.add(fo.label)
    if (row.first.length < 3) row.first.push(`${r.s} -[${t}]-> ${r.g} (conf ${r.conf}, line ${r.line ?? "-"})`)
    row.conf.set(r.conf, (row.conf.get(r.conf) ?? 0) + 1)
  }
}
console.log("\n" + "=".repeat(118))
console.log("Q2 FIRES — per type: edge count, file count, files it came from")
console.log("=".repeat(118))
console.log(`${"type".padEnd(13)}${"edges".padStart(8)}${"files".padStart(8)}  confidence histogram / first files`)
console.log("-".repeat(118))
for (const t of ALL_TYPES) {
  const row = perType.get(t)!
  const hist = [...row.conf.entries()].sort((a, b) => b[0] - a[0]).map(([c, n]) => `${c}:${n}`).join(" ")
  console.log(`${t.padEnd(13)}${String(row.n).padStart(8)}${String(row.files.size).padStart(8)}  ${hist || "-"}`)
  for (const f of row.first) console.log(`               ${f}`)
}
if (OTHER.size) console.log(`\nlabels OUTSIDE the ontology: ${[...OTHER.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`)

// ── Q5 RESOLVED, per convention ───────────────────────────────────────────────
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
type Res = { n: number; srcLocal: number; tgtLocal: number; tgtCorpus: number; spelledHere: number; tgtFileStem: number }
const res = new Map<string, Res>()
const blanks = new Map<string, number>()
const blankSamples = new Map<string, string[]>()
const bump = (m: Map<string, Res>, k: string, f: (r: Res) => void): void => {
  let r = m.get(k)
  if (!r) { r = { n: 0, srcLocal: 0, tgtLocal: 0, tgtCorpus: 0, spelledHere: 0, tgtFileStem: 0 }; m.set(k, r) }
  f(r)
}
for (const fo of out) {
  for (const r of fo.rels) {
    bump(res, r.t, (x) => { x.n++ })
    if (fo.names.has(r.s) || fo.comps.has(r.s)) bump(res, r.t, (x) => { x.srcLocal++ })
    if (fo.written.has(r.g)) bump(res, r.t, (x) => { x.spelledHere++ })
    if (fo.names.has(r.g)) bump(res, r.t, (x) => { x.tgtLocal++ })
    if (corpusNames.has(r.g)) bump(res, r.t, (x) => { x.tgtCorpus++ })
    // Svelte's OWN component-resolution rule: a template writes a component in
    // PascalCase (imports do), and a file's identity is its stem. So an
    // `instantiates` target resolves if SOME admitted .svelte file is NAMED that.
    if (r.t === "instantiates") {
      if ([...corpusNames].some((n) => path.basename(n) === r.g)) bump(res, r.t, (x) => { x.tgtFileStem++ })
    }
    if (r.g.trim().length === 0 || r.s.trim().length === 0) {
      blanks.set(r.t, (blanks.get(r.t) ?? 0) + 1)
      const arr = blankSamples.get(r.t) ?? []
      if (arr.length < 6) { arr.push(`${fo.label}: ${JSON.stringify(r.s)} -> ${JSON.stringify(r.g)}`); blankSamples.set(r.t, arr) }
    }
  }
}
console.log("\n" + "=".repeat(118))
console.log("Q5 RESOLVED — srcLocal = source is a symbol this file publishes; tgtLocal = target is one too; tgtCorpus = some file in the corpus publishes it")
console.log("=".repeat(118))
console.log(`${"label".padEnd(14)}${"edges".padStart(8)}${"srcLocal".padStart(11)}${"tgtLocal".padStart(11)}${"tgtCorpus".padStart(12)}${"tgtFileStem".padStart(13)}${"spelledHere".padStart(13)}`)
for (const t of [...new Set([...res.keys()])].sort()) {
  const r = res.get(t)!
  console.log(`${t.padEnd(14)}${String(r.n).padStart(8)}${pct(r.srcLocal, r.n).padStart(11)}${pct(r.tgtLocal, r.n).padStart(11)}${pct(r.tgtCorpus, r.n).padStart(12)}${pct(r.tgtFileStem, r.n).padStart(13)}${pct(r.spelledHere, r.n).padStart(13)}`)
}

// ── Q4/Q6 label × metadata shape × confidence ─────────────────────────────────
const shapeOf = (md: Record<string, unknown>): string =>
  Object.keys(md).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
const crossTab = new Map<string, Map<string, number>>()
for (const fo of out) {
  for (const r of fo.rels) {
    let m = crossTab.get(r.t)
    if (!m) { m = new Map(); crossTab.set(r.t, m) }
    const key = `${shapeOf(r.md)} @conf=${r.conf}`
    m.set(key, (m.get(key) ?? 0) + 1)
  }
}
console.log("\n" + "=".repeat(118))
console.log("Q4/Q6 — label × metadata-shape × confidence (heuristic = conf < 0.7)")
console.log("=".repeat(118))
for (const t of [...crossTab.keys()].sort()) {
  const rows = [...crossTab.get(t)!.entries()].sort((a, b) => b[1] - a[1])
  const heur = rows.filter(([k]) => Number(k.split("@conf=")[1]) < 0.7).reduce((a, [, v]) => a + v, 0)
  const total = rows.reduce((a, [, v]) => a + v, 0)
  console.log(`\n${t}: ${total} edges, ${heur} heuristic (conf < 0.7)`)
  for (const [k, v] of rows.slice(0, 10)) console.log(`   ${String(v).padStart(6)}  ${k}`)
}

const blankTotal = [...blanks.values()].reduce((a, n) => a + n, 0)
console.log(`\nblank/whitespace endpoints across all labels: ${blankTotal}`)
for (const [k, arr] of blankSamples) for (const s of arr) console.log(`   ${k}: ${s}`)

// ── UNRESOLVED TARGETS: the ones a consumer cannot follow ─────────────────────
console.log("\n" + "=".repeat(118))
console.log("TARGETS THAT BIND NOWHERE IN THE CORPUS (top unresolved per label)")
console.log("=".repeat(118))
const unres = new Map<string, Map<string, number>>()
for (const fo of out) {
  for (const r of fo.rels) {
    if (fo.names.has(r.g) || corpusNames.has(r.g)) continue
    let m = unres.get(r.t)
    if (!m) { m = new Map(); unres.set(r.t, m) }
    m.set(r.g, (m.get(r.g) ?? 0) + 1)
  }
}
for (const [t, m] of [...unres.entries()].sort()) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`\n${t}: ${[...m.values()].reduce((a, b) => a + b, 0)} edges on ${m.size} distinct unbound targets`)
  console.log(`   ${top.map(([k, v]) => `${k}:${v}`).join("  ")}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: {
      files: files.length,
      repos: [...new Set(files.map((f) => f.repo))],
      commits: Object.fromEntries([...new Set(files.map((f) => f.dir))].map((d) => {
        let c = "unknown"
        try { c = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { /* not a repo */ }
        return [d, c]
      })),
    },
    runtime: { files: out.length, parseFail, symbols: symbolTotal, relationships: relTotal, distinctSymbolNames: corpusNames.size, distinctComponentNames: corpusComps.size },
    fires: Object.fromEntries([...perType.entries()].map(([k, v]) => [k, { edges: v.n, files: v.files.size, confidence: Object.fromEntries([...v.conf.entries()].sort((a, b) => b[0] - a[0])), examples: v.first }])),
    labelsOutsideOntology: Object.fromEntries(OTHER),
    resolved: Object.fromEntries(res),
    labelConfidenceCrossTab: Object.fromEntries([...crossTab.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]))])),
    blankEndpoints: Object.fromEntries(blanks),
    blankSamples: Object.fromEntries(blankSamples),
    unresolvedTargets: Object.fromEntries([...unres.entries()].map(([k, v]) => [k, Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60))])),
    instrument: "production ASTEngine.parseFile via src/ast/pool-worker",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}