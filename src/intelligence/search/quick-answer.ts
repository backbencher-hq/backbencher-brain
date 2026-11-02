// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the answer engine behind bb_ask: it decides whether a question
//   is an exact aggregate, an exact symbol name, a vector-similarity retrieval or a
//   lexical fallback, and returns one shaped answer that names its route, its
//   confidence kind, its bounds and the freshness of what it cited.
// WHICH TOOL IT SERVES — bb_ask (mutability read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY —
//   • routes are declared before retrieval because a count is not a match set, and
//     an exact name is not a similarity claim;
//   • the engine is read-only end to end (a question must not write the index);
//   • every answer carries `bounds` so a prefix is never read as a complete match
//     set, and `confidenceKind` so a declared-low floor is never read as a
//     measurement;
//   • a non-discriminative ranking cannot keep a mean-of-similarities confidence:
//     the number is capped and labelled, because the answer itself says the scores
//     do not separate candidates.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/BB_ASK.md,
//   validation/tools/bb_ask/**, gates: npx tsx script/m13/verify-ask-honesty.ts,
//   npx tsx script/m13/verify-ask-provenance.ts, npx tsx script/m13/verify-ask-integration.ts,
//   npx tsx script/m15/verify-ask-deep.ts, npx tsx script/m16/verify-ask-stats.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/semantic-search.ts,
//   src/mcp/tools/bb_ask/{handler,descriptor}.ts, docs/BB_ASK.md, those gates.
// CONTRACTS IT MUST NOT BREAK — read-only access; declared absence (a missing index
//   is never "0 symbols"); declared bounds; declared coverage per compared model;
//   stale vs missing freshness; exact aggregates are not semantic answers.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync } from "node:fs"
import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import { semanticVectorSearch } from "./semantic-search"
import { searchSymbols } from "./symbol-search"
import { fileUnchangedSince } from "../../brain/freshness"
import { makeProvenance, type EvidenceProvenance } from "../evidence"

/** The order-of-magnitude facts an answer is allowed to publish about itself. */
export type ConfidenceKind =
  | "exact-aggregate"
  | "exact-symbol"
  | "similarity-mean"
  | "non-discriminative"
  | "declared-floor"
  | "heuristic"
  | "none"

/** How many matches exist versus how many this answer shows. `totalMatches` is null
 *  when the route cannot know it — a declared unknown, never a fabricated total. */
export interface AnswerBounds {
  returned: number
  totalMatches: number | null
  truncated: boolean
  truncationReason?: string
}

/** Which index snapshot an exact aggregate describes: a count is exact about the
 *  indexed state and says nothing about the working tree. */
export interface IndexSnapshot {
  updatedAt: number | null
  ageMs: number | null
  lastFullIndex: number | null
  lastIncrementalIndex: number | null
}

export interface QuickAnswerResult {
  answer: string
  confidence: number
  confidenceKind: ConfidenceKind
  sources: Array<{ file: string; line: number; context: string }>
  suggestions?: string[]
  provenance: EvidenceProvenance
  /**
   * Which route produced the answer. The door needs this to stop contradicting
   * itself: an `aggregate` answer is exact and has an empty source list BY DESIGN,
   * so a door that renders "no matches" whenever the list is empty denies a
   * correct answer.
   */
  route: "aggregate" | "retrieval" | "symbol-name" | "no-index" | "none"
  /** Which noun was counted, when `route === "aggregate"`. */
  aggregate?: { noun: string; aggregate: string; value: number }
  /** How many matches exist versus how many are shown. Every answer carries one. */
  bounds: AnswerBounds
  /** Present on exact-aggregate answers: the index state the count describes. */
  indexSnapshot?: IndexSnapshot
  /**
   * Retrieval facts that must reach the caller. Without these the caller cannot
   * tell a production embedding's cosine from the offline 50-dimension
   * word-vector one, cannot tell which model the coverage number describes, and
   * cannot see a capped scan or a timed-out provider.
   */
  retrieval?: {
    method: "vector" | "keyword-fallback" | "exact-name"
    queryModel: string
    indexModel: string
    dimension: number
    fallbackReason?: string
    /** Coverage for the model and width that were ACTUALLY compared. */
    embeddingCoverage?: { embedded: number; symbols: number; ratio: number }
    /** Every stored embedding, regardless of model — a different number, labelled. */
    libraryCoverage?: { embedded: number; symbols: number; ratio: number }
    discriminative?: boolean
    nonDiscriminativeCompetitors?: number
    degenerateQueryVector?: boolean
    /** Scan bounds; present on the vector path. */
    scannedRows?: number
    filteredRows?: number
    rankedCandidates?: number
    scanCap?: number
    scanCapped?: boolean
    /** Ask-time embedding bound that fired, if any. */
    embeddingWaitCeilingMs?: number
    embeddingTimedOut?: boolean
    embeddingFellBackTo?: string | null
  }
}

const ENGINE = "quick-answer@intelligence"
const ENGINE_VERSION = "m10.04"

/** The advertised page size and the accepted range (the tool door refuses outside it). */
export const ASK_LIMIT_MIN = 1
export const ASK_LIMIT_MAX = 100
export const ASK_LIMIT_DEFAULT = 5

/** The door's refusal text, emitted here as well so a direct library caller meets
 *  the same rule and the same words as an MCP/CLI caller. */
export const ASK_LIMIT_REFUSAL =
  "bb_ask: limit must be a whole number between 1 and 100 — 0 would return no matches (it is refused, not silently answered), and above 100 the answer stops being a bounded page; refused rather than clamped."

function semanticProvenance(projectId: ProjectID, inner: EvidenceProvenance): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "semantic_candidate",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "semantic-search@intelligence",
    limitations: inner.limitations,
    truncated: inner.truncated,
    unknowns: inner.unknowns.length ? inner.unknowns : ["The natural-language query is matched by similarity, not parsed for intent."],
  })
}

function fallbackProvenance(projectId: ProjectID, reason: string): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "unknown",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "symbol-search@intelligence",
    limitations: ["No semantic or statistical answer derived; only named-symbol matches returned."],
    unknowns: [reason],
  })
}

function emptyProvenance(projectId: ProjectID): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "unknown",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "no-result",
    limitations: ["No indexed evidence matched the query."],
    unknowns: ["Query may refer to behavior not captured by the AST index."],
  })
}

/**
 * Index state, as three distinct facts. A boolean swallowed every error into
 * `false`, so a corrupt database, a locked database, a permission error and a
 * genuinely unindexed project all produced the same confident sentence.
 *
 * The open is byte-read-only: asking a question must not create a database, run a
 * migration or move the WAL. A missing file is `empty` (nothing was ever indexed),
 * an uninitialised file is `unreadable`, and a readable index with no rows is
 * `empty` too — but the two empty reasons are stated differently below.
 */
type IndexState = "indexed" | "empty" | "unreadable"

async function indexState(projectId: ProjectID): Promise<{ state: IndexState; error?: string; dbPath: string }> {
  const dbPath = BrainDatabase.getDbPath(projectId)
  if (!existsSync(dbPath)) return { state: "empty", dbPath }
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const row = raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number } | undefined
    return { state: (row?.c ?? 0) > 0 ? "indexed" : "empty", dbPath }
  } catch (error: any) {
    return { state: "unreadable", error: error?.message ?? String(error), dbPath }
  }
}

/** The index's own last-written timestamp, so an exact count can say which snapshot
 *  it is exact about. Absent row/table is a declared unknown, never "now". */
async function readIndexSnapshot(projectId: ProjectID): Promise<IndexSnapshot | null> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const row = raw
      .prepare(
        "SELECT time_updated AS updatedAt, last_full_index AS lastFullIndex, last_incremental_index AS lastIncrementalIndex " +
          "FROM brain_index_status WHERE project_id = ?",
      )
      .get(projectId) as { updatedAt: number | null; lastFullIndex: number | null; lastIncrementalIndex: number | null } | undefined
    if (!row || row.updatedAt == null) return null
    const updatedAt = Number(row.updatedAt)
    return {
      updatedAt,
      ageMs: Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : null,
      lastFullIndex: row.lastFullIndex == null ? null : Number(row.lastFullIndex),
      lastIncrementalIndex: row.lastIncrementalIndex == null ? null : Number(row.lastIncrementalIndex),
    }
  } catch {
    return null
  }
}

/** Languages the file-count branch can answer for, and the spellings accepted. */
const LANGUAGE_ALIASES: Record<string, string> = {
  "c++": "cpp", "cpp": "cpp", "c#": "csharp", "csharp": "csharp",
  "objective c": "objective-c", "objective-c": "objective-c", "objc": "objective-c",
  "js": "javascript", "node": "javascript", "javascript": "javascript",
  "ts": "typescript", "typescript": "typescript",
  "py": "python", "python": "python", "rb": "ruby", "ruby": "ruby",
  "golang": "go", "go": "go", "kt": "kotlin", "kotlin": "kotlin",
  "rs": "rust", "rust": "rust", "sh": "bash", "shell": "bash", "bash": "bash",
  "yml": "yaml", "yaml": "yaml", "md": "markdown", "markdown": "markdown",
  "cs": "csharp", "vb": "visualbasic", "visualbasic": "visualbasic", "fs": "fsharp", "fsharp": "fsharp",
  "swift": "swift", "dart": "dart", "php": "php", "perl": "perl", "lua": "lua", "r": "r",
  "scala": "scala", "groovy": "groovy", "clojure": "clojure", "elixir": "elixir",
  "erlang": "erlang", "haskell": "haskell", "zig": "zig", "nim": "nim", "hcl": "hcl", "sql": "sql",
}

/**
 * The stat nouns this tool can answer EXACTLY, declared as data so the countable
 * vocabulary is inspectable and every entry is cross-language honest by
 * construction (a method-first language and a function-first language agree).
 */
const COUNTABLE: Array<{ nouns: string[]; label: string; types?: string[] | null; table?: string }> = [
  { nouns: ["symbol", "symbols"], label: "symbols", types: null },
  { nouns: ["function", "functions", "method", "methods", "routine", "routines", "procedure", "procedures", "func", "funcs"], label: "functions", types: ["function", "method"] },
  { nouns: ["class", "classes"], label: "classes", types: ["class"] },
  { nouns: ["interface", "interfaces"], label: "interfaces", types: ["interface"] },
  { nouns: ["struct", "structs", "record", "records"], label: "structs", types: ["struct", "class"] },
  { nouns: ["enum", "enums"], label: "enums", types: ["enum"] },
  { nouns: ["trait", "traits"], label: "traits", types: ["interface", "class"] },
  { nouns: ["type", "types", "typedef", "typedefs"], label: "types", types: ["type", "interface"] },
  { nouns: ["constant", "constants", "consts"], label: "constants", types: ["constant", "variable"] },
  { nouns: ["relationship", "relationships", "relation", "relations", "edge", "edges"], label: "relationships", table: "brain_relationship" },
  { nouns: ["import", "imports", "dependency", "dependencies"], label: "imports", table: "brain_import" },
]

/** Count nouns a developer asks for that this tool has no aggregate for. Listed so
 *  the tool can refuse BY NAME rather than answering a different question. */
const NOT_COUNTABLE = [
  "endpoint", "endpoints", "route", "routes", "line", "lines", "todo", "todos",
  "comment", "comments", "test", "tests", "bug", "bugs", "issue", "issues",
  "component", "components", "module", "modules", "package", "packages",
  "variable", "variables", "field", "fields", "parameter", "parameters", "argument", "arguments",
]

/** English function words carry no counting intent. */
const STOPWORDS = new Set([
  "how", "many", "much", "there", "are", "is", "in", "of", "the", "this", "that",
  "project", "code", "does", "do", "did", "have", "has", "a", "an", "it", "we",
  "i", "to", "for", "and", "total", "currently", "get", "me", "give", "show",
  "tell", "list", "count", "please", "want", "need", "know", "number",
])

function words(lower: string): string[] {
  return lower.split(" ").filter((w) => w.length > 0)
}

function has(lower: string, phrase: string): boolean {
  return lower.includes(phrase)
}

/** Strip trailing sentence punctuation from a name-shaped query without a regex:
 *  the set is small and fixed, and a regex here was both slower to read and the
 *  last remaining text pattern in the tool's read path. */
function stripTrailingPunctuation(name: string): string {
  const PUNCTUATION = ".,;:!?"
  let end = name.length
  while (end > 0 && PUNCTUATION.includes(name[end - 1])) end--
  return name.slice(0, end)
}

/** True when a string contains any whitespace character, without a regex: a
 *  character whose trim() is empty is whitespace. */
function containsWhitespace(value: string): boolean {
  for (const character of value) {
    if (character.trim().length === 0) return true
  }
  return false
}

/**
 * Resolve a query that IS a symbol name, exactly.
 *
 * Case-insensitive on the name, because code is written in a dozen casings.
 * Surrounding whitespace and trailing punctuation are stripped, so `"FileTask."`
 * and `" FileTask "` both resolve. A query containing whitespace is not a name,
 * and the caller falls through to retrieval. Deterministic when the same name
 * exists more than once (overloads, partial classes): the lowest symbol id wins.
 */
async function exactSymbolMatch(
  projectId: ProjectID,
  query: string,
): Promise<{ name: string; symbolType: string; file: string; line: number; stale: boolean; missing: boolean } | null> {
  const name = stripTrailingPunctuation(query.trim()).trim()
  // A symbol name is a single token.
  if (name.length < 2 || name.length > 120 || containsWhitespace(name)) return null
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const row = raw.prepare(
      "SELECT s.name, s.symbol_type AS symbolType, COALESCE(s.line_start, 0) AS line, " +
        "f.relative_path AS file, f.file_hash AS fileHash, f.path AS filePath, f.size_bytes AS sizeBytes, f.last_modified AS lastModified " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.name = ? COLLATE NOCASE AND COALESCE(s.line_start, 0) > 0 " +
        "ORDER BY s.id ASC LIMIT 1",
    ).get(projectId, name) as any
    if (!row) return null
    // The one freshness resolver every read path uses, so an exact match is marked
    // on exactly the same terms as a similarity result.
    const missing = !existsSync(row.filePath)
    const stale = !missing && !fileUnchangedSince(row.filePath, row.fileHash, row.sizeBytes, row.lastModified)
    return { name: row.name, symbolType: row.symbolType ?? "symbol", file: row.file, line: row.line, stale, missing }
  } catch {
    return null
  }
}

/** The freshness marker for a cited source. A deleted file is not "changed". */
function freshnessMarker(source: { stale?: boolean; missing?: boolean }): string {
  if (source.missing) return " [MISSING — file no longer on disk]"
  if (source.stale) return " [STALE — file changed since index]"
  return ""
}

function boundsWith(returned: number, totalMatches: number | null, truncated: boolean, truncationReason?: string): AnswerBounds {
  return truncationReason ? { returned, totalMatches, truncated, truncationReason } : { returned, totalMatches, truncated }
}

function indexSnapshotLimitation(snapshot: IndexSnapshot | null): string[] {
  if (!snapshot || snapshot.updatedAt == null) {
    return ["The index's own last-write timestamp is unavailable, so the age of this count is unknown."]
  }
  return [`The answer is exact about the indexed snapshot written at ${new Date(snapshot.updatedAt).toISOString()} (${snapshot.ageMs == null ? "age unknown" : `${Math.round(snapshot.ageMs / 1000)} s ago`}); files changed on disk after that write are not reflected.`]
}

export async function quickAnswer(
  projectId: ProjectID,
  query: string,
  options: { limit?: number } = {},
): Promise<QuickAnswerResult> {
  // limit is a page size AND a work budget. The tool door refuses outside 1..100
  // with the same words; this guard exists for direct library callers, and it must
  // not be reached by a valid call.
  const requestedLimit = options.limit ?? ASK_LIMIT_DEFAULT
  if (!Number.isFinite(requestedLimit) || !Number.isInteger(requestedLimit) || requestedLimit < ASK_LIMIT_MIN || requestedLimit > ASK_LIMIT_MAX) {
    return {
      answer: ASK_LIMIT_REFUSAL,
      confidence: 0,
      confidenceKind: "none",
      sources: [],
      route: "none",
      bounds: boundsWith(0, null, false),
      provenance: makeProvenance({
        evidenceClass: "unknown",
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        projectId,
        source: "limit-refused",
        limitations: ["No retrieval ran: the requested page size is outside the advertised range."],
        unknowns: [`limit must be a whole number between ${ASK_LIMIT_MIN} and ${ASK_LIMIT_MAX}; got ${String(requestedLimit)}.`],
      }),
    }
  }
  const limit = requestedLimit

  // Honesty guard: a missing index must never produce a confident stat answer
  // ("There are 0 symbols") — the project may have thousands of symbols that were
  // simply never indexed. An index that cannot be READ is a different fact.
  const index = await indexState(projectId)
  if (index.state === "unreadable") {
    return {
      answer:
        `I can't answer this: the index for this project exists but could not be read (${index.error ?? "unknown error"}). ` +
        "Re-indexing will not help until the database is readable — check the error above, then run `bb index <dir> --force`.",
      confidence: 0,
      confidenceKind: "none",
      sources: [],
      route: "no-index",
      bounds: boundsWith(0, null, false),
      provenance: makeProvenance({
        evidenceClass: "unknown",
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        projectId,
        source: "index-unreadable",
        limitations: ["The index could not be opened, so nothing could be answered from it."],
        unknowns: [`Index read failed: ${index.error ?? "unknown error"}`],
      }),
    }
  }
  if (index.state === "empty") {
    return {
      answer: "I can't answer this: no index exists for this project. Index it first (bb_health refresh or full reindex), then ask again.",
      confidence: 0.1,
      confidenceKind: "declared-floor",
      sources: [],
      route: "no-index",
      bounds: boundsWith(0, null, false),
      provenance: makeProvenance({
        evidenceClass: "unknown",
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        projectId,
        source: "no-index",
        limitations: ["No index means no evidence exists to answer from."],
        unknowns: ["No index exists for this project; run indexing first."],
      }),
    }
  }
  const lowerQuery = query.toLowerCase()
  const tokens = words(lowerQuery).filter((w) => !STOPWORDS.has(w))

  // ── largest file ──────────────────────────────────────────────────────────
  if (has(lowerQuery, "largest") || (has(lowerQuery, "biggest") && has(lowerQuery, "file"))) {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const row = raw.prepare("SELECT relative_path AS path, size_bytes AS size FROM brain_file WHERE project_id = ? ORDER BY size_bytes DESC LIMIT 1").get(projectId) as { path: string; size: number } | undefined
    if (row?.size) {
      const snapshot = await readIndexSnapshot(projectId)
      return {
        answer: `The largest file is "${row.path}" at ${(row.size / 1024).toFixed(1)} KB`,
        confidence: 0.9,
        confidenceKind: "exact-aggregate",
        sources: [{ file: row.path, line: 0, context: `${(row.size / 1024).toFixed(1)} KB` }],
        route: "aggregate",
        bounds: boundsWith(1, 1, false),
        indexSnapshot: snapshot ?? undefined,
        provenance: makeProvenance({
          evidenceClass: "indexed",
          engine: ENGINE,
          engineVersion: ENGINE_VERSION,
          projectId,
          source: "max(brain_file.size_bytes)",
          limitations: indexSnapshotLimitation(snapshot),
        }),
      }
    }
  }

  // ── most complex function ────────────────────────────────────────────────
  if (has(lowerQuery, "most complex") || has(lowerQuery, "highest complexity") || has(lowerQuery, "complexest")) {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const row = raw.prepare(
      "SELECT s.name AS name, s.complexity AS complexity, COALESCE(s.line_start, 0) AS line, f.relative_path AS file " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN ('function','method') AND s.complexity IS NOT NULL " +
        "ORDER BY s.complexity DESC, s.gravity_score DESC, s.id ASC LIMIT 1",
    ).get(projectId) as { name: string; complexity: number; line: number; file: string } | undefined
    if (row) {
      const snapshot = await readIndexSnapshot(projectId)
      return {
        answer: `The most complex function is "${row.name}" with complexity ${row.complexity}`,
        confidence: 0.9,
        confidenceKind: "exact-aggregate",
        sources: [{ file: row.file, line: row.line || 0, context: `Function: ${row.name}` }],
        route: "aggregate",
        bounds: boundsWith(1, 1, false),
        indexSnapshot: snapshot ?? undefined,
        provenance: makeProvenance({
          evidenceClass: "indexed",
          engine: ENGINE,
          engineVersion: ENGINE_VERSION,
          projectId,
          source: "max(brain_symbol.complexity) over symbol_type in (function, method)",
          limitations: indexSnapshotLimitation(snapshot),
        }),
      }
    }
  }

  // ── "how many …" ──────────────────────────────────────────────────────────
  if (has(lowerQuery, "how many") || has(lowerQuery, "count the") || has(lowerQuery, "number of")) {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const snapshot = await readIndexSnapshot(projectId)

    // "total symbols" with no explicit noun still means symbols.
    const wantsTotalOnly = has(lowerQuery, "total") && !COUNTABLE.some((entry) => entry.nouns.some((n) => tokens.includes(n)))

    if (!wantsTotalOnly) {
      // Nouns match WHOLE WORDS, never substrings: "how many typescript files"
      // must not route to the `type` counter because "typescript" contains "type".
      const tokenSet = new Set(tokens)
      for (const entry of COUNTABLE) {
        if (!entry.nouns.some((noun) => tokenSet.has(noun))) continue
        let value: number
        let aggregate: string
        const types = entry.types
        if (entry.table) {
          const row = raw.prepare(`SELECT count(*) AS c FROM ${entry.table} WHERE project_id = ?`).get(projectId) as { c: number }
          value = row?.c ?? 0
          aggregate = `count(${entry.table})`
        } else if (!types) {
          const row = raw.prepare("SELECT count(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as { c: number }
          value = row?.c ?? 0
          aggregate = "count(brain_symbol)"
        } else {
          const placeholders = types.map(() => "?").join(",")
          const row = raw.prepare(
            `SELECT count(*) AS c FROM brain_symbol WHERE project_id = ? AND symbol_type IN (${placeholders})`,
          ).get(projectId, ...types) as { c: number }
          value = row?.c ?? 0
          aggregate = `count(brain_symbol where symbol_type in (${types.join(", ")}))`
        }
        return {
          answer: `There are ${value.toLocaleString()} ${entry.label} in this project`,
          confidence: 0.95,
          confidenceKind: "exact-aggregate",
          sources: [],
          route: "aggregate",
          aggregate: { noun: entry.label, aggregate, value },
          bounds: boundsWith(0, null, false),
          indexSnapshot: snapshot ?? undefined,
          provenance: makeProvenance({
            evidenceClass: "indexed",
            engine: ENGINE,
            engineVersion: ENGINE_VERSION,
            projectId,
            source: aggregate,
            limitations: indexSnapshotLimitation(snapshot),
          }),
        }
      }

      // A count question about something with no aggregate: say so, by name.
      const uncountable = NOT_COUNTABLE.filter((noun) => tokens.includes(noun))
      if (uncountable.length > 0) {
        const noun = uncountable[0]
        return {
          answer:
            `I can't count ${noun} — the index has no aggregate for it, so I won't invent one. ` +
            `What I can count exactly: ${COUNTABLE.map((e) => e.label).join(", ")}, and files (optionally by language). ` +
            `For a related question try: bb_search(query='${noun}') or bb_analyze(mode='dependencies').`,
          confidence: 0.3,
          confidenceKind: "declared-floor",
          sources: [],
          route: "none",
          bounds: boundsWith(0, null, false),
          provenance: makeProvenance({
            evidenceClass: "unknown",
            engine: ENGINE,
            engineVersion: ENGINE_VERSION,
            projectId,
            source: "no-aggregate-for-noun",
            limitations: ["No aggregate exists for this noun; no count is reported."],
            unknowns: [`The index cannot count "${noun}".`],
          }),
        }
      }
    }

    // File counts, optionally scoped to a language.
    const mentionsFile = has(lowerQuery, "file") || tokens.some((t) => LANGUAGE_ALIASES[t] !== undefined)
    if (mentionsFile) {
      let lang = ""
      for (const token of tokens) {
        const mapped = LANGUAGE_ALIASES[token]
        if (mapped) { lang = mapped; break }
      }
      if (lang) {
        const row = raw.prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = ? AND language = ?").get(projectId, lang) as { c: number }
        const value = row?.c ?? 0
        return {
          answer: `There are ${value.toLocaleString()} ${lang} files in this project`,
          confidence: 0.95,
          confidenceKind: "exact-aggregate",
          sources: [],
          route: "aggregate",
          aggregate: { noun: `${lang} files`, aggregate: `count(brain_file where language=${lang})`, value },
          bounds: boundsWith(0, null, false),
          indexSnapshot: snapshot ?? undefined,
          provenance: makeProvenance({
            evidenceClass: "indexed",
            engine: ENGINE,
            engineVersion: ENGINE_VERSION,
            projectId,
            source: `count(brain_file where language=${lang})`,
            limitations: indexSnapshotLimitation(snapshot),
          }),
        }
      }
      const row = raw.prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number }
      const value = row?.c ?? 0
      return {
        answer: `There are ${value.toLocaleString()} files in this project`,
        confidence: 0.95,
        confidenceKind: "exact-aggregate",
        sources: [],
        route: "aggregate",
        aggregate: { noun: "files", aggregate: "count(brain_file)", value },
        bounds: boundsWith(0, 0, false),
        indexSnapshot: snapshot ?? undefined,
        provenance: makeProvenance({
          evidenceClass: "indexed",
          engine: ENGINE,
          engineVersion: ENGINE_VERSION,
          projectId,
          source: "count(brain_file)",
          limitations: indexSnapshotLimitation(snapshot),
        }),
      }
    }
  }

  // ── exact symbol name ────────────────────────────────────────────────────
  // A query that IS a symbol name must return that symbol, and this runs BEFORE
  // similarity ranking because similarity cannot be trusted to do it: the local
  // model is a bag of words with no IDF weighting, so a two-word query vector is
  // compared against whole symbol BODIES and the winner can be an unrelated
  // snippet that quotes the name in passing. This is a NAME lookup, not a
  // similarity claim, and the answer says so.
  //
  // When the caller asked for exactly one result, the dense neighbour scan is not
  // run at all: it exists for the neighbour list, and paying a full scan to
  // discard it is work with no answer behind it.
  const exact = await exactSymbolMatch(projectId, query)
  if (exact && limit === 1) {
    return exactNameResult(projectId, exact, [], limit, true)
  }

  // The similarity results are computed either way: below an exact match they are
  // the symbol's neighbours, and on their own they are the answer.
  const semantic = await semanticVectorSearch(projectId, query, { maxResults: limit })
  const retrieval = retrievalFacts(semantic)

  if (exact) {
    const rest = semantic.results.slice(0, Math.max(0, limit - 1))
    return exactNameResult(projectId, exact, rest, limit, false, retrieval)
  }

  if (semantic.results.length > 0) {
    return retrievalResult(projectId, query, semantic, limit, retrieval)
  }

  try {
    const symbolResults = await searchSymbols(projectId, query, { maxResults: limit, includeContent: true })
    if (symbolResults.length > 0) {
      let fallbackAnswer = `I found these symbols matching "${query}" (use bb_search with mode="symbol" to read their code):\n\n`
      for (const r of symbolResults) {
        const staleMark = freshnessMarker(r as any)
        fallbackAnswer += `- ${r.symbolName || r.context} [${r.symbolType || "symbol"}] in ${r.file}:${r.line}${staleMark}\n`
      }
      // Use the relevance the search engine already computed per row (3 = exact,
      // 2 = prefix, 1 = substring) instead of re-scoring names against the entire
      // lowercased query, which made confidence a constant for natural language.
      const scored = symbolResults.map((r) => (Number((r as any)._relevance) || 0) / 3)
      const quality = scored.reduce((a, b) => a + b, 0) / scored.length
      return {
        answer: fallbackAnswer,
        confidence: Math.round(Math.max(0.2, Math.min(0.8, quality)) * 100) / 100,
        confidenceKind: "heuristic",
        sources: symbolResults.map((r) => ({ file: r.file, line: r.line, context: r.symbolName || r.context })),
        route: "symbol-name",
        bounds: boundsWith(symbolResults.length, null, false),
        retrieval,
        provenance: fallbackProvenance(projectId, "semantic search returned no results; symbol-name match used as fallback"),
      }
    }
  } catch (error: any) {
    // A broken install and an empty project must be distinguishable.
    return {
      answer: `I could not search the index for "${query}": ${error?.message ?? String(error)}. This is a tool failure, not a statement about your code.`,
      confidence: 0,
      confidenceKind: "none",
      sources: [],
      route: "none",
      bounds: boundsWith(0, null, false),
      provenance: makeProvenance({
        evidenceClass: "unknown",
        engine: ENGINE,
        engineVersion: ENGINE_VERSION,
        projectId,
        source: "symbol-search-error",
        limitations: ["Symbol search threw; nothing was searched."],
        unknowns: [`Symbol search failed: ${error?.message ?? String(error)}`],
      }),
    }
  }

  return {
    answer:
      "I couldn't find a specific answer or matching code to your query in the brain database. " +
      "Nothing in the index matched — that is a statement about the index, not proof that the behaviour you asked about does not exist.",
    confidence: 0.1,
    confidenceKind: "declared-floor",
    sources: [],
    suggestions: [
      "How many functions are in this project?",
      "What is the most complex function?",
      "How many classes are there?",
      "How many methods are there?",
      "How many files are in this project?",
      "Use bb_search for precise symbol lookup",
    ],
    route: "none",
    bounds: boundsWith(0, 0, false),
    retrieval,
    provenance: emptyProvenance(projectId),
  }
}

/** Map the engine's comparison/scan/bound facts onto the answer's retrieval block. */
function retrievalFacts(semantic: Awaited<ReturnType<typeof semanticVectorSearch>>) {
  const scan = semantic.scan
  return {
    method: semantic.metadata.method,
    queryModel: semantic.metadata.queryModel,
    indexModel: semantic.metadata.indexModel,
    dimension: semantic.metadata.dimension,
    fallbackReason: semantic.metadata.fallbackReason,
    embeddingCoverage: {
      embedded: semantic.comparison.comparableEmbeddings,
      symbols: semantic.comparison.comparableSymbols,
      ratio: semantic.comparison.comparableCoverage,
    },
    libraryCoverage: {
      embedded: semantic.comparison.libraryEmbeddings,
      symbols: semantic.comparison.librarySymbols,
      ratio: semantic.comparison.libraryCoverage,
    },
    discriminative: semantic.metadata.discriminative,
    nonDiscriminativeCompetitors: semantic.metadata.nonDiscriminativeCompetitors,
    degenerateQueryVector: semantic.metadata.fallbackReason === "degenerate-query-vector",
    scannedRows: scan.scannedRows,
    filteredRows: scan.filteredRows,
    rankedCandidates: scan.rankedCandidates,
    scanCap: scan.cap,
    scanCapped: scan.capped,
    embeddingWaitCeilingMs: semantic.embeddingBound?.waitCeilingMs,
    embeddingTimedOut: semantic.embeddingBound?.timedOut,
    embeddingFellBackTo: semantic.embeddingBound?.fellBackTo ?? null,
  }
}

type ExactMatch = NonNullable<Awaited<ReturnType<typeof exactSymbolMatch>>>

function exactNameResult(
  projectId: ProjectID,
  exact: ExactMatch,
  neighbours: Array<{ file: string; line: number; symbolName: string; symbolType: string; stale?: boolean; missing?: boolean }>,
  limit: number,
  scanSkipped: boolean,
  retrieval?: ReturnType<typeof retrievalFacts>,
): QuickAnswerResult {
  const sources: Array<{ file: string; line: number; context: string }> = [
    { file: exact.file, line: exact.line, context: exact.name + (exact.stale ? " (STALE)" : "") + (exact.missing ? " (MISSING)" : "") },
    ...neighbours.map((r) => ({ file: r.file, line: r.line, context: r.symbolName + (r.stale ? " (STALE)" : "") + (r.missing ? " (MISSING)" : "") })),
  ]
  const body = scanSkipped
    ? `\`${exact.name}\` is a symbol in this project (${exact.symbolType}). Matched by NAME, not by similarity — this is an exact lookup, and you asked for one result, so no neighbour scan ran.\n\n`
    : `\`${exact.name}\` is a symbol in this project (${exact.symbolType}). Matched by NAME, not by similarity — this is an exact lookup, so what follows is its neighbours, not better matches.\n\n`
  const neighbourLines = neighbours.length
    ? neighbours.map((r) => `--- ${r.file}:${r.line}${freshnessMarker(r)} — ${r.symbolType} ${r.symbolName}\n`).join("")
    : ""
  const freshnessNote = exact.missing
    ? "\nNote: the file behind this symbol is no longer on disk.\n"
    : exact.stale
      ? "\nNote: the file behind this symbol changed on disk since the last index run.\n"
      : ""
  const limits = ["Identity of the symbol is exact; its behaviour is not described and no similarity ranking decided this result."]
  const unknowns: string[] = []
  if (exact.missing) unknowns.push("The file behind this symbol is no longer on disk.")
  else if (exact.stale) unknowns.push("The file behind this symbol changed on disk since the last index run.")
  if (scanSkipped) limits.push("No neighbour scan ran: the caller asked for exactly one result.")
  return {
    answer: `Closest matches from the AST index for your query (search results, not a verified answer):\n\n${body}${freshnessNote}${neighbourLines}`,
    // A certainty about the INDEX identity, not about behaviour.
    confidence: exact.missing ? 0.7 : exact.stale ? 0.8 : 0.9,
    confidenceKind: "exact-symbol",
    sources,
    route: "retrieval",
    bounds: boundsWith(sources.length, sources.length, false),
    retrieval: {
      method: "exact-name",
      queryModel: "name-lookup",
      indexModel: "name-lookup",
      dimension: 0,
      ...(retrieval
        ? {
            fallbackReason: retrieval.fallbackReason,
            embeddingCoverage: retrieval.embeddingCoverage,
            libraryCoverage: retrieval.libraryCoverage,
            discriminative: retrieval.discriminative,
            nonDiscriminativeCompetitors: retrieval.nonDiscriminativeCompetitors,
            scannedRows: retrieval.scannedRows,
            filteredRows: retrieval.filteredRows,
            rankedCandidates: retrieval.rankedCandidates,
            scanCap: retrieval.scanCap,
            scanCapped: retrieval.scanCapped,
            embeddingWaitCeilingMs: retrieval.embeddingWaitCeilingMs,
            embeddingTimedOut: retrieval.embeddingTimedOut,
            embeddingFellBackTo: retrieval.embeddingFellBackTo,
          }
        : {}),
    },
    provenance: makeProvenance({
      evidenceClass: "indexed",
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      projectId,
      source: "exact-symbol-name (brain_symbol.name)",
      limitations: limits,
      unknowns,
    }),
  }
}

function retrievalResult(
  projectId: ProjectID,
  query: string,
  semantic: Awaited<ReturnType<typeof semanticVectorSearch>>,
  limit: number,
  retrieval: ReturnType<typeof retrievalFacts>,
): QuickAnswerResult {
  const isFallback = semantic.metadata.method === "keyword-fallback"
  // A degenerate query vector is not "no vector was close enough" — it is
  // "nothing was compared at all". The answer must not claim otherwise.
  const degenerate = semantic.metadata.fallbackReason === "degenerate-query-vector"
  const comparable = retrieval.embeddingCoverage!
  const notes: string[] = []

  if (retrieval.embeddingTimedOut) {
    notes.push(
      `Note: the embedding provider did not answer within ${retrieval.embeddingWaitCeilingMs ?? 0} ms, so this question was embedded with the local word-vector model` +
        (retrieval.embeddingFellBackTo ? ` (${retrieval.embeddingFellBackTo})` : "") +
        `. Only ${comparable.embedded.toLocaleString()} of ${comparable.symbols.toLocaleString()} indexed symbols exist in that space, so the ranking below is limited to them.`,
    )
  }
  if (isFallback) {
    notes.push(
      degenerate
        ? "Note: no vector was produced for this query — the embedding model could not represent its terms — so the matches below come from lexical search, not from similarity. No similarity score is shown because none was computed."
        : "Note: semantic embeddings are unavailable or insufficient for this query (coverage too low), so the matches below are lexical, not semantic — I cannot confidently answer this from embeddings.",
    )
  } else if (semantic.metadata.discriminative === false) {
    const competitors = semantic.metadata.nonDiscriminativeCompetitors ?? 0
    notes.push(
      `Note: this ranking does not distinguish its top results — ${competitors} other symbol(s) scored within the same margin of the best. ` +
        "The similarity numbers below separate candidates by an accident of length, not by relevance to the question, so treat the ORDER as unreliable and the scores as a weak signal at best. " +
        "The confidence figure is capped for the same reason.",
    )
  } else if (comparable.ratio < 0.9) {
    notes.push(
      `Note: only ${comparable.embedded.toLocaleString()} of ${comparable.symbols.toLocaleString()} indexed symbols ` +
        `(${Math.round(comparable.ratio * 100)}%) have embeddings in the space this query was compared in, so a symbol matching your question may be absent from this list entirely.`,
    )
  }

  // What the words route actually matched, stated in the answer. Without this, the
  // terms route turns an honest refusal into a confident-looking non-answer.
  const tm = semantic.metadata.termMatch
  if (tm && tm.queryTerms.length > 0) {
    const matched = tm.topMatched
    const ignored = tm.queryTerms.filter((t) => !matched.includes(t))
    const basis =
      matched.length === tm.queryTerms.length
        ? `every word you used (${matched.join(", ")})`
        : matched.length === 1
          ? `ONE word (${matched[0]})`
          : `${matched.length} of ${tm.queryTerms.length} words (${matched.join(", ")})`
    notes.push(
      `Note: these came from a KEYWORD match on ${basis} of your query, not from understanding it. ` +
        (ignored.length
          ? `The result does not mention ${ignored.join(", ")} at all, so the code you asked about may simply not be here — this codebase may not do that. `
          : "") +
        `Treat the list below as places that happen to contain those words, not as an answer.`,
    )
  }

  const header = "Closest matches from the AST index for your query (search results, not a verified answer):\n\n"
  let combinedAnswer = notes.length ? notes.join("\n") + "\n\n" + header : header
  const sources: Array<{ file: string; line: number; context: string }> = []
  for (const res of semantic.results) {
    const staleMark = freshnessMarker(res)
    combinedAnswer += `--- File: ${res.file} (Line ${res.line})${staleMark} ---\n`
    // Only print a similarity when one was actually computed.
    const score = typeof res.similarity === "number" ? ` — similarity ${res.similarity.toFixed(3)}` : ""
    combinedAnswer += `[${res.symbolType}] ${res.symbolName}${score}${staleMark}\n`
    const truncated = (res.snippet || "").split("\n").slice(0, 30).join("\n")
    if (truncated) combinedAnswer += `\`\`\`\n${truncated}\n\`\`\`\n\n`
    sources.push({ file: res.file, line: res.line, context: res.symbolName + (res.stale ? " (STALE)" : "") + (res.missing ? " (MISSING)" : "") })
  }
  combinedAnswer += `\n— Use bb_search for precise symbol lookup: "bb_search(query='${query}')".\n`
  combinedAnswer += `— Use bb_search with mode="file" to read any indexed file.`

  const measured = semantic.results.map((r) => (typeof r.similarity === "number" ? r.similarity : null)).filter((s): s is number => s !== null)
  const nonDiscriminative = semantic.metadata.discriminative === false
  // Confidence is derived ONLY from a real similarity, and only on the vector path.
  // On the keyword path no score exists, so confidence is a declared low constant
  // rather than an average of zeros that reads as measured. When the ranking says
  // it cannot separate candidates, the mean is capped and labelled: a number the
  // answer calls unreliable cannot be published as 0.74.
  const rawConfidence = measured.length === 0
    ? 0.2
    : Math.round(Math.max(0.2, Math.min(0.85, measured.reduce((a, b) => a + b, 0) / measured.length)) * 100) / 100
  const confidence = nonDiscriminative ? Math.min(0.4, rawConfidence) : rawConfidence
  const confidenceKind: ConfidenceKind = nonDiscriminative
    ? "non-discriminative"
    : measured.length === 0
      ? "declared-floor"
      : "similarity-mean"

  const truncationReason = retrieval.scanCapped
    ? `scan cap ${retrieval.scanCap} reached; candidates are a deterministic prefix of the embedding table (ordered by entity_id)`
    : retrieval.rankedCandidates != null && retrieval.rankedCandidates > sources.length
      ? `limit ${limit} of ${retrieval.rankedCandidates} candidates above the similarity floor`
      : undefined
  const truncated = retrieval.scanCapped === true || (retrieval.rankedCandidates ?? 0) > sources.length

  return {
    answer: combinedAnswer,
    confidence,
    confidenceKind,
    sources,
    route: "retrieval",
    bounds: boundsWith(sources.length, retrieval.rankedCandidates ?? null, truncated, truncationReason),
    retrieval,
    provenance: semanticProvenance(projectId, semantic.provenance),
  }
}
