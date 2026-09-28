import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SearchOptions, SearchResults } from "../contracts"
import { readSymbolSnippet } from "../source-utils"

type CorpusRow = {
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

// Cap the candidate scan so a pathological pattern cannot walk an unbounded
// corpus. This is the number of DB rows examined, not results returned.
const REGEX_SCAN_CAP = 20000

export class InvalidRegexError extends Error {
  constructor(pattern: string, cause: string) {
    super('invalid regex "' + pattern + '": ' + cause)
    this.name = "InvalidRegexError"
  }
}

function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseSensitive ? "" : "i")
  } catch (error) {
    throw new InvalidRegexError(pattern, error instanceof Error ? error.message : String(error))
  }
}

// Regex search over indexed symbol names. Returns results tagged with the
// regex retrieval mode and a truncation flag when the scan cap is reached.
export async function searchRegex(projectId: ProjectID, pattern: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxResults = options.maxResults || 100
  const offset = options.offset || 0
  const expression = compileRegex(pattern, options.caseSensitive === true)

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
    "SELECT s.id, s.file_id AS fileId, s.name, s.symbol_type AS symbolType, " +
      "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
      "COALESCE(s.complexity, 0) AS complexity, " +
      "f.relative_path AS relativePath, f.path AS filePath, " +
      "COALESCE(f.language, 'unknown') AS language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'" +
      filters +
      " LIMIT ?",
  ).all(...params, REGEX_SCAN_CAP + 1) as CorpusRow[]

  const truncated = corpus.length > REGEX_SCAN_CAP
  const scannable = truncated ? corpus.slice(0, REGEX_SCAN_CAP) : corpus

  const matched: CorpusRow[] = []
  for (const row of scannable) {
    if (AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
    if (expression.test(row.name)) matched.push(row)
  }

  matched.sort(
    (a, b) =>
      (AnalysisExclusions.isTestPath(a.relativePath) ? 1 : 0) - (AnalysisExclusions.isTestPath(b.relativePath) ? 1 : 0) ||
      b.complexity - a.complexity ||
      a.relativePath.localeCompare(b.relativePath) ||
      a.name.localeCompare(b.name),
  )

  const page = matched.slice(offset, offset + maxResults)
  const results: SearchResults = []
  results.searchMode = "regex"
  results.truncated = truncated
  for (const row of page) {
    results.push({
      file: row.relativePath,
      fileId: row.fileId,
      line: row.line,
      column: 0,
      context: row.symbolType + ": " + row.name,
      symbolName: row.name,
      symbolType: row.symbolType,
      language: row.language,
      matchType: "symbol",
      snippet: options.includeContent ? (await readSymbolSnippet(row.filePath, row.line, row.lineEnd)) || row.name : row.name,
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
