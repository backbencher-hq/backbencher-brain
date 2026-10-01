import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import { semanticVectorSearch } from "./semantic-search"
import { searchSymbols } from "./symbol-search"
import { makeProvenance, type EvidenceProvenance } from "../evidence"

export interface QuickAnswerResult {
  answer: string
  confidence: number
  sources: Array<{ file: string; line: number; context: string }>
  suggestions?: string[]
  provenance: EvidenceProvenance
  /**
   * Which route produced the answer. This is the field the door needs in order
   * to stop contradicting itself: an `aggregate` answer is exact and has an
   * empty source list BY DESIGN, so a door that renders "no matches" whenever
   * the list is empty denies a correct answer. Only `retrieval` and
   * `symbol-name` answers may ever be described in terms of matches.
   */
  route: "aggregate" | "retrieval" | "symbol-name" | "no-index" | "none"
  /** Which noun was counted, when `route === "aggregate"`. */
  aggregate?: { noun: string; aggregate: string; value: number }
  /**
   * Retrieval facts that must reach the caller. The engine already computes
   * every one of these (semantic-search.ts `metadata`); before this field they
   * were dropped at the door, so a 50-dimensional offline word-vector cosine
   * was presented exactly like a production embedding's, with no way to tell.
   */
  retrieval?: {
    method: "vector" | "keyword-fallback"
    queryModel: string
    indexModel: string
    dimension: number
    fallbackReason?: string
    embeddingCoverage: { embedded: number; symbols: number; ratio: number }
    /**
     * The query produced a vector of all zeros. Cosine against such a vector is
     * 0 for every row, so NOTHING was actually compared and the answer came
     * from the lexical path.
     */
    degenerateQueryVector: boolean
  }
}

const ENGINE = "quick-answer@intelligence"
const ENGINE_VERSION = "m10.03"

function statProvenance(projectId: ProjectID, fact: string): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "indexed",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: fact,
    limitations: ["Count is a direct aggregate over indexed rows; it does not interpret semantics."],
  })
}

function semanticProvenance(projectId: ProjectID, inner: EvidenceProvenance): EvidenceProvenance {
  return makeProvenance({
    evidenceClass: "semantic_candidate",
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    projectId,
    source: "semantic-search@intelligence",
    limitations: inner.limitations,
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
 * Index state, as three distinct facts. The previous version returned a boolean
 * and swallowed every error into `false`, so a corrupt database, a locked
 * database, a permission error, a missing native driver and a genuinely
 * unindexed project all produced the same confident sentence — "no index exists
 * for this project. Index it first" — which sends the user to re-index a
 * project that is already indexed and throws the real error away.
 */
type IndexState = "indexed" | "empty" | "unreadable"

async function indexState(projectId: ProjectID): Promise<{ state: IndexState; error?: string }> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number } | undefined
    return { state: (row?.c ?? 0) > 0 ? "indexed" : "empty" }
  } catch (error: any) {
    return { state: "unreadable", error: error?.message ?? String(error) }
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
const LANGUAGE_INDEX = new Set(Object.values(LANGUAGE_ALIASES))

/**
 * The stat nouns this tool can answer EXACTLY. Declared as data rather than as
 * a chain of `if`s, so two things become true that were not:
 *   1. the countable vocabulary is inspectable — the tool can therefore say
 *      which count questions it cannot answer, instead of silently returning
 *      unrelated search results that look like an attempt; and
 *   2. every entry is cross-language honest by construction (a method-first
 *      language and a function-first language agree) rather than by
 *      remembering one Ruby regression.
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

/** Count nouns a developer asks for that this tool has no aggregate for. Listed
 *  so the tool can refuse BY NAME rather than answering a different question. */
const NOT_COUNTABLE = [
  "endpoint", "endpoints", "route", "routes", "line", "lines", "todo", "todos",
  "comment", "comments", "test", "tests", "bug", "bugs", "issue", "issues",
  "component", "components", "module", "modules", "package", "packages",
  "variable", "variables", "field", "fields", "parameter", "parameters", "argument", "arguments",
]

/** English function words carry no counting intent. Dropping them keeps
 *  "how many lines of code are there" from matching a countable noun while
 *  still letting "how many class files" match "class". */
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

/**
 * How much of the index is actually embedded. Measured per run, not assumed.
 *
 * The documented coverage-honesty note used to fire only when the whole vector
 * path failed, which is a PATH condition and not a COVERAGE condition: at 22%
 * coverage the vector path succeeds and the tool printed similarity numbers
 * with no disclosure at all. This is the number that note is about.
 */
async function embeddingCoverage(projectId: ProjectID): Promise<{ embedded: number; symbols: number; ratio: number }> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    // TWO placeholders, TWO bindings. Binding one leaves the second subquery
    // with NULL, which SQLite reports as 0 — the coverage silently reads as
    // "0 of 0 symbols embedded" on every project. Measured, not guessed.
    const row = raw.prepare(
      "SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols, " +
        "(SELECT COUNT(DISTINCT entity_id) FROM brain_semantic_embedding WHERE project_id = ?) AS embedded",
    ).get(projectId, projectId) as { symbols: number; embedded: number } | undefined
    const symbols = row?.symbols ?? 0
    const embedded = row?.embedded ?? 0
    return { embedded, symbols, ratio: symbols > 0 ? embedded / symbols : 0 }
  } catch {
    return { embedded: 0, symbols: 0, ratio: 0 }
  }
}

export async function quickAnswer(projectId: ProjectID, query: string, options: { limit?: number } = {}): Promise<QuickAnswerResult> {
  const limit = Math.max(0, Math.floor(options.limit ?? 5))

  // Honesty guard: a missing index must never produce a confident stat answer
  // ("There are 0 symbols") — the project may have thousands of symbols that
  // were simply never indexed. Without an index there is no evidence, so the
  // answer is an explicit unknown, not a fabricated count. An index that cannot
  // be READ is a different fact and gets a different answer, because "index it
  // first" is the wrong remedy for a corrupt or locked database.
  const index = await indexState(projectId)
  if (index.state === "unreadable") {
    return {
      answer:
        `I can't answer this: the index for this project exists but could not be read (${index.error ?? "unknown error"}). ` +
        "Re-indexing will not help until the database is readable — check the error above, then run `bb index <dir> --force`.",
      confidence: 0,
      sources: [],
      route: "no-index",
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
      sources: [],
      route: "no-index",
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
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT relative_path AS path, size_bytes AS size FROM brain_file WHERE project_id = ? ORDER BY size_bytes DESC LIMIT 1").get(projectId) as { path: string; size: number } | undefined
    if (row?.size) {
      return {
        answer: `The largest file is "${row.path}" at ${(row.size / 1024).toFixed(1)} KB`,
        confidence: 0.9,
        sources: [{ file: row.path, line: 0, context: `${(row.size / 1024).toFixed(1)} KB` }],
        route: "aggregate",
        provenance: statProvenance(projectId, "max(brain_file.size_bytes)"),
      }
    }
  }

  // ── most complex function ────────────────────────────────────────────────
  // HONESTY: the previous query ordered by `gravity_score DESC, complexity
  // DESC` — that ranks by how many things call a function — while the
  // provenance source string said `max(brain_symbol.complexity)`. The two only
  // agree when gravity and complexity happen to agree. On rake the tool named a
  // function of complexity 2 while the index held one of complexity 10. The
  // answer and its provenance now name the same ordering, and the tie-break is
  // deterministic so equal complexities rank stably.
  if (has(lowerQuery, "most complex") || has(lowerQuery, "highest complexity") || has(lowerQuery, "complexest")) {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare(
      "SELECT s.name AS name, s.complexity AS complexity, COALESCE(s.line_start, 0) AS line, f.relative_path AS file " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN ('function','method') AND s.complexity IS NOT NULL " +
        "ORDER BY s.complexity DESC, s.gravity_score DESC, s.id ASC LIMIT 1",
    ).get(projectId) as { name: string; complexity: number; line: number; file: string } | undefined
    if (row) {
      return {
        answer: `The most complex function is "${row.name}" with complexity ${row.complexity}`,
        confidence: 0.9,
        sources: [{ file: row.file, line: row.line || 0, context: `Function: ${row.name}` }],
        route: "aggregate",
        provenance: statProvenance(projectId, "max(brain_symbol.complexity) over symbol_type in (function, method)"),
      }
    }
  }

  // ── "how many …" ──────────────────────────────────────────────────────────
  // Routing on a DECLARED noun table rather than a chain of substring tests.
  // Two properties this buys, both of which were missing:
  //   1. "how many methods" is answerable. It is the most natural question in
  //      ruby/python/java and the old chain did not know the word, so the
  //      query fell through to retrieval and returned five arbitrary methods.
  //   2. A count question naming something we cannot count is REFUSED by
  //      name, instead of being answered with unrelated search results that
  //      look like an attempt.
  if (has(lowerQuery, "how many") || has(lowerQuery, "count the") || has(lowerQuery, "number of")) {
    const raw = await BrainDatabase.getRawInstance(projectId)

    // "total symbols" with no explicit noun still means symbols.
    const wantsTotalOnly = has(lowerQuery, "total") && !COUNTABLE.some((entry) => entry.nouns.some((n) => lowerQuery.includes(n)))

    if (!wantsTotalOnly) {
      for (const entry of COUNTABLE) {
        if (!entry.nouns.some((noun) => lowerQuery.includes(noun))) continue
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
          sources: [],
          route: "aggregate",
          aggregate: { noun: entry.label, aggregate, value },
          provenance: statProvenance(projectId, aggregate),
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
          sources: [],
          route: "none",
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
          sources: [],
          route: "aggregate",
          aggregate: { noun: `${lang} files`, aggregate: `count(brain_file where language=${lang})`, value },
          provenance: statProvenance(projectId, `count(brain_file where language=${lang})`),
        }
      }
      const row = raw.prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as { c: number }
      const value = row?.c ?? 0
      return {
        answer: `There are ${value.toLocaleString()} files in this project`,
        confidence: 0.95,
        sources: [],
        route: "aggregate",
        aggregate: { noun: "files", aggregate: "count(brain_file)", value },
        provenance: statProvenance(projectId, "count(brain_file)"),
      }
    }
  }

  const semantic = await semanticVectorSearch(projectId, query, { maxResults: limit })
  const coverage = await embeddingCoverage(projectId)
  const isFallback = semantic.metadata.method === "keyword-fallback"
  // A degenerate query vector is not "no vector was close enough" — it is
  // "nothing was compared at all". The engine reports it as such; the answer
  // must not claim otherwise.
  const degenerate = semantic.metadata.fallbackReason === "degenerate-query-vector"
  const retrieval = {
    method: semantic.metadata.method,
    queryModel: semantic.metadata.queryModel,
    indexModel: semantic.metadata.indexModel,
    dimension: semantic.metadata.dimension,
    fallbackReason: semantic.metadata.fallbackReason,
    embeddingCoverage: coverage,
    degenerateQueryVector: degenerate,
  }

  if (semantic.results.length > 0) {
    // Honesty in three parts, because they fail independently:
    //  (a) the path. A keyword-fallback answer is lexical, and says so.
    //  (b) the score. The keyword path fills similarity with null and the code
    //      says that number is meaningless — so it is NOT printed. Printing
    //      "similarity 0.000" under a "these are not semantic" banner is a
    //      number that looks like evidence and is not.
    //  (c) the coverage. The documented note used to fire only when the WHOLE
    //      vector path failed. At 22% coverage the vector path succeeds and the
    //      tool printed similarity numbers with no coverage disclosure at all.
    const notes: string[] = []
    if (isFallback) {
      notes.push(
        degenerate
          ? "Note: no vector was produced for this query — the embedding model could not represent its terms — so the matches below come from lexical search, not from similarity. No similarity score is shown because none was computed."
          : "Note: semantic embeddings are unavailable or insufficient for this query (coverage too low), so the matches below are lexical, not semantic — I cannot confidently answer this from embeddings.",
      )
    } else if (coverage.ratio < 0.9) {
      notes.push(
        `Note: only ${coverage.embedded.toLocaleString()} of ${coverage.symbols.toLocaleString()} indexed symbols ` +
        `(${Math.round(coverage.ratio * 100)}%) have embeddings, so a symbol matching your question may be absent from this list entirely.`,
      )
    }
    const header = `Closest matches from the AST index for your query (search results, not a verified answer):\n\n`
    let combinedAnswer = notes.length ? notes.join("\n") + "\n\n" + header : header
    const sources: Array<{ file: string; line: number; context: string }> = []
    for (const res of semantic.results) {
      const staleMark = res.stale ? " [STALE — file changed since index]" : ""
      combinedAnswer += `--- File: ${res.file} (Line ${res.line})${staleMark} ---\n`
      // Only print a similarity when one was actually computed.
      const score = typeof res.similarity === "number" ? ` — similarity ${res.similarity.toFixed(3)}` : ""
      combinedAnswer += `[${res.symbolType}] ${res.symbolName}${score}${staleMark}\n`
      const truncated = (res.snippet || "").split("\n").slice(0, 30).join("\n")
      if (truncated) combinedAnswer += `\`\`\`\n${truncated}\n\`\`\`\n\n`
      sources.push({ file: res.file, line: res.line, context: res.symbolName + (res.stale ? " (STALE)" : "") })
    }
    combinedAnswer += `\n— Use bb_search for precise symbol lookup: "bb_search(query='${query}')".\n`
    combinedAnswer += `— Use bb_search with mode="file" to read any indexed file.`
    // Confidence is derived ONLY from a real similarity, and only on the vector
    // path. On the keyword path no score exists, so confidence is a declared
    // low constant rather than an average of zeros that reads as measured.
    const measured = semantic.results.map((r) => (typeof r.similarity === "number" ? r.similarity : null)).filter((s): s is number => s !== null)
    const confidence = measured.length === 0
      ? 0.2
      : Math.round(Math.max(0.2, Math.min(0.85, measured.reduce((a, b) => a + b, 0) / measured.length)) * 100) / 100
    return {
      answer: combinedAnswer,
      confidence,
      sources,
      route: "retrieval",
      retrieval,
      provenance: semanticProvenance(projectId, semantic.provenance),
    }
  }

  try {
    const symbolResults = await searchSymbols(projectId, query, { maxResults: limit, includeContent: true })
    if (symbolResults.length > 0) {
      let fallbackAnswer = `I found these symbols matching "${query}" (use bb_search with mode="symbol" to read their code):\n\n`
      for (const r of symbolResults) {
        const staleMark = (r as any).stale ? " [STALE — file changed since index]" : ""
        fallbackAnswer += `- ${r.symbolName || r.context} [${r.symbolType || "symbol"}] in ${r.file}:${r.line}${staleMark}\n`
      }
      // Use the relevance the search engine already computed per row (3 = exact,
      // 2 = prefix, 1 = substring) instead of re-scoring names against the
      // ENTIRE lowercased query — which, for any natural-language query, scored
      // every row 0.3 and made confidence a constant.
      const scored = symbolResults.map((r) => (Number((r as any)._relevance) || 0) / 3)
      const quality = scored.reduce((a, b) => a + b, 0) / scored.length
      return {
        answer: fallbackAnswer,
        confidence: Math.round(Math.max(0.2, Math.min(0.8, quality)) * 100) / 100,
        sources: symbolResults.map((r) => ({ file: r.file, line: r.line, context: r.symbolName || r.context })),
        route: "symbol-name",
        retrieval,
        provenance: fallbackProvenance(projectId, "semantic search returned no results; symbol-name match used as fallback"),
      }
    }
  } catch (error: any) {
    // Previously a bare `catch {}`: a broken install and an empty project were
    // indistinguishable. The failure is stated, and the answer says so.
    return {
      answer: `I could not search the index for "${query}": ${error?.message ?? String(error)}. This is a tool failure, not a statement about your code.`,
      confidence: 0,
      sources: [],
      route: "none",
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
    retrieval,
    provenance: emptyProvenance(projectId),
  }
}
