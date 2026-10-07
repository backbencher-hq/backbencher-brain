/**
 * DERIV_EXPORTS_CLOJ — the ONTOLOGY CENSUS: what the PRODUCTION path actually emits.
 *
 * ## Why this file exists
 *
 * Source derivation — counting which `RelationshipType` members appear in
 * `real-clojure-analyzer.ts` — answers exactly one question: is a type
 * CONSTRUCTIBLE. It cannot answer whether it FIRES, because a branch reachable
 * only through a predicate that never matches is indistinguishable from a
 * constructible one by reading. Claiming 10/10 from a source scan misled this
 * programme for a week.
 *
 * So this census runs `parseFile` (src/ast/pool-worker.ts) — the production
 * entry, not `analyze()` — over a real corpus, and reports, per relationship
 * type: the count, the files it came from, the confidence histogram, and the
 * three R7 endpoint checks. Imports and exports are tallied on THEIR OWN
 * channels (`ParseResult.imports`, `ParseResult.exports`), because a count of
 * zero on the relationship channel for a type that lives on another channel is
 * a property of the CHANNEL, not a defect in the emitter
 * (src/ast/types.ts:206-216; parallel-indexer writes `brain_import`, a table).
 *
 * ## No regex
 *
 * Zero regular expressions. Every string test is `includes` / `startsWith` /
 * `endsWith` or a char scan, and every structural question is asked of the
 * AST through node type and named children. A regex over source text matches
 * comments and string literals, misses nested syntax, and breaks silently on
 * the next grammar version.
 *
 * ## Usage
 *
 *     bun script/m14/clj-ontology-census.ts                 # clj-kondo (lane corpus)
 *     REPO=clojure bun script/m14/clj-ontology-census.ts    # a different corpus
 *     bun script/m14/clj-ontology-census.ts --fresh         # ignore the checkpoint
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { resumableWalk, resetCheckpoint } from "./resumable-walk"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.REPO ?? "clj-kondo"
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Placeholder literals that may never appear as an edge endpoint (rule R7). */
const PLACEHOLDER_ENDPOINTS = new Set(["unknown", "?", "", "<unknown>", "(anonymous)"])

const OUT = `validation/m14/measurements/clj-ontology-${REPO}.json`
if (process.argv.includes("--fresh")) resetCheckpoint(OUT + ".walk")
mkdirSync(path.dirname(OUT), { recursive: true })

// ------------------------------------------------------------------ population
// DERIVED from the corpus directory, never hand-written: a hard-coded file list
// rots silently and the instrument keeps reporting 0 with total confidence
// (M14-HONESTY-CONTRACT §"an instrument must declare the population it covered").
const root = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  }).split("\0").filter(Boolean)
} catch {
  console.error(`no git repo at ${root} — cannot derive the population.`)
  process.exit(2)
}

const files: { abs: string; rel: string; text: string }[] = []
let rejectedByLanguage = 0
let rejectedBySize = 0
for (const rel of tracked) {
  const abs = path.join(root, rel)
  let size: number
  try { size = statSync(abs).size } catch { continue }
  if (size > 512 * 1024) { rejectedBySize++; continue }
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(abs, text) !== "clojure") { rejectedByLanguage++; continue }
  files.push({ abs, rel, text })
}
console.log(`DERIV_EXPORTS_CLOJ — ontology census`)
console.log(`corpus: ${REPO}  (${root})`)
console.log(`population: ${files.length} clojure files, DERIVED from git ls-files (${tracked.length} tracked,`)
console.log(`             ${rejectedByLanguage} not detected as clojure, ${rejectedBySize} over 512 KiB)`)

// ------------------------------------------------------------------ accumulators
//
// The tally is accumulated from an APPEND-ONLY per-file JSONL, not from the live
// process. `resumableWalk` skips files an earlier run already walked, so a naive
// census reports ZERO for everything on its second run — the counts would be a
// function of which files THIS process happened to parse, which is the
// "correct number about the wrong population" defect wearing a fresh hat.
// Measured: the first run of this census wrote 10,464 edges; the immediate
// re-run, resuming from its own checkpoint, printed 0 of every type.
const JSONL = OUT + ".files.jsonl"
if (process.argv.includes("--fresh")) { try { unlinkSync(JSONL) } catch {} }
type Rec = {
  rel: string
  symbols: number
  emptyNames: number
  unknownKinds: number
  parseError: boolean
  localNames: string[]
  imports: { module: string }[]
  exports: { name: string }[]
  rels: {
    t: string
    s: string
    g: string
    c: number | null
    rt: string
    ec: string
    line: number | null
  }[]
}
const walkStats = await resumableWalk(OUT + ".walk", files.length, {
  id: (i) => files[i].abs,
  concurrency: 8,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, root)
    const syms: any[] = r.symbols ?? []
    const localNames: string[] = []
    let emptyNames = 0
    let unknownKinds = 0
    for (const s of syms) {
      const n = String(s?.name ?? "")
      if (n === "") emptyNames++
      const k = String(s?.kind ?? "")
      if (k === "" || k === "unknown") unknownKinds++
      localNames.push(n)
      const q = String(s?.qualifiedName ?? s?.fqn ?? s?.scope ?? "")
      if (q) localNames.push(q)
    }
    const rec: Rec = {
      rel: f.rel,
      symbols: syms.length,
      emptyNames,
      unknownKinds,
      parseError: (r.errors ?? []).some((e: any) => String(e?.message ?? "").includes("ParseError")),
      localNames,
      imports: (r.imports ?? []).map((x: any) => ({ module: String(x?.module ?? "") })),
      exports: (r.exports ?? []).map((x: any) => ({ name: String(x?.name ?? "") })),
      rels: (r.relationships ?? []).map((x: any) => ({
        t: String(x?.type ?? x?.relationshipType ?? ""),
        s: String(x?.source ?? x?.from ?? ""),
        g: String(x?.target ?? x?.to ?? ""),
        c: typeof x?.confidence === "number" ? x.confidence : null,
        rt: String(x?.metadata?.relationshipType ?? "(none)"),
        ec: String(x?.metadata?.evidenceClass ?? "(none)"),
        line: typeof x?.line_number === "number" ? x.line_number : null,
      })),
    }
    appendFileSync(JSONL, JSON.stringify(rec) + "\n")
  },
})

// ------------------------------------------------------------------ aggregate
interface Row {
  n: number
  files: Set<string>
  conf: Map<string, number>
  relType: Map<string, number>
  evidenceClass: Map<string, number>
  badEndpoints: { source: number; target: number; examples: string[] }
  /** per-EDGE resolution, not per-endpoint: an edge can name the same owner 12 times. */
  resolution: { bothFile: number; srcOnlyFile: number; tgtOnlyFile: number; neitherFile: number }
  resolutionCorpus: { both: number; srcOnly: number; tgtOnly: number; neither: number }
  /** distinct endpoints of each side, and how many of them resolve — a repeat-count free view */
  endpoints: { src: Set<string>; tgt: Set<string> }
  selfLoops: number
  examples: string[]
  unresolvedExamples: string[]
}
const blank = (): Row => ({
  n: 0, files: new Set(), conf: new Map(), relType: new Map(), evidenceClass: new Map(),
  badEndpoints: { source: 0, target: 0, examples: [] },
  resolution: { bothFile: 0, srcOnlyFile: 0, tgtOnlyFile: 0, neitherFile: 0 },
  resolutionCorpus: { both: 0, srcOnly: 0, tgtOnly: 0, neither: 0 },
  endpoints: { src: new Set(), tgt: new Set() },
  selfLoops: 0, examples: [], unresolvedExamples: [],
})
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, blank())

/** every symbol name the corpus produced, for the corpus-wide resolution check */
const corpusSymbolNames = new Set<string>()

let importRows = 0
let importFiles = 0
let importExample = ""
let exportRows = 0
let exportFiles = 0
let exportExample = ""
let offEnum = new Map<string, number>()
let symbolTotal = 0
let emptySymbolNames = 0
let unknownSymbolKinds = 0
let filesWithErrorNodes = 0
let recordsRead = 0

// PASS 1 — collect. The corpus-wide resolution check needs the WHOLE universe of
// symbol names before it can ask whether an endpoint is in it, so the two passes
// are separated deliberately: a single pass makes the answer depend on directory
// order, which is precisely the "correct number about the wrong population" shape.
const admitted = new Set(files.map((f) => f.rel))
const recs: Rec[] = []
for (const line of readFileSync(JSONL, "utf8").split("\n")) {
  const t = line.trim()
  if (!t) continue
  const rec: Rec = JSON.parse(t)
  recordsRead++
  if (!admitted.has(rec.rel)) continue
  for (const n of rec.localNames) corpusSymbolNames.add(n)
  recs.push(rec)
}

// PASS 2 — tally.
for (const rec of recs) {
  symbolTotal += rec.symbols
  emptySymbolNames += rec.emptyNames
  unknownSymbolKinds += rec.unknownKinds
  if (rec.parseError) filesWithErrorNodes++
  const localNames = new Set(rec.localNames)
  if (rec.imports.length) importFiles++
  importRows += rec.imports.length
  if (!importExample && rec.imports.length) importExample = `${REPO}/${rec.rel}`
  if (rec.exports.length) exportFiles++
  exportRows += rec.exports.length
  if (!exportExample && rec.exports.length) exportExample = `${REPO}/${rec.rel} :: ${rec.exports[0].name}`

  for (const rel of rec.rels) {
    const row0 = rows.get(rel.t as Type)
    if (!row0) {
      offEnum.set(rel.t, (offEnum.get(rel.t) ?? 0) + 1)
      continue
    }
    const row = row0
    row.n++
    row.files.add(`${REPO}/${rec.rel}`)
    if (row.examples.length < 3) row.examples.push(`${rel.s} -> ${rel.g} @${rel.line ?? "?"}`)
    row.conf.set(rel.c === null ? "ABSENT" : rel.c.toFixed(2), (row.conf.get(rel.c === null ? "ABSENT" : rel.c.toFixed(2)) ?? 0) + 1)
    row.relType.set(rel.rt, (row.relType.get(rel.rt) ?? 0) + 1)
    row.evidenceClass.set(rel.ec, (row.evidenceClass.get(rel.ec) ?? 0) + 1)
    row.endpoints.src.add(rel.s)
    row.endpoints.tgt.add(rel.g)
    const label = `${REPO}/${rec.rel}:${rel.line ?? "?"} ${rel.s} -> ${rel.g}`
    for (const [which, v] of [["source", rel.s], ["target", rel.g]] as const) {
      if (!PLACEHOLDER_ENDPOINTS.has(v.trim().toLowerCase())) continue
      if (which === "source") row.badEndpoints.source++
      else row.badEndpoints.target++
      if (row.badEndpoints.examples.length < 5) row.badEndpoints.examples.push(`${which}:${label}`)
    }
    // Resolution is counted PER EDGE. Counting per endpoint and dividing by 2n
    // produces a NEGATIVE percentage the moment one owner appears on 12 edges —
    // which is the normal shape for `implements`, where a record names several
    // protocols and every one of them points at the same owner.
    const sf = localNames.has(rel.s)
    const tf = localNames.has(rel.g)
    row.resolution[sf ? (tf ? "bothFile" : "tgtOnlyFile") : tf ? "srcOnlyFile" : "neitherFile"]++
    const sc = corpusSymbolNames.has(rel.s)
    const tc = corpusSymbolNames.has(rel.g)
    row.resolutionCorpus[sc ? (tc ? "both" : "tgtOnly") : tc ? "srcOnly" : "neither"]++
    if (!tf && row.unresolvedExamples.length < 6) row.unresolvedExamples.push(`target: ${label}`)
    if (!sf && row.unresolvedExamples.length < 6) row.unresolvedExamples.push(`source: ${label}`)
    if (rel.s === rel.g && rel.s !== "") row.selfLoops++
  }
}

const pct = walkStats.total === 0 ? 0 : ((walkStats.walked + walkStats.alreadyDone) / walkStats.total) * 100
console.log(`walk: ${walkStats.walked + walkStats.alreadyDone}/${walkStats.total} (${pct.toFixed(1)}%)  newly ${walkStats.walked}  resumed ${walkStats.alreadyDone}  bad ${walkStats.skippedBad}${walkStats.partial ? "  PARTIAL" : ""}`)
if (walkStats.partial) {
  console.log(`      every count below is over ${pct.toFixed(1)}% of the population. A resumed walk produces the`)
  console.log(`      SAME counts as a complete one over the files it did see — the counts do not know they`)
  console.log(`      are smaller. ${walkStats.skippedBad} file(s) excluded as unparseable/hanging.`)
}
console.log(`symbols: ${symbolTotal}   empty names: ${emptySymbolNames}   empty/unknown kinds: ${unknownSymbolKinds}   files with a ParseError warning: ${filesWithErrorNodes}`)
console.log(`imports[]  channel: ${importRows} rows in ${importFiles} files   e.g. ${importExample}`)
console.log(`exports[]  channel: ${exportRows} rows in ${exportFiles} files   e.g. ${exportExample}`)
console.log(`corpus-wide symbol names: ${corpusSymbolNames.size}\n`)

// ------------------------------------------------------------------ report
const top = (m: Map<string, number>, k = 6) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => `${a}=${b}`).join("  ") || "(none)"

console.log("type          count  in-files  conf-histogram              both-ends-in-FILE  both-ends-in-CORPUS  self-loops")
console.log("-".repeat(160))
const table: any[] = []
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const both = r.n ? (100 * r.resolution.bothFile / r.n).toFixed(1) : "n/a"
  const bothC = r.n ? (100 * r.resolutionCorpus.both / r.n).toFixed(1) : "n/a"
  console.log(
    `${t.padEnd(12)} ${String(r.n).padStart(6)} ${String(r.files.size).padStart(8)}   ` +
    `${top(r.conf, 4).padEnd(28)} ${(both + "%").padStart(12)}  ${(bothC + "%").padStart(15)}  ${String(r.selfLoops).padStart(10)}`,
  )
  table.push({
    type: t, count: r.n, filesIn: r.files.size, fileExamples: [...r.files].slice(0, 8),
    confidence: Object.fromEntries(r.conf), relationshipTypeMeta: Object.fromEntries(r.relType),
    evidenceClass: Object.fromEntries(r.evidenceClass),
    placeholderEndpoints: r.badEndpoints, placeholderExamples: r.badEndpoints.examples,
    resolutionPerEdgeInFile: r.resolution, resolutionPerEdgeInCorpus: r.resolutionCorpus,
    distinctEndpoints: { source: r.endpoints.src.size, target: r.endpoints.tgt.size },
    unresolvedExamples: r.unresolvedExamples,
    selfLoops: r.selfLoops, examples: r.examples,
  })
}

console.log("\n--- per-type detail (only types with edges) ---")
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  if (r.n === 0) continue
  console.log(`\n${t}  ${r.n} edges in ${r.files.size} files  (distinct endpoints: ${r.endpoints.src.size} src / ${r.endpoints.tgt.size} tgt)`)
  console.log(`  files:   ${[...r.files].slice(0, 4).join(", ")}`)
  console.log(`  conf:    ${top(r.conf)}`)
  console.log(`  meta:    ${top(r.relType)}`)
  console.log(`  eclass:  ${top(r.evidenceClass)}`)
  console.log(`  e.g.:    ${r.examples.join("   |   ")}`)
  console.log(`  resolve: in-file ${top(new Map(Object.entries(r.resolution)) as any, 4)}`)
  console.log(`           corpus  ${top(new Map(Object.entries(r.resolutionCorpus)) as any, 4)}`)
  if (r.unresolvedExamples.length) {
    console.log(`  UNRESOLVED-IN-FILE examples:`)
    for (const e of r.unresolvedExamples) console.log(`      ${e}`)
  }
  if (r.selfLoops) console.log(`  SELF-LOOPS: ${r.selfLoops}`)
  if (r.badEndpoints.source + r.badEndpoints.target > 0) {
    console.log(`  >>> R7 PLACEHOLDER ENDPOINTS: ${r.badEndpoints.source} src / ${r.badEndpoints.target} tgt`)
    for (const e of r.badEndpoints.examples) console.log(`      ${e}`)
  }
}

if (offEnum.size) console.log(`\n>>> relationship types OUTSIDE the 10-type ontology: ${top(offEnum)}`)

writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  corpus: REPO, corpusRoot: CR,
  population: { tracked, admitted: files.length, rejectedByLanguage, rejectedBySize },
  walk: walkStats,
  symbols: { total: symbolTotal, emptyNames: emptySymbolNames, unknownKinds: unknownSymbolKinds, filesWithErrorNodes },
  importsChannel: { rows: importRows, files: importFiles, example: importExample },
  exportsChannel: { rows: exportRows, files: exportFiles, example: exportExample },
  corpusSymbolNames: corpusSymbolNames.size,
  types: table,
  offOntology: Object.fromEntries(offEnum),
}, null, 2))
console.log(`\nartifact: ${OUT}`)
