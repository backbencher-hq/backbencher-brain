import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SearchOptions, SearchResults } from "../contracts"

type CorpusRow = {
  id: string
  fileId: string
  name: string
  qualifiedName: string | null
  docstring: string | null
  symbolType: string
  line: number
  lineEnd: number
  complexity: number
  relativePath: string
  filePath: string
  language: string
}

let fts5Available: boolean | null = null

// Probe FTS5 support once per process. Both better-sqlite3 and bun:sqlite ship
// FTS5, but detect defensively so a missing extension degrades to LIKE.
function detectFts5(raw: { exec: (sql: string) => void }): boolean {
  if (fts5Available !== null) return fts5Available
  try {
    raw.exec("CREATE VIRTUAL TABLE IF NOT EXISTS __bb_fts_probe USING fts5(x)")
    raw.exec("DROP TABLE IF EXISTS __bb_fts_probe")
    fts5Available = true
  } catch {
    fts5Available = false
  }
  return fts5Available
}

function ftsQuote(term: string): string {
  return '"' + term.replace(/"/g, '""') + '"'
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? ""
  return line.trim().slice(0, 100)
}

// Giant-corpus guard: projects with more corpus rows than this use the bounded
// SQL-phase path instead of the full-corpus + ephemeral-FTS5 build (measured
// to take minutes on a 1M-symbol index, M19.Q1).
const GIANT_CORPUS_OFFSET = 25000

// Per-phase cap for the bounded path. Keeps every unindexable scan (substring
// / docstring) within interactive latency; matches are still ranked across the
// bounded candidate pool and the cap is recorded as a documented bound.
const PHASE_CAP = 2000

// Content/documentation search over the indexed symbol corpus
// (name + qualified_name + docstring), BM25-ranked when FTS5 is available.
// The brain does not store raw file source, so "content" means the indexed
// symbol + documentation corpus, not full-text file contents.
//
// Scale behavior (M19.Q1): for projects up to GIANT_CORPUS_OFFSET rows the
// pre-existing full-corpus + ephemeral-FTS5 path is used unchanged. Beyond
// that threshold the corpus fetch + 1M-row FTS5 build measured minutes, so a
// bounded SQL-phase path is used instead: exact/prefix name phases hit the
// case-insensitive name index, substring phases are id-first-capped, and the
// docstring phase caps at PHASE_CAP matches. Scoring mirrors rankWithLike
// (name +3, qualified_name +2, docstring +1) so both paths agree on weights.
export async function searchContent(projectId: ProjectID, query: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxResults = options.maxResults || 100
  const offset = options.offset || 0
  const trimmed = query.trim()
  if (!trimmed) return withMeta([], "content")

  if (isGiantCorpus(raw, projectId)) {
    return searchContentBounded(raw, projectId, trimmed, options, maxResults, offset)
  }
  return searchContentClassic(raw, projectId, trimmed, options, maxResults, offset, detectFts5(raw))
}

// Cheap giant guard: does a row exist GIANT_CORPUS_OFFSET deep into the
// corpus? Bounded by the (project_id) index, never fetches the whole corpus.
function isGiantCorpus(raw: any, projectId: ProjectID): boolean {
  const probe = raw.prepare(
    "SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE ? LIMIT 1 OFFSET ?",
  ).get(projectId, "/%/%", GIANT_CORPUS_OFFSET) as { id: string } | undefined
  return probe !== undefined
}

// Original full-corpus + FTS5 path for normal-size projects (unchanged).
async function searchContentClassic(
  raw: any,
  projectId: ProjectID,
  trimmed: string,
  options: SearchOptions,
  maxResults: number,
  offset: number,
  fts5: boolean,
): Promise<SearchResults> {
  const params: unknown[] = [projectId]
  let filters = ""
  if (options.languages?.length) {
    filters += " AND f.language IN (" + options.languages.map(() => "?").join(",") + ")"
    params.push(...options.languages)
  }
  if (options.symbolKind) {
    filters += " AND s.symbol_type = ?"
    params.push(options.symbolKind)
  }

  const corpus = raw.prepare(
    "SELECT s.id, s.file_id AS fileId, s.name, s.qualified_name AS qualifiedName, " +
      "s.docstring, s.symbol_type AS symbolType, " +
      "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
      "COALESCE(s.complexity, 0) AS complexity, " +
      "f.relative_path AS relativePath, f.path AS filePath, " +
      "COALESCE(f.language, 'unknown') AS language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'" +
      filters,
  ).all(...params) as CorpusRow[]

  const usable = corpus.filter(
    (row) => !AnalysisExclusions.isHardNoisePath(row.relativePath) && !AnalysisExclusions.isNoiseSymbolName(row.name),
  )

  const ranked = fts5 ? rankWithFts5(raw, trimmed, usable) : rankWithLike(trimmed, usable)
  const page = ranked.slice(offset, offset + maxResults)
  return buildResults(raw, page, "content", maxResults)
}

// Bounded SQL-phase path for giant corpora. Phases score with the same weights
// rankWithLike uses so ordering semantics are preserved across both paths.
async function searchContentBounded(
  raw: any,
  projectId: ProjectID,
  trimmed: string,
  options: SearchOptions,
  maxResults: number,
  offset: number,
): Promise<SearchResults> {
  const byId = new Map<string, { row: CorpusRow; score: number }>()
  const bump = (rows: CorpusRow[], score: number) => {
    for (const row of rows) {
      if (AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
      const existing = byId.get(row.id)
      if (existing) existing.score += score
      else byId.set(row.id, { row, score })
    }
  }

  const { sql: idFilterSql, params: idFilterParams } = languageClause(options)

  // 1. exact name (indexed via NOCASE index)
  const exact = selectJoined(raw, projectId, "s.name = ? COLLATE NOCASE" + idFilterSql, [trimmed, ...idFilterParams])
  bump(exact, 3)

  // 2. name prefix (indexed via NOCASE index range scan)
  const prefix = selectJoined(raw, projectId, "s.name LIKE ? COLLATE NOCASE" + idFilterSql, [trimmed + "%", ...idFilterParams])
  bump(prefix, 3)

  const pageBudget = offset + maxResults

  // 3. name substring (id-first, capped) — only when the indexed name phases
  // did not already fill the requested page (docstring-only matches would rank
  // below any name match anyway, so this cannot change the returned page).
  if (byId.size < pageBudget) {
    const nameIds = raw.prepare(
      "SELECT id FROM brain_symbol WHERE project_id = ? AND name LIKE ? COLLATE NOCASE AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%' LIMIT ?",
    ).all(projectId, "%" + trimmed + "%", PHASE_CAP) as Array<{ id: string }>
    if (nameIds.length) bump(fetchByIds(raw, projectId, nameIds, idFilterSql, idFilterParams), 1)
  }

  // 4. qualified_name substring (id-first, capped) — same skip rule: only
  // when name phases did not already fill the page.
  if (byId.size < pageBudget) {
    const qualIds = raw.prepare(
      "SELECT id FROM brain_symbol WHERE project_id = ? AND qualified_name LIKE ? COLLATE NOCASE AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%' LIMIT ?",
    ).all(projectId, "%" + trimmed + "%", PHASE_CAP) as Array<{ id: string }>
    if (qualIds.length) bump(fetchByIds(raw, projectId, qualIds, idFilterSql, idFilterParams), 2)
  }

  // 5. docstring substring (id-first, capped) — the last resort phase: only
  // runs when name + qualified_name could not fill the requested page. On a
  // giant corpus with no matches at all this is one bounded full scan (worst
  // case a few seconds) — recorded honestly in Q1 as the miss-query cost.
  if (byId.size < pageBudget) {
    const docIds = raw.prepare(
      "SELECT id FROM brain_symbol WHERE project_id = ? AND docstring LIKE ? COLLATE NOCASE AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%' LIMIT ?",
    ).all(projectId, "%" + trimmed + "%", PHASE_CAP) as Array<{ id: string }>
    if (docIds.length) bump(fetchByIds(raw, projectId, docIds, idFilterSql, idFilterParams), 1)
  }

  const ranked = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.row.complexity - a.row.complexity || a.row.relativePath.localeCompare(b.row.relativePath))
    .map((entry) => entry.row)
  const page = ranked.slice(offset, offset + maxResults)
  return buildResults(raw, page, "content", maxResults)
}

// Plain joined select for small candidate sets (keyword predicates).
function selectJoined(
  raw: any,
  projectId: ProjectID,
  predicate: string,
  params: unknown[],
): CorpusRow[] {
  return raw.prepare(
    "SELECT s.id, s.file_id AS fileId, s.name, s.qualified_name AS qualifiedName, " +
      "s.docstring, s.symbol_type AS symbolType, " +
      "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
      "COALESCE(s.complexity, 0) AS complexity, " +
      "f.relative_path AS relativePath, f.path AS filePath, " +
      "COALESCE(f.language, 'unknown') AS language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%' AND " + predicate,
  ).all(projectId, ...params) as CorpusRow[]
}

function languageClause(options: SearchOptions): { sql: string; params: unknown[] } {
  let sql = ""
  const params: unknown[] = []
  if (options.languages?.length) {
    sql += " AND f.language IN (" + options.languages.map(() => "?").join(",") + ")"
    params.push(...options.languages)
  }
  if (options.symbolKind) {
    sql += " AND s.symbol_type = ?"
    params.push(options.symbolKind)
  }
  return { sql, params }
}

function fetchByIds(
  raw: any,
  projectId: ProjectID,
  idRows: Array<{ id: string }>,
  filterSql: string,
  filterParams: unknown[],
): CorpusRow[] {
  const distinct = [...new Set(idRows.map((r) => r.id))]
  if (distinct.length === 0) return []
  const placeholders = distinct.map(() => "?").join(",")
  return raw.prepare(
    "SELECT s.id, s.file_id AS fileId, s.name, s.qualified_name AS qualifiedName, " +
      "s.docstring, s.symbol_type AS symbolType, " +
      "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
      "COALESCE(s.complexity, 0) AS complexity, " +
      "f.relative_path AS relativePath, f.path AS filePath, " +
      "COALESCE(f.language, 'unknown') AS language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.id IN (" + placeholders + ")" + filterSql,
  ).all(...distinct, ...filterParams) as CorpusRow[]
}

function buildResults(raw: any, page: CorpusRow[], mode: string, maxResults: number): SearchResults {
  const results: SearchResults = withMeta([], mode)
  for (const row of page) {
    results.push({
      file: row.relativePath,
      fileId: row.fileId,
      line: row.line,
      column: 0,
      context: row.docstring ? row.symbolType + ": " + row.name + " — " + firstLine(row.docstring) : row.symbolType + ": " + row.name,
      symbolName: row.name,
      symbolType: row.symbolType,
      language: row.language,
      matchType: "content",
      snippet: row.docstring ? firstLine(row.docstring) : (row.qualifiedName || row.name),
      complexity: row.complexity,
      _relevance: 1,
    })
  }
  try {
    const freshness = checkResultsFreshness(raw, results.map((result) => ({ fileId: result.fileId })))
    let staleCount = 0
    for (const result of results) {
      if (["stale", "missing"].includes(freshness.get(result.fileId) ?? "")) {
        result.stale = true
        staleCount++
      }
    }
    results.staleCount = staleCount
    results.freshCount = results.length - staleCount
  } catch {}
  return results
}

function rankWithFts5(raw: { exec: (sql: string) => void; prepare: (sql: string) => { run: (...p: unknown[]) => unknown; all: (...p: unknown[]) => unknown[] } }, query: string, corpus: CorpusRow[]): CorpusRow[] {
  const table = "__bb_content_fts_" + Math.random().toString(36).slice(2, 10)
  try {
    raw.exec("CREATE VIRTUAL TABLE " + table + " USING fts5(id UNINDEXED, name, qualified_name, docstring)")
    const insert = raw.prepare("INSERT INTO " + table + " (id, name, qualified_name, docstring) VALUES (?, ?, ?, ?)")
    for (const row of corpus) {
      insert.run(row.id, row.name, row.qualifiedName ?? "", row.docstring ?? "")
    }
    const terms = query.split(/\s+/).filter(Boolean).map(ftsQuote).join(" OR ")
    if (!terms) return []
    const ranked = raw.prepare(
      "SELECT id, bm25(" + table + ") AS score FROM " + table + " WHERE " + table + " MATCH ?",
    ).all(terms) as Array<{ id: string; score: number }>
    const byId = new Map(corpus.map((row) => [row.id, row]))
    const ordered: CorpusRow[] = []
    for (const match of ranked) {
      const row = byId.get(match.id)
      if (row) ordered.push(row)
    }
    return ordered
  } catch {
    return rankWithLike(query, corpus)
  } finally {
    try {
      raw.exec("DROP TABLE IF EXISTS " + table)
    } catch {}
  }
}

function rankWithLike(query: string, corpus: CorpusRow[]): CorpusRow[] {
  const needle = query.toLowerCase()
  const scored: Array<{ row: CorpusRow; score: number }> = []
  for (const row of corpus) {
    const name = row.name.toLowerCase()
    const qualified = (row.qualifiedName ?? "").toLowerCase()
    const docstring = (row.docstring ?? "").toLowerCase()
    let score = 0
    if (name.includes(needle)) score += 3
    if (qualified.includes(needle)) score += 2
    if (docstring.includes(needle)) score += 1
    if (score > 0) scored.push({ row, score })
  }
  scored.sort((a, b) => b.score - a.score || b.row.complexity - a.row.complexity || a.row.relativePath.localeCompare(b.row.relativePath))
  return scored.map((entry) => entry.row)
}

function withMeta(results: SearchResults, mode: string): SearchResults {
  results.searchMode = mode
  return results
}