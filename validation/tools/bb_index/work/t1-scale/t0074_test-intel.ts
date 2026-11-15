import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type {
  TestEvidenceKind,
  TestGap,
  TestGapReport,
  TestImpactReport,
  TestIntelOptions,
  TestLink,
  TestMappingEntry,
  TestMappingReport,
} from "../contracts"
import { makeProvenance } from "../evidence"
// M57.T5 (#793): ONE non-code vocabulary, shared with the indexer's classifier
// (src/ast/test-classification.ts). The private copy this module used to own is
// exactly the drift the canonical definition exists to prevent.
import { NON_CODE_TEST_LANGUAGES } from "../../ast/test-classification"

const DIRECT_TYPES = new Set(["calls", "instantiates"])
const REFERENCE_TYPES = new Set(["references", "uses", "extends", "implements"])
const IMPORT_TYPES = new Set(["imports"])

const EVIDENCE_CONFIDENCE: Record<TestEvidenceKind, number> = {
  direct_call: 0.85,
  reference: 0.6,
  import: 0.4,
}

const PROD_SYMBOL_TYPES = "('function','method','class','interface','struct','enum')"

// M50.A2 residual — what counts as a test SOURCE.
//
// The indexer's `is_test_file` flag matches directory segments (…/spec/…) with
// no regard for file type, so on a real repo data fixtures are flagged as
// tests: 30 files, every one of them JSON (script/m14/spec/*-completeness.json,
// validation/m14/results/M14.0.SPEC.json). Trusting the flag alone made this
// engine report a "30 test files / 5,196 test symbols" corpus that is entirely
// data, and made every production symbol look "untested" while the engine had
// classified zero call/reference/import edges (all 4,651 relationships from
// those files are `contains`).
//
// A test source must therefore be code. Non-code flagged files are excluded
// from the test corpus here, and the exclusion is DECLARED in provenance.unknowns
// so a smaller corpus is never silent.
// M57.T5 (#793): the indexer-side misclassification is now FIXED at the source
// (test-classification.ts gates the flag on file type). The non-code vocabulary
// below is no longer a private copy — it is imported from the ONE definition
// so the indexer and this engine can never drift apart again.


/** SQL fragment: exclude non-code languages from a test-corpus predicate. */
export function codeTestClause(alias: string): { sql: string; params: string[] } {
  const col = alias ? `${alias}.language` : "language"
  return {
    sql: ` AND LOWER(COALESCE(${col}, '')) NOT IN (${NON_CODE_TEST_LANGUAGES.map(() => "?").join(", ")})`,
    params: [...NON_CODE_TEST_LANGUAGES],
  }
}

/** Default page size for the test-intelligence reports.
 *
 *  Measured on backbencher-brain/src: test_mapping at the old default of 1000
 *  rendered 375,270 bytes (~104k tokens) in ONE tool call, because every entry
 *  carries a `links` array. A default is a promise about what a caller gets
 *  without asking; this one is a page a caller can read, and a caller who
 *  wants the whole corpus passes `limit`. */
const DEFAULT_PAGE = 50

/** Cap on the `links` array inside one mapping entry. A utility called by 400
 *  tests would otherwise render 400 rows for a single symbol, and what a caller
 *  wants from that entry — is it tested, and how strongly — is unchanged by the
 *  380 rows after the first few. Capped and DECLARED; the ranking and the
 *  summary still use the complete set. */
const DEFAULT_MAX_LINKS = 20







/** Human-readable provenance token for a corpus that produced no evidence. */
const NO_EVIDENCE_UNKNOWN =
  "no-test-evidence-edges: no calls/references/imports relationship originates from a code test file, so every production symbol is reported untested — this is an absence of evidence, not evidence of absence"

/** M57.T2: shared disclosure helper — a zero test corpus must say WHY it is zero. */
export function noEvidenceUnknown(): string {
  return NO_EVIDENCE_UNKNOWN
}

export function nonCodeUnknown(nonCodeTestFiles: number): string | null {
  return nonCodeTestFiles > 0
    ? `non-code-test-files-excluded: ${nonCodeTestFiles} is_test_file path(s) are data/config formats, not test sources, and were excluded from the test corpus`
    : null
}

type ProdRow = {
  id: string
  name: string
  symbolType: string
  file: string
  line: number
  complexity: number
  gravity: number
}

type TestEdgeRow = {
  targetId: string
  relType: string
  testSymId: string
  testSymName: string
  testFile: string
}

function classify(relType: string): TestEvidenceKind | null {
  if (DIRECT_TYPES.has(relType)) return "direct_call"
  if (REFERENCE_TYPES.has(relType)) return "reference"
  if (IMPORT_TYPES.has(relType)) return "import"
  return null
}

/** Escape %/_/\ and append the prefix wildcard for a LIKE path-prefix match. */
function likePrefix(p: string): string {
  return p.replace(/[\\%_]/g, (c) => "\\" + c).replace(/\/+$/, "") + "/%"
}

function strongest(links: TestLink[]): TestEvidenceKind | "none" {
  if (links.some((l) => l.evidence === "direct_call")) return "direct_call"
  if (links.some((l) => l.evidence === "reference")) return "reference"
  if (links.some((l) => l.evidence === "import")) return "import"
  return "none"
}

async function loadGraph(projectId: ProjectID, includeMethods: boolean, filePath?: string) {
  const raw = await BrainDatabase.getRawInstance(projectId)

  // Optional scope: production symbols under a project-relative path prefix.
  // Applied at the SQL layer (prefix match on brain_file.relative_path) so a
  // scoped call is cheaper than project-wide, not just a post-filter.
  const scopeSql = filePath ? " AND f.relative_path LIKE ? ESCAPE '\\'" : ""
  const scopeParams: string[] = filePath ? [likePrefix(filePath)] : []

  const prodRows = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, f.relative_path AS file, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.complexity,0) AS complexity, COALESCE(s.gravity_score,0) AS gravity " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 AND s.symbol_type IN " + PROD_SYMBOL_TYPES + scopeSql,
  ).all(projectId, ...scopeParams) as ProdRow[]

  const fileCode = codeTestClause("")
  const flaggedTestFiles = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").get(projectId) as { c: number }).c
  const testFileCount = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1" + fileCode.sql).get(projectId, ...fileCode.params) as { c: number }).c
  const symCode = codeTestClause("f")
  const testSymCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND COALESCE(f.is_test_file,0)=1" + symCode.sql).get(projectId, ...symCode.params) as { c: number }).c
  const nonCodeTestFiles = Math.max(0, flaggedTestFiles - testFileCount)

  // M50.A2 residual: the edge query scans the whole relationship table to find
  // rows whose SOURCE symbol lives in a test file. When no code test source
  // exists the answer is provably empty (same predicate, same definition), so
  // the scan is skipped entirely instead of paying 370ms to prove zero.
  const edgeCode = codeTestClause("tf")
  const testEdges = testFileCount === 0 ? ([] as TestEdgeRow[]) : (raw.prepare(
    "SELECT r.target_symbol_id AS targetId, r.relationship_type AS relType, " +
      "ts.id AS testSymId, ts.name AS testSymName, tf.relative_path AS testFile " +
      "FROM brain_relationship r " +
      "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
      "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0) = 1 " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL" + edgeCode.sql,
  ).all(projectId, ...edgeCode.params) as TestEdgeRow[])

  // Path predicates are per FILE, not per symbol (~12 symbols per file here), so
  // resolve each distinct path once — the same memo the orphan engine uses.
  const noisePathMemo = new Map<string, boolean>()
  const isNoisePath = (file: string): boolean => {
    let v = noisePathMemo.get(file)
    if (v === undefined) { v = AnalysisExclusions.isHardNoisePath(file); noisePathMemo.set(file, v) }
    return v
  }
  const filtered = prodRows.filter(
    (r) =>
      !isNoisePath(r.file) &&
      !AnalysisExclusions.isNoiseSymbolName(r.name) &&
      (includeMethods || r.symbolType !== "method"),
  )
  // What the filter removed, as a NUMBER the answer carries.
  //
  // The population was silently smaller than the store's, and nothing said so:
  // on the atlas corpus the documented filter (`symbol_type IN
  // PROD_SYMBOL_TYPES`, non-test files) selects 171 symbols and the report said
  // `productionSymbols: 169`. Two symbols were dropped as noise paths or noise
  // names — a reasonable decision, and one an agent cannot reconstruct, because
  // the numbers do not reconcile against anything they can query.
  const excludedAsNoise = prodRows.length - filtered.length
  return { filtered, testEdges, testFileCount, testSymCount, nonCodeTestFiles, excludedAsNoise }
}

// MODE: mapping — production symbols -> test evidence, keyed by RESOLVED symbol
// id (avoids same-named-symbol contamination).
export async function testMapping(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestMappingReport> {
  const includeMethods = options.includeMethods ?? true
  // The page, not the whole corpus: see DEFAULT_PAGE. At the old 1000 a
  // single call on backbencher-brain/src rendered 375,270 bytes (~104k tokens).
  const maxResults = options.maxResults ?? DEFAULT_PAGE
  const { filtered, testEdges, testFileCount, testSymCount, nonCodeTestFiles, excludedAsNoise } = await loadGraph(projectId, includeMethods, options.filePath)

  const linksByTarget = new Map<string, TestLink[]>()
  let classifiedEdges = 0
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    classifiedEdges++
    if (!linksByTarget.has(e.targetId)) linksByTarget.set(e.targetId, [])
    linksByTarget.get(e.targetId)!.push({
      testSymbolId: e.testSymId,
      testSymbolName: e.testSymName,
      testFile: e.testFile,
      evidence: kind,
      relationshipType: e.relType,
      confidence: EVIDENCE_CONFIDENCE[kind],
    })
  }

  const entries: TestMappingEntry[] = filtered.map((s) => {
    const links = linksByTarget.get(s.id) ?? []
    return {
      symbolId: s.id,
      name: s.name,
      symbolType: s.symbolType,
      file: s.file,
      line: s.line,
      complexity: s.complexity,
      gravity: s.gravity,
      links,
      strongestEvidence: strongest(links),
    }
  })

  const tested = entries.filter((e) => e.links.length > 0).length
  const totalLinks = entries.reduce((sum, e) => sum + e.links.length, 0)
  entries.sort((a, b) => b.links.length - a.links.length || b.complexity - a.complexity)

  // The page is a page. testGaps already declared its bound; testMapping
  // sliced to maxResults and said nothing, so a caller could not tell 50
  // entries out of 4048 from the whole corpus.
  const page = entries.slice(0, maxResults)
  // Rank on the FULL link count, then trim the array — the ranking is the
  // finding, the trim is the budget.
  const ranked = page.map((e) => ({
    ...e,
    links: e.links.slice(0, DEFAULT_MAX_LINKS),
    linksTruncated: e.links.length > DEFAULT_MAX_LINKS,
  }))

  const mappingUnknowns: string[] = []
  if (classifiedEdges === 0) mappingUnknowns.push(NO_EVIDENCE_UNKNOWN)
  const mappingNonCode = nonCodeUnknown(nonCodeTestFiles)
  if (mappingNonCode) mappingUnknowns.push(mappingNonCode)
  if (entries.length > ranked.length) {
    mappingUnknowns.push(`entry-page: showing ${ranked.length} of ${entries.length} production symbols — raise limit for the rest`)
  }

  return {
    entries: ranked,
    provenance: makeProvenance({
      evidenceClass: "inferred",
      engine: "test-intel@intelligence",
      engineVersion: "m10.05",
      projectId,
      source: "brain_symbol+brain_relationship+brain_file",
      limitations: [
        "Static relationships do not prove runtime execution or line coverage.",
        "A production symbol is one whose type is in PROD_SYMBOL_TYPES; constants, properties, type aliases, modules and namespaces are outside the untested denominator entirely.",
        `An entry carries at most ${DEFAULT_MAX_LINKS} links (linksTruncated says when more exist); the ranking and the summary use the complete set.`,
      ],
      truncated: entries.length > ranked.length,
      unknowns: mappingUnknowns,
    }),
    summary: {
      productionSymbols: entries.length,
      // So `productionSymbols + excludedAsNoise` is the store's population
      // under this mode's own documented filter, and a reader can check it.
      excludedAsNoise,
      returned: ranked.length,
      truncated: entries.length > ranked.length,
      testedSymbols: tested,
      untestedSymbols: entries.length - tested,
      testFiles: testFileCount,
      scannedTestSymbols: testSymCount,
      evidenceLinks: totalLinks,
    },
  }
}

// MODE: gaps — untested / weakly-tested production symbols, risk-ranked.
//
// M50.A2 residual: this used to call `testMapping(..., {maxResults: 100000})`,
// which materialized EVERY production symbol with its links array, then built a
// gap object (with its recommendation string) for every one of them, sorted
// ~30k of those, and sliced to 200. Same defect shape as bb_patterns/
// bb_security/bb_analyze complexity: the engine built far more than it can
// return. Candidates are now lightweight sort keys and the finding objects are
// built only for the returned page. The two-stage stable sort reproduces the
// previous ordering exactly (previous first key: links.length desc,
// complexity desc; second key: riskScore desc, file asc), so the returned page
// is byte-identical.
export async function testGaps(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestGapReport> {
  const maxResults = options.maxResults ?? DEFAULT_PAGE
  const includeMethods = options.includeMethods ?? true
  const { filtered, testEdges, nonCodeTestFiles, excludedAsNoise } = await loadGraph(projectId, includeMethods, options.filePath)

  // One pass over the edges: classify once, count per target (the count is the
  // previous implementation's `links.length`, needed to reproduce its order).
  const anyEvidence = new Set<string>()
  const hasDirect = new Set<string>()
  const linkCount = new Map<string, number>()
  let classifiedEdges = 0
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    classifiedEdges++
    anyEvidence.add(e.targetId)
    linkCount.set(e.targetId, (linkCount.get(e.targetId) ?? 0) + 1)
    if (kind === "direct_call") hasDirect.add(e.targetId)
  }

  const candidates = filtered
    .filter((s) => !hasDirect.has(s.id))
    .map((s) => ({
      s,
      links: linkCount.get(s.id) ?? 0,
      category: (anyEvidence.has(s.id) ? "weak_evidence" : "no_evidence") as TestGap["category"],
      riskScore: Math.round((s.complexity * 2 + s.gravity * 10) * 100) / 100,
    }))
  // Stage 1 reproduces testMapping's entries order; stage 2 the gap ranking.
  candidates.sort((a, b) => b.links - a.links || b.s.complexity - a.s.complexity)
  candidates.sort((a, b) => b.riskScore - a.riskScore || a.s.file.localeCompare(b.s.file))

  const byCategory: Record<string, number> = {}
  let highRisk = 0
  for (const c of candidates) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
    if (c.riskScore >= 10) highRisk++
  }

  const gaps: TestGap[] = candidates.slice(0, maxResults).map((c) => ({
    symbolId: c.s.id,
    name: c.s.name,
    symbolType: c.s.symbolType,
    file: c.s.file,
    line: c.s.line,
    category: c.category,
    complexity: c.s.complexity,
    gravity: c.s.gravity,
    riskScore: c.riskScore,
    recommendation:
      c.category === "no_evidence"
        ? "No test references this symbol; add a direct test."
        : "Only indirect/import evidence; add a direct assertion-bearing test.",
  }))

  const gapUnknowns: string[] = []
  if (classifiedEdges === 0) gapUnknowns.push(NO_EVIDENCE_UNKNOWN)
  const gapNonCode = nonCodeUnknown(nonCodeTestFiles)
  if (gapNonCode) gapUnknowns.push(gapNonCode)

  return {
    gaps,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-gaps@intelligence", engineVersion: "m10.02", projectId, source: "static-test-mapping", limitations: ["A missing static link does not prove that runtime coverage is absent."], truncated: candidates.length > maxResults, unknowns: gapUnknowns }),
    summary: {
      // `total` is the number of GAPS, not the number of production symbols —
      // it is `productionSymbols` minus the ones with a direct test. That is
      // correct and it was invisible, because `test_mapping.summary` reports a
      // field of the same name meaning the population: on the atlas corpus the
      // two modes answered 169 and 163 for what reads as one question, and
      // nothing in either payload said the arithmetic.
      //
      // The population is now stated here under its own name, and the identity
      // closes in public:
      //   productionSymbols = gaps + directlyTested + excludedAsNoise
      // which on that corpus is 169 = 163 + 6 + 0.
      productionSymbols: filtered.length,
      total: candidates.length,
      directlyTested: filtered.length - candidates.length,
      excludedAsNoise,
      returned: gaps.length,
      truncated: candidates.length > gaps.length,
      byCategory,
      highRisk,
    },
  }
}

// MODE: impact — which tests exercise a changed symbol (direct + indirect via
// the shared graph engine's caller traversal). Runtime coverage is a separate,
// unpopulated field unless a real artifact is supplied.
export async function testImpact(projectId: ProjectID, target: string, options: TestIntelOptions = {}): Promise<TestImpactReport> {
  const { graphTraversal } = await import("../graph/graph-engine")
  const raw = await BrainDatabase.getRawInstance(projectId)

  const testFileIds = new Set(
    (raw.prepare("SELECT id FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").all(projectId) as Array<{ id: string }>).map((r) => r.id),
  )
  const symbolFile = new Map<string, string>()
  for (const r of raw.prepare("SELECT id, file_id AS fileId FROM brain_symbol WHERE project_id=?").all(projectId) as Array<{ id: string; fileId: string }>) {
    symbolFile.set(r.id, r.fileId)
  }
  const fileRel = new Map<string, string>()
  for (const r of raw.prepare("SELECT id, relative_path AS rel FROM brain_file WHERE project_id=?").all(projectId) as Array<{ id: string; rel: string }>) {
    fileRel.set(r.id, r.rel)
  }

  let graph
  try {
    graph = await graphTraversal(projectId, target, { direction: "callers", maxDepth: options.maxDepth ?? 4 })
  } catch {
    return { target, found: false, directTests: [], indirectTests: [], affectedTestFiles: [], truncated: false, provenance: makeProvenance({ evidenceClass: "unknown", engine: "test-impact@intelligence", engineVersion: "m10.02", projectId, source: "graph-resolution", limitations: ["The target could not be resolved in the indexed graph."], unknowns: ["target-not-found"] }), runtimeCoverage: { available: false } }
  }

  const direct: TestImpactReport["directTests"] = []
  const indirect: TestImpactReport["indirectTests"] = []
  const affected = new Set<string>()

  for (const edge of graph.callers) {
    const node = graph.nodes[edge.from]
    if (!node || node.isExternal) continue
    const fileId = symbolFile.get(node.id)
    if (!fileId || !testFileIds.has(fileId)) continue
    const testFile = fileRel.get(fileId) ?? node.file
    affected.add(testFile)
    const entry = { testSymbol: node.name, testFile, depth: edge.depth }
    if (edge.depth === 0) direct.push(entry)
    else indirect.push(entry)
  }

  // testMapping and testGaps both attach the "no-test-evidence-edges" unknown
  // when the corpus produced nothing. testImpact did not, so on a project with
  // no test files it reported found:true with two empty arrays — an
  // authoritative "no test touches this" backed by nothing. The evidence is
  // one COUNT away, so take it.
  const testSymbols = (
    raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 1").get(projectId) as { c: number }
  ).c
  const unknowns = ["runtime-coverage-unavailable"]
  if (testSymbols === 0) unknowns.unshift(NO_EVIDENCE_UNKNOWN)
  return {
    target,
    found: true,
    directTests: direct,
    indirectTests: indirect,
    affectedTestFiles: Array.from(affected).sort(),
    truncated: graph.summary.truncated,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-impact@intelligence", engineVersion: "m10.02", projectId, source: "brain_relationship", limitations: ["Static test impact does not prove runtime execution or coverage."], truncated: graph.summary.truncated, unknowns }),
    runtimeCoverage: { available: false },
  }
}
