// script/m16/verify-embedding-lifecycle.ts — shared embedding lifecycle gate.
//
// Proves the shared indexer/embedding contract independently of analyzers:
//   1. flushBackgroundEmbeddings makes queued local vectors durable;
//   2. every symbol in a small fixture receives a valid vector;
//   3. removing a temporary project immediately after indexing does not let the
//      queued worker recreate its database or write through a stale handle.
//
// API routing and API dimensions are covered separately by script/verify-embed.ts.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, condition: boolean, detail = "") {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log("  FAIL: " + label + (detail ? " — " + detail : ""))
  }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m16/results")
mkdirSync(RESULTS_DIR, { recursive: true })

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "bb-m16-embedding-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", "module.ts"), `
export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0)
}

export class PriceCalculator {
  compute(price: number, tax: number): number {
    return price + tax
  }
}
`)
  return root
}

function removeProject(root: string, projectId: string) {
  BrainDatabase.close(projectId)
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

let durableRoot = ""
let durableProject = ""
let removedRoot = ""
let removedProject = ""
try {
  // No API variables: this gate intentionally verifies the always-available
  // local vector fallback. API behavior has its own deterministic verifier.
  delete process.env.BB_EMBEDDING_BASE_URL
  delete process.env.BB_EMBEDDING_API_KEY
  delete process.env.BB_EMBEDDING_MODEL

  // EMB1/EMB2: index, flush, and inspect durable vectors.
  durableRoot = fixture()
  durableProject = getProjectId(durableRoot)
  const indexResult = await indexProjectParallel(durableProject, durableRoot, {})
  ck("EMB1: fixture indexed files", indexResult.successFiles > 0, JSON.stringify(indexResult))

  const before = await BrainDatabase.getRawInstance(durableProject)
  const symbols = (before.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(durableProject) as any).c as number
  const beforeRows = (before.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(durableProject) as any).c as number
  ck("EMB1: fixture has symbols to embed", symbols >= 2, "symbols=" + symbols)
  console.log("  queued-state: symbols=" + symbols + " embeddings=" + beforeRows)

  await flushBackgroundEmbeddings()

  const raw = await BrainDatabase.getRawInstance(durableProject)
  const rows = raw.prepare("SELECT entity_id, embedding_model, vector_dimension, embedding_vector FROM brain_semantic_embedding WHERE project_id=?").all(durableProject) as any[]
  const embeddedIds = new Set(rows.map((row) => row.entity_id))
  const symbolRows = raw.prepare("SELECT id FROM brain_symbol WHERE project_id=?").all(durableProject) as any[]
  ck("EMB2: flush makes vectors durable", rows.length > 0, "rows=" + rows.length)
  ck("EMB2: every fixture symbol has a vector", symbolRows.length > 0 && symbolRows.every((row) => embeddedIds.has(row.id)), `symbols=${symbolRows.length} embedded=${embeddedIds.size}`)
  ck("EMB2: vectors have one real model and positive dimension", rows.length > 0 && new Set(rows.map((row) => row.embedding_model)).size === 1 && rows.every((row) => typeof row.embedding_model === "string" && row.embedding_model.length > 0 && row.vector_dimension > 0), JSON.stringify(rows.slice(0, 2).map((row) => ({ model: row.embedding_model, dimension: row.vector_dimension }))))
  ck("EMB2: vectors are valid numeric arrays", rows.length > 0 && rows.every((row) => {
    try {
      const vector = JSON.parse(row.embedding_vector)
      return Array.isArray(vector) && vector.length === row.vector_dimension && vector.length > 0 && vector.every((value: unknown) => typeof value === "number" && Number.isFinite(value))
    } catch { return false }
  }))

  // EMB3: index a second project and remove it immediately after indexing
  // returns. The queue is non-blocking, so this happens before its scheduled
  // setImmediate drainer in the normal event-loop ordering.
  removedRoot = fixture()
  removedProject = getProjectId(removedRoot)
  await indexProjectParallel(removedProject, removedRoot, {})
  const removedDbDir = path.dirname(BrainDatabase.getDbPath(removedProject))
  removeProject(removedRoot, removedProject)
  await flushBackgroundEmbeddings()
  ck("EMB3: removed project database remains absent", !existsSync(removedDbDir), removedDbDir)
  ck("EMB3: removed project directory remains absent", !existsSync(removedRoot), removedRoot)
} catch (error) {
  ck("EMB lifecycle session completes without an exception", false, error instanceof Error ? error.message : String(error))
} finally {
  await flushBackgroundEmbeddings()
  if (durableProject) BrainDatabase.close(durableProject)
  if (removedProject) BrainDatabase.close(removedProject)
  if (durableRoot) rmSync(durableRoot, { recursive: true, force: true })
  if (removedRoot) rmSync(removedRoot, { recursive: true, force: true })
  if (durableProject) rmSync(path.dirname(BrainDatabase.getDbPath(durableProject)), { recursive: true, force: true })
  if (removedProject) rmSync(path.dirname(BrainDatabase.getDbPath(removedProject)), { recursive: true, force: true })
}

const evidence = {
  issue: "M16.EMB1-EMB3",
  code: "EMB",
  tool: "shared-indexer/semantic-embedding-lifecycle",
  title: "background embedding persistence and cleanup ordering",
  verified: failed === 0,
  checks,
  passed,
  failed,
  negatives: 0,
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS_DIR, "EMB.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`EMB: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed)`)
process.exit(failed > 0 ? 1 : 0)
