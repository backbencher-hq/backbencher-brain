import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SearchOptions, SearchResults } from "../contracts"
import { readSymbolSnippet } from "../source-utils"

type Candidate = {
  id: string
  fileId: string
  name: string
  symbolType: string
  line: number
  lineEnd: number
  complexity: number
  relativePath: string
  filePath: string
  language: string
}

export async function searchSymbols(projectId: ProjectID, query: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxResults = options.maxResults || 100
  const offset = options.offset || 0
  if (options.mode === "content") {
    const { searchContent } = await import("./content-search")
    return searchContent(projectId, query, options)
  }
  if (options.mode === "regex" || options.regex) {
    const { searchRegex } = await import("./regex-search")
    return searchRegex(projectId, query, options)
  }

  const candidates: Candidate[] = []
  const seen = new Set<string>()
  const phases = options.exact
    ? [{ clause: "s.name = ?", relevance: 3, value: query }]
    : options.caseSensitive
      ? [
          { clause: "s.name = ?", relevance: 3, value: query },
          { clause: "instr(s.name, ?) = 1", relevance: 2, value: query },
          { clause: "instr(s.name, ?) > 0", relevance: 1, value: query },
        ]
      : [
          { clause: "LOWER(s.name) = LOWER(?)", relevance: 3, value: query },
          { clause: "LOWER(s.name) LIKE LOWER(?)", relevance: 2, value: `${query}%` },
          { clause: "LOWER(s.name) LIKE LOWER(?)", relevance: 1, value: `%${query}%` },
        ]

  const fetchCap = Math.min(5000, Math.max(offset + maxResults * 2, maxResults * 4))
  for (const phase of phases) {
    const params: unknown[] = [projectId, phase.value]
    let filters = ""
    if (options.languages?.length) {
      filters += ` AND f.language IN (${options.languages.map(() => "?").join(",")})`
      params.push(...options.languages)
    }
    if (options.symbolKind) {
      filters += " AND s.symbol_type = ?"
      params.push(options.symbolKind)
    }
    const rows = raw.prepare(`
      SELECT s.id, s.file_id AS fileId, s.name, s.symbol_type AS symbolType,
             COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, COALESCE(s.complexity, 0) AS complexity,
             f.relative_path AS relativePath, f.path AS filePath, COALESCE(f.language, 'unknown') AS language
      FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND ${phase.clause}
        AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'${filters}
      LIMIT ?
    `).all(...params, fetchCap) as Candidate[]
    for (const row of rows) {
      if (seen.has(row.id)) continue
      if (AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
      seen.add(row.id)
      candidates.push(row)
    }
  }

  candidates.sort((a, b) => {
    const relevance = (name: string) => name.toLowerCase() === query.toLowerCase() ? 3 : name.toLowerCase().startsWith(query.toLowerCase()) ? 2 : 1
    return relevance(b.name) - relevance(a.name) || (AnalysisExclusions.isTestPath(a.relativePath) ? 1 : 0) - (AnalysisExclusions.isTestPath(b.relativePath) ? 1 : 0) || b.complexity - a.complexity || a.relativePath.localeCompare(b.relativePath)
  })

  const page = candidates.slice(offset, offset + maxResults)
  const results: SearchResults = []
  results.searchMode = "symbol"
  for (const row of page) {
    results.push({
      file: row.relativePath,
      fileId: row.fileId,
      line: row.line,
      column: 0,
      context: `${row.symbolType}: ${row.name}`,
      symbolName: row.name,
      symbolType: row.symbolType,
      language: row.language,
      matchType: "symbol",
      snippet: options.includeContent ? await readSymbolSnippet(row.filePath, row.line, row.lineEnd) || row.name : row.name,
      complexity: row.complexity,
      _relevance: row.name.toLowerCase() === query.toLowerCase() ? 3 : row.name.toLowerCase().startsWith(query.toLowerCase()) ? 2 : 1,
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
