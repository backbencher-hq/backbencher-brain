// script/m13/verify-ask-adversarial.ts — M13.25 (A3).
//
// Adversarial unit coverage for bb_ask:
//   1. empty query           → rejected at the boundary; engine-level no crash
//   2. missing index         → explicit unknown, never a fabricated stat
//   3. missing embeddings    → explicit keyword-fallback metadata, no crash
//   4. model mismatch rows   → excluded (cross-model comparison is prohibited)
//   5. corrupt vector rows   → skipped (bad JSON / NaN / non-numeric),
//                              never NaN similarities, no crash
//
// Every case is asserted as a negative where the adversarial condition holds.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { SemanticEngine } from "../../src/brain/semantic/engine"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.25",
  code: "A3",
  tool: "bb_ask",
  title: "bb_ask: adversarial unit tests",
  layers: ["unit", "integration"],
  decisions: {
    missingIndex: "quickAnswer guards stats with indexHasFiles — a missing index returns explicit unknown, never 'There are 0 symbols'",
    missingEmbeddings: "semanticVectorSearch returns keyword-fallback metadata with an explicit fallbackReason when no same-model embeddings exist",
    modelMismatch: "only same-model + same-dimension rows are scanned (SQL filter); cross-model rows are structurally excluded",
    corruptVectors: "bad JSON / NaN / non-numeric vectors are skipped by isDenseNumericVector; similarities are finite-checked so NaN never reaches results",
  },
  limitations: [
    "The dense-vector adversarial cases require a dense query model at runtime; if the model degrades to non-dense (tfidf), those cases are recorded as skipped, not failed.",
  ],
})

const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_ask")!

// ── 1. Empty query: boundary rejects; engine does not crash ───────────────
{
  const err = (() => { try { validateToolArguments(descriptor, { query: "" }); return "" } catch (e: any) { return String(e) } })()
  harness.check("empty query: rejected at the boundary", err.includes("non-empty query"), err.slice(0, 100))
  const res = await semanticVectorSearch("no-such-project-xyz", "")
  harness.check("empty query: engine returns explicit metadata, no crash", res.results.length === 0 && !!res.metadata?.method, `method=${res.metadata?.method}`)
}

// ── 2. Missing index: explicit unknown, no fabricated stat ────────────────
{
  const res = await quickAnswer("no-such-project-xyz", "how many symbols are in this project")
  harness.negative("missing index: never answers a fabricated count (no 'There are 0 symbols')", !res.answer.includes("There are 0 symbols"), res.answer.slice(0, 120))
  harness.check("missing index: provenance class is unknown", res.provenance.evidenceClass === "unknown", res.provenance.evidenceClass)
  harness.check("missing index: unknowns name the missing index", (res.provenance.unknowns ?? []).some((u) => u.toLowerCase().includes("no index")), JSON.stringify(res.provenance.unknowns))
  harness.check("missing index: zero sources", res.sources.length === 0)
}

// ── Fixture for embedding-state cases ─────────────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-adversarial-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\nexport function handleLogin(): string { return \"in\" }\n")
await indexProjectParallel(projectId, root, {})

// ── 3. Missing embeddings: explicit fallback metadata, no crash ───────────
{
  const res = await semanticVectorSearch(projectId, "how does request handling work?")
  const meta = res.metadata ?? {}
  if (meta.method === "vector") {
    harness.check("missing embeddings: vector path ran (recorded)", true, `model=${meta.queryModel} dim=${meta.dimension}`)
  } else {
    harness.check("missing embeddings: keyword-fallback with explicit reason, no crash", meta.method === "keyword-fallback" && typeof meta.fallbackReason === "string" && meta.fallbackReason.length > 0, JSON.stringify(meta))
  }
  harness.check("missing embeddings: results carry no NaN similarity", res.results.every((r) => Number.isFinite(r.similarity)))
}

// ── 4+5. Model mismatch + corrupt vectors ─────────────────────────────────
{
  // Learn the runtime query model + dimension, then plant adversarial rows.
  const probe = await SemanticEngine.embed("probe")
  const queryModel = SemanticEngine.getLastEmbeddingModel()
  const dim = probe?.length ?? 0
  const dense = !["tfidf-v1"].includes(queryModel) && dim > 0

  if (!dense) {
    harness.check("adversarial vectors: dense path not available at runtime (recorded, not failed)", true, `model=${queryModel}`)
  } else {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const t = Date.now()
    const insert = raw.prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    const good = Array(dim).fill(0.5)
    const nanVec = Array.from({ length: dim }, (_, i) => (i === 0 ? Number.NaN : 0.5))
    // 4. model mismatch: same dim, DIFFERENT model label
    insert.run("adv:mismatch", projectId, "adv-mismatch-symbol", "function", "some-other-model-v9", JSON.stringify(good), dim, "h1", JSON.stringify({ name: "advMismatch" }), 0.35, t, t, t)
    // 5. corrupt: same model, same dim — bad JSON, NaN vector, non-numeric vector
    insert.run("adv:badjson", projectId, "adv-badjson-symbol", "function", queryModel, "not-json-at-all", dim, "h2", JSON.stringify({ name: "advBadJson" }), 0.35, t, t, t)
    insert.run("adv:nan", projectId, "adv-nan-symbol", "function", queryModel, JSON.stringify(nanVec), dim, "h3", JSON.stringify({ name: "advNaN" }), 0.35, t, t, t)
    insert.run("adv:nonnum", projectId, "adv-nonnum-symbol", "function", queryModel, JSON.stringify([...good.slice(0, dim - 1), "x"]), dim, "h4", JSON.stringify({ name: "advNonNum" }), 0.35, t, t, t)
    // wrong-dim row: same model, different dimension
    insert.run("adv:wrongdim", projectId, "adv-wrongdim-symbol", "function", queryModel, JSON.stringify([0.5, 0.5]), 2, "h5", JSON.stringify({ name: "advWrongDim" }), 0.35, t, t, t)

    const res = await semanticVectorSearch(projectId, "request handling")
    const ids = res.results.map((r) => r.entityId)
    harness.negative("model mismatch: different-model row is never returned", !ids.includes("adv-mismatch-symbol"), `ids=${ids.join(",")}`)
    harness.negative("corrupt: bad-JSON row is never returned (no crash)", !ids.includes("adv-badjson-symbol"))
    harness.negative("corrupt: NaN vector row is never returned", !ids.includes("adv-nan-symbol"))
    harness.negative("corrupt: non-numeric vector row is never returned", !ids.includes("adv-nonnum-symbol"))
    harness.negative("corrupt: wrong-dimension row is never returned", !ids.includes("adv-wrongdim-symbol"))
    harness.negative("corrupt: no NaN similarity anywhere in results", res.results.every((r) => Number.isFinite(r.similarity)), JSON.stringify(res.results.map((r) => r.similarity)).slice(0, 120))
    harness.check("corrupt: metadata reports scan/filter counts", typeof res.metadata?.scannedRows === "number" && res.metadata.scannedRows > 0, JSON.stringify(res.metadata))
  }
}

// ── Corrupt rows must not break the full answer path ──────────────────────
{
  const res = await quickAnswer(projectId, "how does request handling work?")
  harness.check("full path: quickAnswer survives adversarial rows, no crash", res.answer.length > 0 && !!res.provenance.evidenceClass, res.provenance.evidenceClass)
  harness.check("full path: sources are real indexed files", res.sources.every((s) => s.file.length > 0))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
