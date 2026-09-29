import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { SemanticEngine } from "../../brain/semantic/engine"
import { cosineFloat32, readRowVector } from "../../brain/semantic/vector-binary"
import { promoteMissingBlobsInBackground } from "../../brain/semantic/vector-promote"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SemanticResult, SemanticSearchOptions, SemanticSearchResults } from "../contracts"
import { readSymbolSnippet } from "../source-utils"
import { makeProvenance } from "../evidence"

// Hard cap on candidate vectors loaded into memory for the dense scan. This
// bounds memory and CPU; when exceeded the scan is truncated deterministically
// (highest-priority rows first via the ORDER BY in the query).
const VECTOR_SCAN_CAP = Number(process.env.BB_VECTOR_SCAN_CAP || 20000)

// Sparse/incompatible model labels that must never be fed to dense cosine.
const NON_DENSE_MODELS = new Set(["tfidf-v1"])

/** Stored embeddings vs indexable symbols, read with one query. Returns 1/1
 *  when there is nothing to cover, so a fully-unembedded index never renders
 *  as "0% covered" (which reads as total failure rather than total absence). */
function measureCoverage(raw: any, projectId: ProjectID): { indexSymbolCount: number; embeddedSymbolCount: number; embeddingCoverage: number } {
  try {
    // TWO placeholders, TWO bindings — binding one leaves the second subquery
    // NULL, which SQLite reports as 0, and coverage then reads "0 of 0" on
    // every project instead of the real ratio.
    const row = raw.prepare(
      "SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols, " +
        "(SELECT COUNT(DISTINCT entity_id) FROM brain_semantic_embedding WHERE project_id = ?) AS embedded",
    ).get(projectId, projectId) as { symbols: number; embedded: number } | undefined
    const indexSymbolCount = row?.symbols ?? 0
    const embeddedSymbolCount = row?.embedded ?? 0
    return {
      indexSymbolCount,
      embeddedSymbolCount,
      embeddingCoverage: indexSymbolCount > 0 ? embeddedSymbolCount / indexSymbolCount : 1,
    }
  } catch {
    return { indexSymbolCount: 0, embeddedSymbolCount: 0, embeddingCoverage: 1 }
  }
}

type EmbeddingRow = {
  rowid?: number
  entityId: string
  vector: string
  /** M50.A2 (#764): little-endian float32 accelerator; null on legacy rows. */
  blob?: Uint8Array | null
  model: string
}

// The accelerator column is added at open (ensureSchemaIfNew). A readonly open
// (doctor/inspection paths) skips that migration, so the column may be absent —
// detected once per handle and answered from JSON only, never by failing.
const blobColumnByHandle = new WeakMap<object, boolean>()
function hasBlobColumn(raw: any): boolean {
  const cached = blobColumnByHandle.get(raw)
  if (cached !== undefined) return cached
  let has = false
  try {
    has = (raw.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as Array<{ name: string }>).some((c) => c.name === "embedding_blob")
  } catch {
    has = false
  }
  blobColumnByHandle.set(raw, has)
  return has
}

type SymbolRow = {
  id: string
  name: string
  symbolType: string
  line: number
  lineEnd: number
  fileId: string
  relativePath: string
  filePath: string
  language: string
}

// NOTE (M50.A2 #764): the old `isDenseNumericVector(JSON.parse(...))` guard is
// gone on purpose. `readRowVector` (vector-binary.ts) is now the single
// admission test: it accepts a blob only at the exact byte length and a JSON
// row only when it scans to exactly `vector_dimension` finite numbers, then
// `Number.isFinite(similarity)` rejects overflowed/invalid vectors. Same
// guarantees, without allocating an array per row.

// Vector-backed semantic retrieval with strict model consistency.
//
// Rules enforced here:
// - The query vector's producing model (getLastEmbeddingModel) is authoritative.
//   Only stored embeddings from that same model are compared. Cross-model
//   comparison is prohibited because different models occupy different vector
//   spaces even at equal dimensions.
// - tfidf-v1 and any non-finite/non-numeric vectors are excluded from the dense
//   cosine path.
// - Every response carries explicit metadata: query model, index model,
//   method, dimension, scan counts, and a fallback reason when applicable.
export async function semanticVectorSearch(
  projectId: ProjectID,
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchResults> {
  const maxResults = options.maxResults || 50
  const raw = await BrainDatabase.getRawInstance(projectId)

  // Coverage is measured, not assumed, and read once per call. Every response
  // carries it, including the fallback ones: a caller asking "why did I get
  // these results" needs the ratio, and at 22% coverage the vector path
  // succeeds while most of the index is simply absent from the comparison.
  const coverage = measureCoverage(raw, projectId)

  const emptyMeta = (method: "vector" | "keyword-fallback", reason: string, model = "unknown", dimension = 0): SemanticSearchResults => ({
    results: [],
    provenance: makeProvenance({ evidenceClass: method === "vector" ? "unknown" : "semantic_candidate", engine: "semantic-search@intelligence", engineVersion: "m10.02", projectId, source: method === "vector" ? "no-result" : "content-search-fallback", limitations: ["Semantic retrieval is candidate discovery, not behavioral proof."], unknowns: [reason] }),
    metadata: { queryModel: model, indexModel: model, method, dimension, scannedRows: 0, filteredRows: 0, fallbackReason: reason, ...coverage },
  })

  let queryVector: number[]
  try {
    queryVector = await SemanticEngine.embed(query)
  } catch {
    return await keywordFallback(projectId, query, options, "embedding-error")
  }
  if (!queryVector || queryVector.length === 0) {
    return await keywordFallback(projectId, query, options, "no-query-vector")
  }
  // A vector of the right SHAPE but no magnitude is a different failure from an
  // empty one, and it must not be reported as "we compared vectors and none
  // were close enough".
  //
  // The local word-vector model returns a 50-element array of zeros whenever
  // every token in the query is out of vocabulary — which is every
  // identifier-shaped query, because the vocabulary is built by splitting
  // camelCase and snake_case while the query tokenizer splits on whitespace
  // only. Measured over 9 real repositories: 99 of 99 symbol names and 81 of
  // 180 ordinary questions produce exactly this vector. Cosine against the zero
  // vector is 0 for EVERY row, so the old code fell through to
  // `no-vector-above-threshold` — a reason that blames the index for a problem
  // that is entirely in the query, and points remediation at re-embedding a
  // corpus that was embedded correctly.
  if (queryVector.every((component) => component === 0)) {
    return await keywordFallback(projectId, query, options, "degenerate-query-vector")
  }

  // Authoritative model = the one that actually produced this query vector.
  const queryModel = SemanticEngine.getLastEmbeddingModel()
  if (NON_DENSE_MODELS.has(queryModel)) {
    return await keywordFallback(projectId, query, options, "non-dense-query-model")
  }

  // Retrieve only same-model, same-dimension embeddings. Deterministic order so
  // truncation at the cap is stable, not arbitrary. The blob column is selected
  // when present so dense rows skip JSON parsing entirely (M50.A2: measured
  // 1.75s of JSON.parse+cosine per bb_ask at 10.5k x 2048-dim).
  const columnsBase =
    "SELECT rowid AS rowid, entity_id AS entityId, embedding_vector AS vector, "
  const columnsBlob = columnsBase + "embedding_blob AS blob, embedding_model AS model "
  const columnsJson = columnsBase + "embedding_model AS model "
  const fromWhere =
    "FROM brain_semantic_embedding " +
    "WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? " +
    "ORDER BY entity_id LIMIT ?"
  const args = [projectId, queryModel, queryVector.length, VECTOR_SCAN_CAP] as const
  let rows: EmbeddingRow[]
  const withBlobColumn = hasBlobColumn(raw)
  if (withBlobColumn) {
    try {
      rows = raw.prepare(columnsBlob + fromWhere).all(...args) as EmbeddingRow[]
    } catch {
      // The column vanished under a cached handle (manual surgery, a DB
      // swapped on disk): degrade to the JSON column instead of failing the
      // query, and remember the answer for this handle.
      blobColumnByHandle.set(raw, false)
      rows = raw.prepare(columnsJson + fromWhere).all(...args) as EmbeddingRow[]
    }
  } else {
    rows = raw.prepare(columnsJson + fromWhere).all(...args) as EmbeddingRow[]
  }

  if (rows.length === 0) {
    return await keywordFallback(projectId, query, options, "no-matching-model-embeddings")
  }

  // Same scoring math as before, on float32 buffers: the blob path becomes a
  // zero-copy view, and the legacy path fills a reused scratch buffer with the
  // measured fast scanner (bit-faithful to float32, max abs delta 2.9e-8).
  const dim = queryVector.length
  const queryF32 = new Float32Array(dim)
  for (let i = 0; i < dim; i++) queryF32[i] = queryVector[i]
  const scratch = new Float32Array(dim)
  const scored: Array<{ entityId: string; similarity: number }> = []
  // M50.A2 (#764): rows read from JSON that lack the accelerator are promoted
  // in the background AFTER this call returns — a user with a pre-existing
  // index gets the faster path without re-indexing anything.
  const needsPromotion: number[] = []
  for (const row of rows) {
    const vec = readRowVector(row.blob ?? null, row.vector, dim, scratch)
    if (!vec) continue // tfidf/sparse/malformed or dimension mismatch
    if (withBlobColumn && row.blob == null && typeof row.rowid === "number") needsPromotion.push(row.rowid)
    const similarity = cosineFloat32(queryF32, vec, dim)
    if (Number.isFinite(similarity)) scored.push({ entityId: row.entityId, similarity })
  }
  if (needsPromotion.length > 0) {
    promoteMissingBlobsInBackground(raw, String(projectId), queryModel, needsPromotion)
  }

  const isLocalVectors = queryVector.length < 200
  const threshold = options.similarityThreshold ?? (isLocalVectors ? 0.15 : 0.35)
  const ranked = scored
    .filter((s) => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.min(maxResults * 10, 500))

  if (ranked.length === 0) {
    return await keywordFallback(projectId, query, options, "no-vector-above-threshold")
  }

  const results = await resolveEntities(projectId, ranked, options, maxResults)
  if (results.length === 0) {
    return await keywordFallback(projectId, query, options, "no-resolvable-entities")
  }

  return {
    results,
    provenance: makeProvenance({ evidenceClass: "semantic_candidate", engine: "semantic-search@intelligence", engineVersion: "m10.02", projectId, source: "brain_semantic_embedding", limitations: ["Semantic similarity is candidate discovery and does not prove behavior, ownership, or architecture."], truncated: rows.length >= VECTOR_SCAN_CAP }),
    metadata: {
      queryModel,
      indexModel: queryModel,
      method: "vector",
      dimension: queryVector.length,
      scannedRows: rows.length,
      filteredRows: scored.length,
      ...coverage,
    },
  }
}

async function resolveEntities(
  projectId: ProjectID,
  ranked: Array<{ entityId: string; similarity: number }>,
  options: SemanticSearchOptions,
  maxResults: number,
): Promise<SemanticResult[]> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const byId = new Map(ranked.map((r) => [r.entityId, r.similarity]))
  const ids = ranked.map((r) => r.entityId)
  if (ids.length === 0) return []

  const placeholders = ids.map(() => "?").join(",")
  const symbols = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, " +
      "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
      "f.id AS fileId, f.relative_path AS relativePath, f.path AS filePath, COALESCE(f.language, 'unknown') AS language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.id IN (" + placeholders + ")",
  ).all(projectId, ...ids) as SymbolRow[]

  const symbolMap = new Map(symbols.map((s) => [s.id, s]))
  // Freshness truthfulness: a source whose file changed on disk since indexing
  // must be flagged stale — never presented as current.
  const freshness = checkResultsFreshness(raw, symbols.map((s) => ({ fileId: s.fileId })))
  const results: SemanticResult[] = []

  for (const entry of ranked) {
    if (results.length >= maxResults) break
    const symbol = symbolMap.get(entry.entityId)
    if (!symbol) continue
    if (AnalysisExclusions.isAnalysisExcluded(symbol.relativePath)) continue
    if (options.filePath && !symbol.relativePath.includes(options.filePath) && !symbol.filePath.includes(options.filePath)) continue
    if (options.languages?.length && !options.languages.includes(symbol.language)) continue
    if (options.symbolKind && symbol.symbolType !== options.symbolKind) continue

    const snippet = (await readSymbolSnippet(symbol.filePath, symbol.line, symbol.lineEnd, 30)) || symbol.name
    results.push({
      entityId: entry.entityId,
      symbolName: symbol.name,
      symbolType: symbol.symbolType,
      file: symbol.relativePath,
      line: symbol.line,
      snippet,
      similarity: entry.similarity,
      language: symbol.language,
      stale: ["stale", "missing"].includes(freshness.get(symbol.fileId) ?? "") || undefined,
    })
  }
  return results
}

async function keywordFallback(
  projectId: ProjectID,
  query: string,
  options: SemanticSearchOptions,
  reason: string,
): Promise<SemanticSearchResults> {
  const { searchContent } = await import("./content-search")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const content = await searchContent(projectId, query, {
    maxResults: options.maxResults || 50,
    languages: options.languages,
    symbolKind: options.symbolKind,
  })
  // `similarity: null`, not 0 — see SemanticResult.similarity. A zero is a
  // NUMBER, and every consumer treated it as one.
  const results: SemanticResult[] = content.map((row) => ({
    entityId: row.fileId,
    symbolName: row.symbolName || row.context,
    symbolType: row.symbolType || "symbol",
    file: row.file,
    line: row.line,
    snippet: row.snippet,
    similarity: null,
    language: row.language,
    stale: (row as any).stale === true || undefined,
  }))
  return {
    results,
    provenance: makeProvenance({ evidenceClass: "semantic_candidate", engine: "semantic-search@intelligence", engineVersion: "m10.02", projectId, source: "content-search-fallback", limitations: ["Keyword fallback is not vector-ranked and similarity is not meaningful; results are candidate discovery, not behavioral proof."], unknowns: [reason] }),
    metadata: {
      queryModel: "none",
      indexModel: "none",
      method: "keyword-fallback",
      dimension: 0,
      scannedRows: content.length,
      filteredRows: content.length,
      fallbackReason: reason,
      ...measureCoverage(raw, projectId),
    },
  }
}
