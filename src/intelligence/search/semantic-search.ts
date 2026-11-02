// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — vector retrieval for bb_ask: it embeds a question, compares
//   only stored vectors from the same model and width, and returns ranked candidates
//   with the provenance, freshness and comparison facts the answer needs.
// WHICH TOOL IT SERVES — bb_ask (mutability read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — three constraints force the design:
//   1. a READ must not write. Every open is byte-read-only, the legacy-blob
//      promotion that used to be scheduled for read rows is gone (that belongs to
//      indexing), and the fallback engines are the only remaining shared readers.
//   2. a similarity is only meaningful in ONE vector space, so the query model and
//      width are authoritative and rows from any other space are excluded.
//   3. a number's meaning must be declared with it: the comparison coverage is
//      measured for the model that was ACTUALLY compared (after the query vector
//      exists), the scan cap is published, and a provider that does not answer in
//      time is reported instead of hiding as slow retrieval.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/BB_ASK.md,
//   validation/tools/bb_ask/**, gates: npx tsx script/m13/verify-ask-honesty.ts,
//   npx tsx script/verify-semantic.ts, npx tsx script/m13/verify-ask-integration.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/quick-answer.ts,
//   src/mcp/tools/bb_ask/{handler,descriptor}.ts, docs/BB_ASK.md, those gates.
// CONTRACTS IT MUST NOT BREAK — read-only access to the index; model/width
//   consistency; similarity null (never 0) on the lexical path; declared absence
//   via fallbackReason; declared coverage, scan bounds and embedding-timeout facts.
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { SemanticEngine } from "../../brain/semantic/engine"
import { cosineFloat32, readRowVector } from "../../brain/semantic/vector-binary"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SemanticResult, SemanticSearchOptions, SemanticSearchResults } from "../contracts"
import { readSymbolSnippet } from "../source-utils"
import { makeProvenance } from "../evidence"
import { embedLocal, projectVocabulary } from "../../brain/semantic/local-embed"

declare module "../contracts" {
  interface SemanticResult {
    /**
     * True when the indexed file no longer exists on disk. Distinct from
     * `stale` (the file changed): a deleted file is not "changed", and a reader
     * deciding whether to trust a citation needs to know which one it is.
     */
    missing?: boolean
  }
}

/** Hard cap on candidate vectors loaded for the dense scan. Bounds memory and CPU;
 *  when it is reached the scan is a deterministic prefix of the embedding table
 *  (ordered by entity_id) and that fact is published in `scan.capped`. */
export const VECTOR_SCAN_CAP = Number(process.env.BB_VECTOR_SCAN_CAP || 20000)

/** How much a query embedding may block the tool before the local fallback runs.
 *  The provider bound is 30 s by default; a read tool that answers in ~2 s cannot
 *  wait for it. The answer declares the bound that fired. */
export const EMBEDDING_WAIT_CEILING_MS = 2000

/**
 * How close two scores must be for the ranking to be treated as unable to tell
 * them apart. 0.05 on a cosine is roughly the resolution of a 50-dimensional
 * hashed space: one extra vocabulary word in a typical body moves the score by
 * about this much, so results within it differ by vocabulary rather than by
 * anything about the question.
 */
const NON_DISCRIMINATIVE_MARGIN = 0.05

/**
 * Minimum cosine for a LOCAL (offline, 50-dimensional hashed) match to be
 * returned at all. The old floor (0.15) sat below the false-positive median:
 * measured over two populations known apart without human judgement, a 0.50
 * floor kept 61% of true matches and 0% of false ones, while the dense matches it
 * gives up are symbol-name queries the exact-name route answers before retrieval
 * is consulted.
 */
export const LOCAL_VECTOR_FLOOR = 0.5

/** Minimum cosine for a non-local (API embedding model) match. */
export const DENSE_MODEL_FLOOR = 0.35

// Sparse/incompatible model labels that must never be fed to dense cosine.
const NON_DENSE_MODELS = new Set(["tfidf-v1"])

/** Facts about the vector space that was compared. `comparable*` counts are for the
 *  query model and width; `library*` counts describe every stored embedding, which
 *  is a different number and is labelled as such. */
export interface SemanticComparison {
  queryModel: string
  dimension: number
  comparableSymbols: number
  comparableEmbeddings: number
  comparableCoverage: number
  librarySymbols: number
  libraryEmbeddings: number
  libraryCoverage: number
}

/** Bounds on the scan that produced the results, so a prefix is never read as a
 *  complete match set. */
export interface SemanticScan {
  cap: number
  scannedRows: number
  filteredRows: number
  rankedCandidates: number
  capped: boolean
}

/** What the ask-time embedding did: whether the provider answered inside the tool's
 *  ceiling, and which vector space answered when it did not. */
export interface SemanticEmbeddingBound {
  waitCeilingMs: number
  timedOut: boolean
  fellBackTo: string | null
}

export type SemanticSearchFacts = {
  comparison: SemanticComparison
  scan: SemanticScan
  embeddingBound?: SemanticEmbeddingBound
}

export type SemanticSearchResultsWithFacts = SemanticSearchResults & SemanticSearchFacts

/** Stored embedding rows and indexable symbols, read through a byte-read-only
 *  handle. Two queries rather than one subquery pair so the model filter applies
 *  to the embedding count: a project can hold several models at once. */
async function measureCounts(
  raw: any,
  projectId: ProjectID,
  model: string | null,
  dimension: number,
): Promise<SemanticComparison> {
  let librarySymbols = 0
  let libraryEmbeddings = 0
  let comparableEmbeddings = 0
  try {
    librarySymbols = ((raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c ?? 0)
    libraryEmbeddings = ((raw.prepare("SELECT COUNT(DISTINCT entity_id) AS c FROM brain_semantic_embedding WHERE project_id = ?").get(projectId) as any)?.c ?? 0)
    if (model !== null) {
      comparableEmbeddings = ((raw
        .prepare("SELECT COUNT(DISTINCT entity_id) AS c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ?")
        .get(projectId, model, dimension) as any)?.c ?? 0)
    }
  } catch {
    // A count that cannot be read is reported as zero coverage with the call's
    // limitations, never as a full index.
  }
  return {
    queryModel: model ?? "none",
    dimension,
    comparableSymbols: librarySymbols,
    comparableEmbeddings,
    comparableCoverage: librarySymbols > 0 ? comparableEmbeddings / librarySymbols : 0,
    librarySymbols,
    libraryEmbeddings,
    libraryCoverage: librarySymbols > 0 ? libraryEmbeddings / librarySymbols : 0,
  }
}

type EmbeddingRow = {
  rowid?: number
  entityId: string
  vector: string
  /** Little-endian float32 accelerator; null on legacy rows. */
  blob?: Uint8Array | null
  model: string
}

// The accelerator column is added at open (ensureSchemaIfNew). A byte-read-only
// open deliberately skips migrations, so the column may be absent on an index
// that has not been opened read-write since the column landed — detected once per
// handle and answered from JSON only, never by failing.
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

/** Resolve a promise, or report that the wait ceiling fired. The underlying
 *  promise keeps its own rejection handler, so a late provider answer cannot
 *  become an unhandled rejection after the tool has moved on. */
async function boundedWait<T>(
  promise: Promise<T>,
  waitMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), waitMs)
    if (typeof (timer as any).unref === "function") (timer as any).unref()
  })
  const settled = promise.then(
    (value) => ({ timedOut: false as const, value }),
    () => ({ timedOut: true as const }),
  )
  const winner = await Promise.race([settled, timeout])
  if (timer) clearTimeout(timer)
  return winner
}

/** The project's vocabulary in the local vector space, read-only. Used only when a
 *  provider timeout forces the local model after `SemanticEngine.embed` has
 *  already been abandoned. */
function localQueryVector(raw: any, projectId: ProjectID, query: string): number[] {
  try {
    const vectors = embedLocal([query], projectVocabulary(raw, projectId))
    return vectors[0] ?? []
  } catch {
    return []
  }
}

// Vector-backed semantic retrieval with strict model consistency.
//
// Rules enforced here:
// - The query vector's producing model (SemanticEngine.getLastEmbeddingModel, or the
//   local label when a provider timeout forced the local fallback) is authoritative.
//   Only stored embeddings from that same model AND dimension are compared.
// - tfidf-v1 and any non-finite/non-numeric vectors are excluded from the dense path.
// - Every response carries metadata: query model, index model, method, dimension,
//   scan counts, fallback reason, and the comparison/scan/embedding facts.
// - Access is read-only: no schema creation, no healing, no blob promotion.
export async function semanticVectorSearch(
  projectId: ProjectID,
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchResultsWithFacts> {
  // Page size is a work budget. The tool refuses <1 and >100 at its door; the
  // engine clamps so a direct caller cannot turn it into an unbounded job.
  const maxResults = Math.max(1, Math.min(100, Math.floor(options.maxResults ?? 50)))

  let raw: any
  try {
    raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  } catch (error: any) {
    return unreadableResult(projectId, error?.message ?? String(error))
  }

  const waitCeilingMs = (() => {
    const fromEnv = Number(process.env.BB_EMBEDDING_TIMEOUT_MS)
    const providerBound = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30_000
    return Math.min(providerBound, EMBEDDING_WAIT_CEILING_MS)
  })()

  let queryVector: number[] = []
  let queryModel = "unknown"
  let embeddingBound: SemanticEmbeddingBound | undefined
  try {
    const raced = await boundedWait(SemanticEngine.embed(query, projectId as any), waitCeilingMs)
    if (raced.timedOut) {
      // The provider did not answer inside the tool's ceiling. Compute the local
      // vector directly instead of waiting for the engine's own 30 s failure path;
      // the answer then compares in the 50-dimension space and says so.
      queryVector = localQueryVector(raw, projectId, query)
      queryModel = SemanticEngine.LOCAL_MODEL_LABEL
      embeddingBound = { waitCeilingMs, timedOut: true, fellBackTo: queryVector.length > 0 ? SemanticEngine.LOCAL_MODEL_LABEL : null }
    } else {
      queryVector = raced.value
      queryModel = SemanticEngine.getLastEmbeddingModel()
    }
  } catch {
    return await keywordFallback(projectId, query, options, maxResults, "embedding-error", {
      comparison: await measureCounts(raw, projectId, null, 0),
      scan: emptyScan(),
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }

  if (!queryVector || queryVector.length === 0) {
    return await keywordFallback(projectId, query, options, maxResults, "no-query-vector", {
      comparison: await measureCounts(raw, projectId, null, 0),
      scan: emptyScan(),
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }
  const dimension = queryVector.length
  // A vector of the right SHAPE but no magnitude is a different failure from an
  // empty one: the local word-vector model returns a 50-element zero vector when
  // every token in the query is out of vocabulary, and cosine against it is 0 for
  // every row, so NOTHING was compared. Reported as such, with the cause in the
  // query rather than in the index.
  if (queryVector.every((component) => component === 0)) {
    return await keywordFallback(projectId, query, options, maxResults, "degenerate-query-vector", {
      comparison: await measureCounts(raw, projectId, queryModel, dimension),
      scan: emptyScan(),
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }
  if (NON_DENSE_MODELS.has(queryModel)) {
    return await keywordFallback(projectId, query, options, maxResults, "non-dense-query-model", {
      comparison: await measureCounts(raw, projectId, null, 0),
      scan: emptyScan(),
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }

  // Coverage is measured AFTER the query vector exists, for the model and width
  // that will actually be compared — not for the whole library. The two numbers
  // differ on a mixed-model index (measured: 32,837 stored embeddings library-wide,
  // 1,931 comparable in the local 50-dimension space).
  const comparison = await measureCounts(raw, projectId, queryModel, dimension)

  // Retrieve only same-model, same-dimension embeddings. Deterministic order so
  // truncation at the cap is stable, not arbitrary. The blob column is selected
  // when present so dense rows skip JSON parsing entirely.
  const columnsBase = "SELECT rowid AS rowid, entity_id AS entityId, embedding_vector AS vector, "
  const columnsBlob = columnsBase + "embedding_blob AS blob, embedding_model AS model "
  const columnsJson = columnsBase + "embedding_model AS model "
  const fromWhere =
    "FROM brain_semantic_embedding " +
    "WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? " +
    "ORDER BY entity_id LIMIT ?"
  const args = [projectId, queryModel, dimension, VECTOR_SCAN_CAP] as const
  let rows: EmbeddingRow[]
  const withBlobColumn = hasBlobColumn(raw)
  if (withBlobColumn) {
    try {
      rows = raw.prepare(columnsBlob + fromWhere).all(...args) as EmbeddingRow[]
    } catch {
      // The column vanished under a cached handle: degrade to the JSON column
      // instead of failing the query, and remember the answer for this handle.
      blobColumnByHandle.set(raw, false)
      rows = raw.prepare(columnsJson + fromWhere).all(...args) as EmbeddingRow[]
    }
  } else {
    rows = raw.prepare(columnsJson + fromWhere).all(...args) as EmbeddingRow[]
  }

  if (rows.length === 0) {
    return await keywordFallback(projectId, query, options, maxResults, "no-matching-model-embeddings", {
      comparison,
      scan: emptyScan(),
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }

  // Same scoring math as before, on float32 buffers: the blob path becomes a
  // zero-copy view, and the legacy path fills a reused scratch buffer.
  const queryF32 = new Float32Array(dimension)
  for (let i = 0; i < dimension; i++) queryF32[i] = queryVector[i]
  const scratch = new Float32Array(dimension)
  const scored: Array<{ entityId: string; similarity: number }> = []
  for (const row of rows) {
    const vec = readRowVector(row.blob ?? null, row.vector, dimension, scratch)
    if (!vec) continue // tfidf/sparse/malformed or dimension mismatch
    const similarity = cosineFloat32(queryF32, vec, dimension)
    if (Number.isFinite(similarity)) scored.push({ entityId: row.entityId, similarity })
  }

  const isLocalVectors = dimension < 200
  const threshold = options.similarityThreshold ?? (isLocalVectors ? LOCAL_VECTOR_FLOOR : DENSE_MODEL_FLOOR)
  const aboveThreshold = scored.filter((s) => s.similarity >= threshold)
  const ranked = aboveThreshold.sort((a, b) => b.similarity - a.similarity).slice(0, Math.min(maxResults * 10, 500))
  const scan: SemanticScan = {
    cap: VECTOR_SCAN_CAP,
    scannedRows: rows.length,
    filteredRows: scored.length,
    rankedCandidates: aboveThreshold.length,
    capped: rows.length >= VECTOR_SCAN_CAP,
  }

  if (ranked.length === 0) {
    return await keywordFallback(projectId, query, options, maxResults, "no-vector-above-threshold", {
      comparison,
      scan,
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }

  const results = await resolveEntities(projectId, ranked, options, maxResults)
  if (results.length === 0) {
    return await keywordFallback(projectId, query, options, maxResults, "no-resolvable-entities", {
      comparison,
      scan,
      ...(embeddingBound ? { embeddingBound } : {}),
    })
  }

  // ── is this ranking discriminative, or noise with a decimal point? ───────
  const rankedScores = ranked.map((r) => r.similarity)
  const topScore = rankedScores[0]
  const competitors = rankedScores.filter((s) => s >= topScore - NON_DISCRIMINATIVE_MARGIN).length - 1

  return {
    results,
    provenance: makeProvenance({
      evidenceClass: "semantic_candidate",
      engine: "semantic-search@intelligence",
      engineVersion: "m10.03",
      projectId,
      source: "brain_semantic_embedding",
      limitations: ["Semantic similarity is candidate discovery and does not prove behavior, ownership, or architecture."],
      truncated: scan.capped,
      unknowns: embeddingBound?.timedOut
        ? [`The embedding provider did not answer within ${waitCeilingMs} ms; the question was embedded with the local word-vector model (${SemanticEngine.LOCAL_MODEL_LABEL}).`]
        : [],
    }),
    metadata: {
      queryModel,
      indexModel: queryModel,
      method: "vector",
      dimension,
      scannedRows: scan.scannedRows,
      filteredRows: scan.filteredRows,
      discriminative: competitors === 0,
      nonDiscriminativeCompetitors: competitors,
      indexSymbolCount: comparison.librarySymbols,
      embeddedSymbolCount: comparison.comparableEmbeddings,
      embeddingCoverage: comparison.comparableCoverage,
    },
    comparison,
    scan,
    ...(embeddingBound ? { embeddingBound } : {}),
  }
}

function emptyScan(): SemanticScan {
  return { cap: VECTOR_SCAN_CAP, scannedRows: 0, filteredRows: 0, rankedCandidates: 0, capped: false }
}

/** The index cannot be read at all. A read must not create a database to answer a
 *  question about one, so this is answered from nothing and says so. */
function unreadableResult(projectId: ProjectID, error: string): SemanticSearchResultsWithFacts {
  const comparison: SemanticComparison = {
    queryModel: "none",
    dimension: 0,
    comparableSymbols: 0,
    comparableEmbeddings: 0,
    comparableCoverage: 0,
    librarySymbols: 0,
    libraryEmbeddings: 0,
    libraryCoverage: 0,
  }
  return {
    results: [],
    provenance: makeProvenance({
      evidenceClass: "unknown",
      engine: "semantic-search@intelligence",
      engineVersion: "m10.03",
      projectId,
      source: "index-not-readable",
      limitations: ["The index could not be opened read-only, so nothing could be compared."],
      unknowns: [`Index read failed: ${error}`],
    }),
    metadata: {
      queryModel: "none",
      indexModel: "none",
      method: "keyword-fallback",
      dimension: 0,
      scannedRows: 0,
      filteredRows: 0,
      fallbackReason: "index-not-readable",
      indexSymbolCount: 0,
      embeddedSymbolCount: 0,
      embeddingCoverage: 0,
    },
    comparison,
    scan: emptyScan(),
  }
}

async function resolveEntities(
  projectId: ProjectID,
  ranked: Array<{ entityId: string; similarity: number }>,
  options: SemanticSearchOptions,
  maxResults: number,
): Promise<SemanticResult[]> {
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
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
  // Freshness truthfulness: a source whose file changed on disk since indexing is
  // flagged stale; a source whose file is gone is flagged missing. They are two
  // different facts and the answer renders them differently.
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
    const status = freshness.get(symbol.fileId)
    results.push({
      entityId: entry.entityId,
      symbolName: symbol.name,
      symbolType: symbol.symbolType,
      file: symbol.relativePath,
      line: symbol.line,
      snippet,
      similarity: entry.similarity,
      language: symbol.language,
      stale: status === "stale" || status === "missing" || undefined,
      missing: status === "missing" || undefined,
      fileId: symbol.fileId,
    })
  }
  return results
}

/** Lexical fallback: content search, with `similarity: null` (not 0 — a zero is a
 *  number and every consumer treated it as one). Carries the comparison/scan facts
 *  that were measured before the fallback, so a reader can see what was compared
 *  even when the lexical path answered. */
async function keywordFallback(
  projectId: ProjectID,
  query: string,
  options: SemanticSearchOptions,
  maxResults: number,
  reason: string,
  facts: SemanticSearchFacts,
): Promise<SemanticSearchResultsWithFacts> {
  const { searchContent } = await import("./content-search")
  let content: any[] = []
  try {
    content = await searchContent(projectId, query, {
      maxResults,
      languages: options.languages,
      symbolKind: options.symbolKind,
    })
  } catch {
    content = []
  }
  const results: SemanticResult[] = content.map((row: any) => ({
    entityId: row.fileId,
    symbolName: row.symbolName || row.context,
    symbolType: row.symbolType || "symbol",
    file: row.file,
    line: row.line,
    snippet: row.snippet,
    similarity: null,
    language: row.language,
    stale: row.stale === true || undefined,
    fileId: row.fileId,
  }))
  return {
    results,
    provenance: makeProvenance({
      evidenceClass: "semantic_candidate",
      engine: "semantic-search@intelligence",
      engineVersion: "m10.03",
      projectId,
      source: "content-search-fallback",
      limitations: ["Keyword fallback is not vector-ranked and similarity is not meaningful; results are candidate discovery, not behavioral proof."],
      truncated: facts.scan.capped,
      unknowns: [reason],
    }),
    metadata: {
      queryModel: "none",
      indexModel: "none",
      method: "keyword-fallback",
      dimension: 0,
      scannedRows: facts.scan.scannedRows,
      filteredRows: facts.scan.filteredRows,
      fallbackReason: reason,
      // The terms route reports which query words produced these rows; a match on
      // ONE common word is a coincidence with any query sharing that word, and an
      // answer that lists code blocks without saying so reads as a finding.
      ...((content as any).termMatch ? { termMatch: (content as any).termMatch } : {}),
      indexSymbolCount: facts.comparison.librarySymbols,
      embeddedSymbolCount: facts.comparison.libraryEmbeddings,
      embeddingCoverage: facts.comparison.libraryCoverage,
    },
    comparison: facts.comparison,
    scan: facts.scan,
    ...(facts.embeddingBound ? { embeddingBound: facts.embeddingBound } : {}),
  }
}
