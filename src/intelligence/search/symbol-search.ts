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
  /** 3 exact, 2 prefix, 1 inner substring — the phase that admitted the row. */
  phaseRelevance: number
}

// ── page-size domain ────────────────────────────────────────────────────────
// `maxResults` used to be read with `options.maxResults || 100`, which made
// limit:0 return 100 rows and let a negative value through to `LIMIT -N` —
// SQLite reads a negative LIMIT as "no limit", so the whole matching corpus was
// materialised and then sliced from the end. Page size is now normalized once,
// here, so every engine and every caller (MCP, CLI, library) agrees.
const DEFAULT_PAGE_SIZE = 100

function normalizePageSize(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_PAGE_SIZE
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PAGE_SIZE
  return n
}

function normalizeOffset(value: unknown): number {
  if (value === undefined || value === null) return 0
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

// ── LIKE metacharacters ─────────────────────────────────────────────────────
// The query was interpolated straight into `name LIKE ?` with the pattern value
// built as `${query}%` / `%${query}%`. SQL LIKE gives `%` and `_` wildcard
// meaning, so the query for the identifier `get_user` also matched `getXuser`
// and the query `%` returned the entire corpus. Escaping is what makes a query a
// query again: `escapeLike` is applied to every user-supplied fragment, and the
// matching SQL always carries the same ESCAPE clause.
const LIKE_ESCAPE_CHAR = "\\"

function escapeLike(fragment: string): string {
  return fragment.split(LIKE_ESCAPE_CHAR).join(LIKE_ESCAPE_CHAR + LIKE_ESCAPE_CHAR).split("%").join(LIKE_ESCAPE_CHAR + "%").split("_").join(LIKE_ESCAPE_CHAR + "_")
}

const LIKE_ESCAPE_CLAUSE = ` ESCAPE '${LIKE_ESCAPE_CHAR}'`

// ── case folding ────────────────────────────────────────────────────────────
// SQLite's NOCASE collation and its LOWER() fold ASCII A–Z only. The ranking
// below folds with String.toLowerCase(), which folds every Unicode case pair.
// Fetching on one rule and ranking on another means a case-insensitive search
// silently loses e.g. ΣΊΣΥΦΟΣ / σίσυφος — in a product whose premise is 40+
// languages. So a query that contains any non-ASCII character takes a JS-side
// fold, and the SQL narrows the candidate set with the query's ASCII prefix
// (still index-backed) before that fold runs.
const NON_ASCII = /[^\x00-\x7F]/

function longestAsciiPrefix(value: string): string {
  let i = 0
  while (i < value.length && value.charCodeAt(i) < 128) i++
  return value.slice(0, i)
}

function foldEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

// A phase is one SQL predicate plus how well a match it produces ranks.
type Phase = {
  clause: string
  /** 3 = whole name, 2 = name prefix, 1 = anywhere in the name. */
  relevance: number
  /** The value bound to the predicate's single `?`. */
  value: string
  /** Substring predicates cannot use the name index; they are fetched by id. */
  substring: boolean
  /** JS-side case fold, for queries SQL cannot fold (non-ASCII). */
  fold?: "equal" | "prefix" | "substring"
}

// Rows the noise filter would remove anyway are filtered in SQL where the rule
// is expressible as a suffix/dir test, so a `node_modules` row can no longer
// consume the page budget before the legitimate rows are looked at. The rules
// that need a real path shape stay in JS — but they now run BEFORE the page
// slice instead of after, which is the difference between "the cap was full of
// noise" and "a short page".
function isNoiseCandidate(row: Candidate): boolean {
  return AnalysisExclusions.isHardNoisePath(row.relativePath) || AnalysisExclusions.isNoiseSymbolName(row.name)
}

export async function searchSymbols(projectId: ProjectID, rawQuery: string, options: SearchOptions = {}): Promise<SearchResults> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  if (options.mode === "content") {
    const { searchContent } = await import("./content-search")
    return searchContent(projectId, rawQuery, options)
  }
  if (options.mode === "regex" || options.regex) {
    const { searchRegex } = await import("./regex-search")
    return searchRegex(projectId, rawQuery, options)
  }

  // A query is trimmed before anything else. `content` mode already did this
  // (`searchContent` trims); symbols and regex did not, so the same string
  // found a symbol in one mode and nothing in another.
  const query = String(rawQuery ?? "").trim()
  const maxResults = normalizePageSize(options.maxResults)
  const offset = normalizeOffset(options.offset)
  if (!query) return emptyResult("symbol")

  const caseSensitive = options.caseSensitive === true
  const unicodeQuery = NON_ASCII.test(query)
  const phases = buildPhases(query, options.exact === true, caseSensitive, unicodeQuery)

  // The candidate budget has to grow with the page or paging silently ends
  // early: a `LIMIT 60` candidate set means `offset:60` is "no results" even
  // when ten thousand symbols match. It is bounded (FETCH_CAP_MAX) so the scan
  // stays interactive, and hitting the bound is REPORTED, not hidden.
  const budget = offset + maxResults
  const fetchCap = Math.min(FETCH_CAP_MAX, Math.max(MIN_FETCH_CAP, budget * 4))
  const idCap = Math.min(ID_CAP_MAX, Math.max(MIN_ID_CAP, budget * 4))

  const candidates: Candidate[] = []
  const seen = new Set<string>()
  const truncationReasons = new Set<string>()

  for (const phase of phases) {
    const rows = await runPhase(raw, projectId, phase, { fetchCap, idCap, options, query, caseSensitive })
    if (rows.truncated) truncationReasons.add(`candidate-cap:${phase.relevance}`)
    for (const row of rows.rows) {
      // First phase to admit a row wins, and the phases run strongest-first, so
      // a row matched by both the exact and the substring phase keeps the exact
      // score. Without the id guard, a multi-phase match was scored twice and
      // the `seen` set was consulted after the row had already been pushed.
      if (seen.has(row.id)) continue
      seen.add(row.id)
      candidates.push({ ...row, phaseRelevance: phase.relevance })
    }
  }

  const beforeNoise = candidates.length
  const kept = candidates.filter((row) => !isNoiseCandidate(row))
  if (beforeNoise !== kept.length) truncationReasons.add("noise-filter")

  // Ranking: phase score, then production before tests, then complexity, then a
  // locale-INDEPENDENT path/name tie-break. `localeCompare` was locale-
  // dependent, so the same query could page differently on two machines.
  const folded = unicodeQuery ? query.toLowerCase() : query
  const score = (name: string) => (name.toLowerCase() === folded ? 3 : name.toLowerCase().startsWith(folded) ? 2 : 1)
  kept.sort((a, b) => {
    return (
      score(b.name) - score(a.name) ||
      (AnalysisExclusions.isTestPath(a.relativePath) ? 1 : 0) - (AnalysisExclusions.isTestPath(b.relativePath) ? 1 : 0) ||
      b.complexity - a.complexity ||
      compareCodeUnits(a.relativePath, b.relativePath) ||
      compareCodeUnits(a.name, b.name)
    )
  })

  const page = kept.slice(offset, offset + maxResults)
  const results: SearchResults = emptyResult("symbol")
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
      _relevance: score(row.name),
    })
  }
  results.totalMatches = kept.length
  results.truncated = truncationReasons.size > 0
  if (truncationReasons.size > 0) results.truncationReason = [...truncationReasons].sort().join(",")
  applyFreshness(raw, results)
  return results
}

function emptyResult(mode: string): SearchResults {
  const results = [] as unknown as SearchResults
  results.searchMode = mode
  results.staleCount = 0
  results.freshCount = 0
  results.totalMatches = 0
  return results
}

/** Locale-independent ordering: UTF-16 code units, not ICU collation. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function buildPhases(query: string, exact: boolean, caseSensitive: boolean, unicodeQuery: boolean): Phase[] {
  if (unicodeQuery) {
    // SQL cannot fold these, so each phase narrows with the query's ASCII prefix
    // (still an index-backed range scan when the query starts with ASCII) and
    // the accept/reject decision is made in JS with the SAME toLowerCase() the
    // ranking uses — so "case-insensitive" means one thing in this engine.
    // The narrowing prefix must be at least 2 characters to be selective; a
    // 1-character prefix on a large project matches most of the corpus, so the
    // non-ASCII path is used instead and the candidate cap bounds the scan.
    const asciiPrefix = longestAsciiPrefix(query)
    const narrow = asciiPrefix.length >= 2
    if (exact) {
      return narrow
        ? [{ clause: "s.name LIKE ? ESCAPE '\\'", relevance: 3, value: escapeLike(asciiPrefix) + "%", substring: false, fold: "equal" }]
        : [{ clause: "LENGTH(s.name) = LENGTH(?)", relevance: 3, value: query, substring: false, fold: "equal" }]
    }
    if (narrow) {
      // A prefix narrows to names SHARING the ASCII head; an exact match could
      // still differ later in the string, so the substring phase runs too.
      return [
        { clause: "s.name LIKE ? ESCAPE '\\'", relevance: 3, value: escapeLike(asciiPrefix) + "%", substring: false, fold: "equal" },
        { clause: "s.name LIKE ? ESCAPE '\\'", relevance: 2, value: escapeLike(asciiPrefix) + "%", substring: false, fold: "prefix" },
        { clause: "1 = 1", relevance: 1, value: "", substring: true, fold: "substring" },
      ]
    }
    // No usable ASCII prefix, so the SQL still has to choose the rows to
    // transfer. LENGTH is the one narrowing SQLite can express honestly for a
    // non-ASCII needle: a name equal to the query has the same character count,
    // and a name containing it cannot be shorter. Without it the fallback would
    // be "the first N rows in table order, then filter", which silently returns
    // nothing for a symbol that exists whenever the corpus is large.
    return [
      { clause: "LENGTH(s.name) = LENGTH(?)", relevance: 3, value: query, substring: true, fold: "equal" },
      { clause: "LENGTH(s.name) >= LENGTH(?)", relevance: 2, value: query, substring: true, fold: "prefix" },
      { clause: "LENGTH(s.name) >= LENGTH(?)", relevance: 1, value: query, substring: true, fold: "substring" },
    ]
  }
  if (exact) {
    // `exact` means "only names equal to the query" — under the caller's case
    // rule. It used to emit a bare `s.name = ?`, which is a BYTE comparison, so
    // `exact:true` silently overrode the default `caseSensitive:false` and hid
    // every case variant of the name the caller asked for.
    return [{ clause: caseSensitive ? "s.name = ?" : "s.name = ? COLLATE NOCASE", relevance: 3, value: query, substring: false }]
  }
  if (caseSensitive) {
    return [
      { clause: "s.name = ?", relevance: 3, value: query, substring: false },
      // Indexed range scan, not instr(): `instr(name, ?)` is a full table scan
      // for every query (EXPLAIN QUERY PLAN: `SCAN brain_symbol`).
      { clause: "s.name LIKE ? ESCAPE '\\'", relevance: 2, value: escapeLike(query) + "%", substring: false },
      { clause: "s.name LIKE ? ESCAPE '\\'", relevance: 1, value: "%" + escapeLike(query) + "%", substring: true },
    ]
  }
  return [
    { clause: "s.name = ? COLLATE NOCASE", relevance: 3, value: query, substring: false },
    { clause: "s.name LIKE ? COLLATE NOCASE ESCAPE '\\'", relevance: 2, value: escapeLike(query) + "%", substring: false },
    { clause: "s.name LIKE ? COLLATE NOCASE ESCAPE '\\'", relevance: 1, value: "%" + escapeLike(query) + "%", substring: true },
  ]
}

/** The predicate phases for the default (case-insensitive) search. Exported for the suite that pins the folding rule. */
export function symbolSearchPhases(query: string, exact: boolean, caseSensitive: boolean): Phase[] {
  return buildPhases(query, exact, caseSensitive, NON_ASCII.test(query))
}

// Candidate caps. These bound the un-indexable scans; they scale with the page
// so `offset` stays reachable, and reaching one sets `truncated` instead of
// quietly returning a short answer.
const MIN_FETCH_CAP = 2000
const FETCH_CAP_MAX = 50000
const MIN_ID_CAP = 2000
const ID_CAP_MAX = 50000

type PhaseRun = { rows: Candidate[]; truncated: boolean }

async function runPhase(
  raw: any,
  projectId: ProjectID,
  phase: Phase,
  ctx: { fetchCap: number; idCap: number; options: SearchOptions; query: string; caseSensitive: boolean },
): Promise<PhaseRun> {
  const { filters, params } = filterSql(ctx.options)
  const base = `${SELECT_COLUMNS} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'${filters}`
  // Placeholder order follows TEXT order: `base` ends with the filter
  // predicates, so their values bind before the phase value and the LIMIT.
  // Supplying them after the phase value shifted every parameter by one, so a
  // filtered search bound the language to the name — and a filtered exact search
  // returned nothing at all while the unfiltered one worked.
  if (phase.fold) {
    // Folded scan: SQL only narrows the rows that get TRANSFERRED, and the
    // accept/reject decision is made in JS with the same toLowerCase() the
    // ranking uses — so the fold rule cannot disagree with the rank rule.
    const rows = raw.prepare(`${base} AND ${phase.clause} LIMIT ?`).all(projectId, ...params, phase.value, ctx.fetchCap) as Candidate[]
    return { rows: filterFolded(rows, phase, ctx.query), truncated: rows.length >= ctx.fetchCap }
  }
  if (!phase.substring) {
    const rows = raw.prepare(`${base} AND ${phase.clause} LIMIT ?`).all(projectId, ...params, phase.value, ctx.fetchCap) as Candidate[]
    return { rows, truncated: rows.length >= ctx.fetchCap }
  }
  // Substring predicates cannot use the name index, so the id set is fetched
  // first and only those ids are joined — M19.Q1 measured the join-inside-the-
  // scan form at ~1.3s per query on 1M symbols. The clause is un-aliased here
  // because this query has no `s` alias: keeping the alias produced a raw
  // `no such column: s.name` out of every substring and prefix search.
  //
  // The filters are applied INSIDE this id query, joined to brain_file. They
  // used to run only on the second pass, which meant the candidate cap was
  // spent on rows the filter was about to discard: on a project where
  // `name LIKE '%e%'` matches 8000 rows and only 661 of them are `class`
  // symbols, `symbolKind:"class"` returned the first 661 of the *unfiltered*
  // 2000 and then dropped them — a filtered search that silently lost two
  // thirds of its matches while the unfiltered one worked.
  const { filters: idFilters, params: idFilterParams } = filterSql(ctx.options, "s", "f")
  const idRows = raw
    .prepare(
      `SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id = ? AND COALESCE(s.line_start, 0) > 0 AND s.name NOT LIKE '/%/%'${idFilters} AND ${phase.clause} LIMIT ?`,
    )
    .all(projectId, ...idFilterParams, phase.value, ctx.idCap) as Array<{ id: string }>
  if (idRows.length === 0) return { rows: [], truncated: false }
  const distinct = [...new Set(idRows.map((row) => row.id))]
  const placeholders = distinct.map(() => "?").join(",")
  // The filter is re-applied here for the same reason the phase runs again: the
  // id set is the *candidate* set, and the joined row is what gets ranked. A
  // filter is never assumed to hold across the two.
  const rows = raw
    .prepare(`${SELECT_COLUMNS} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (${placeholders})${filters}`)
    .all(...distinct, ...params) as Candidate[]
  return { rows, truncated: idRows.length >= ctx.idCap }
}

/** Strip the `s.` alias so a clause written for the joined form fits the id query. */
function unaliased(clause: string): string {
  return clause.replace(/\bs\./g, "")
}

const SELECT_COLUMNS = `SELECT s.id, s.file_id AS fileId, s.name, s.symbol_type AS symbolType,
           COALESCE(s.line_start, 0) AS line, COALESCE(s.line_end, 0) AS lineEnd, COALESCE(s.complexity, 0) AS complexity,
           f.relative_path AS relativePath, f.path AS filePath, COALESCE(f.language, 'unknown') AS language`

/**
 * Filter vocabulary, applied case-insensitively. `language` and `symbolKind`
 * are free-form strings in the public schema, so a caller writing "TypeScript"
 * or "Function" used to get a byte-identical "no results" to a wrong symbol
 * name. The stored vocabulary is lowercase, so NOCASE equality is the honest
 * comparison; an unknown value simply matches nothing, which the boundary
 * reports separately with the vocabulary.
 */
function filterSql(options: SearchOptions, symbolAlias = "s", fileAlias = "f"): { filters: string; params: unknown[] } {
  let filters = ""
  const params: unknown[] = []
  if (options.languages?.length) {
    filters += ` AND ${fileAlias}.language COLLATE NOCASE IN (${options.languages.map(() => "?").join(",")})`
    params.push(...options.languages)
  }
  if (options.symbolKind) {
    filters += ` AND ${symbolAlias}.symbol_type COLLATE NOCASE = ?`
    params.push(options.symbolKind)
  }
  return { filters, params }
}

function filterFolded(rows: Candidate[], phase: Phase, query: string): Candidate[] {
  const needle = query.toLowerCase()
  return rows.filter((row) => {
    const name = row.name.toLowerCase()
    if (phase.fold === "equal") return name === needle
    if (phase.fold === "prefix") return name.startsWith(needle)
    return name.includes(needle)
  })
}

function applyFreshness(raw: any, results: SearchResults): void {
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
    // A freshness failure must not erase the answer, but it must also not be
    // silent: the counts stay at their conservative default and the caller sees
    // staleCount 0 / freshCount 0 rather than a claim of freshness.
    results.freshnessError = true
  }
}
