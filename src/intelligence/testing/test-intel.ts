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

const DIRECT_TYPES = new Set(["calls", "instantiates"])
const REFERENCE_TYPES = new Set(["references", "uses", "extends", "implements"])
const IMPORT_TYPES = new Set(["imports"])

const EVIDENCE_CONFIDENCE: Record<TestEvidenceKind, number> = {
  direct_call: 0.85,
  reference: 0.6,
  import: 0.4,
}

const PROD_SYMBOL_TYPES = "('function','method','class','interface','struct','enum')"

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

function strongest(links: TestLink[]): TestEvidenceKind | "none" {
  if (links.some((l) => l.evidence === "direct_call")) return "direct_call"
  if (links.some((l) => l.evidence === "reference")) return "reference"
  if (links.some((l) => l.evidence === "import")) return "import"
  return "none"
}

async function loadGraph(projectId: ProjectID, includeMethods: boolean) {
  const raw = await BrainDatabase.getRawInstance(projectId)

  const prodRows = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, f.relative_path AS file, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.complexity,0) AS complexity, COALESCE(s.gravity_score,0) AS gravity " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 AND s.symbol_type IN " + PROD_SYMBOL_TYPES,
  ).all(projectId) as ProdRow[]

  const testEdges = raw.prepare(
    "SELECT r.target_symbol_id AS targetId, r.relationship_type AS relType, " +
      "ts.id AS testSymId, ts.name AS testSymName, tf.relative_path AS testFile " +
      "FROM brain_relationship r " +
      "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
      "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0) = 1 " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL",
  ).all(projectId) as TestEdgeRow[]

  const testFileCount = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").get(projectId) as { c: number }).c
  const testSymCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND COALESCE(f.is_test_file,0)=1").get(projectId) as { c: number }).c

  const filtered = prodRows.filter(
    (r) =>
      !AnalysisExclusions.isHardNoisePath(r.file) &&
      !AnalysisExclusions.isNoiseSymbolName(r.name) &&
      (includeMethods || r.symbolType !== "method"),
  )
  return { filtered, testEdges, testFileCount, testSymCount }
}

// MODE: mapping — production symbols -> test evidence, keyed by RESOLVED symbol
// id (avoids same-named-symbol contamination).
export async function testMapping(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestMappingReport> {
  const includeMethods = options.includeMethods ?? true
  const maxResults = options.maxResults ?? 1000
  const { filtered, testEdges, testFileCount, testSymCount } = await loadGraph(projectId, includeMethods)

  const linksByTarget = new Map<string, TestLink[]>()
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
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
  entries.sort((a, b) => b.links.length - a.links.length || b.complexity - a.complexity)

  return {
    entries: entries.slice(0, maxResults),
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-intel@intelligence", engineVersion: "m10.02", projectId, source: "brain_symbol+brain_relationship+brain_file", limitations: ["Static relationships do not prove runtime execution or line coverage."] }),
    summary: {
      productionSymbols: entries.length,
      testedSymbols: tested,
      untestedSymbols: entries.length - tested,
      testFiles: testFileCount,
      scannedTestSymbols: testSymCount,
    },
  }
}

// MODE: gaps — untested / weakly-tested production symbols, risk-ranked.
export async function testGaps(projectId: ProjectID, options: TestIntelOptions = {}): Promise<TestGapReport> {
  const maxResults = options.maxResults ?? 200
  const mapping = await testMapping(projectId, { ...options, maxResults: 100000 })

  const gaps: TestGap[] = []
  for (const e of mapping.entries) {
    let category: TestGap["category"] | null = null
    if (e.strongestEvidence === "none") category = "no_evidence"
    else if (e.strongestEvidence === "reference" || e.strongestEvidence === "import") category = "weak_evidence"
    if (!category) continue

    const riskScore = Math.round((e.complexity * 2 + e.gravity * 10) * 100) / 100
    gaps.push({
      symbolId: e.symbolId,
      name: e.name,
      symbolType: e.symbolType,
      file: e.file,
      line: e.line,
      category,
      complexity: e.complexity,
      gravity: e.gravity,
      riskScore,
      recommendation:
        category === "no_evidence"
          ? "No test references this symbol; add a direct test."
          : "Only indirect/import evidence; add a direct assertion-bearing test.",
    })
  }

  gaps.sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file))
  const byCategory: Record<string, number> = {}
  for (const g of gaps) byCategory[g.category] = (byCategory[g.category] ?? 0) + 1
  const highRisk = gaps.filter((g) => g.riskScore >= 10).length

  return {
    gaps: gaps.slice(0, maxResults),
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-gaps@intelligence", engineVersion: "m10.02", projectId, source: "static-test-mapping", limitations: ["A missing static link does not prove that runtime coverage is absent."], truncated: gaps.length > maxResults }),
    summary: { total: gaps.length, byCategory, highRisk },
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

  return {
    target,
    found: true,
    directTests: direct,
    indirectTests: indirect,
    affectedTestFiles: Array.from(affected).sort(),
    truncated: graph.summary.truncated,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "test-impact@intelligence", engineVersion: "m10.02", projectId, source: "brain_relationship", limitations: ["Static test impact does not prove runtime execution or coverage."], truncated: graph.summary.truncated, unknowns: ["runtime-coverage-unavailable"] }),
    runtimeCoverage: { available: false },
  }
}
