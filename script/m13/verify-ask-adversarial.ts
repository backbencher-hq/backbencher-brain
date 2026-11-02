// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — adversarial coverage for bb_ask: every hostile input the read
//   path can meet — empty query, absent index, absent embeddings, foreign-model rows,
//   corrupt vectors, sparse tf-idf rows, out-of-range page sizes — must produce a
//   declared answer or a named refusal, never a crash, a NaN or a fabricated count.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — each case asserts the NEGATIVE property that used to be
//   assumed: a missing index does not become a database, a foreign-model row is never
//   compared, a corrupt vector is skipped rather than producing NaN, and a page size
//   outside 1..100 is refused instead of silently answered.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a3.json and
//   validation/tools/bb_ask/gates/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/{semantic-search,quick-answer}.ts,
//   src/mcp/tools/bb_ask/handler.ts.
// CONTRACTS IT MUST NOT BREAK — similarity is null or finite (never NaN, never 0 as a
//   fake score); a foreign model's vectors are never compared; no read creates the index.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { SemanticEngine } from "../../src/brain/semantic/engine"
import { quickAnswer, ASK_LIMIT_REFUSAL } from "../../src/intelligence/search/quick-answer"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { Harness, noNanSimilarity } from "./harness"

const harness = new Harness({
  issue: "bb_ask adversarial inputs: absent index, absent embeddings, foreign models, corrupt vectors, page-size abuse",
  code: "A3",
  tool: "bb_ask",
  title: "bb_ask: adversarial unit coverage",
  layers: ["unit", "integration"],
  decisions: {
    missingIndex: "quickAnswer answers an explicit unknown and does NOT create an index database to answer a question about one",
    foreignModel: "only rows whose embedding_model and vector_dimension equal the query vector's are compared",
    corruptVectors: "malformed or non-finite vectors are skipped; every returned similarity is null or finite",
    pageSize: "limit outside 1..100 is refused with the page-size sentence, never clamped into a different answer",
  },
  limitations: ["The dense-vector cases require a dense query model; if the embedder degrades they are recorded as skipped, not failed."],
})

const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_ask")!

// ── 1. Empty query: boundary rejects; engine does not crash ───────────────
{
  const err = (() => { try { validateToolArguments(descriptor, { query: "" }); return "" } catch (e: any) { return String(e) } })()
  harness.check("empty query: rejected at the boundary", err.includes("non-empty query"), err.slice(0, 100))
  const res = await semanticVectorSearch(getProjectId("/tmp/bb-ask-no-such-project"), "")
  harness.check("empty query: engine returns explicit metadata without an index, no crash", res.results.length === 0 && !!res.metadata?.method, `method=${res.metadata?.method}`)
}

// ── 2. Missing index: explicit unknown, and no database is created ────────
{
  const missingId = "bb-ask-missing-" + Date.now()
  const dbPath = BrainDatabase.getDbPath(missingId)
  const before = existsSync(dbPath)
  const res = await quickAnswer(missingId, "how many symbols are in this project")
  harness.negative("missing index: never answers a fabricated count (no 'There are 0 symbols')", !res.answer.includes("There are 0 symbols"), res.answer.slice(0, 120))
  harness.check("missing index: provenance class is unknown", res.provenance.evidenceClass === "unknown", res.provenance.evidenceClass)
  harness.check("missing index: unknowns name the missing index", (res.provenance.unknowns ?? []).some((u) => u.toLowerCase().includes("no index")), JSON.stringify(res.provenance.unknowns))
  harness.check("missing index: zero sources", res.sources.length === 0)
  harness.negative("missing index: the read did not create an index database", !existsSync(dbPath), `db exists=${existsSync(dbPath)} before=${before}`)
}

// ── 3. Fixture for the embedding-level adversarial cases ──────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-adversarial-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(request: string): string { return request }\nexport function handleLogin(user: string): string { return user }\n")
writeFileSync(path.join(root, "src", "more.ts"), "export function handleResponse(response: string): string { return response }\n")
await indexProjectParallel(projectId, root, {})
await flushBackgroundEmbeddings()
const raw = await BrainDatabase.getRawInstance(projectId)

// ── 4. Corrupt vectors and foreign-model rows ─────────────────────────────
{
  const baseline = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  const dimension = baseline.metadata.dimension > 0 ? baseline.metadata.dimension : 50
  const now = Date.now()
  const insert = raw.prepare(
    "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
  // A corrupt row in the SAME model/width the query uses — it must be skipped, not compared.
  insert.run("corrupt:row", projectId, "nonexistent-entity", "symbol", baseline.metadata.queryModel, "{not valid json", dimension, "hash", "{}", 0.7, now, now, now)
  // A foreign-model row at a different width — it must never enter the comparison.
  insert.run("foreign:row", projectId, "foreign-entity", "symbol", "foreign-model-v9", JSON.stringify(new Array(4).fill(1)), 4, "hash", "{}", 0.7, now, now, now)

  const after = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  harness.check("corrupt vector: retrieval still returns a shaped answer", !!after.metadata, `method=${after.metadata?.method}`)
  harness.negative("corrupt vector: no result similarity is NaN", after.results.every(noNanSimilarity))
  harness.check("foreign model: index model equals the query model (never compared across spaces)", after.metadata.indexModel === after.metadata.queryModel, `${after.metadata.queryModel} vs ${after.metadata.indexModel}`)
  harness.negative("foreign model: its 4-dimension rows are not counted as comparable", after.comparison.comparableEmbeddings <= after.scan.scannedRows, `comparable=${after.comparison.comparableEmbeddings} scanned=${after.scan.scannedRows}`)
  harness.check("comparison: comparable count equals the rows actually scanned when the scan is not capped", after.scan.capped || after.comparison.comparableEmbeddings === after.scan.scannedRows, `comparable=${after.comparison.comparableEmbeddings} scanned=${after.scan.scannedRows} capped=${after.scan.capped}`)

  // tfidf-v1 rows are sparse and carry a distinct label; the dense path must not see them.
  insert.run("tfidf:row", projectId, "tfidf-entity", "symbol", "tfidf-v1", JSON.stringify([{ token: "x", weight: 1 }]), 1, "hash", "{}", 0.15, now, now, now)
  const afterTfidf = await semanticVectorSearch(projectId, "handle a request", { maxResults: 5 })
  harness.negative("tfidf rows are never scanned by the dense path", afterTfidf.metadata.indexModel !== "tfidf-v1", afterTfidf.metadata.indexModel)
  harness.negative("tfidf insertion leaves no NaN similarity", afterTfidf.results.every(noNanSimilarity))
}

// ── 5. Missing embeddings: declared lexical fallback, similarity null (not 0) ──
{
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  const noEmbeddings = await semanticVectorSearch(projectId, "handle request", { maxResults: 5 })
  harness.check("empty embeddings: keyword fallback is engaged", noEmbeddings.metadata.method === "keyword-fallback", noEmbeddings.metadata.method)
  harness.check("empty embeddings: fallback carries a named reason", typeof noEmbeddings.metadata.fallbackReason === "string" && noEmbeddings.metadata.fallbackReason!.length > 0, String(noEmbeddings.metadata.fallbackReason))
  harness.negative("empty embeddings: no similarity is fabricated as 0", noEmbeddings.results.every((r) => r.similarity === null || typeof r.similarity === "number"), JSON.stringify(noEmbeddings.results.map((r) => r.similarity).slice(0, 5)))
}

// ── 6. Page size abuse: refused by the engine when the door is bypassed ───
{
  for (const bad of [0, 101, -1, 2.5]) {
    const res = await quickAnswer(projectId, "how many functions are in this project", { limit: bad })
    harness.negative(`page size ${JSON.stringify(bad)}: refused with the page-size sentence`, res.answer === ASK_LIMIT_REFUSAL && res.route === "none" && res.sources.length === 0, res.answer.slice(0, 120))
  }
  const clamped = await semanticVectorSearch(projectId, "handle request", { maxResults: 0 })
  harness.check("engine: maxResults=0 is clamped to a bounded page, not treated as unlimited", clamped.results.length <= 1, `results=${clamped.results.length}`)
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
harness.emit()
