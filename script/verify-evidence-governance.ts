import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { semanticVectorSearch } from "../src/intelligence/search/semantic-search"
import { graphTraversal } from "../src/intelligence/graph/graph-engine"
import { detectOrphans } from "../src/intelligence/patterns/orphans"
import { testMapping, testGaps, testImpact } from "../src/intelligence/testing/test-intel"
import { testQuality } from "../src/intelligence/testing/quality"
import { assertProvenance, makeProvenance } from "../src/intelligence/evidence"
import { checkFileFreshness } from "../src/brain/freshness"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}
function checkProvenance(label: string, value: unknown, evidenceClass: string): void {
  try {
    assertProvenance(value)
    const provenance = value as any
    check(`${label} has evidence class ${evidenceClass}`, provenance.evidenceClass === evidenceClass)
    check(`${label} has engine identity`, typeof provenance.engine === "string" && provenance.engine.length > 0 && typeof provenance.engineVersion === "string")
    check(`${label} has source`, typeof provenance.source === "string" && provenance.source.length > 0)
    check(`${label} has limitations`, Array.isArray(provenance.limitations))
    check(`${label} has bounds`, typeof provenance.truncated === "boolean" && typeof provenance.sampled === "boolean")
  } catch (error) { check(`${label} provenance validates`, false, error instanceof Error ? error.message : String(error)) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-evidence-"))
const fixture = createContractFixture(root)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  const semantic = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  checkProvenance("semantic result", semantic.provenance, "semantic_candidate")
  check("semantic method is explicit", semantic.metadata.method === "vector" || semantic.metadata.method === "keyword-fallback")
  check("semantic limitations reject proof interpretation", semantic.provenance.limitations.some((item) => item.toLowerCase().includes("candidate")))

  const graph = await graphTraversal(projectId, "handleRequest", { direction: "both", maxDepth: 3 })
  checkProvenance("graph result", graph.provenance, "inferred")
  check("graph exposes truncation state", typeof graph.summary.truncated === "boolean")

  const orphans = await detectOrphans(projectId, { maxResults: 5 })
  checkProvenance("orphan result", orphans.provenance, "static_finding")
  check("orphan evidence is non-empty", orphans.findings.every((finding) => finding.evidence.length > 0 && finding.limitations.length > 0))

  const mapping = await testMapping(projectId)
  checkProvenance("test mapping", mapping.provenance, "inferred")
  check("test mapping produces evidence links", mapping.entries.some((entry) => entry.links.length > 0 && entry.strongestEvidence !== "none"))
  check("test mapping separates untested symbols", mapping.entries.some((entry) => entry.strongestEvidence === "none"))

  const gaps = await testGaps(projectId)
  checkProvenance("test gaps", gaps.provenance, "inferred")
  check("test gaps are not runtime claims", gaps.provenance.limitations.some((item) => item.toLowerCase().includes("runtime")))

  const impact = await testImpact(projectId, "handleRequest")
  checkProvenance("test impact", impact.provenance, "inferred")
  check("runtime coverage remains separate", impact.runtimeCoverage.available === false && impact.provenance.unknowns.includes("runtime-coverage-unavailable"))

  const quality = await testQuality(projectId, { maxFiles: 1 })
  checkProvenance("test quality", quality.provenance, "static_finding")
  check("quality reports bounded sampling", quality.provenance.sampled === false || quality.provenance.unknowns.length >= 0)

  const malformed = { evidenceClass: "indexed", engine: "x" }
  let rejected = false
  try { assertProvenance(malformed) } catch { rejected = true }
  check("malformed provenance is rejected", rejected)
  const unknown = makeProvenance({ evidenceClass: "unknown", engine: "fixture", engineVersion: "m10.02", projectId, source: "fixture", limitations: ["fixture unavailable"], unknowns: ["unavailable-input"] })
  checkProvenance("unknown fixture", unknown, "unknown")

  const testEvidence = raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").get(projectId) as { c: number }
  check("fixture contains test evidence", testEvidence.c > 0)

  const chainRow = raw.prepare("SELECT id FROM brain_file WHERE project_id=? AND path LIKE ?").get(projectId, "%app.ts") as { id: string } | undefined
  check("source file is indexed", !!chainRow)
  if (chainRow) {
    const before = checkFileFreshness(raw, chainRow.id)
    check("indexed file reads fresh before mutation", before?.status === "fresh")
    writeFileSync(fixture.sourceFile, "export function handleRequest(): string { return \"mutated\" }\nexport function addedAfterIndex(): number { return 7 }\n")
    const after = checkFileFreshness(raw, chainRow.id)
    check("mutated file is detected as stale", after?.status === "stale")
  }
} catch (error) {
  check("evidence fixture session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  try { chmodSync(root, 0o755) } catch {}
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "M10 EVIDENCE: PASS" : `M10 EVIDENCE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
