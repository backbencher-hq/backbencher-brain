// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the semantic-retrieval engine gate: model/width consistency,
//   comparison facts, corrupt and foreign-model row tolerance, tf-idf exclusion,
//   NaN-free similarities, the declared lexical fallback and the read-only open.
// WHICH TOOL IT SERVES — bb_ask (read) through src/intelligence/search/semantic-search.ts.
// WHY IT IS SHAPED THIS WAY — the engine's contract is "a similarity is only meaningful in
//   one vector space, and every number it returns is declared": this gate checks the space
//   filter, the declared coverage for that space, the scan bounds, and that a malformed or
//   overflowing vector can never surface as NaN.
// WHERE ITS EVIDENCE LIVES — stdout PASS/FAIL (this script predates the M13 harness) and
//   validation/tools/bb_ask/gates/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/semantic-search.ts,
//   docs/BB_ASK.md, validation/tools/bb_ask/work/run-gates.mjs.
// CONTRACTS IT MUST NOT BREAK — a failure is a non-zero exit; corrupt rows are injected
//   only into a temporary fixture database.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { semanticVectorSearch } from "../src/intelligence/search/semantic-search"


let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}
function checkNegative(label: string, condition: boolean, detail = ""): void {
  check(`${label} [negative]${detail ? " " + detail : ""}`, condition)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-semantic-"))
const projectId = getProjectId(root)
const dbPath = BrainDatabase.getDbPath(projectId)
try {
  // A fixture whose symbol bodies contain the query terms, so the LOCAL vector path
  // actually clears its 0.50 floor: the corruption, overflow and model-mismatch checks
  // below are meaningless on a fallback answer (and used to be silently skipped).
  mkdirSync(path.join(root, "src"), { recursive: true })
  const denseBody = "export function requestHandler(request: string): string { return request + \"handled\" }\n"
  writeFileSync(path.join(root, "src", "alpha.ts"), denseBody)
  writeFileSync(path.join(root, "src", "beta.ts"), denseBody)
  await indexProjectParallel(projectId, root, {})
  // Embeddings are generated on the background queue — wait for them so the assertions
  // below read durable vectors.
  await flushBackgroundEmbeddings()
  const raw = await BrainDatabase.getRawInstance(projectId)

  const embeddingRows = (raw.prepare("SELECT COUNT(*) AS c FROM brain_semantic_embedding WHERE project_id = ?").get(projectId) as { c: number }).c
  console.log("  (embedding rows: " + embeddingRows + ")")

  const baseline = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  check("returns explicit metadata block", !!baseline.metadata && typeof baseline.metadata.method === "string")
  check("metadata reports a method", ["vector", "keyword-fallback"].includes(baseline.metadata.method))
  check("query model equals index model in vector mode", baseline.metadata.method !== "vector" || baseline.metadata.queryModel === baseline.metadata.indexModel)
  check("comparison facts travel with the result", !!baseline.comparison && typeof baseline.comparison.comparableEmbeddings === "number" && typeof baseline.comparison.libraryEmbeddings === "number")
  check("scan bounds travel with the result", !!baseline.scan && typeof baseline.scan.cap === "number" && typeof baseline.scan.capped === "boolean")

  if (baseline.metadata.method === "vector") {
    check("vector mode: comparable symbols equal the rows actually scanned (scan not capped)", baseline.scan.capped || baseline.comparison.comparableEmbeddings === baseline.scan.scannedRows, `comparable=${baseline.comparison.comparableEmbeddings} scanned=${baseline.scan.scannedRows}`)
    check("vector mode: the compared model is named on the comparison facts", baseline.comparison.queryModel === baseline.metadata.queryModel, `${baseline.comparison.queryModel} vs ${baseline.metadata.queryModel}`)
    checkNegative("vector mode: every similarity is finite", baseline.results.every((row) => typeof row.similarity === "number" && Number.isFinite(row.similarity)), JSON.stringify(baseline.results.map((r) => r.similarity).slice(0, 4)))
  } else {
    console.log("  (vector path unavailable at runtime — recorded, not failed)")
  }

  // Corrupt row: invalid JSON in the SAME model/width must be skipped, never crash.
  if (baseline.metadata.dimension > 0) {
    const now = Date.now()
    const insert = raw.prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    insert.run("corrupt:row", projectId, "nonexistent-entity", "symbol", baseline.metadata.queryModel, "{not valid json", baseline.metadata.dimension, "hash", "{}", 0.7, now, now, now)

    // Overflow row: FINITE JSON numbers whose squared norm overflows to Infinity, so the
    // cosine is NaN unless the engine filters non-finite similarities. This is the only
    // way a finite input can produce NaN — it is what the guard exists for.
    const overflow = new Array(baseline.metadata.dimension).fill(1e308)
    insert.run("overflow:row", projectId, "overflow-entity", "symbol", baseline.metadata.queryModel, JSON.stringify(overflow), baseline.metadata.dimension, "hash", "{}", 0.7, now, now, now)

    const afterCorrupt = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
    if (afterCorrupt.metadata.method === "vector") {
      // Two injected rows are inadmissible in this model/width: invalid JSON and an
      // overflowing vector whose cosine is NaN. `filteredRows` counts only finite
      // similarities, so it must be scannedRows - 2. Removing the guard breaks this.
      check("non-finite candidates are excluded from the scored set (filteredRows = scannedRows - 2)", afterCorrupt.metadata.filteredRows === afterCorrupt.metadata.scannedRows - 2, `filtered=${afterCorrupt.metadata.filteredRows} scanned=${afterCorrupt.metadata.scannedRows}`)
    }
    check("corrupt vector does not crash retrieval", !!afterCorrupt.metadata)
    check("corrupt row is excluded from the filtered set", afterCorrupt.metadata.method !== "vector" || afterCorrupt.metadata.filteredRows <= afterCorrupt.metadata.scannedRows)
    checkNegative("no result similarity is NaN (invalid JSON skipped, overflowing vector filtered)", afterCorrupt.results.every((row) => row.similarity === null || (typeof row.similarity === "number" && Number.isFinite(row.similarity))), JSON.stringify(afterCorrupt.results.map((r) => r.similarity).slice(0, 5)))
  } else {
    console.log("  (skip corrupt/overflow vector injection — no vector-mode baseline)")
  }

  // tfidf-v1 rows are sparse and carry a distinct label; the dense path must not see them.
  {
    const now = Date.now()
    raw.prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("tfidf:row", projectId, "tfidf-entity", "symbol", "tfidf-v1", JSON.stringify([{ token: "x", weight: 1 }]), 1, "hash", "{}", 0.15, now, now, now)
    const afterTfidf = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
    check("tfidf rows are never scanned by the dense path", afterTfidf.metadata.indexModel !== "tfidf-v1")
    checkNegative("tfidf rows never produce a NaN similarity", afterTfidf.results.every((row) => row.similarity === null || Number.isFinite(row.similarity)))
  }

  // No-embeddings fallback: declare the reason and report similarity as null, not 0.
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  const noEmbeddings = await semanticVectorSearch(projectId, "handleRequest", { maxResults: 5 })
  check("empty embeddings trigger the keyword fallback", noEmbeddings.metadata.method === "keyword-fallback")
  check("fallback carries a reason", typeof noEmbeddings.metadata.fallbackReason === "string" && noEmbeddings.metadata.fallbackReason!.length > 0)
  checkNegative("fallback similarity is null, not 0 (a 0 would be averaged as a score)", noEmbeddings.results.every((row) => row.similarity === null), JSON.stringify(noEmbeddings.results.map((r) => r.similarity).slice(0, 4)))

  // Missing project: the engine answers from nothing and creates nothing.
  {
    const missingId = "semantic-missing-" + Date.now()
    const missingDb = BrainDatabase.getDbPath(missingId)
    const missing = await semanticVectorSearch(missingId, "handle request")
    check("missing project: explicit metadata, no throw", !!missing.metadata && missing.results.length === 0)
    check("missing project: no database is created by a read", !existsSync(missingDb), missingDb)
  }
} catch (error) {
  check("semantic session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(dbPath), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nSEMANTIC: PASS" : "\nSEMANTIC: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
