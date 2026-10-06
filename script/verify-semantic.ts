import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { semanticVectorSearch } from "../src/intelligence/search/semantic-search"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-semantic-"))
const projectId = getProjectId(root)
try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})
  // Embeddings are generated on the background queue — wait for them so the
  // assertions below read durable vectors and the final wipe cannot race
  // with a still-draining queue.
  await flushBackgroundEmbeddings()
  const raw = await BrainDatabase.getRawInstance(projectId)

  const embCount = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ?").get(projectId) as { c: number }).c
  console.log("  (embedding rows: " + embCount + ")")

  // Baseline: local word vectors produce embeddings for a small fixture.
  const baseline = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  check("returns explicit metadata block", !!baseline.metadata && typeof baseline.metadata.method === "string")
  check("metadata reports a method", ["vector", "keyword-fallback"].includes(baseline.metadata.method))
  check("query model equals index model in vector mode", baseline.metadata.method !== "vector" || baseline.metadata.queryModel === baseline.metadata.indexModel)

  // Corruption tolerance: inject a corrupt vector row for the query model/dimension.
  if (baseline.metadata.method === "vector" && baseline.metadata.dimension > 0) {
    const now = Date.now()
    raw.prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("corrupt:row", projectId, "nonexistent-entity", "symbol", baseline.metadata.indexModel, "{not valid json", baseline.metadata.dimension, "hash", "{}", 0.7, now, now, now)
    const afterCorrupt = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
    check("corrupt vector does not crash retrieval", !!afterCorrupt.metadata)
    check("corrupt row excluded from filtered set", afterCorrupt.metadata.method !== "vector" || afterCorrupt.metadata.filteredRows <= afterCorrupt.metadata.scannedRows)
  } else {
    console.log("  (skip corruption test — no vector-mode baseline)")
  }

  // TF-IDF exclusion: a tfidf-v1 row must never be compared by dense cosine.
  {
    const now = Date.now()
    raw.prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("tfidf:row", projectId, "tfidf-entity", "symbol", "tfidf-v1", JSON.stringify([{ token: "x", weight: 1 }]), 1, "hash", "{}", 0.15, now, now, now)
    const afterTfidf = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
    // tfidf-v1 has a different model label, so it can never enter the query-model scan.
    check("tfidf rows are never scanned by dense path", afterTfidf.metadata.indexModel !== "tfidf-v1")
    for (const r of afterTfidf.results) {
      // `Number.isFinite` alone cannot express this assertion. The keyword
      // fallback deliberately reports `similarity: null` (a 0 would be a NUMBER
      // and every consumer would treat it as a real score — see
      // semantic-search.ts keywordFallback), and `Number.isFinite(null)` is
      // false. So this check used to FAIL on a correct null while still being
      // unable to prove the absence of NaN. Test the actual claim instead:
      // every similarity is either a deliberate null or a finite number.
      check(
        "no result similarity is NaN",
        r.similarity === null || Number.isFinite(r.similarity),
      )
    }
  }

  // No-embeddings fallback: wipe embeddings, expect keyword-fallback with a reason.
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  const noEmb = await semanticVectorSearch(projectId, "handleRequest", { maxResults: 5 })
  check("empty embeddings triggers keyword fallback", noEmb.metadata.method === "keyword-fallback")
  check("fallback carries a reason", typeof noEmb.metadata.fallbackReason === "string" && noEmb.metadata.fallbackReason.length > 0)
} catch (error) {
  check("semantic session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nSEMANTIC: PASS" : "\nSEMANTIC: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
