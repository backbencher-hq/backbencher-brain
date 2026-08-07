import { BrainDatabase } from "../../brain/database"
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

// Content/documentation search over the indexed symbol corpus
// (name + qualified_name + docstring), BM25-ranked when FTS5 is available.
// The brain does not store raw file source, so "content" means the indexed
// symbol + documentation corpus, not full-text file contents.
export async function searchContent(projectId: ProjectID, query: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxResults = options.maxResults || 100
  const offset = options.offset || 0
  const trimmed = query.trim()
  if (!trimmed) return withMeta([], "content")

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

  const ranked = detectFts5(raw) ? rankWithFts5(raw, trimmed, usable) : rankWithLike(trimmed, usable)
  const page = ranked.slice(offset, offset + maxResults)

  const results: SearchResults = withMeta([], "content")
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
      "SELECT id, bm25(" + table + ") AS score FROM " + table + " WHERE " + table + " MATCH ? ORDER BY score",
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
