import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { SearchOptions, SearchResults } from "../contracts"
import { readSymbolSnippet } from "../source-utils"
import { scanWithDeadline } from "./regex-scan-worker"

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
 * Wall-clock budget for one regex scan, enforced by TERMINATING a worker.
 *
 * A deadline checked between rows is not protection. Measured in a fresh
 * process, one `test()` call on ONE name:
 *
 *   (a+)+b vs "a"*30                     > 15,000ms (killed)
 *   (a+)+b vs "pre_handleRequestInner"     2,076ms
 *   (a+)+b vs "handleRequestExact"           235ms
 *
 * So the exposure is not the accumulation across a corpus — it is a single row.
 * The scan is therefore isolated in a worker thread (regex-scan-worker.ts) and
 * this budget is a hard kill, not a cooperative check. When it fires the answer
 * is returned empty with `truncated: true` and
 * `truncationReason: "time-budget"`: a bounded answer, never a partial one
 * presented as complete.
 */
const REGEX_TIME_BUDGET_MS = 2000

/**
 * Cap on how many MATCHED rows are projected into full records.
 *
 * The projection is bounded so a match-everything pattern cannot turn one call
 * into seconds of row-object construction. It is deliberately generous — at 5,000
 * it cost real recall on real corpora (phpunit's `name` has 6,277 declarations),
 * and a cap that drops a quarter of the answer is not a cap a caller can reason
 * about. The join is chunked, so a large cap does not produce a raw "too many
 * SQL variables" driver error.
 */
const PROJECTION_MAX = 50000

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
    filters += " AND s.file_id IN (SELECT id FROM brain_file WHERE project_id = ? AND language COLLATE NOCASE IN (" + options.languages.map(() => "?").join(",") + "))"
    params.push(projectId, ...options.languages)
  }
  if (options.symbolKind) {
    filters += " AND s.symbol_type COLLATE NOCASE = ?"
    params.push(options.symbolKind)
  }
  // The worker's own query binds the project id first, so only the FILTER values
  // are forwarded with the predicate.
  const workerExtraParams = [...params.slice(1)]

  // The candidate read is bounded and happens on the caller's own connection;
  // only the MATCHING is isolated, because only the matching is unbounded.
  const candidates = raw
    .prepare(
      "SELECT s.id AS id, s.name AS name FROM brain_symbol s " +
        "WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'" +
        filters +
        " LIMIT ?",
    )
    .all(...params, REGEX_SCAN_CAP + 1) as Array<{ id: string; name: string }>

  const rowCapReached = candidates.length > REGEX_SCAN_CAP
  const rows = rowCapReached ? candidates.slice(0, REGEX_SCAN_CAP) : candidates

  const scan = await scanWithDeadline(
    { pattern, caseSensitive: options.caseSensitive === true, names: rows.map((row) => row.name) },
    REGEX_TIME_BUDGET_MS,
  )

  const timeBudgetReached = scan.timedOut
  const unisolated = scan.inline
  const matchedIds = scan.matchedIndexes.map((index) => rows[index]!.id)
  // The projection, for the matched rows only, in CHUNKS.
  //
  // Chunked because a pattern can match every symbol in a project, and a single
  // `IN (?, ?, …)` with 17 868 placeholders exceeds SQLite's bound-variable
  // limit — the request fails with "too many SQL variables", which is a raw
  // driver error reaching the caller for a query that should simply return
  // every match.
  const matched: CorpusRow[] = []
  const PROJECTION_CHUNK = 500
  // The projection is bounded too, not just the scan. A pattern that matches
  // most of a large project would otherwise spend seconds building row objects
  // for matches the caller will never see: measured 5,395ms to project 17,868
  // ids (~0.3ms each) on top of the scan. Ranking a PREFIX of the matched set is
  // not the ranking of the whole set, so when the cap fires the answer says so —
  // the same rule the scan cap already follows.
  const projectionCapReached = matchedIds.length > PROJECTION_MAX
  const projectable = projectionCapReached ? matchedIds.slice(0, PROJECTION_MAX) : matchedIds
  // Reported so a caller can tell "5 matches" from "5000 matches were ranked and
  // 12,000 more matched". Without it, `totalMatches` under-reports silently.
  const matchedRowCount = matchedIds.length
  for (let start = 0; start < projectable.length; start += PROJECTION_CHUNK) {
    const chunk = projectable.slice(start, start + PROJECTION_CHUNK)
    const rows = raw
      .prepare(
        "SELECT s.id, s.file_id AS fileId, s.name, s.symbol_type AS symbolType, " +
          "COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, " +
          "COALESCE(s.complexity, 0) AS complexity, " +
          "f.relative_path AS relativePath, f.path AS filePath, " +
          "COALESCE(f.language, 'unknown') AS language " +
          "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (" +
          chunk.map(() => "?").join(",") +
          ")",
      )
      .all(...chunk) as CorpusRow[]
    for (const row of rows) {
      // The noise filter moved here, after the cheap scan: it needs the path, so
      // it cannot run before the projection, and running it before the page
      // slice is what stops noise rows from consuming the page.
      if (AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)) continue
      matched.push(row)
    }
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
  results.truncated = rowCapReached || timeBudgetReached || projectionCapReached
  const reasons: string[] = []
  if (rowCapReached) reasons.push("scan-cap")
  if (timeBudgetReached) reasons.push("time-budget")
  if (projectionCapReached) reasons.push("projection-cap")
  if (unisolated) reasons.push("unisolated-scan")
  if (reasons.length) results.truncationReason = reasons.join(",")
  // The number of rows the pattern matched, and the number that were ranked and
  // can be shown. They differ when a cap fired, and reporting only the smaller
  // one would under-report the match set with no marker.
  results.totalMatches = matchedRowCount
  results.rankedMatches = matched.length
  // How far the scan got, so a bounded answer can say "stopped after N".
  if (timeBudgetReached) results.scannedRows = rows.length
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
