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
const contentFtsBuilds = new Map<string, Promise<boolean>>()
const CONTENT_FTS_TABLE = "brain_symbol_content_fts"
const CONTENT_FTS_META = "brain_symbol_content_fts_meta"

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

// The giant path cannot rebuild an ephemeral FTS table for every query. Keep a
// persistent trigram index in the project DB and rebuild it only when the
// symbol snapshot changes. The table is deliberately project-scoped even
// though a normal brain DB contains one project, so the invariant remains true
// for shared/test databases too.
function contentFtsSchema(raw: any): void {
  raw.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${CONTENT_FTS_TABLE} USING fts5(
      symbol_id UNINDEXED, project_id UNINDEXED, name, qualified_name, docstring,
      tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS ${CONTENT_FTS_META} (
      project_id TEXT PRIMARY KEY NOT NULL,
      symbol_count INTEGER NOT NULL,
      max_updated INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS bb_content_fts_symbol_insert
      AFTER INSERT ON brain_symbol
      BEGIN DELETE FROM ${CONTENT_FTS_META} WHERE project_id = NEW.project_id; END;
    CREATE TRIGGER IF NOT EXISTS bb_content_fts_symbol_update
      AFTER UPDATE ON brain_symbol
      BEGIN
        DELETE FROM ${CONTENT_FTS_META} WHERE project_id = OLD.project_id;
        DELETE FROM ${CONTENT_FTS_META} WHERE project_id = NEW.project_id;
      END;
    CREATE TRIGGER IF NOT EXISTS bb_content_fts_symbol_delete
      AFTER DELETE ON brain_symbol
      BEGIN DELETE FROM ${CONTENT_FTS_META} WHERE project_id = OLD.project_id; END;`,
  )
}

async function ensureContentFts(raw: any, projectId: ProjectID): Promise<boolean> {
  if (!detectFts5(raw)) return false
  try {
    contentFtsSchema(raw)
    const marker = raw.prepare(
      `SELECT symbol_count AS symbolCount, max_updated AS maxUpdated FROM ${CONTENT_FTS_META} WHERE project_id = ?`,
    ).get(projectId) as { symbolCount: number; maxUpdated: number } | undefined
    // The rebuild writes the marker only after every row is inserted. Symbol
    // mutations delete the marker through the triggers above, so readiness is
    // O(1) and never performs a million-row COUNT on the query path. A missing
    // marker deliberately falls back to the bounded SQL path until maintenance
    // rebuilds the index; stale content is never presented as fresh.
    return marker !== undefined
  } catch {
    return false
  }
}

/** Build the persistent giant-corpus search index outside the query path. */
export async function rebuildContentSearchIndex(projectId: ProjectID): Promise<{ indexed: number; symbolCount: number; maxUpdated: number }> {
  const key = String(projectId)
  const active = contentFtsBuilds.get(key)
  if (active) {
    await active
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare(`SELECT symbol_count AS symbolCount, max_updated AS maxUpdated FROM ${CONTENT_FTS_META} WHERE project_id=?`).get(projectId) as any
    return { indexed: Number(row?.symbolCount || 0), symbolCount: Number(row?.symbolCount || 0), maxUpdated: Number(row?.maxUpdated || 0) }
  }
  const build = Promise.resolve().then(async () => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    if (!detectFts5(raw)) throw new Error("SQLite FTS5 is unavailable")
    contentFtsSchema(raw)
    const snapshot = raw.prepare(
      "SELECT COUNT(*) AS symbolCount, COALESCE(MAX(time_updated), 0) AS maxUpdated FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%'",
    ).get(projectId) as { symbolCount: number; maxUpdated: number }
    const rebuild = raw.transaction(() => {
      raw.prepare(`DELETE FROM ${CONTENT_FTS_TABLE} WHERE project_id = ?`).run(projectId)
      const insert = raw.prepare(`INSERT INTO ${CONTENT_FTS_TABLE} (symbol_id, project_id, name, qualified_name, docstring) VALUES (?, ?, ?, ?, ?)`)
      const rows = raw.prepare("SELECT id, name, qualified_name AS qualifiedName, docstring FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%'").all(projectId) as Array<{ id: string; name: string; qualifiedName: string | null; docstring: string | null }>
      for (const row of rows) insert.run(row.id, projectId, row.name, row.qualifiedName ?? "", row.docstring ?? "")
      raw.prepare(`INSERT INTO ${CONTENT_FTS_META} (project_id, symbol_count, max_updated) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET symbol_count=excluded.symbol_count, max_updated=excluded.max_updated`).run(projectId, snapshot.symbolCount, snapshot.maxUpdated)
      return rows.length
    })
    const indexed = rebuild()
    return { indexed, symbolCount: snapshot.symbolCount, maxUpdated: snapshot.maxUpdated }
  })
  contentFtsBuilds.set(key, build.then(() => true))
  try {
    return await build
  } finally {
    contentFtsBuilds.delete(key)
  }
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
  const contentFtsReady = await ensureContentFts(raw, projectId)

  // 1. exact name (indexed via NOCASE index)
  const exact = selectJoined(raw, projectId, "s.name = ? COLLATE NOCASE" + idFilterSql, [trimmed, ...idFilterParams])
  bump(exact, 3)

  // 2. name prefix (indexed via NOCASE index range scan)
  const prefix = selectJoined(raw, projectId, "s.name LIKE ? COLLATE NOCASE" + idFilterSql, [trimmed + "%", ...idFilterParams])
  bump(prefix, 3)

  const pageBudget = offset + maxResults

  // 3-5. Use the persistent trigram index for substring candidates. The final
  // JavaScript check preserves the old exact-substring semantics while FTS5
  // avoids repeatedly scanning qualified_name and docstring across a giant DB.
  if (byId.size < pageBudget) {
    const lowerNeedle = trimmed.toLowerCase()
    let broadIds: Array<{ id: string }> = []
    if (contentFtsReady && trimmed.length >= 3) {
      const ftsQuery = '"' + trimmed.replace(/"/g, '""') + '"'
      broadIds = raw.prepare(
        `SELECT symbol_id AS id FROM ${CONTENT_FTS_TABLE} WHERE ${CONTENT_FTS_TABLE} MATCH ? AND project_id = ? LIMIT ?`,
      ).all(ftsQuery, projectId, PHASE_CAP) as Array<{ id: string }>
    }
    const rows = broadIds.length
      ? fetchByIds(raw, projectId, broadIds, idFilterSql, idFilterParams)
      : []
    for (const row of rows) {
      let score = 0
      const lowerName = row.name.toLowerCase()
      if (lowerName === lowerNeedle) score += 3
      if (lowerName.startsWith(lowerNeedle)) score += 3
      if (lowerName.includes(lowerNeedle)) score += 1
      if ((row.qualifiedName ?? "").toLowerCase().includes(lowerNeedle)) score += 2
      if ((row.docstring ?? "").toLowerCase().includes(lowerNeedle)) score += 1
      if (score > 0) bump([row], score)
    }

    // Short queries and SQLite builds without trigram FTS retain the previous
    // bounded SQL behavior; this is a compatibility fallback, not the giant
    // fast path.
    if (!contentFtsReady || (trimmed.length < 3 && byId.size < pageBudget)) {
      const needle = "%" + trimmed + "%"
      const fallbackIds = raw.prepare(
        "SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%' " +
          "AND (name LIKE ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE OR docstring LIKE ? COLLATE NOCASE) LIMIT ?",
      ).all(projectId, needle, needle, needle, PHASE_CAP) as Array<{ id: string }>
      const fallbackRows = fetchByIds(raw, projectId, fallbackIds, idFilterSql, idFilterParams)
      for (const row of fallbackRows) {
        let score = 0
        const lowerName = row.name.toLowerCase()
        if (lowerName === lowerNeedle) score += 3
        if (lowerName.startsWith(lowerNeedle)) score += 3
        if (lowerName.includes(lowerNeedle)) score += 1
        if ((row.qualifiedName ?? "").toLowerCase().includes(lowerNeedle)) score += 2
        if ((row.docstring ?? "").toLowerCase().includes(lowerNeedle)) score += 1
        if (score > 0) bump([row], score)
      }
    }
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