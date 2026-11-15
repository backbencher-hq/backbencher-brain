/**
 * NIM AMBIGUITY SPLIT — deliverable B: an ambiguous target is ONE edge that the
 * reverse walk will attribute to ONE declaration, so the number that matters is
 * not "how many targets are ambiguous" but "how many are ambiguous IN A WAY THE
 * EDGE ITSELF CANNOT DISAMBIGUATE".
 *
 * ## Why this file exists rather than a line in the doc
 *
 * `script/m14/incoming-check.ts` measures `ambiguousTargets`, and it is right
 * about what it says: a target string that resolves to more than one published
 * symbol. But it resolves against
 *
 *   const published = new Map<string, string[]>()   // incoming-check.ts:107
 *
 * keyed on NAME, with the kinds as the value and **the file discarded** (lines
 * 134-146). So a name declared in `a.nim` and again in `b.nim` counts as
 * ambiguous — while every edge carries its own file and the reverse walk can
 * separate those two by exactly that. The figure is an upper bound that mixes
 * two different findings:
 *
 *   SAME-FILE ambiguity     the referring file declares the name more than once.
 *                           Overloading is ordinary Nim (`proc f` and `proc f`
 *                           with different arities; a field and a proc of the
 *                           same name). Nothing on the edge distinguishes them,
 *                           so this is irreducible without a qualified name.
 *   CROSS-FILE ambiguity    declared once in the referring file, more than once
 *                           across the indexed set. The edge's file already
 *                           decides it.
 *
 * It is §8 shared machinery, so it is not edited here. This instrument measures
 * the split instead, from the same production entry point, so the claim in the
 * doc can be a number rather than an adjective.
 *
 * ## What it reports, per relationship type
 *
 *   unique          the target resolves to exactly one published symbol
 *   sameFile        more than one published symbol IN THE EDGE'S OWN FILE
 *   crossFileOnly   more than one across the indexed set, exactly one in the
 *                   edge's own file — resolvable by the file the edge names
 *   unresolved      no published symbol carries that name anywhere
 *
 * ## The limit of this instrument, stated
 *
 * It resolves by NAME, like every instrument in this lane. A name that two
 * unrelated files both declare and that an edge in a THIRD file names is counted
 * `crossFileOnly` only if the third file also declares it — otherwise it is
 * `unresolved`, which conflates "external" with "never indexed" exactly as the
 * shared harness does. The `neverIndexedOnCorpusTree` column is the correction:
 * it names the unresolved targets that ARE written somewhere in the corpus, which
 * is the subset that is a defect rather than a third-party package.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type T = (typeof ALL_TYPES)[number]

const SUB = process.env.BB_NIM_AMBIGUITY_SUB ?? "compiler"
const LIMIT = Number(process.env.BB_NIM_AMBIGUITY_FILES ?? 240)

// ─────────────────────────────────────────────────── the file set
// Same discovery as the census — `git ls-files`, the production router, the
// 512 KB cap — narrowed to one subtree so the index universe and the edge
// universe are the same set, which is what makes the same-file column meaningful.
const files: { abs: string; dir: string; rel: string; repo: string }[] = []
const corpusFiles: { abs: string; rel: string; repo: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (detectLanguageFromPath(rel) !== "nim") continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    corpusFiles.push({ abs, rel, repo: e })
    if (SUB !== "all" && !rel.startsWith(SUB)) continue
    files.push({ abs, dir, rel, repo: e })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
corpusFiles.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const sample = files.slice(0, LIMIT)

// ─────────────────────────────────────────────────── index it
/** name -> file -> kinds. The file dimension is the whole point of this file. */
const published = new Map<string, Map<string, Set<string>>>()
const rels: { type: string; source: string; target: string; file: string }[] = []
const unresolvedEdges: { type: string; target: string }[] = []
let symbols = 0
let parseFailures = 0
let degraded = 0

const publish = (name: string, kind: string, file: string): void => {
  if (name.length === 0) return
  let byFile = published.get(name)
  if (!byFile) { byFile = new Map(); published.set(name, byFile) }
  let kinds = byFile.get(file)
  if (!kinds) { kinds = new Set(); byFile.set(file, kinds) }
  kinds.add(kind)
}

for (const f of sample) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
  if (!r) { parseFailures++; continue }
  if (r.fallback === true) degraded++
  const label = `${f.repo}/${f.rel}`
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    const kind = String(s?.kind ?? "")
    publish(name, kind, label)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) publish(q, kind, label)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    rels.push({
      type: String(rel?.type ?? ""), source: String(rel?.source ?? ""),
      target: String(rel?.target ?? ""), file: label,
    })
  }
}

// ─────────────────────────────────────────────────── classify every target
type Bucket = "unique" | "sameFile" | "crossFileOnly" | "unresolved"
const row = (): Record<Bucket, number> => ({ unique: 0, sameFile: 0, crossFileOnly: 0, unresolved: 0 })
const perType: Record<string, Record<Bucket, number>> = {}
for (const t of ALL_TYPES) perType[t] = row()
const offOntology: Record<string, number> = {}

// The unresolved targets, bucketed by how many files declare them at all, so
// "external package" and "we published it nowhere" do not share a column.
const unresolvedNames = new Map<string, number>()
const sameFileNames = new Map<string, number>()

for (const e of rels) {
  const t = e.type
  if (!perType[t]) { perType[t] = row(); offOntology[t] = (offOntology[t] ?? 0) + 1 }
  const byFile = published.get(e.target)
  if (!byFile) {
    perType[t].unresolved++
    unresolvedNames.set(e.target, (unresolvedNames.get(e.target) ?? 0) + 1)
    // stashed here, decided after the tree sweep; the label is what carries the
    // per-type split, because an `imports` target is a MODULE name and a module
    // name is written on a parse tree without being a declaration.
    unresolvedEdges.push({ type: t, target: e.target })
    continue
  }
  const total = [...byFile.values()].reduce((a, s) => a + s.size, 0)
  const here = byFile.get(e.file)
  const hereCount = here ? here.size : 0
  if (hereCount === 1 && total > 1) {
    perType[t].crossFileOnly++
  } else if (hereCount > 1) {
    perType[t].sameFile++
    sameFileNames.set(`${e.target}`, (sameFileNames.get(`${e.target}`) ?? 0) + 1)
  } else {
    // nothing in this file: either unique corpus-wide, or the name lives only
    // in other files. `total` decides.
    if (total === 1) perType[t].unique++
    else perType[t].crossFileOnly++
  }
}

// ─────────────────────────────────────────────────── the never-indexed correction
// An unresolved target that IS written on some corpus parse tree is a defect;
// one that is written nowhere is a third-party package. Measured on a bounded
// raw-parse sweep of the same repos, by DECLARATION NODE — no text matching.
const treeNames = new Set<string>()
{
  const DECL = new Set([
    "identifier", "type_identifier", "field_identifier", "const_identifier",
    "func_identifier", "proc_identifier", "method_identifier", "type_class",
    "type_concept", "type_object", "type_enum", "type_type",
  ])
  const walk = (node: any): void => {
    if (!node) return
    if (DECL.has(String(node.type)) && typeof node.text === "string") {
      const leaf = node.text.split(".").pop() ?? node.text
      const t = leaf.trim()
      if (t.length > 0) treeNames.add(t)
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i))
  }
  let swept = 0
  // The WHOLE corpus, not the indexed subset. Sweeping only the indexed files
  // would report every `calls` target declared in some other module as "never
  // indexed", which is the finding the deliverable explicitly separates out:
  // outside this index and absent from the corpus are opposite answers.
  for (const f of corpusFiles) {
    try {
      const src = readFileSync(f.abs, "utf8")
      const p = await (await import("../../../../src/ast/engine")).getParser("nim")
      const tree = p.parse(src)
      if (tree) { walk(tree.rootNode); swept++ }
    } catch { /* best effort: the column is a correction, not the measurement */ }
  }
  console.log(`raw-parse sweep for the never-indexed column: ${swept} of ${corpusFiles.length} corpus files, ${treeNames.size} declaration names`)
}

// Two denominators, because they answer different questions and the difference
// is the whole point: a NAME count says how many identifiers are affected, an
// EDGE count says how many rows of the graph are dangling.
let neverIndexedNames_n = 0
let externalNames_n = 0
let neverIndexedEdges = 0
let externalEdges = 0
const neverIndexedNames: string[] = []
const externalNames: string[] = []
for (const [name, edgeCount] of unresolvedNames) {
  if (treeNames.has(name)) { neverIndexedNames_n++; neverIndexedEdges += edgeCount; neverIndexedNames.push(name) }
  else { externalNames_n++; externalEdges += edgeCount; externalNames.push(name) }
}
const neverIndexed = neverIndexedNames_n
const external = externalNames_n

// Per-type, because the aggregate is not a finding on its own: `imports` names
// modules and `references` names types, and only one of those is a declaration
// that failed to publish.
const unresolvedPerType: Record<string, { outsideIndex: number; external: number }> = {}
for (const t of ALL_TYPES) unresolvedPerType[t] = { outsideIndex: 0, external: 0 }
for (const e of unresolvedEdges) {
  const k = (unresolvedPerType[e.type] ??= { outsideIndex: 0, external: 0 })
  if (treeNames.has(e.target)) k.outsideIndex++
  else k.external++
}

// ─────────────────────────────────────────────────── report
const pad = (s: string, n: number): string => String(s).padEnd(n)
const rpad = (s: string | number, n: number): string => String(s).padStart(n)
const pct = (a: number, b: number): string => (b === 0 ? "-" : `${((100 * a) / b).toFixed(1)}%`)

console.log(`nim ambiguity split — ${sample.length} file(s) of ${SUB}, ${symbols} symbols`)
console.log(`analyzer    : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`degraded parses: ${degraded}   parse failures: ${parseFailures}   edges: ${rels.length}`)
console.log(`distinct published names: ${published.size}`)
console.log("")
console.log(`${pad("type", 14)}${rpad("edges", 9)}${rpad("unique", 10)}${rpad("sameFile", 10)}${rpad("crossFile", 11)}${rpad("unresolved", 12)}   irreducible share`)
console.log("-".repeat(96))
let tEdges = 0, tUnique = 0, tSame = 0, tCross = 0, tUnres = 0
for (const t of ALL_TYPES) {
  const r = perType[t]
  const n = r.unique + r.sameFile + r.crossFileOnly + r.unresolved
  tEdges += n; tUnique += r.unique; tSame += r.sameFile; tCross += r.crossFileOnly; tUnres += r.unresolved
  console.log(`${pad(t, 14)}${rpad(n, 9)}${rpad(r.unique, 10)}${rpad(r.sameFile, 10)}${rpad(r.crossFileOnly, 11)}${rpad(r.unresolved, 12)}   ${pct(r.sameFile, n)}`)
}
console.log("-".repeat(96))
console.log(`${pad("TOTAL", 14)}${rpad(tEdges, 9)}${rpad(tUnique, 10)}${rpad(tSame, 10)}${rpad(tCross, 11)}${rpad(tUnres, 12)}   ${pct(tSame, tEdges)}`)
console.log("")
console.log(`IRREDUCIBLE (sameFile) is the only ambiguity an edge cannot resolve by its own file:`)
console.log(`  ${tSame} of ${tEdges} edges = ${pct(tSame, tEdges)}.  The shared harness counts`)
console.log(`  ${tSame + tCross} of them ambiguous, so it overstates this lane by ${tCross} edges.`)
const topSame = [...sameFileNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
if (topSame.length) {
  console.log(`  most frequent same-file ambiguous names: ${topSame.map(([k, v]) => `${k}(${v})`).join(" ")}`)
}
console.log("")
console.log(`UNRESOLVED ${tUnres} edges / ${unresolvedNames.size} distinct target names, against an INDEX of ${sample.length} file(s) and a CORPUS of ${corpusFiles.length}:`)
console.log(`  on a corpus parse tree, NOT in this index — OUTSIDE THE INDEX UNIVERSE : ${neverIndexedNames_n} names, ${neverIndexedEdges} edges`)
console.log(`  on no corpus parse tree at all — EXTERNAL / third-party               : ${externalNames_n} names, ${externalEdges} edges`)
console.log(`  The first column is NOT called a defect, because this index is ${sample.length} files and the corpus is ${corpusFiles.length}.`)
console.log(`  A whole-project index publishes most of it, so the column BOUNDS the defect rather`)
console.log(`  than establishing one. What establishes it is this same classification with the index`)
console.log(`  universe EQUAL to the corpus: validation/m14/measurements/nim/resolution-audit.txt`)
// READ the sibling artifact rather than quoting its number. This line used to
// carry a hardcoded "over 4,555 files and its TREE-ONLY column is 91 edges",
// which was correct when written and wrong the moment the corpus grew — a quoted
// figure in an instrument's own output is the same drift the doc keeps finding
// in hand-written prose, except here it would have been printed by a command
// that otherwise looks reproducible. If the artifact is absent or unreadable the
// line says so instead of falling back to a remembered number.
const SIBLING = path.resolve((import.meta as any).dirname ?? ".", "../../measurements/nim/resolution-audit.json")
let siblingLine = "  [not available: validation/m14/measurements/nim/resolution-audit.json is absent — run resolution-audit.ts]"
try {
  const sib = JSON.parse(readFileSync(SIBLING, "utf8"))
  const rows = Array.isArray(sib.targets) ? sib.targets : []
  const total = rows.reduce((a: number, r: any) => a + (Number(r?.treeDeclaredOnly) || 0), 0)
  const split = rows.filter((r: any) => (Number(r?.treeDeclaredOnly) || 0) > 0)
    .map((r: any) => `${r.type} ${r.treeDeclaredOnly}`).join(", ")
  siblingLine = `  does exactly that over ${sib.files ?? "?"} files and its TREE-ONLY column is ${total} edges`
    + (split ? ` (${split})` : "") + " — read from the artifact, not quoted."
} catch { /* the declared absence above is the answer */ }
console.log(siblingLine)
if (neverIndexedNames.length) console.log(`  never-indexed names: ${neverIndexedNames.slice(0, 20).join(" ")}`)
// Named examples, per type: a count of unresolvable targets is not actionable and
// the deliverable asks for the name, not the adjective.
const unresolvedByType: Record<string, Map<string, number>> = {}
for (const e of unresolvedEdges) {
  const m = (unresolvedByType[e.type] ??= new Map())
  m.set(e.target, (m.get(e.target) ?? 0) + 1)
}
const offKeys = Object.keys(offOntology)
console.log(`edge types outside the 10-type ontology: ${offKeys.length ? offKeys.join(" ") : "none"}`)
console.log("")
console.log(`most frequent UNRESOLVED targets per type, marked with where the corpus writes the name:`)
for (const t of ALL_TYPES) {
  const m = unresolvedByType[t]
  if (!m || m.size === 0) continue
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`  ${pad(t, 13)} ${top.map(([k, v]) => `${k}(${v})${treeNames.has(k) ? "*" : ""}`).join(" ")}`)
}
console.log(`  * = written on some corpus parse tree but absent from this ${sample.length}-file index —`)
console.log(`      OUTSIDE THE INDEX UNIVERSE, which is not the same finding as external and is not yet a defect`)
console.log("")
console.log(`${pad("type", 14)}${rpad("unresolved", 12)}${rpad("outsideIndex", 14)}${rpad("external", 11)}   outsideIndex is bounded by the index size, not a verdict`)
console.log("-".repeat(72))
for (const t of ALL_TYPES) {
  const k = unresolvedPerType[t]
  if (k.outsideIndex + k.external === 0) continue
  console.log(`${pad(t, 14)}${rpad(k.outsideIndex + k.external, 12)}${rpad(k.outsideIndex, 14)}${rpad(k.external, 11)}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    analyzerSha256: HASH_BEFORE, analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
    sub: SUB, files: sample.length, filesAvailable: files.length,
    corpusFilesSweptForDeclarations: treeNames.size > 0 ? corpusFiles.length : 0, symbols,
    parseFailures, degraded, edges: rels.length, distinctPublishedNames: published.size,
    perType, offOntology,
    totals: { edges: tEdges, unique: tUnique, sameFile: tSame, crossFileOnly: tCross, unresolved: tUnres },
    unresolvedPerType,
    topUnresolvedByType: Object.fromEntries(Object.entries(unresolvedByType).map(([k, m]) => [k, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)])),
    topUnresolvedDeclaredOnCorpusTree: Object.fromEntries(Object.entries(unresolvedByType).map(([k, m]) => [k, [...m.entries()].filter(([n]) => treeNames.has(n)).sort((a, b) => b[1] - a[1]).slice(0, 25)])),
    unresolvedSplit: {
      unresolvedEdges: tUnres, unresolvedNames: unresolvedNames.size,
      outsideIndexUniverse: { names: neverIndexedNames_n, edges: neverIndexedEdges, note: "declared on a corpus parse tree, absent from this index; a whole-project index publishes most of these, so this BOUNDS the defect rather than establishing it. The whole-corpus measurement is resolution-audit.txt's TREE-ONLY column." },
      neverIndexedOnCorpusTree: { names: neverIndexedNames_n, edges: neverIndexedEdges },
      external: { names: externalNames_n, edges: externalEdges },
    },
    neverIndexedNames: neverIndexedNames.slice(0, 200),
    sameFileAmbiguousNames: [...sameFileNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100),
    corpusDeclarationNamesSeen: treeNames.size,
    declaredLimit: "resolves by NAME, so a name two unrelated files share is crossFileOnly or unresolved; the never-indexed column is the correction and is itself a bounded sweep",
  }, null, 2))
  console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${analyzerHash() === HASH_BEFORE ? "  (unchanged — every number above is tied to this analyzer state)" : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states and are not reproducible"}`)
  console.log(`\nwrote ${OUT}`)
}