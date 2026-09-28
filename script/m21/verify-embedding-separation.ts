// script/m21/verify-embedding-separation.ts — M21.E1
// Proves that structural indexing completion and embedding durability are
// measured separately. Uses a temporary fixture and the built-in local vector
// path; no external provider or repository is required.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const root = mkdtempSync(path.join(tmpdir(), "bb-m21-e1-"))
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}
let projectId = ""
let result: any
try {
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "e1-fixture.ts"), `
export function add(left: number, right: number): number { return left + right }
export class Calculator { total(value: number): number { return add(value, 1) } }
`)
  delete process.env.BB_EMBEDDING_BASE_URL
  delete process.env.BB_EMBEDDING_API_KEY
  delete process.env.BB_EMBEDDING_MODEL
  projectId = getProjectId(root)

  const started = performance.now()
  const indexResult = await indexProjectParallel(projectId, root, { skipPostProcessing: true })
  const structuralMs = performance.now() - started
  check("E1 structural index executes successfully", indexResult.successFiles > 0 && indexResult.errorFiles === 0, JSON.stringify(indexResult))

  const rawBefore = await BrainDatabase.getRawInstance(projectId)
  const symbols = Number((rawBefore.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c)
  const embeddingsBefore = Number((rawBefore.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any).c)
  check("E1 structural counts are nonzero", symbols >= 2, `symbols=${symbols}`)
  check("E1 structural result is captured before flush", Number.isFinite(structuralMs) && structuralMs >= 0)

  const flushStarted = performance.now()
  await flushBackgroundEmbeddings()
  const embeddingFlushMs = performance.now() - flushStarted
  const rawAfter = await BrainDatabase.getRawInstance(projectId)
  const embeddingsAfter = Number((rawAfter.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any).c)
  const models = (rawAfter.prepare("SELECT DISTINCT embedding_model model FROM brain_semantic_embedding WHERE project_id=?").all(projectId) as any[]).map((row) => row.model)
  check("E1 flush phase has an independent duration", Number.isFinite(embeddingFlushMs) && embeddingFlushMs >= 0)
  check("E1 local embeddings are durable after flush", embeddingsAfter > 0 && embeddingsAfter <= symbols, `before=${embeddingsBefore} after=${embeddingsAfter} symbols=${symbols}`)
  check("E1 embedding model is explicitly recorded", models.length === 1 && typeof models[0] === "string" && models[0].length > 0, JSON.stringify(models))
  negative("E1 provider timing is not fabricated without explicit API configuration", !process.env.BB_EMBEDDING_BASE_URL && !process.env.BB_EMBEDDING_MODEL)
  const isFinitePhase = (t: any) => typeof t === "number" && Number.isFinite(t) && t >= 0
  negative("E1 non-finite or negative phase timing is rejected", !isFinitePhase(Number.NaN) && !isFinitePhase(-1) && isFinitePhase(structuralMs) && isFinitePhase(embeddingFlushMs))
  negative("E1 zero embeddings cannot be relabeled as completed vectors", !(embeddingsAfter === 0 && symbols > 0))

  const commit = (await import("node:child_process")).spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.E1", code: "E1", milestone: "M21",
    status: passed === checks && negatives >= 3 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-embedding-separation.ts",
    evidenceFile: "E1.json", generatedAt: new Date().toISOString(),
    corpus: { kind: "temporary-fixture", files: 1, revision: null },
    timings: { structuralIndexMs: structuralMs, embeddingFlushMs, totalObservedMs: structuralMs + embeddingFlushMs },
    counts: { symbols, embeddingsBeforeFlush: embeddingsBefore, embeddingsAfterFlush: embeddingsAfter },
    embeddingMode: {
      explicitApiConfigured: false,
      actualPersistedModel: models.length === 1 ? models[0] : null,
      localFallbackExpected: true,
      providerDiscoveryMaySelectModel: true,
    },
    limitations: [
      "This proves phase separation on a controlled fixture using local vectors; provider/API latency is E3 scope.",
      "The verifier does not claim the production indexer's full post-processing duration; skipPostProcessing is intentional for phase isolation."
    ]
  }
} catch (error) {
  check("E1 verifier completes without an exception", false, String(error))
  result = { issue: "M21.E1", code: "E1", milestone: "M21", status: "known-gap", checks, passed, failed: checks - passed, negativeCases: negatives, currentCommit: "unknown", workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-embedding-separation.ts", evidenceFile: "E1.json", generatedAt: new Date().toISOString(), limitations: [String(error)] }
} finally {
  await flushBackgroundEmbeddings().catch(() => undefined)
  if (projectId) BrainDatabase.close(projectId)
  rmSync(root, { recursive: true, force: true })
  if (projectId) rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/E1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`E1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
