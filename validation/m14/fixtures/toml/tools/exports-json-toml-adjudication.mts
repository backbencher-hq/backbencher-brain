/**
 * THE `exports` CONTRADICTION, MEASURED ON BOTH SIDES — json's emission against toml's census predicate.
 *
 * HANDOFF-level context: toml's applicability audit says its `exports` ruling "rests on a JUDGEMENT"
 * and that "the json lane reached the OPPOSITE conclusion on the same question for the same type, so
 * the two lanes currently hold contradictory verdicts on identical reasoning." A contradiction is a
 * finding, and the way to settle one is to read what each lane ACTUALLY EMITS rather than what each
 * spec says about the other's construct.
 *
 * What this probe measures, over the corpus, through the PRODUCTION path (`parseFile`, the same entry
 * point the incoming gate uses):
 *
 *   SIDE JSON — for a bounded, deterministic set of `package.json` documents that carry
 *   `exports`/`main`/`bin`, every `exports` edge the analyzer emits, its line, and whether its TARGET
 *   is a symbol the SAME DOCUMENT declares. That is the whole question: is json's `exports` target an
 *   in-document entry point, or an external name?
 *
 *   SIDE TOML — for the same population, the publish-surface key sites the toml census counts, and
 *   whether the VALUE names a declaration (the census's `referentSites`) or the KEY is the kind of
 *   name json's shape would target.
 *
 * It settles nothing by itself and claims nothing about which lane is right; it produces the two
 * numbers the adjudication needs.
 *
 * READ-ONLY. No files written.
 *
 *   npx tsx validation/m14/fixtures/toml/tools/exports-json-toml-adjudication.mts [--files=N]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const N = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=24").split("=")[1]) || 24
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

/** git-tracked files of one extension under the corpus, sorted, deterministic. */
function discover(exts: string[]): { abs: string; repo: string; rel: string }[] {
  const out: { abs: string; repo: string; rel: string }[] = []
  for (const name of readdirSync(CR).sort()) {
    const repo = path.join(CR, name)
    try { if (!statSync(repo).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" })
      tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!exts.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(repo, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      out.push({ abs, repo, rel: name + "/" + rel })
    }
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

const json = discover(["json", "jsonc"])
const toml = discover(["toml"])
console.log(`population: ${json.length} admitted json/jsonc · ${toml.length} admitted toml (same admission as the gate)`)
console.log(`SAMPLE: the first ${N} admitted json documents that emit at least one \`exports\` edge — a deterministic slice of the sorted population, and the slice is stated so the number is about the sample`)
console.log("")

// ── SIDE JSON ────────────────────────────────────────────────────────────────────────────────────
let scanned = 0
let docsWithExports = 0
let edges = 0
let inDocument = 0
let foreignOrNothing = 0
const samples: string[] = []
for (const f of json) {
  if (docsWithExports >= N) break
  scanned++
  if (scanned > 4000) break
  let r: any
  try { r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any) } catch { continue }
  const ex = (r?.relationships ?? []).filter((x: any) => String(x?.type ?? "") === "exports")
  if (ex.length === 0) continue
  docsWithExports++
  const names = new Set<string>()
  for (const s of r.symbols ?? []) {
    const n = String(s?.name ?? ""); if (n.length > 0) names.add(n)
    const q = String(s?.qualifiedName ?? ""); if (q.length > 0) names.add(q)
  }
  const lines: string[] = []
  for (const e of ex) {
    edges++
    const tgt = String(e?.target ?? "")
    const t = names.has(tgt)
    if (t) inDocument++; else foreignOrNothing++
    lines.push(`      ${String(e.source)} -> ${JSON.stringify(tgt)}  line ${e.line_number ?? "?"}  target-in-this-document=${t ? "YES" : "NO"}`)
  }
  samples.push(`  ${f.rel}\n${lines.join("\n")}`)
}
console.log(`SIDE JSON — ${docsWithExports} documents with exports edges out of ${scanned} parsed`)
console.log(`  edges ${edges} · target declared in the SAME document ${inDocument} · target not declared there ${foreignOrNothing}`)
for (const s of samples.slice(0, 4)) console.log(s)

// ── SIDE TOML ────────────────────────────────────────────────────────────────────────────────────
const EXPORT_KEYS = new Set(["export", "exports", "expose", "exposed", "pub", "public", "publish", "main", "module", "mod", "entrypoint"])
const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await getParser("toml")
const kidsOf = (n: any): any[] => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }
const leafOf = (k: any): string => {
  if (!k) return ""
  if (k.type === "dotted_key") { const cs = kidsOf(k); return cs.length > 0 ? leafOf(cs[cs.length - 1]) : "" }
  let t = String(k.text ?? "").trim()
  if (t.length >= 2) { const q = t.charCodeAt(0); if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1) }
  return t.toLowerCase()
}
let sites = 0, stringSites = 0, valueNamesOwnDecl = 0
for (const f of toml) {
  let root: any
  try { root = (await parser.parse(readFileSync(f.abs, "utf8"), f.abs)).rootNode } catch { continue }
  const declared = new Set<string>()
  const pairs: any[] = []
  const st = [root]
  while (st.length) {
    const x = st.pop()
    if (x.type === "pair") {
      const k = kidsOf(x)[0]
      if (k) {
        const leaf = leafOf(k)
        if (leaf.length > 0) { declared.add(leaf); pairs.push(x) }
      }
    }
    for (const c of kidsOf(x)) st.push(c)
  }
  for (const p of pairs) {
    const k = kidsOf(p)[0]
    const leaf = leafOf(k)
    if (!EXPORT_KEYS.has(leaf)) continue
    sites++
    const cs = kidsOf(p)
    const v = cs.length > 1 ? cs[cs.length - 1] : null
    let val: string | null = null
    if (v && v.type === "string") { let t = String(v.text).trim(); if (t.length >= 2) { const q = t.charCodeAt(0); if ((q === 34 || q === 39) && t.charCodeAt(t.length - 1) === q) t = t.slice(1, -1) } ; val = t.toLowerCase() }
    if (val === null) continue
    stringSites++
    if (declared.has(val)) valueNamesOwnDecl++
  }
}
console.log("")
console.log(`SIDE TOML — publish-surface key sites over the whole admitted population (census predicate, ${EXPORT_KEYS.size} leaf names)`)
console.log(`  sites ${sites} · with a string value ${stringSites} · value names a declaration in the SAME document ${valueNamesOwnDecl}`)
console.log(`  AND WHAT json's SHAPE WOULD TARGET: json's ` + "`exports`" + ` target is the entry point's OWN KEY SYMBOL`)
console.log(`  (\`<identity>.main\`, \`<identity>.exports.<subpath>\`, \`<identity>.bin.<command>\`), so the analogous toml`)
console.log(`  edge would target the SITE'S KEY (a declaration in the document) — which is why the two lanes are not`)
console.log(`  answering the same question: toml's census tested the VALUE, json's mechanism names the KEY.`)
