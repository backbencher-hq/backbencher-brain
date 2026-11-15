/**
 * EVERY `uses` TARGET THAT NO FILE IN THE CORPUS PUBLISHES — the full list, classified.
 *
 * ## Why this exists
 *
 * The incoming audit reports `uses` targets in five disjoint classes and puts
 * **52** of 13,275 in `name-exists-unbound` and **4** in `hopeless`. Those two
 * numbers are the ones that answer the question the workstream asks of an
 * incoming edge, and they mean opposite things:
 *
 *   name-exists-unbound  a declaration in THIS corpus carries the name, but not
 *                        under the id the edge names. That is a binding defect and
 *                        it belongs to whichever component publishes ids.
 *   hopeless             no declaration in this corpus carries the name at all:
 *                        an external package, a path, or a builtin.
 *
 * The audit stores 5 examples of each, which is enough to show a shape and not
 * enough to settle whether the 52 share one cause or fifty-two. The task's own
 * instruction is explicit that the two must be separated, because "they look
 * identical in a count and are opposite findings". This probe prints all of them.
 *
 * ## What this measures
 *
 * Ids come from the ANALYZER driven on its own parser, never from `parseFile`, so
 * a production-side parse loss cannot hide inside the id set and make a published
 * declaration look absent. Every `uses` edge is read from `parseFile`, because
 * that is the production edge set and the thing a consumer actually receives.
 *
 * For each unpublished target the probe then searches the whole corpus for a
 * declaration whose LEAF name matches, and prints those candidates with the file
 * that declares each. A candidate list of one is a rename away from binding; a
 * candidate list of many is a name collision this lane cannot break per-file; an
 * empty list is genuinely external.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/unpublished-uses-targets.mts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out")] + 1 : "/tmp/opencode/pb/unpublished-uses.json"

type CorpusFile = { repo: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (k.endsWith(".proto")) corpus.push({ repo: entry, rel: r, abs })
    }
  }
  walk(dir, "")
}

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

// ---- pass 1: the corpus-wide published id set, from the ANALYZER only
const published = new Set<string>()
const byLeaf = new Map<string, { id: string; file: string }[]>()
let analyzerSymbols = 0
for (const f of corpus) {
  const content = readFileSync(f.abs, "utf8")
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const tree = parser.parse(content)
  const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
  const label = `${f.repo}/${f.rel}`
  for (const s of a.symbols ?? []) {
    const id = String(s.metadata?.id ?? s.name)
    published.add(id)
    analyzerSymbols++
    const leaf = id.includes("#") ? id.slice(0, id.indexOf("#")) : id
    const lastDot = leaf.lastIndexOf(".")
    const name = lastDot >= 0 ? leaf.slice(lastDot + 1) : leaf
    const arr = byLeaf.get(name) ?? []
    arr.push({ id, file: label })
    byLeaf.set(name, arr)
  }
}

// ---- pass 2: every `uses` edge production emits, against that id set
type Row = { target: string; referrers: string[]; leafCandidates: { id: string; file: string }[] }
const rows = new Map<string, Row>()
let usesEdges = 0
for (const f of corpus) {
  let prod: any
  try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { continue }
  const label = `${f.repo}/${f.rel}`
  const seenPerSource = new Map<string, number>()
  for (const e of (prod?.relationships ?? []) as any[]) {
    if (String(e.type) !== "uses") continue
    usesEdges++
    const src = String(e.source)
    const n = seenPerSource.get(src) ?? 0
    seenPerSource.set(src, n + 1)
    const target = String(e.target)
    if (published.has(target)) continue
    const row = rows.get(target) ?? { target, referrers: [], leafCandidates: [] }
    row.referrers.push(`${label} :: ${src}#${n}`)
    rows.set(target, row)
  }
}

// ---- classify
const nameExists: Row[] = []
const hopeless: Row[] = []
for (const row of rows.values()) {
  const lastDot = row.target.lastIndexOf(".")
  const name = lastDot >= 0 ? row.target.slice(lastDot + 1) : row.target
  const cands = byLeaf.get(name) ?? []
  // a candidate is only evidence if it is not the same id under a different prefix
  row.leafCandidates = cands.filter((c) => c.id !== row.target)
  ;(row.leafCandidates.length > 0 ? nameExists : hopeless).push(row)
}
const unique = (a: Row[], b: Row[]) => a.filter((x) => !b.includes(x))
void unique

console.log(`corpus files            ${corpus.length}`)
console.log(`analyzer symbols        ${analyzerSymbols}`)
console.log(`distinct published ids  ${published.size}`)
console.log(`uses edges (production) ${usesEdges}`)
console.log(`distinct unpublished targets ${rows.size}`)
console.log(`  name-exists-unbound   ${nameExists.length}`)
console.log(`  hopeless              ${hopeless.length}`)

const byCandCount = new Map<number, number>()
for (const r of nameExists) byCandCount.set(r.leafCandidates.length, (byCandCount.get(r.leafCandidates.length) ?? 0) + 1)
console.log(`\nname-exists-unbound by candidate count (1 = a rename from binding):`)
for (const [k, v] of [...byCandCount].sort((a, b) => a[0] - b[0])) console.log(`  ${String(k).padStart(3)} candidates: ${v} target(s)`)

console.log(`\n--- name-exists-unbound, every one ---`)
for (const r of nameExists.sort((a, b) => a.leafCandidates.length - b.leafCandidates.length)) {
  console.log(`${r.target}   (${r.leafCandidates.length} candidate(s))`)
  for (const c of r.leafCandidates.slice(0, 4)) console.log(`      -> ${c.id}   ${c.file}`)
  if (r.leafCandidates.length > 4) console.log(`      ... and ${r.leafCandidates.length - 4} more`)
  console.log(`      from ${r.referrers.length} edge(s): ${r.referrers.slice(0, 2).join("  |  ")}`)
}
console.log(`\n--- hopeless, every one ---`)
for (const r of hopeless) {
  console.log(`${r.target}   from ${r.referrers.length} edge(s)`)
  for (const x of r.referrers.slice(0, 3)) console.log(`      ${x}`)
}

writeFileSync(OUT, JSON.stringify({
  corpusFiles: corpus.length, analyzerSymbols, distinctPublishedIds: published.size,
  usesEdges, distinctUnpublishedTargets: rows.size,
  nameExistsUnbound: nameExists.length, hopeless: hopeless.length,
  nameExistsUnboundRows: nameExists, hopelessRows: hopeless,
}, null, 2))
console.log(`\nwrote ${OUT}`)
