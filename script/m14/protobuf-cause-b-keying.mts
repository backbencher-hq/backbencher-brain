/**
 * PROTOBUF LANE — the shared `diagnose-incoming.mts` cause-B number, on the key the
 * store actually binds.
 *
 * ## Why this file exists
 *
 * `script/m14/diagnose-incoming.mts` (aggregate `analyzers/ontology-laptop-b`) reports,
 * for this lane on 80 files:
 *
 *     EDGES recoverable by fixing the name function: 3976
 *     by edge type: {"contains":3283,"uses":693}
 *
 * and the brief offers a proven recipe for exactly that shape: make the edge target
 * equal the published `name`. Applying that recipe here would mean retargeting 3,976
 * edges at bare leaf names, which pass 5 measured as the defect rather than the fix —
 * publishing the bare name took store-bound edges that named the declaration they were
 * about from 96.81% to 0 of 3,075 provably.
 *
 * The two measurements disagree because they key on different fields. `diagnose-incoming`
 * builds `byName` from `s.name`. This lane publishes the id on BOTH `s.qualifiedName`
 * and `s.metadata.qualifiedName` (`real-protobuf-analyzer.ts:451,488`) precisely so that
 * `resolveRelationships` strategy 1 can match `target_external` against
 * `brain_symbol.qualified_name` deterministically instead of taking the store's
 * first-wins leaf fallback.
 *
 * So the question is not "is 3,976 right" but "under which key", and the answer decides
 * whether 3,976 edges are recoverable or 0 are. This probe measures BOTH keys on ONE
 * walk of ONE file set, so the comparison is not two runs disagreeing.
 *
 * ## What it reports
 *
 *   KEY `name`           — what the shared instrument measures
 *   KEY `qualifiedName`  — the column strategy 1 matches, i.e. the store's binding key
 *   KEY `metadata.id`    — the same value, and it does NOT survive pool-worker's
 *                          projection, so it is measured here to show why publishing only
 *                          it bought nothing (pass 5's "3,075 edges, ~3,000 bound, 0
 *                          provably" is this row)
 *
 * For each key: distinct targets resolved / unresolved, and the shared tool's own
 * last-segment heuristic applied to what stays unresolved. Only the B-class remainder —
 * a target whose FINAL SEGMENT is a published name under that key but whose full string
 * is not — is genuinely "one canonical name function away".
 *
 * ## No regex
 *
 * The walk is `execFileSync` over `find`; the language filter is `endsWith(".proto")`;
 * the final-segment split is `lastIndexOf(".")` + `slice`. No pattern literal appears.
 *
 * ## Usage
 *
 *   npx tsx script/m14/protobuf-cause-b-keying.mts [fileCount] [--out /path.json] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const NUM = argv.find((a) => /^[0-9]+$/.test(a)) ?? "80"
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/cause-b-keying.json"
const JSON_ONLY = argv.includes("--json")

const files = execFileSync(
  "bash",
  ["-lc", `find ${CR} -name '*.proto' -type f | sort | head -${NUM}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)

const TYPE = { name: new Map<string, Set<string>>(), qualifiedName: new Map<string, Set<string>>(), metadataId: new Map<string, Set<string>>() }
const edges: { t: string; type: string; file: string }[] = []
let parsed = 0
let failed = 0

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, CR)
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    const push = (m: Map<string, Set<string>>, k: unknown) => {
      const key = String(k ?? "")
      if (!key) return
      let set = m.get(key)
      if (!set) m.set(key, (set = new Set()))
      set.add(f)
    }
    push(TYPE.name, s.name)
    push(TYPE.qualifiedName, s.qualifiedName)
    push(TYPE.metadataId, s.metadata?.id ?? s.metadata?.qualifiedName)
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? ""), file: f })
  }
}

const distinct = [...new Set(edges.map((e) => e.t))]

/** the shared tool's B heuristic: final segment is published under THIS key */
const bClass = (m: Map<string, Set<string>>, t: string): boolean => {
  if (!t.includes(".")) return false
  const i = t.lastIndexOf(".")
  return m.has(t.slice(i + 1))
}

/**
 * The shared heuristic fires on any dotted target whose text after the LAST dot is a
 * published name. A module path ends in a FILE EXTENSION, so `"google/protobuf/
 * timestamp.proto"` tests against the name `proto` — and `proto` IS published, as
 * `kind=namespace`, by every file under a directory named `proto`. So the whole
 * module-path population self-matches and the heuristic calls it recoverable.
 *
 * This is partitioned rather than asserted: a B-class target is counted as
 * module-path-shaped (`includes("/")`, a character search) and the extension that
 * matched is named, so a reader can see that the matched segment is `proto` and not a
 * declaration of `proto`.
 */
const lastSegmentOf = (t: string): string => {
  const i = t.lastIndexOf(".")
  return i < 0 ? t : t.slice(i + 1)
}

const report: any = {
  population: {
    corpusRoot: CR,
    fileCount: files.length,
    parsed,
    failed,
    sampling: `find -name '*.proto' -type f | sort | head -${NUM}  (the shared diagnose-incoming population, verbatim)`,
    firstFile: files[0],
    lastFile: files[files.length - 1],
  },
  totals: {
    edges: edges.length,
    distinctTargets: distinct.length,
    publishedNames: TYPE.name.size,
    publishedQualifiedNames: TYPE.qualifiedName.size,
    publishedMetadataIds: TYPE.metadataId.size,
  },
  keys: {},
}

for (const key of ["name", "qualifiedName", "metadataId"] as const) {
  const m = TYPE[key]
  const resolved = distinct.filter((t) => m.has(t))
  const unresolved = distinct.filter((t) => !m.has(t))
  const bTargets = unresolved.filter((t) => bClass(m, t))
  const bModulePath = bTargets.filter((t) => t.includes("/"))
  const bNotModulePath = bTargets.filter((t) => !t.includes("/"))
  const bMatchedSegments = new Map<string, number>()
  for (const t of bModulePath) {
    const seg = lastSegmentOf(t)
    bMatchedSegments.set(seg, (bMatchedSegments.get(seg) ?? 0) + 1)
  }
  const cost = new Map<string, number>()
  for (const e of edges) {
    if (m.has(e.t)) continue
    if (!bClass(m, e.t)) continue
    cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
  }
  report.keys[key] = {
    resolvedTargets: resolved.length,
    unresolvedTargets: unresolved.length,
    resolutionRateTargets: Number(((100 * resolved.length) / distinct.length).toFixed(2)),
    bClassTargets: bTargets.length,
    bClassEdges: [...cost.values()].reduce((a, b) => a + b, 0),
    bClassEdgesByType: Object.fromEntries([...cost].sort((a, b) => b[1] - a[1])),
    bClassExamples: bTargets.slice(0, 5),
    bClassModulePathTargets: bModulePath.length,
    bClassModulePathMatchedSegments: Object.fromEntries([...bMatchedSegments].sort((a, b) => b[1] - a[1]).slice(0, 5)),
    bClassNonModulePathTargets: bNotModulePath.length,
    bClassNonModulePathEdges: edges.filter((e) => !m.has(e.t) && bClass(m, e.t) && !e.t.includes("/")).length,
    bClassNonModulePathExamples: bNotModulePath.slice(0, 5),
  }
}

// ---- A: is the published ID an identifier? Keyed on `qualifiedName`, the column
// strategy 1 matches. An id published by MORE THAN ONE FILE is the condition under
// which a reverse walk picks a winner nobody chose.
const qFiles = new Map<string, Set<string>>()
const qName = new Map<string, Set<string>>()
const qKind = new Map<string, Set<string>>()
for (const f of files) {
  const r: any = await parseFile(f, CR)
  for (const s of r?.symbols ?? []) {
    const k = String(s.qualifiedName ?? "")
    if (!k) continue
    if (!qFiles.has(k)) {
      qFiles.set(k, new Set())
      qName.set(k, new Set())
      qKind.set(k, new Set())
    }
    qFiles.get(k)!.add(f)
    qName.get(k)!.add(String(s.name))
    qKind.get(k)!.add(String(s.kind))
  }
}
const ambiguousIds = [...qFiles.entries()].filter(([, v]) => v.size > 1)
const ambHist = new Map<string, number>()
for (const [, v] of ambiguousIds) {
  const k = v.size > 10 ? "11+" : String(v.size)
  ambHist.set(k, (ambHist.get(k) ?? 0) + 1)
}
// Two ids colliding while carrying DIFFERENT declaration names are two different
// symbols sharing a published id — unrepairable inside one analyzer. Same name, same
// kind, many files is one declaration vendored — the corpus's shape, not the analyzer's.
const ambDistinctNames = ambiguousIds.filter(([k]) => (qName.get(k)?.size ?? 0) > 1)
report.causeA = {
  publishedIds: qFiles.size,
  idsPublishedByMoreThanOneFile: ambiguousIds.length,
  ofThoseCarryingMoreThanOneDistinctName: ambDistinctNames.length,
  filesPerCollidingIdHistogram: Object.fromEntries([...ambHist].sort((a, b) => a[0].localeCompare(b[0]))),
  edgesTargetingACollidingId: edges.filter((e) => (qFiles.get(e.t)?.size ?? 0) > 1).length,
  worstIds: ambiguousIds
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5)
    .map(([k, v]) => `${v.size} files  ${k}  names=${JSON.stringify([...(qName.get(k) ?? [])])}  kinds=${JSON.stringify([...(qKind.get(k) ?? [])])}`),
  note:
    "Keyed on qualifiedName. `name` is deliberately NOT used as the id: this lane publishes " +
    "the fully-qualified id on both channels so strategy 1 binds deterministically, and a " +
    "bare name is not an identifier for a protobuf declaration.",
}

// ---- C: what stays unresolved on the binding key, partitioned by whether the corpus
// can answer it at all.
const unresolvedOnQ = distinct.filter((t) => !TYPE.qualifiedName.has(t))
const corpusBasenames = new Map<string, string[]>()
for (const f of files) {
  const b = f.slice(f.lastIndexOf("/") + 1)
  if (!corpusBasenames.has(b)) corpusBasenames.set(b, [])
  corpusBasenames.get(b)!.push(f)
}
const cNamesCorpusFile = unresolvedOnQ.filter((t) => {
  const b = t.slice(t.lastIndexOf("/") + 1)
  return corpusBasenames.has(b)
})
const cNoCorpusFile = unresolvedOnQ.filter((t) => {
  const b = t.slice(t.lastIndexOf("/") + 1)
  return !corpusBasenames.has(b)
})
// A target naming no corpus file AND matching a well-known-type or stdlib spelling is
// external by design. The spellings checked are literal string prefixes, not patterns.
const EXTERNAL_PREFIXES = [
  "google.protobuf.", "google/protobuf/", "google.api.", "google/type/",
  "google/rpc/", "protoc-gen-", "validate/", "envoy/", "grpc/",
]
const cExternalShaped = cNoCorpusFile.filter((t) => EXTERNAL_PREFIXES.some((p) => t.startsWith(p)))
const cUnexplained = cNoCorpusFile.filter((t) => !EXTERNAL_PREFIXES.some((p) => t.startsWith(p)))
report.causeC = {
  unresolvedTargetsOnBindingKey: unresolvedOnQ.length,
  namingACorpusFileByBasename: cNamesCorpusFile.length,
  namingNoCorpusFile: cNoCorpusFile.length,
  ofThoseExternalShaped: cExternalShaped.length,
  ofThoseUnexplained: cUnexplained.length,
  unexplainedExamples: cUnexplained.slice(0, 12),
  externalShapedExamples: cExternalShaped.slice(0, 6),
  edgesOnUnexplainedTargets: edges.filter((e) => cUnexplained.includes(e.t)).length,
  note:
    "Basename resolution is over the 842-file population, so a target naming a .proto OUTSIDE " +
    "it is counted as naming no corpus file. `namingACorpusFileByBasename` is class U1 in this " +
    "lane's pass-20 partition; the remainder is U2/U4. The external check is a literal prefix " +
    "list, so a well-known type spelled some other way lands in `unexplained`, not in `external`.",
}

// Which key does the STORE bind on? Pass 5 established strategy 1 compares
// target_external against brain_symbol.qualified_name. This measures how many edges
// name a symbol under that key, which is the number that matters for bb_impact.
const q = TYPE.qualifiedName
const edgesOnQ = edges.filter((e) => q.has(e.t)).length
const edgesOnNameOnly = edges.filter((e) => !q.has(e.t) && TYPE.name.has(e.t)).length
report.storeBinding = {
  edgesNamingAPublishedQualifiedName: edgesOnQ,
  edgesNamingOnlyABarePublishedName: edgesOnNameOnly,
  note:
    "strategy 1 matches target_external against brain_symbol.qualified_name. An edge in " +
    "edgesNamingOnlyABarePublishedName does NOT match it and falls through to the store's " +
    "leaf-name first-wins fallback, which is the non-determinism pass 5 measured.",
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`population ${report.population.fileCount} files (parsed ${parsed}, failed ${failed})`)
  console.log(`sampling: ${report.population.sampling}`)
  console.log(`edges ${report.totals.edges}   distinct targets ${report.totals.distinctTargets}`)
  console.log(`published: name ${report.totals.publishedNames}  qualifiedName ${report.totals.publishedQualifiedNames}  metadataId ${report.totals.publishedMetadataIds}`)
  console.log()
  console.log("cause B under each key, same walk, same files:")
  for (const key of ["name", "qualifiedName", "metadataId"] as const) {
    const r = report.keys[key]
    console.log(`  ${key.padEnd(15)} resolved ${String(r.resolvedTargets).padStart(5)}/${report.totals.distinctTargets} (${r.resolutionRateTargets}%)  unresolved ${String(r.unresolvedTargets).padStart(5)}  B-class ${String(r.bClassEdges).padStart(5)} edges  ${JSON.stringify(r.bClassEdgesByType)}`)
    console.log(`  ${"".padEnd(15)} of which NOT a module path: ${r.bClassNonModulePathTargets} targets / ${r.bClassNonModulePathEdges} edges; module-path targets matched on: ${JSON.stringify(r.bClassModulePathMatchedSegments)}`)
  }
  console.log()
  console.log(`store binding (strategy 1 / brain_symbol.qualified_name):`)
  console.log(`  edges naming a published qualifiedName: ${edgesOnQ}`)
  console.log(`  edges naming ONLY a bare published name:  ${edgesOnNameOnly}`)
  console.log()
  console.log(`A  name is not an identifier (keyed on qualifiedName):`)
  console.log(`  published ids ${report.causeA.publishedIds}   ids in >1 file ${report.causeA.idsPublishedByMoreThanOneFile}   of those, >1 distinct name ${report.causeA.ofThoseCarryingMoreThanOneDistinctName}`)
  console.log(`  edges targeting a colliding id: ${report.causeA.edgesTargetingACollidingId}`)
  console.log(`  files-per-colliding-id: ${JSON.stringify(report.causeA.filesPerCollidingIdHistogram)}`)
  for (const w of report.causeA.worstIds) console.log(`    ${w}`)
  console.log()
  console.log(`C  external / genuinely absent, on the binding key:`)
  console.log(`  unresolved targets ${report.causeC.unresolvedTargetsOnBindingKey}`)
  console.log(`    naming a corpus file by basename: ${report.causeC.namingACorpusFileByBasename}`)
  console.log(`    naming no corpus file:            ${report.causeC.namingNoCorpusFile}`)
  console.log(`      external-shaped:                ${report.causeC.ofThoseExternalShaped}`)
  console.log(`      UNEXPLAINED:                    ${report.causeC.ofThoseUnexplained}  (${report.causeC.edgesOnUnexplainedTargets} edges)`)
  if (report.causeC.unexplainedExamples.length) console.log(`      e.g. ${JSON.stringify(report.causeC.unexplainedExamples)}`)
}
writeFileSync(OUT, JSON.stringify(report, null, 2))