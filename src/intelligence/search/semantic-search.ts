import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { SemanticEngine } from "../../brain/semantic/engine"
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

type EmbeddingRow = {
  entityId: string
  vector: string
  model: string
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

function isDenseNumericVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === "number" && Number.isFinite(n))
}

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

  const emptyMeta = (method: "vector" | "keyword-fallback", reason: string, model = "unknown", dimension = 0): SemanticSearchResults => ({
    results: [],
    provenance: makeProvenance({ evidenceClass: method === "vector" ? "unknown" : "semantic_candidate", engine: "semantic-search@intelligence", engineVersion: "m10.02", projectId, source: method === "vector" ? "no-result" : "content-search-fallback", limitations: ["Semantic retrieval is candidate discovery, not behavioral proof."], unknowns: [reason] }),
    metadata: { queryModel: model, indexModel: model, method, dimension, scannedRows: 0, filteredRows: 0, fallbackReason: reason },
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

  // Authoritative model = the one that actually produced this query vector.
  const queryModel = SemanticEngine.getLastEmbeddingModel()
  if (NON_DENSE_MODELS.has(queryModel)) {
    return await keywordFallback(projectId, query, options, "non-dense-query-model")
  }

  // Retrieve only same-model, same-dimension embeddings. Deterministic order so
  // truncation at the cap is stable, not arbitrary.
  const rows = raw.prepare(
    "SELECT entity_id AS entityId, embedding_vector AS vector, embedding_model AS model " +
      "FROM brain_semantic_embedding " +
      "WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? " +
      "ORDER BY entity_id LIMIT ?",
  ).all(projectId, queryModel, queryVector.length, VECTOR_SCAN_CAP) as EmbeddingRow[]

  if (rows.length === 0) {
    return await keywordFallback(projectId, query, options, "no-matching-model-embeddings")
  }

  const scored: Array<{ entityId: string; similarity: number }> = []
  for (const row of rows) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.vector)
    } catch {
      continue
    }
    if (!isDenseNumericVector(parsed)) continue // guards against tfidf/sparse/NaN
    const similarity = SemanticEngine.cosineSimilarity(queryVector, parsed)
    if (Number.isFinite(similarity)) scored.push({ entityId: row.entityId, similarity })
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
  const content = await searchContent(projectId, query, {
    maxResults: options.maxResults || 50,
    languages: options.languages,
    symbolKind: options.symbolKind,
  })
  const results: SemanticResult[] = content.map((row) => ({
    entityId: row.fileId,
    symbolName: row.symbolName || row.context,
    symbolType: row.symbolType || "symbol",
    file: row.file,
    line: row.line,
    snippet: row.snippet,
    similarity: 0,
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
    },
  }
}
