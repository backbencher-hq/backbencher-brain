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

// Rows examined, not rows returned. Bounds the scan a single pattern can cause.
const REGEX_SCAN_CAP = 20000

/**
 * Wall-clock budget for one regex scan.
 *
 * The row cap bounds how many names are tested but NOT how long a single
 * `test()` takes: JS `RegExp` has no timeout, so a pattern like `(a|a)+$`
 * against a 200-character identifier backtracks for minutes on the one thread
 * that also owns the database handle. Measured on a five-file project: 177ms
 * for `(a|a)+$`, which is ~0.03s per name, i.e. ~10 minutes across the 20 000
 * row cap — and the caller sees a hung server, not an error.
 *
 * The deadline is checked between rows, so it bounds the SCAN. A single
 * pathological name can still exceed it; that residual risk is stated in
 * docs/BB_SEARCH.md rather than papered over. When the deadline is reached the
 * answer is returned with `truncated: true` and `truncationReason:
 * "time-budget"`, so a bounded answer is never presented as a complete one.
 */
const REGEX_TIME_BUDGET_MS = 2000

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

function normalizePageSize(value: unknown): number {
  if (value === undefined || value === null) return 100
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return 100
  return n
}

function normalizeOffset(value: unknown): number {
  if (value === undefined || value === null) return 0
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Regex search over indexed symbol names. Returns results tagged with the
// regex retrieval mode plus truncation flags when the scan cap or the time
// budget stopped the scan.
export async function searchRegex(projectId: ProjectID, rawPattern: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxResults = normalizePageSize(options.maxResults)
  const offset = normalizeOffset(options.offset)
  // Trimmed like every other mode: a pattern is a pattern, not a sentence with
  // accidental surrounding whitespace.
  const pattern = String(rawPattern ?? "").trim()
  if (!pattern) {
    const empty = [] as unknown as SearchResults
    empty.searchMode = "regex"
    empty.staleCount = 0
    empty.freshCount = 0
    empty.totalMatches = 0
    return empty
  }
  const expression = compileRegex(pattern, options.caseSensitive === true)

  const params: unknown[] = [projectId]
  let filters = ""
  if (options.languages?.length) {
    filters += " AND f.language COLLATE NOCASE IN (" + options.languages.map(() => "?").join(",") + ")"
    params.push(...options.languages)
  }
  if (options.symbolKind) {
    filters += " AND s.symbol_type COLLATE NOCASE = ?"
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

  const rowCapReached = corpus.length > REGEX_SCAN_CAP
  const scannable = rowCapReached ? corpus.slice(0, REGEX_SCAN_CAP) : corpus

  const matched: CorpusRow[] = []
  const deadline = Date.now() + REGEX_TIME_BUDGET_MS
  let timeBudgetReached = false
  for (let i = 0; i < scannable.length; i++) {
    // Deadline checked every row: the loop is the only unbounded dimension
    // reachable from a caller's pattern.
    if ((i & 0xFF) === 0 && Date.now() > deadline) {
      timeBudgetReached = true
      break
    }
    const row = scannable[i]!
    if (AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
    if (expression.test(row.name)) matched.push(row)
  }

  matched.sort(
    (a, b) =>
      (AnalysisExclusions.isTestPath(a.relativePath) ? 1 : 0) - (AnalysisExclusions.isTestPath(b.relativePath) ? 1 : 0) ||
      b.complexity - a.complexity ||
      compareCodeUnits(a.relativePath, b.relativePath) ||
      compareCodeUnits(a.name, b.name),
  )

  const page = matched.slice(offset, offset + maxResults)
  const results = [] as unknown as SearchResults
  results.searchMode = "regex"
  results.truncated = rowCapReached || timeBudgetReached
  if (rowCapReached) results.truncationReason = "scan-cap"
  else if (timeBudgetReached) results.truncationReason = "time-budget"
  results.totalMatches = matched.length
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
  } catch {
    results.freshnessError = true
  }

  return results
}
