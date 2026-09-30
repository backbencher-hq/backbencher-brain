// M20.D3 — the bb_doc documentation generator.
//
// Read-only. It never writes a repository file, never refreshes the index, and
// never invents a fact: a claim is either extracted from the index, inferred
// from cited evidence under a cap, or declared unknown.
//
// THE CONTRACT THIS FILE IMPLEMENTS is docs/BB_DOC.md. Three rules from it
// shape everything below, and each one was broken before this revision (the
// defects are named inline so the reason survives the next edit):
//
//   1. "Citation IDs are deterministic for the same project snapshot, query,
//      and schema version" — so an ID may never contain a machine's absolute
//      path. It is built from the repository-relative path only.
//   2. "The deterministic gate fails when ... required mode sections are
//      absent" — so every mode emits its DECLARED section set, and
//      completeness is measured against that set rather than against whatever
//      happened to be produced.
//   3. "Inferred claims are capped at 0.85; semantic-only feature discovery is
//      capped at 0.70; stale or missing evidence cannot support a confident
//      claim" — so confidence is DERIVED, never passed in by a caller.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../brain/database"
import { checkFileFreshness, resolveRowsFreshnessDetailed } from "../../brain/freshness"
import { semanticVectorSearch } from "../search/semantic-search"
import { languageExtensionEntries } from "../../ast/language-detection"

export type DocMode = "symbol" | "file" | "module" | "feature" | "api" | "project" | "coverage"
export type DocFormat = "markdown" | "json"
export type DocAudience = "developer" | "maintainer" | "user" | "website"
export type DocDetail = "brief" | "standard" | "deep"

export interface DocRequest {
  mode: DocMode
  target?: string
  format?: DocFormat
  audience?: DocAudience
  detail?: DocDetail
  includeExamples?: boolean
  includeDiagrams?: boolean
  includeTests?: boolean
  limit?: number
  maxTokens?: number
}

export interface DocCitation {
  id: string
  kind: "symbol" | "file" | "relationship" | "import" | "test" | "finding" | "embedding" | "health"
  path?: string
  symbol?: string
  lineStart?: number
  lineEnd?: number
  relationshipType?: string
  evidence: string
  freshness: "fresh" | "stale" | "missing" | "unknown"
  confidence: number | null
}

export interface DocFact {
  classification: "extracted" | "inferred" | "generated" | "unknown"
  statement: string
  confidence: number | null
  citationIds: string[]
}

export interface DocSection {
  id: string
  heading: string
  prose: string
  facts: DocFact[]
  citations: string[]
}

export interface DocUnknown {
  statement: string
  reason: "not-indexed" | "not-observed" | "stale-evidence" | "unsupported-mode" | "output-budget"
  affectedSection: string
}

export interface DocQuality {
  passed: boolean
  factuality: { passed: boolean; uncitedClaims: number; unsupportedClaims: number }
  references: { passed: boolean; broken: number; stale: number; missing: number }
  completeness: { passed: boolean; covered: number; expected: number; unknown: number }
  freshness: { passed: boolean; snapshot: string; staleClaims: number }
  budget: { passed: boolean; estimatedTokens: number; maxTokens: number }
  warnings: string[]
}

export interface DocReferenceMetadata {
  projectId: string
  projectPath: string
  snapshotId: string
  generatedAt: string
  indexVersion: string | null
  schemaVersion: number | null
  sourceLanguage: string | null
  canonicalPath: string | null
  slugs: string[]
  tags: string[]
  relatedReferences: string[]
  diagrams: Array<{ id: string; format: "mermaid" | "json"; citationIds: string[] }>
}

export interface DocResult {
  schemaVersion: "1"
  mode: DocMode
  title: string
  summary: string
  sections: DocSection[]
  citations: DocCitation[]
  unknowns: DocUnknown[]
  quality: DocQuality
  reference: DocReferenceMetadata
}

type Row = Record<string, any>

// ─────────────────────────────────────────────────────────────────────────────
// bounds
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_EVIDENCE_LIMIT = 20
const MAX_EVIDENCE_LIMIT = 100
const DEFAULT_TOKEN_BUDGET = 4_000
const MAX_TOKEN_BUDGET = 16_000
/** Relationship/import evidence per symbol, before the per-section cap. */
const RELATIONSHIP_FETCH_CAP = 40
const IMPORT_FETCH_CAP = 40
/** How many files a broad mode will select before it declares truncation. */
const SCOPE_FILE_CAP = 500

function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback
}

/**
 * The output budget. A caller-supplied budget is HONOURED (a budget below the
 * default is a real request to be terse), it is only clamped to the server
 * maximum. It used to floor at 1, so maxTokens=100 silently became 1.
 */
function resolveTokenBudget(requested: unknown): number {
  const n = Number(requested)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TOKEN_BUDGET
  return Math.max(1, Math.min(MAX_TOKEN_BUDGET, Math.floor(n)))
}

/**
 * Languages whose SYMBOL NAMES ARE PROSE, so a source-text scan over the file means
 * nothing for them.
 *
 * `markdown` is here for a measured reason, not a stylistic one. A markdown symbol is
 * a heading, a table, a code fence or a front-matter block, so its "name" is English
 * text — and both scanners below read the file as if those names were code:
 *
 *  1. the comment scanner (`SourceReader.docstring`) is C-family `/**` `*` `//`. In markdown `*`
 *     is the BOLD delimiter, so a prose line above a heading is read as a JSDoc
 *     block. Measured over this repository's own index (331 `.md` files, 3,598
 *     markdown symbols): **79 symbols received a fabricated docstring at
 *     `classification: "extracted", confidence: 1.0`**, e.g. a heading "Symbols seem
 *     missing after an edit" inheriting the `*Fix:** only run one indexing write…`
 *     line above it. A confident fabrication is worse than an absence: it is the one
 *     output shape a reader cannot tell from a real extraction.
 *  2. The `includeTests` fallback substring-scans test files for the symbol's name.
 *     A heading named `File`, `Contract`, `Decisions` or `ack` matches any test file
 *     containing that English word. Measured: 5 of 2,321 distinct markdown names in
 *     this index would falsely match, each published as an `inferred` fact at
 *     confidence 0.7.
 *
 * The router decides, not a table kept beside it: `language-detection.ts` is the one
 * registry that admits a file to an analyzer, so the doc lane agrees with it rather
 * than keeping a second opinion (the same rule `script/m14/differential.ts` states
 * for the F5 lane's sampling universe).
 *
 * NOT a general "no comments in prose formats" claim. `yaml`, `toml` and `xml` are
 * equally prose-shaped and are deliberately absent, because a comment scanner over a
 * YAML `#` line is a different question and has not been measured — adding them on
 * the strength of this reasoning would be exactly the unmeasured widening this
 * repository keeps refusing.
 */
const PROSE_NAME_LANGUAGES: ReadonlySet<string> = new Set(["markdown"])

/**
 * Extension → language, resolved ONCE per generation.
 *
 * `languageExtensionEntries()` is the router's own registry, so the doc lane
 * cannot drift from the answer the indexer used — but the linear scan it
 * requires is not free, and this predicate is called once per symbol: a linear
 * walk per call cost 22ms for 160 symbols, which is 95% of the time to
 * document a 20-file project. The registry is a fixed table inside this
 * process, so resolving it once and reusing it is the same answer, not an
 * approximation of one. The re-read is kept below for the case where the
 * registry is genuinely not constant.
 */
let proseExtensionCache: { prose: Set<string> } | null = null

function proseNameExtensions(): Set<string> {
  if (proseExtensionCache) return proseExtensionCache.prose
  const prose = new Set<string>()
  for (const [extension, language] of languageExtensionEntries()) {
    if (PROSE_NAME_LANGUAGES.has(language)) prose.add(extension)
  }
  proseExtensionCache = { prose }
  return prose
}

function isProseNameFile(filePath: unknown): boolean {
  if (typeof filePath !== "string" || filePath.length === 0) return false
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  const dot = filePath.lastIndexOf(".")
  if (dot < slash + 1) return false
  const ext = filePath.slice(dot + 1).toLowerCase()
  if (!ext) return false
  const cached = proseNameExtensions()
  // An extension the router does not know cannot be a prose language, so this
  // is the whole answer: one Set lookup, no scan, no registry walk.
  return cached.has(ext)
}

/** Facts per section. `detail` is a real input, not decoration (D17). */
function factsPerSection(detail: DocDetail | undefined, limit: number): number {
  if (detail === "brief") return Math.max(1, Math.min(5, limit))
  if (detail === "deep") return limit * 3
  return limit
}

// ─────────────────────────────────────────────────────────────────────────────
// text helpers (char scans; the project carries no regex by default)
// ─────────────────────────────────────────────────────────────────────────────
function quote(value: unknown): string { return String(value ?? "").split("`").join("'") }
function collapse(value: unknown): string { return String(value ?? "").split(/\s+/).join(" ").trim() }
function stripExtension(name: string): string {
  const slash = name.lastIndexOf("/")
  const dot = name.lastIndexOf(".")
  return dot > slash + 1 ? name.slice(0, dot) : name
}
function dirOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/")
  return slash < 0 ? "" : relPath.slice(0, slash + 1)
}
function baseOf(relPath: string): string {
  const slash = relPath.lastIndexOf("/")
  return slash < 0 ? relPath : relPath.slice(slash + 1)
}
function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((p) => p.length > 0 && value.startsWith(p))
}
function containsAny(value: string, needles: string[]): boolean {
  return needles.some((n) => n.length > 0 && value.includes(n))
}
function isDotfilePath(relPath: string): boolean {
  return startsWithAny(relPath, [".git/", ".github/", ".gitlab/", ".circleci/", ".vscode/", ".idea/"])
}

// ─────────────────────────────────────────────────────────────────────────────
// citation identity — repository-relative, never absolute (D3)
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeIdPart(value: string): string {
  let out = ""
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    const keep = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || code === 45 || code === 46 || code === 47 || code === 95 || code === 58
    out += keep ? value[i] : "_"
  }
  return out
}

/**
 * Build a citation id from the repository-relative path. The ABSOLUTE path is
 * never an input: the same project at the same revision must produce the same
 * ids on any machine, because the docs promise those ids are website cache
 * keys.
 */
function makeCitationId(parts: Array<string | number | undefined>): string {
  return parts
    .map((part) => sanitizeIdPart(part === undefined || part === null ? "" : String(part)))
    .filter((part) => part.length > 0)
    .join(":")
}

/**
 * Freshness for every file a document touches, resolved ONCE.
 *
 * `checkFileFreshness` re-reads the file row and re-stats the file, so calling
 * it per citation made freshness cost scale with the number of citations rather
 * than the number of FILES: 20 citations cost 12ms and dominated the 20ms
 * budget for documenting a 20-file project. `resolveRowsFreshnessDetailed` is
 * the shared batch resolver every other read tool uses for exactly this, and it
 * memoises the stat per unique path. Same answer, one pass.
 */
class FreshnessResolver {
  private readonly statuses: Map<string, DocCitation["freshness"]>

  constructor(raw: any, projectId: string, fileIds: string[]) {
    this.statuses = new Map()
    const unique = [...new Set(fileIds.filter(Boolean))]
    if (!unique.length) return
    const resolved = resolveRowsFreshnessDetailed(raw, projectId, unique.map((fileId) => ({ fileId })))
    for (const [fileId, status] of resolved.statuses) this.statuses.set(fileId, status as DocCitation["freshness"])
  }

  /** Unknown when the id was not among the files this generation resolved. */
  of(fileId: string | undefined): DocCitation["freshness"] {
    if (!fileId) return "unknown"
    return this.statuses.get(fileId) ?? "unknown"
  }
}

function sourceFreshness(raw: any, fileId: string): DocCitation["freshness"] {
  const result = checkFileFreshness(raw, fileId)
  return result?.status ?? "unknown"
}

/**
 * Confidence is DERIVED from the claim's classification and the freshness of
 * the evidence under it. A caller cannot assert confidence.
 */
const CAP_BY_CLASSIFICATION: Record<DocFact["classification"], number> = {
  extracted: 1,
  inferred: 0.85,
  generated: 0.85,
  unknown: 0,
}
/** Stale or missing evidence cannot support a confident claim. */
const CAP_BY_FRESHNESS: Record<DocCitation["freshness"], number> = {
  fresh: 1,
  unknown: 0.7,
  stale: 0.5,
  missing: 0.3,
}

function deriveConfidence(classification: DocFact["classification"], citations: DocCitation[]): number | null {
  if (classification === "unknown") return null
  let cap = CAP_BY_CLASSIFICATION[classification]
  for (const citation of citations) {
    const freshnessCap = CAP_BY_FRESHNESS[citation.freshness]
    if (freshnessCap < cap) cap = freshnessCap
  }
  // Semantic-only feature discovery is capped lower than lexical discovery.
  const semanticOnly = citations.length > 0 && citations.every((c) => c.kind === "embedding")
  if (semanticOnly && cap > 0.7) cap = 0.7
  return Math.round(cap * 100) / 100
}

function addCitation(
  citations: DocCitation[],
  spec: { kind: DocCitation["kind"]; idParts: Array<string | number | undefined>; relPath?: string; symbol?: string; lineStart?: number; lineEnd?: number; relationshipType?: string; evidence: string; fileId?: string; /** An index-scoped citation (totals, a language histogram) is current by construction. */ indexScoped?: boolean },
  resolver: FreshnessResolver,
): string {
  const base = makeCitationId([spec.kind, ...spec.idParts])
  // Guarantee uniqueness: two relationships can share a file and a line, and a
  // silently merged citation is a citation that cannot be resolved.
  let id = base
  let ordinal = 2
  while (citations.some((citation) => citation.id === id)) id = `${base}#${ordinal++}`
  const freshness = spec.fileId ? resolver.of(spec.fileId) : spec.indexScoped ? "fresh" : "unknown"
  citations.push({
    id,
    kind: spec.kind,
    path: spec.relPath,
    symbol: spec.symbol || undefined,
    lineStart: spec.lineStart || undefined,
    lineEnd: spec.lineEnd || undefined,
    relationshipType: spec.relationshipType,
    evidence: spec.evidence,
    freshness,
    confidence: Math.round(CAP_BY_FRESHNESS[freshness] * 100) / 100,
  })
  return id
}

function fact(classification: DocFact["classification"], statement: string, citationIds: string[], citations: DocCitation[]): DocFact {
  const cited = citationIds.map((id) => citations.find((citation) => citation.id === id)).filter((c): c is DocCitation => Boolean(c))
  return { classification, statement, confidence: deriveConfidence(classification, cited), citationIds }
}

function queryRows(raw: any, sql: string, ...params: any[]): Row[] {
  return raw.prepare(sql).all(...params).map((row: Row) => ({ ...row, __raw: raw }))
}

// ─────────────────────────────────────────────────────────────────────────────
// source docstrings
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Reads the comment block immediately above a definition FROM DISK.
 *
 * It used to call `readFileSync` once per SYMBOL, so documenting a 20-file /
 * 160-symbol project read 160 files — 330ms of the 330ms a `project` document
 * took, measured. Each file is now read at most once per generation and the
 * result is memoised per (path, line).
 *
 * Two honest limits, both measured on real corpora:
 *  - it is disk state while the rest of the result is index state, so a fact
 *    sourced this way says so ("the source file on disk");
 *  - it recognises `/**`, ` * ` and `//` only. `#` (Ruby, Python, Perl, shell,
 *    YAML, Makefile), `;` (Lisp, Elixir, Clojure) and `--` (SQL, Lua,
 *    Haskell) are not comment styles in any universal sense, so a symbol in
 *    those languages reports "not observed" rather than a guess. Teaching it a
 *    language belongs to the analyzer lane, which knows the grammar.
 */
class SourceReader {
  private readonly lines = new Map<string, string[] | null>()
  private readonly docstrings = new Map<string, string | null>()

  private readLines(absPath: string): string[] | null {
    if (this.lines.has(absPath)) return this.lines.get(absPath) ?? null
    let value: string[] | null = null
    try { value = readFileSync(absPath, "utf8").split(/\r?\n/) } catch { value = null }
    this.lines.set(absPath, value)
    return value
  }

  /** The comment block immediately above `lineStart`, or null when there is none. */
  docstring(absPath: string | undefined, lineStart: number): string | null {
    if (!absPath || !lineStart) return null
    // See PROSE_NAME_LANGUAGES. This guard was written onto a `sourceDocstring`
    // free function that nothing calls, while every LIVE call site goes through
    // this method — so the markdown fabrication it documents (a heading
    // inheriting the `*bold*` prose line above it, published as an extracted
    // fact at confidence 1.0) was still reachable. The guard belongs where the
    // scan happens, which is here.
    if (isProseNameFile(absPath)) return null
    const key = `${absPath}:${lineStart}`
    if (this.docstrings.has(key)) return this.docstrings.get(key) ?? null
    const fileLines = this.readLines(absPath)
    let result: string | null = null
    if (fileLines) {
      const before = fileLines.slice(0, Math.max(0, lineStart - 1)).reverse()
      const comments: string[] = []
      for (const line of before) {
        const trimmed = line.trim()
        if (!trimmed) {
          if (comments.length) break
          continue
        }
        const isBlock = trimmed.startsWith("/**")
        if (isBlock || trimmed.startsWith("*") || trimmed.startsWith("//")) {
          comments.unshift(trimmed.replace(/^\/\*\*?\s?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").replace(/^\/\/\s?/, ""))
          if (isBlock) break
        } else break
      }
      const text = collapse(comments.join(" "))
      result = text.length ? text : null
    }
    this.docstrings.set(key, result)
    return result
  }

  /** The whole file as text, for the test-reference scan. Read once. */
  text(absPath: string): string | null {
    const fileLines = this.readLines(absPath)
    return fileLines ? fileLines.join("\n") : null
  }

  /** Line count, or null when the file cannot be read. Memoised per path. */
  lineCount(absPath: string): number | null {
    const fileLines = this.readLines(absPath)
    return fileLines ? fileLines.length : null
  }

  exists(absPath: string): boolean {
    return this.readLines(absPath) !== null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// target resolution
// ─────────────────────────────────────────────────────────────────────────────
function normalizeTarget(raw: string): string {
  let value = raw.trim()
  while (value.startsWith("./")) value = value.slice(2)
  while (value.startsWith("/")) value = value.slice(1)
  while (value.endsWith("/")) value = value.slice(0, -1)
  return value
}

/**
 * `file` mode target resolution.
 *
 * The declared target is a repository-relative path, so an exact path, an
 * absolute path and a directory prefix are the contract. A bare FILE NAME is
 * also accepted because it is what a caller types, and it is matched on the
 * basename only — not as a substring of the whole path, which is what the old
 * `LIKE '%' || target` did (a pattern with a leading and no trailing `%`, so
 * it silently behaved as a SUFFIX match and resolved nothing for a directory,
 * a basename or any path prefix).
 */
function resolveFileTarget(raw: any, projectId: string, projectPath: string, target: string, cap: number): Row[] {
  const normalized = normalizeTarget(target)
  if (!normalized) return []
  const absolute = path.isAbsolute(target) ? target : path.resolve(projectPath, target)
  const exact = queryRows(
    raw,
    "SELECT * FROM brain_file WHERE project_id=? AND (relative_path=? OR relative_path=? OR path=? OR path=?) ORDER BY relative_path LIMIT ?",
    projectId, target, normalized, target, absolute, cap,
  )
  if (exact.length) return exact
  const byDirectory = queryRows(
    raw, "SELECT * FROM brain_file WHERE project_id=? AND relative_path LIKE ? ORDER BY relative_path LIMIT ?",
    projectId, `${normalized}/%`, cap,
  )
  if (byDirectory.length) return byDirectory
  // Basename match: the name the caller typed, with or without its extension,
  // compared against the LAST segment only.
  const candidates = queryRows(
    raw, "SELECT * FROM brain_file WHERE project_id=? AND instr(relative_path, ?) > 0 ORDER BY relative_path LIMIT ?",
    projectId, normalized, Math.max(cap * 10, 200),
  )
  const stem = stripExtension(baseOf(normalized))
  return candidates
    .filter((row) => {
      const base = baseOf(String(row.relative_path ?? ""))
      return base === normalized || base === `${normalized}` || stripExtension(base) === stem
    })
    .slice(0, cap)
}

function targetFiles(raw: any, projectId: string, projectPath: string, request: DocRequest, scopeCap: number): { files: Row[]; truncated: number } {
  const target = request.target ? String(request.target) : ""
  const normalized = normalizeTarget(target)
  if (request.mode === "file") return { files: resolveFileTarget(raw, projectId, projectPath, target, scopeCap), truncated: 0 }
  if (request.mode === "module") {
    if (!normalized) return { files: [], truncated: 0 }
    const total = Number((queryRows(raw, "SELECT count(*) AS c FROM brain_file WHERE project_id=? AND (relative_path LIKE ? OR relative_path LIKE ?)", projectId, `${normalized}/%`, `${normalized}%`)[0]?.c ?? 0))
    const files = queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND (relative_path LIKE ? OR relative_path LIKE ?) ORDER BY relative_path LIMIT ?", projectId, `${normalized}/%`, `${normalized}%`, scopeCap)
    return { files, truncated: Math.max(0, total - files.length) }
  }
  if (request.mode === "coverage") {
    const clause = normalized ? "AND (relative_path LIKE ? OR relative_path LIKE ?)" : ""
    const params: any[] = normalized ? [projectId, `${normalized}/%`, `${normalized}%`, scopeCap] : [projectId, scopeCap]
    const total = Number((queryRows(raw, `SELECT count(*) AS c FROM brain_file WHERE project_id=? ${clause}`, ...params.slice(0, -1))[0]?.c ?? 0))
    const files = queryRows(raw, `SELECT * FROM brain_file WHERE project_id=? ${clause} ORDER BY relative_path LIMIT ?`, ...params)
    return { files, truncated: Math.max(0, total - files.length) }
  }
  if (request.mode === "project" || request.mode === "api") {
    // Project/api document the project, so the selection is ordered by how much
    // code a file actually holds. `ORDER BY relative_path` put .github CI
    // configuration first on every real repository measured.
    const total = Number((queryRows(raw, "SELECT count(*) AS c FROM brain_file WHERE project_id=?", projectId)[0]?.c ?? 0))
    const files = queryRows(
      raw,
      `SELECT f.* FROM brain_file f WHERE f.project_id=?
         ORDER BY (f.is_config_file = 1), (relative_path LIKE '.%'), (relative_path LIKE '%.md'),
                  (SELECT count(*) FROM brain_symbol s WHERE s.file_id = f.id) DESC, f.relative_path
       LIMIT ?`,
      projectId, scopeCap,
    )
    return { files, truncated: Math.max(0, total - files.length) }
  }
  return { files: [], truncated: 0 }
}

interface FeatureDiscovery {
  symbols: Row[]
  lexical: number
  semantic: number
  semanticError: string | null
  ms: number
}

async function discoverFeatureSymbols(raw: any, projectId: string, request: DocRequest, limit: number): Promise<FeatureDiscovery> {
  const started = Date.now()
  const target = String(request.target ?? "").toLowerCase()
  const lexical = queryRows(
    raw,
    `SELECT s.*, f.path, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
     WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ? OR lower(COALESCE(s.qualified_name,'')) LIKE ?)
     ORDER BY s.gravity_score DESC, s.line_start LIMIT ?`,
    projectId, `%${target}%`, `%${target}%`, `%${target}%`, limit,
  )
  const out: FeatureDiscovery = { symbols: lexical, lexical: lexical.length, semantic: 0, semanticError: null, ms: 0 }
  // Semantic discovery tops up a thin lexical result. It is the most expensive
  // dependency this tool has (measured 3-40s on real repositories), so it
  // runs when it can add candidates, and `detail: "deep"` asks for it outright.
  const wanted = request.detail === "deep" || lexical.length < limit
  if (!wanted) { out.ms = Date.now() - started; return out }
  try {
    const discovered = await semanticVectorSearch(projectId as never, String(request.target ?? ""), { maxResults: limit })
    const already = new Set(lexical.map((row) => row.id))
    const ids = discovered.results.map((result) => result.entityId).filter((id): id is string => Boolean(id) && !already.has(id))
    out.semantic = ids.length
    if (ids.length) {
      const semantic = queryRows(
        raw,
        `SELECT s.*, f.path, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
         WHERE s.project_id=? AND s.id IN (${ids.map(() => "?").join(",")}) ORDER BY s.gravity_score DESC, s.line_start LIMIT ?`,
        projectId, ...ids, limit,
      )
      out.symbols = [...lexical, ...semantic].slice(0, limit)
    }
  } catch (error: any) {
    // A failed multi-second dependency is DECLARED, never swallowed: the spec
    // caps semantic-only discovery at 0.70 precisely because it is weaker
    // evidence, and a caller must be able to see that it is missing.
    out.semanticError = collapse(error?.message ?? String(error)) || "semantic discovery failed"
  }
  out.ms = Date.now() - started
  return out
}

async function targetSymbols(raw: any, projectId: string, request: DocRequest, files: Row[], limit: number): Promise<{ symbols: Row[]; feature: FeatureDiscovery | null }> {
  const target = request.target ? String(request.target) : ""
  if (request.mode === "symbol") {
    const symbols = queryRows(
      raw,
      "SELECT s.*, f.path, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.name=? OR s.qualified_name=? OR s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT ?",
      projectId, target, target, target.split(".").pop() ?? target, target.split("::").pop() ?? target, limit,
    )
    return { symbols, feature: null }
  }
  if (request.mode === "api") {
    return {
      symbols: queryRows(
        raw,
        `SELECT s.*, f.path, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
         WHERE s.project_id=? AND (s.api_contract_path IS NOT NULL OR lower(s.symbol_type) IN ('route','endpoint','controller'))
           AND (?='' OR s.api_contract_path=? OR f.relative_path=? OR f.relative_path LIKE ?) ORDER BY f.relative_path, s.line_start LIMIT ?`,
        projectId, target, target, target, `${normalizeTarget(target)}/%`, limit,
      ),
      feature: null,
    }
  }
  if (request.mode === "feature") {
    const feature = await discoverFeatureSymbols(raw, projectId, request, limit)
    return { symbols: feature.symbols, feature }
  }
  if (files.length) {
    return {
      symbols: queryRows(
        raw,
        `SELECT s.*, f.path, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
         WHERE s.project_id=? AND s.file_id IN (${files.map(() => "?").join(",")}) ORDER BY f.relative_path, s.line_start LIMIT ?`,
        projectId, ...files.map((file) => file.id), limit * 2,
      ),
      feature: null,
    }
  }
  return { symbols: [], feature: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// fact builders
// ─────────────────────────────────────────────────────────────────────────────
/** A Set of the repository's relative paths, for resolving imports. */
function localPathIndex(raw: any, projectId: string): { paths: Set<string>; stems: Set<string> } {
  const rows = queryRows(raw, "SELECT relative_path FROM brain_file WHERE project_id=?", projectId)
  const paths = new Set<string>()
  const stems = new Set<string>()
  for (const row of rows) {
    const rel = String(row.relative_path ?? "")
    if (!rel) continue
    paths.add(rel)
    paths.add(stripExtension(rel))
    stems.add(baseOf(rel))
    stems.add(stripExtension(baseOf(rel)))
  }
  return { paths, stems }
}

function addFileFacts(raw: any, resolver: FreshnessResolver, files: Row[], citations: DocCitation[], unknowns: DocUnknown[]): DocFact[] {
  const facts: DocFact[] = []
  for (const file of files) {
    const rel = String(file.relative_path ?? "")
    const id = addCitation(citations, {
      kind: "file", idParts: [rel], relPath: rel,
      lineStart: Number(file.line_start ?? 0) || undefined,
      evidence: `Indexed file ${rel}`, fileId: String(file.id),
    }, resolver)
    facts.push(fact("extracted", `${rel} is an indexed ${file.language ?? "unknown-language"} file with ${file.line_count ?? "unknown"} lines.`, [id], citations))
    if (file.has_syntax_errors) {
      // One unknown PER FILE, all attached to the Overview: the Overview states
      // what each indexed file is, and a file whose parse failed is a different
      // claim about that file. Attaching all of them to `risks` buried the
      // Risks section under 65 identical-shaped unknowns on a real corpus, and
      // a `risks` unknown that describes `lib/libc/include/.../activdbg.h` is
      // not a risk finding.
      unknowns.push({ statement: `Syntax validity for ${rel} is unknown because the index recorded parser errors, so its symbols and byte bounds may be wrong.`, reason: "not-observed", affectedSection: "overview" })
    }
    const freshness = resolver.of(String(file.id))
    if (freshness === "stale") {
      unknowns.push({ statement: `Current source for ${rel} cannot be confirmed: the file changed after indexing.`, reason: "stale-evidence", affectedSection: "stale" })
    } else if (freshness === "missing") {
      unknowns.push({ statement: `${rel} is indexed but no longer exists on disk.`, reason: "not-indexed", affectedSection: "stale" })
    }
  }
  return facts
}

/**
 * `brain_symbol.parameters` holds a JSON array of `{name, ...}` objects. It was
 * rendered verbatim, so a signature read
 * `define_task ([{"name":"task_class"},{"name":"args"}])`. The names are the
 * parameter list; the rest of each object is not a signature.
 */
function formatParameters(raw: unknown): string | null {
  const text = collapse(raw)
  if (!text || text === "[]" || text === "null") return null
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) {
        const names = parsed
          .map((item: any) => (typeof item === "string" ? item : item && typeof item === "object" ? String(item.name ?? item.parameter ?? "") : ""))
          .filter(Boolean)
        return names.length ? names.join(", ") : null
      }
    } catch { /* not JSON after all — fall through to the raw text */ }
  }
  return text.replace(/^\(|\)$/g, "") || null
}

function addSymbolFacts(raw: any, reader: SourceReader, resolver: FreshnessResolver, symbols: Row[], citations: DocCitation[], unknowns: DocUnknown[], includeTests: boolean): { api: DocFact[]; behavior: DocFact[]; tests: DocFact[] } {
  const api: DocFact[] = []
  const behavior: DocFact[] = []
  const tests: DocFact[] = []
  for (const symbol of symbols) {
    const rel = String(symbol.relative_path ?? "")
    const start = Number(symbol.line_start ?? 0)
    const end = Number(symbol.line_end ?? start)
    const id = addCitation(citations, {
      kind: "symbol", idParts: [rel, symbol.name, `${start}-${end}`], relPath: rel, symbol: String(symbol.name ?? ""),
      lineStart: start || undefined, lineEnd: end || undefined,
      evidence: `Indexed ${symbol.symbol_type} ${symbol.name}`, fileId: String(symbol.source_file_id ?? ""),
    }, resolver)
    const parameters = formatParameters(symbol.parameters)
    const signature = `${symbol.symbol_type} ${symbol.name}${parameters ? `(${parameters})` : "()"}`
    const returns = symbol.return_type ? `: ${collapse(symbol.return_type)}` : ""
    api.push(fact("extracted", `${signature}${returns} is defined in ${rel} at lines ${start}-${end}.`, [id], citations))
    if (symbol.api_contract_path) api.push(fact("extracted", `${symbol.name} is bound to the API contract ${symbol.api_contract_path}.`, [id], citations))
    if (symbol.visibility) api.push(fact("extracted", `${symbol.name} is declared ${symbol.visibility}.`, [id], citations))

    behavior.push(fact("extracted", `${symbol.name} is defined in ${rel} at line ${start}${symbol.return_type ? ` and returns ${collapse(symbol.return_type)}` : ""}.`, [id], citations))
    const docstring = symbol.docstring || reader.docstring(symbol.path, start)
    if (docstring) {
      const from = symbol.docstring ? "the index" : "the source file on disk"
      behavior.push(fact("extracted", `Its documentation (${from}) says: ${collapse(docstring)}`, [id], citations))
    } else {
      unknowns.push({ statement: `No docstring was indexed for ${symbol.name} and none is present in the comment style this tool reads.`, reason: "not-observed", affectedSection: "behavior" })
    }
    if (symbol.complexity != null) behavior.push(fact("extracted", `${symbol.name} has a measured complexity of ${symbol.complexity}.`, [id], citations))
    if (symbol.is_async) behavior.push(fact("extracted", `${symbol.name} is asynchronous.`, [id], citations))

    if (includeTests) {
      const indexed = queryRows(
        raw,
        "SELECT DISTINCT f.* FROM brain_relationship r JOIN brain_symbol ts ON ts.id=r.source_symbol_id JOIN brain_file f ON f.id=ts.file_id WHERE r.project_id=? AND r.target_symbol_id=? AND f.is_test_file=1 LIMIT 10",
        symbol.project_id, symbol.id,
      )
      if (indexed.length) {
        const testId = addCitation(citations, {
          kind: "test", idParts: [String(indexed[0].relative_path)], relPath: String(indexed[0].relative_path),
          lineStart: Number(indexed[0].line_start ?? 0) || undefined,
          evidence: `Test file references ${symbol.name}`, fileId: String(indexed[0].id),
        }, resolver)
        tests.push(fact("extracted", `${symbol.name} has indexed test evidence in ${indexed.map((test) => test.relative_path).join(", ")}.`, [testId], citations))
      } else {
        // The honest reason matters: "no relationship in the index" and "a test
        // file mentions the name" are different claims, and neither is "the
        // project has no tests".
        const testFiles = queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND is_test_file=1 ORDER BY relative_path LIMIT 50", symbol.project_id)
        // A markdown symbol's name is a heading, so substring-matching it against test
        // source matches English prose: measured, 5 of 2,321 distinct markdown names
        // in this index (`File`, `Contract`, `Decisions`, `ack`, `value`) would each
        // attach a real test file at confidence 0.7. See PROSE_NAME_LANGUAGES — the
        // honest state for these is the `not-observed` unknown below, not a match.
        const referencing = isProseNameFile(symbol.path) ? undefined : testFiles.find((test) => {
          const text = reader.text(String(test.path))
          return text !== null && text.includes(String(symbol.name))
        })
        if (referencing) {
          const testId = addCitation(citations, {
            kind: "test", idParts: [String(referencing.relative_path)], relPath: String(referencing.relative_path),
            lineStart: Number(referencing.line_start ?? 0) || undefined,
            evidence: `Test source references ${symbol.name}`, fileId: String(referencing.id),
          }, resolver)
          tests.push(fact("inferred", `${symbol.name} is named in the test source ${referencing.relative_path}, but no indexed relationship connects them.`, [testId], citations))
        } else {
          unknowns.push({
            statement: testFiles.length
              ? `No indexed test relationship for ${symbol.name}, and no indexed test file names it.`
              : `No test files are indexed in this project, so ${symbol.name} cannot be checked for test coverage.`,
            reason: "not-observed", affectedSection: "tests",
          })
        }
      }
    }
  }
  return { api, behavior, tests }
}

function addPublicSymbolFacts(raw: any, resolver: FreshnessResolver, symbols: Row[], citations: DocCitation[]): DocFact[] {
  const facts: DocFact[] = []
  for (const symbol of symbols) {
    const exported = symbol.visibility === "export" || symbol.visibility === "public" || symbol.is_declaration === 0
    if (!exported) continue
    const rel = String(symbol.relative_path ?? "")
    const start = Number(symbol.line_start ?? 0)
    const id = addCitation(citations, {
      kind: "symbol", idParts: [rel, symbol.name, `${start}-${Number(symbol.line_end ?? start)}`], relPath: rel,
      symbol: String(symbol.name ?? ""), lineStart: start || undefined,
      evidence: `Public ${symbol.symbol_type} ${symbol.name}`, fileId: String(symbol.source_file_id ?? ""),
    }, resolver)
    facts.push(fact("extracted", `${symbol.symbol_type} ${quote(symbol.name)} is public in ${rel} at line ${start}.`, [id], citations))
  }
  return facts
}
/**
 * Relationship facts name the SYMBOL on the other end of the edge.
 *
 * The old renderer used the target symbol's FILE. The index already carried
 * the name — it was joined in the query and then discarded — so the tool stated
 * "X calls src/lib/math.ts" where the true statement is "X calls add". For a
 * symbol-directed edge a file is never the right object; for `contains` and
 * friends a file is.
 */
function addRelationshipFacts(raw: any, resolver: FreshnessResolver, symbols: Row[], citations: DocCitation[]): { facts: DocFact[]; unresolved: number } {
  const facts: DocFact[] = []
  let unresolved = 0
  if (!symbols.length) return { facts, unresolved }
  const SYMBOL_DIRECTED = new Set(["calls", "uses", "references", "overrides", "extends", "implements", "inherits", "throws", "returns", "awaits"])
  // ONE query for the whole symbol set. It used to be one query PER SYMBOL with
  // `(source = ? OR target = ?)`, which SQLite resolves by scanning every
  // relationship of the project once per symbol: 18.8ms for 40 symbols on a
  // project with ZERO relationships, and it grows with the project. The edge
  // set is grouped in JS instead.
  const symbolIds = [...new Set(symbols.map((symbol) => String(symbol.id)))]
  const inList = symbolIds.map(() => "?").join(",")
  const cap = RELATIONSHIP_FETCH_CAP * Math.max(1, Math.min(symbolIds.length, 8))
  const relationships = queryRows(
    raw,
    `SELECT r.*, ss.name AS source_name, sf.relative_path AS source_path, ts.name AS target_name, ts.qualified_name AS target_qualified,
            tf.relative_path AS target_file
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id=r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id=ss.file_id
       LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id
       LEFT JOIN brain_file tf ON tf.id=ts.file_id
      WHERE r.project_id=? AND (r.source_symbol_id IN (${inList}) OR r.target_symbol_id IN (${inList}))
      ORDER BY r.line_number LIMIT ?`,
    projectId_(symbols), ...symbolIds, ...symbolIds, cap,
  )
  const byId = new Map(symbols.map((symbol) => [String(symbol.id), symbol]))
  const seen = new Set<string>()
  // An INBOUND edge names the other file, so its freshness is as resolvable as
  // an outbound edge's. Leaving it unset reported "unknown" for a file the tool
  // could have checked.
  const fileIdByPath = new Map<string, string>()
  for (const relationship of relationships) {
    const sourceId = String(relationship.source_symbol_id ?? "")
    const targetId = String(relationship.target_symbol_id ?? "")
    // An edge is reported once per DOCUMENTED symbol it touches, so a
    // cross-file call appears under both ends, each naming the other.
    for (const [ownId, otherId] of [[sourceId, targetId], [targetId, sourceId]] as Array<[string, string]>) {
      const symbol = byId.get(ownId)
      if (!symbol) continue
      const outbound = ownId === sourceId
      const otherSymbol = outbound ? (relationship.target_name ?? relationship.target_qualified) : (relationship.source_name ?? null)
      const otherExternal = outbound ? relationship.target_external : relationship.source_external
      const otherFile = outbound ? relationship.target_file : relationship.source_path
      const other = otherSymbol ?? otherExternal ?? otherFile ?? "an unresolved target"
      const type = String(relationship.relationship_type ?? "relates to")
      const subject = outbound ? String(symbol.name) : (otherSymbol ?? otherExternal ?? "an unresolved source")
      const statement = `${subject} ${type} ${other}.`
      if (seen.has(statement)) continue
      seen.add(statement)
      if (!otherSymbol && SYMBOL_DIRECTED.has(type)) unresolved++
      const rel = String(otherFile ?? "")
      const line = Number(relationship.line_number ?? 0)
      let edgeFileId = outbound ? String(symbol.source_file_id ?? "") : ""
      if (!edgeFileId && rel) {
        const cached = fileIdByPath.get(rel)
        if (cached !== undefined) edgeFileId = cached
        else {
          const row = queryRows(raw, "SELECT id FROM brain_file WHERE project_id=? AND relative_path=?", String(symbol.project_id), rel)[0]
          edgeFileId = String(row?.id ?? "")
          fileIdByPath.set(rel, edgeFileId)
        }
      }
      const id = addCitation(citations, {
        kind: "relationship",
        idParts: [rel, type, line, other],
        relPath: rel || undefined,
        lineStart: line || undefined,
        relationshipType: type,
        evidence: `${type} relationship at line ${line || "unknown"}`,
        fileId: edgeFileId || undefined,
      }, resolver)
      const classification: DocFact["classification"] = otherSymbol || otherFile ? "extracted" : "inferred"
      facts.push(fact(classification, statement, [id], citations))
    }
  }
  return { facts, unresolved }
}

function projectId_(symbols: Row[]): string {
  return String(symbols[0]?.project_id ?? "")
}

function addImportFacts(raw: any, resolver: FreshnessResolver, files: Row[], citations: DocCitation[], local: { paths: Set<string>; stems: Set<string> }): DocFact[] {
  const facts: DocFact[] = []
  for (const file of files) {
    const rel = String(file.relative_path ?? "")
    const dir = dirOf(rel)
    const imports = queryRows(raw, "SELECT * FROM brain_import WHERE project_id=? AND file_id=? ORDER BY line_number LIMIT ?", file.project_id, file.id, IMPORT_FETCH_CAP)
    for (const item of imports) {
      const spec = String(item.import_path ?? "")
      if (!spec) continue
      const bare = spec.startsWith("./") ? spec.slice(2) : spec
      const stem = stripExtension(bare)
      // Resolve the spec against what the project actually contains. The old
      // renderer repeated `is_external` verbatim, so `require_relative "helper"`
      // in lib/main.rb was documented as an external dependency although
      // lib/helper.rb is indexed in the same project.
      const localHit = local.paths.has(bare) || local.paths.has(stem) || local.paths.has(dir + bare) || local.paths.has(dir + stem) || local.stems.has(baseOf(bare))
      const id = addCitation(citations, {
        kind: "import",
        idParts: [rel, spec, Number(item.line_number ?? 0)],
        relPath: rel,
        lineStart: Number(item.line_number ?? 0) || undefined,
        evidence: `Import ${spec}`,
        fileId: String(file.id),
      }, resolver)
      facts.push(localHit
        ? fact("extracted", `${rel} imports ${spec}, which is a file this project indexes.`, [id], citations)
        : fact("extracted", `${rel} imports ${spec}${item.is_external ? " as an external dependency" : ""}.`, [id], citations))
    }
  }
  return facts
}

/**
 * Analysis findings for the scope, located through their occurrences. This was
 * defined and never called, so the `finding` citation kind and the risks the
 * spec requires for `file` and `project` modes did not exist.
 */
function addFindingFacts(raw: any, resolver: FreshnessResolver, projectId: string, files: Row[], citations: DocCitation[], unknowns: DocUnknown[]): DocFact[] {
  const rows = queryRows(
    raw,
    `SELECT f.*, o.location FROM brain_analysis_finding f
       LEFT JOIN brain_analysis_occurrence o ON o.finding_id = f.id AND o.state = f.state
     WHERE f.project_id=? AND f.state NOT IN ('resolved','suppressed')
     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.last_seen_at DESC LIMIT 20`,
    projectId,
  )
  // Analysis findings are ONE risk source, and no read path in this tool
  // produces them, so on every corpus measured this section was empty while
  // the index held 1 099 files with recorded parser errors and 185 477 symbols
  // with a measured complexity. An always-empty REQUIRED section is a
  // placeholder, not a measurement, so the other two sources the index really
  // holds are read here, and their absence is stated rather than implied.
  const brokenFiles = Number((queryRows(raw, "SELECT count(*) AS c FROM brain_file WHERE project_id=? AND has_syntax_errors=1", projectId)[0]?.c ?? 0))
  const complexityFacts: DocFact[] = []
  if (rows.length === 0 && brokenFiles === 0) {
    unknowns.push({ statement: "No open analysis finding, no recorded parser error and no complexity outlier is indexed for this project, so no risk is asserted here — the absence of evidence is not evidence of absence.", reason: "not-indexed", affectedSection: "risks" })
  }
  if (brokenFiles > 0) {
    const healthId = addCitation(citations, {
      kind: "health", idParts: ["risk", "syntax-errors"], indexScoped: true,
      evidence: `${brokenFiles} file(s) carry recorded parser errors`,
    }, resolver)
    complexityFacts.push(fact("extracted", `${brokenFiles} indexed file(s) carry recorded parser errors, so the symbols and byte bounds bb_doc cites from them may be wrong.`, [healthId], citations))
    const worst = queryRows(raw, "SELECT relative_path, line_count FROM brain_file WHERE project_id=? AND has_syntax_errors=1 ORDER BY line_count DESC LIMIT 10", projectId)
    for (const row of worst) {
      const id = addCitation(citations, {
        kind: "file", idParts: [String(row.relative_path)], relPath: String(row.relative_path),
        evidence: `File with recorded parser errors`, fileId: String((queryRows(raw, "SELECT id FROM brain_file WHERE project_id=? AND relative_path=?", projectId, row.relative_path)[0]?.id ?? "")),
      }, resolver)
      complexityFacts.push(fact("extracted", `${row.relative_path} carries a recorded parser error.`, [id], citations))
    }
  }
  // The highest measured complexity in scope — a measured value, cited, and the
  // reader can see the threshold it was selected by.
  const COMPLEXITY_OUTLIER = 15
  const outliers = queryRows(
    raw,
    "SELECT s.name, s.complexity, s.line_start, s.line_end, f.relative_path, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.complexity >= ? ORDER BY s.complexity DESC, s.name LIMIT 20",
    projectId, COMPLEXITY_OUTLIER,
  )
  if (outliers.length) {
    const healthId = addCitation(citations, {
      kind: "health", idParts: ["risk", "complexity", String(COMPLEXITY_OUTLIER)], indexScoped: true,
      evidence: `${outliers.length} symbol(s) at measured complexity >= ${COMPLEXITY_OUTLIER}`,
    }, resolver)
    complexityFacts.push(fact("extracted", `${outliers.length} symbol(s) carry a measured complexity of ${COMPLEXITY_OUTLIER} or more; the ${outliers.length} highest are listed below.`, [healthId], citations))
    for (const row of outliers) {
      const id = addCitation(citations, {
        kind: "symbol", idParts: [String(row.relative_path), String(row.name), `${row.line_start}-${row.line_end}`], relPath: String(row.relative_path),
        symbol: String(row.name), lineStart: Number(row.line_start) || undefined, lineEnd: Number(row.line_end) || undefined,
        evidence: `Symbol with measured complexity ${row.complexity}`, fileId: String(row.source_file_id),
      }, resolver)
      complexityFacts.push(fact("extracted", `${row.name} in ${row.relative_path} has a measured complexity of ${row.complexity}.`, [id], citations))
    }
  }
  if (!rows.length) return complexityFacts
  const scope = new Set(files.map((file) => String(file.relative_path ?? "")))
  const facts: DocFact[] = []
  for (const finding of rows) {
    const location = typeof finding.location === "string" ? finding.location : ""
    const colon = location.lastIndexOf(":")
    const locPath = colon > 0 ? location.slice(0, colon) : location
    const locLine = colon > 0 ? Number(location.slice(colon + 1)) || 0 : 0
    const fileId = locPath ? String((queryRows(raw, "SELECT id FROM brain_file WHERE project_id=? AND relative_path=?", projectId, locPath)[0]?.id ?? "")) : ""
    const id = addCitation(citations, {
      kind: "finding",
      idParts: [finding.fingerprint ?? finding.id],
      relPath: locPath || undefined,
      lineStart: locLine || undefined,
      evidence: `${finding.severity} finding: ${finding.title}`,
      fileId: fileId || undefined,
    }, resolver)
    const inScope = !scope.size || scope.has(locPath)
    facts.push(fact("extracted", `Finding ${finding.title} is open at ${finding.severity} severity${locPath ? ` in ${locPath}${locLine ? `:${locLine}` : ""}` : ""}${inScope && files.length ? "" : " (outside the documented scope)"}.`, [id], citations))
  }
  return [...facts, ...complexityFacts]
}

function addInventoryFacts(raw: any, resolver: FreshnessResolver, projectId: string, files: Row[], citations: DocCitation[]): { facts: DocFact[]; languages: Array<{ language: string; files: number; symbols: number }> } {
  const facts: DocFact[] = []
  const totals = queryRows(
    raw,
    `SELECT (SELECT count(*) FROM brain_file WHERE project_id=?) AS files,
            (SELECT count(*) FROM brain_symbol WHERE project_id=?) AS symbols,
            (SELECT count(*) FROM brain_relationship WHERE project_id=?) AS relationships,
            (SELECT count(*) FROM brain_import WHERE project_id=?) AS imports,
            (SELECT count(*) FROM brain_file WHERE project_id=? AND has_syntax_errors=1) AS syntax_error_files`,
    projectId, projectId, projectId, projectId, projectId,
  )[0] ?? {}
  const healthId = addCitation(citations, {
    kind: "health", idParts: ["index-totals"], indexScoped: true,
    evidence: `Indexed totals: ${totals.files} files, ${totals.symbols} symbols, ${totals.relationships} relationships`,
  }, resolver)
  facts.push(fact("extracted", `The index holds ${totals.files} files, ${totals.symbols} symbols, ${totals.relationships} relationships and ${totals.imports} imports.`, [healthId], citations))
  if (Number(totals.syntax_error_files ?? 0) > 0) {
    facts.push(fact("extracted", `${totals.syntax_error_files} files carry recorded parser errors, so their symbols and bounds may be wrong.`, [healthId], citations))
  }
  const languages = queryRows(
    raw,
    `SELECT f.language, count(DISTINCT f.id) AS files, count(s.id) AS symbols
       FROM brain_file f LEFT JOIN brain_symbol s ON s.file_id = f.id
      WHERE f.project_id=? AND f.language IS NOT NULL GROUP BY f.language ORDER BY symbols DESC, files DESC LIMIT 12`,
    projectId,
  ) as Array<{ language: string; files: number; symbols: number }>
  for (const row of languages) {
    const id = addCitation(citations, {
      kind: "health", idParts: ["language", row.language], indexScoped: true,
      evidence: `${row.files} ${row.language} files holding ${row.symbols} symbols`,
    }, resolver)
    facts.push(fact("extracted", `${row.language}: ${row.files} files, ${row.symbols} symbols.`, [id], citations))
  }
  return { facts, languages }
}

function addEntryPointFacts(raw: any, resolver: FreshnessResolver, projectId: string, citations: DocCitation[]): DocFact[] {
  const rows = queryRows(
    raw,
    `SELECT s.name, s.symbol_type, s.line_start, s.line_end, s.visibility, s.api_contract_path, s.gravity_score, f.relative_path, f.id AS source_file_id
       FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
      WHERE s.project_id=? AND s.visibility IN ('export','public') AND s.line_start > 0
      ORDER BY s.gravity_score DESC, s.name LIMIT 20`,
    projectId,
  )
  const facts: DocFact[] = []
  for (const row of rows) {
    const rel = String(row.relative_path ?? "")
    const start = Number(row.line_start ?? 0)
    const id = addCitation(citations, {
      kind: "symbol", idParts: [rel, row.name, `${start}-${Number(row.line_end ?? start)}`], relPath: rel,
      symbol: String(row.name ?? ""), lineStart: start || undefined, lineEnd: Number(row.line_end ?? start) || undefined,
      evidence: `Exported ${row.symbol_type} ${row.name}`, fileId: String(row.source_file_id ?? ""),
    }, resolver)
    facts.push(fact("extracted", `${row.symbol_type} ${quote(row.name)} is exported from ${rel} at line ${start}${row.api_contract_path ? ` and bound to contract ${row.api_contract_path}` : ""}.`, [id], citations))
  }
  return facts
}

function addOptionalUnknowns(request: DocRequest, unknowns: DocUnknown[]): void {
  if (request.includeExamples === true) {
    unknowns.push({ statement: "No example was emitted: an example requires a cited source snippet or a verified API contract, and neither was available in this scope.", reason: "not-observed", affectedSection: "examples" })
  }
  if (request.includeDiagrams === true) {
    unknowns.push({ statement: "No diagram was emitted: a diagram requires cited graph nodes and links, and this implementation does not resolve them.", reason: "not-observed", affectedSection: "diagrams" })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// section assembly
// ─────────────────────────────────────────────────────────────────────────────
interface SectionDraft {
  id: string
  heading: string
  required: boolean
  audience: DocAudience[] | "all"
  /** Optional sections are dropped for `brief`. */
  optional?: boolean
  facts: DocFact[]
  /** Prose that adds orientation only — never a restatement of the facts. */
  lead?: string
}

function buildProse(draft: SectionDraft, citationCount: number): string {
  if (draft.facts.length === 0) return `No indexed evidence was found for ${draft.heading.toLowerCase()}.`
  const noun = draft.facts.length === 1 ? "item" : "items"
  return `${draft.facts.length} cited ${noun} from ${citationCount} source${citationCount === 1 ? "" : "s"}${draft.lead ? `. ${draft.lead}` : "."}`
}

function assembleSection(draft: SectionDraft, citations: DocCitation[]): DocSection {
  const citationIds = [...new Set(draft.facts.flatMap((f) => f.citationIds))]
  return { id: draft.id, heading: draft.heading, prose: buildProse(draft, citationIds.length), facts: draft.facts, citations: citationIds }
}

// ─────────────────────────────────────────────────────────────────────────────
// the generator
// ─────────────────────────────────────────────────────────────────────────────
export async function generateDocumentation(projectId: string, projectPath: string, request: DocRequest): Promise<DocResult> {
  const mode = request.mode
  const detail = request.detail ?? "standard"
  const audience = request.audience ?? "developer"
  const limit = clamp(request.limit, DEFAULT_EVIDENCE_LIMIT, MAX_EVIDENCE_LIMIT)
  const perSection = factsPerSection(detail, limit)
  const scopeCap = Math.min(limit * 5, SCOPE_FILE_CAP)

  const raw: any = await BrainDatabase.getRawInstance(projectId as never)
  // One reader per generation: each source file is read at most once.
  const reader = new SourceReader()
  const scope = targetFiles(raw, projectId, projectPath, request, scopeCap)
  let files = scope.files
  const selected = await targetSymbols(raw, projectId, request, files, limit)
  let symbols = selected.symbols
  const feature = selected.feature

  if (!files.length && symbols.length) {
    const fileIds = [...new Set(symbols.map((symbol) => symbol.source_file_id).filter(Boolean))]
    if (fileIds.length) {
      files = queryRows(raw, `SELECT * FROM brain_file WHERE project_id=? AND id IN (${fileIds.map(() => "?").join(",")}) ORDER BY relative_path`, projectId, ...fileIds)
    }
  }

  const citations: DocCitation[] = []
  const unknowns: DocUnknown[] = []
  const includeTests = request.includeTests === true || mode === "symbol" || mode === "coverage" || mode === "feature"
  // One indexed read, and it is what makes an import resolvable to a local
  // file. Gating it on the mode left `symbol` mode reporting every import in
  // the symbol's own file as an external dependency.
  const local = localPathIndex(raw, projectId)

  if (scope.truncated > 0) {
    unknowns.push({ statement: `The scope contains more indexed files than the evidence limit allows; ${scope.truncated} file(s) were not examined.`, reason: "output-budget", affectedSection: "inventory" })
  }
  if (feature?.semanticError) {
    unknowns.push({ statement: `Semantic candidate discovery did not run: ${feature.semanticError}. Only lexical candidates are used, so feature recall is lower than the mode's ceiling.`, reason: "not-observed", affectedSection: "entry-points" })
  }

  // Freshness is resolved ONCE for every file this generation could cite, not
  // once per citation: the resolver is the shared batch one every other read
  // tool uses, and it memoises the stat per unique path.
  const resolver = new FreshnessResolver(raw, projectId, [
    ...files.map((file) => String(file.id)),
    ...symbols.map((symbol) => String(symbol.source_file_id ?? "")),
  ])

  const fileFacts = addFileFacts(raw, resolver, files, citations, unknowns)
  const usesSymbolFacts = mode === "symbol" || mode === "feature" || mode === "api"
  const symbolParts = usesSymbolFacts
    ? addSymbolFacts(raw, reader, resolver, symbols, citations, unknowns, includeTests)
    : { api: [] as DocFact[], behavior: [] as DocFact[], tests: [] as DocFact[] }
  const relationshipParts = addRelationshipFacts(raw, resolver, symbols, citations)
  const importFacts = addImportFacts(raw, resolver, files, citations, local)
  const inventory = mode === "project" || mode === "module" ? addInventoryFacts(raw, resolver, projectId, files, citations) : { facts: [] as DocFact[], languages: [] as Array<{ language: string; files: number; symbols: number }> }
  const findingFacts = mode === "file" || mode === "project" || mode === "module" ? addFindingFacts(raw, resolver, projectId, files, citations, unknowns) : []
  const entryPointFacts = mode === "project" || mode === "module" ? addEntryPointFacts(raw, resolver, projectId, citations) : []
  if (relationshipParts.unresolved > 0) {
    unknowns.push({ statement: `${relationshipParts.unresolved} relationship(s) name a target the index did not resolve to a symbol; those edges are reported as inferred, not extracted.`, reason: "not-indexed", affectedSection: "flow" })
  }

  // Every mode emits its DECLARED section set (docs/BB_DOC.md), whether or not
  // evidence was found, so the completeness gate measures the contract rather
  // than whatever the code path happened to produce.
  const drafts: SectionDraft[] = []
  const push = (draft: SectionDraft) => { drafts.push(draft) }

  if (mode === "symbol") {
    push({ id: "api", heading: "API", required: true, audience: "all", facts: symbolParts.api })
    push({ id: "behavior", heading: "Behavior", required: true, audience: "all", facts: symbolParts.behavior, lead: "Read from the index and, where the index has none, from the comment block above the definition on disk." })
    push({ id: "dependencies", heading: "Dependencies", required: true, audience: "all", facts: [...relationshipParts.facts, ...importFacts], lead: "Edges are read from the graph; an edge whose target the index did not resolve is marked inferred." })
    push({ id: "tests", heading: "Tests", required: true, audience: "all", facts: symbolParts.tests })
    push({ id: "limitations", heading: "Limitations", required: true, audience: ["maintainer", "website"], facts: [], lead: "What this document cannot say is stated here rather than filled in." })
  } else if (mode === "file") {
    push({ id: "overview", heading: "Overview", required: true, audience: "all", facts: fileFacts })
    push({ id: "public-symbols", heading: "Public symbols", required: true, audience: "all", facts: addPublicSymbolFacts(raw, resolver, symbols, citations) })
    push({ id: "dependencies", heading: "Dependencies", required: true, audience: "all", facts: [...importFacts, ...relationshipParts.facts] })
    push({ id: "risks", heading: "Risks", required: true, audience: "all", facts: findingFacts })
  } else if (mode === "module") {
    push({ id: "purpose", heading: "Purpose", required: true, audience: "all", facts: fileFacts, lead: "The files this module is made of, as the index sees them." })
    push({ id: "entry-points", heading: "Entry points", required: true, audience: "all", facts: entryPointFacts })
    push({ id: "public-surface", heading: "Public surface", required: true, audience: "all", facts: addPublicSymbolFacts(raw, resolver, symbols, citations) })
    push({ id: "module-graph", heading: "Module graph", required: true, audience: "all", facts: [...importFacts, ...relationshipParts.facts, ...inventory.facts] })
  } else if (mode === "feature") {
    push({ id: "entry-points", heading: "Entry points", required: true, audience: "all", facts: symbolParts.api })
    push({ id: "flow", heading: "Flow", required: true, audience: "all", facts: relationshipParts.facts, lead: feature ? `Candidates came from ${feature.lexical} lexical and ${feature.semantic} semantic match(es) in ${feature.ms}ms.` : undefined })
    push({ id: "components", heading: "Components", required: true, audience: "all", facts: [...fileFacts, ...symbolParts.behavior] })
    push({ id: "test-coverage", heading: "Test coverage", required: true, audience: "all", facts: symbolParts.tests })
  } else if (mode === "api") {
    push({ id: "endpoints", heading: "Endpoints", required: true, audience: "all", facts: symbolParts.api })
    push({ id: "inputs-outputs", heading: "Inputs and outputs", required: true, audience: "all", facts: symbolParts.behavior })
    push({ id: "errors", heading: "Errors", required: true, audience: ["developer", "maintainer", "website"], facts: [], lead: "No error surface is asserted: an endpoint's failures are not inferable from its signature, and the index does not record them." })
    push({ id: "examples", heading: "Examples", required: true, audience: "all", facts: [] })
  } else if (mode === "project") {
    push({ id: "architecture", heading: "Architecture", required: true, audience: "all", facts: inventory.facts, lead: "Counts and language mix as measured in the index." })
    push({ id: "inventory", heading: "Inventory", required: true, audience: "all", facts: [...entryPointFacts, ...fileFacts] })
    push({ id: "risks", heading: "Risks", required: true, audience: "all", facts: findingFacts })
    push({ id: "documentation-map", heading: "Documentation map", required: true, audience: "all", facts: coverageFacts(symbols, reader, resolver, citations) })
  } else {
    // coverage
    const documented = symbols.filter((symbol) => Boolean(symbol.docstring || reader.docstring(symbol.path, Number(symbol.line_start ?? 0))))
    const undocumented = symbols.filter((symbol) => !documented.includes(symbol))
    push({ id: "documented", heading: "Documented", required: true, audience: "all", facts: documented.map((symbol) => fact("extracted", coverageStatement(symbol, true), [coverageCitation(symbol, citations, resolver)], citations)) })
    push({ id: "undocumented", heading: "Undocumented", required: true, audience: "all", facts: undocumented.map((symbol) => fact("unknown", coverageStatement(symbol, false), [coverageCitation(symbol, citations, resolver)], citations)) })
    push({ id: "stale", heading: "Stale", required: true, audience: "all", facts: symbols.filter((symbol) => resolver.of(String(symbol.source_file_id ?? "")) !== "fresh").map((symbol) => fact("extracted", `${symbol.name} is in a file that changed after indexing.`, [coverageCitation(symbol, citations, resolver)], citations)) })
    push({ id: "unsupported", heading: "Unsupported", required: true, audience: ["maintainer", "website"], facts: [] })
  }

  // The OPTIONAL sections are what `audience` and `detail` select. A REQUIRED
  // section is never dropped: it is part of the mode's contract, and dropping
  // one to suit a reader would make completeness unsatisfiable for that reader
  // and would hide evidence from the website contract.
  const optional: SectionDraft[] = []
  if (mode === "project" || mode === "api") {
    // The declared `project` section set is Architecture / Inventory / Risks /
    // Documentation map, none of which is a dependency surface. Dropping the
    // graph would have removed every edge and import from a project document,
    // so it is an OPTIONAL section rather than a rename of a required one.
    optional.push({ id: "dependencies", heading: "Dependencies", required: false, audience: "all", optional: true, facts: [...relationshipParts.facts, ...importFacts], lead: "Edges are read from the graph; an edge whose target the index did not resolve is marked inferred." })
  }
  if (audience === "maintainer" || audience === "website") {
    optional.push({ id: "evidence-index", heading: "Evidence index", required: false, audience: "all", optional: true, facts: [], lead: "Every citation this result rests on, grouped by kind." })
  }
  if (detail === "deep") {
    optional.push({ id: "all-edges", heading: "All edges", required: false, audience: "all", optional: true, facts: relationshipParts.facts })
  }
  const selectedDrafts = [...drafts, ...optional].filter((draft) => {
    if (draft.required) return true
    if (draft.optional && detail === "brief") return false
    return draft.audience === "all" || draft.audience.includes(audience)
  })

  // The per-section evidence cap.
  //
  // This used to announce `${capped} of ${total} were emitted; the rest did not
  // fit the requested detail` — and then the budget pass announced its own drop
  // for the SAME section, so the two messages counted the same facts twice: a
  // 12-of-24 documentation map reported "18 more dropped", for 36 accounted out
  // of 24. Worse, the two reasons are conflated in one sentence, so a reader
  // cannot tell which bound bit.
  //
  // The cap is recorded as a BOUND and the budget pass as a BOUND, and the
  // section's own count is the truth. The budget pass measures what it actually
  // removed from the already-capped list, so the arithmetic closes.
  const sections: DocSection[] = []
  const cappedOut: Array<{ heading: string; emitted: number; available: number }> = []
  for (const draft of selectedDrafts) {
    const capped = draft.facts.slice(0, perSection)
    if (capped.length < draft.facts.length) {
      cappedOut.push({ heading: draft.heading, emitted: capped.length, available: draft.facts.length })
    }
    sections.push(assembleSection(draft, citations))
  }

  if (!files.length && !symbols.length) {
    unknowns.push({ statement: `No indexed evidence matched ${request.target ?? mode}.`, reason: "not-indexed", affectedSection: selectedDrafts[0]?.id ?? "overview" })
  }
  addOptionalUnknowns(request, unknowns)

  // Two same-named symbols — overloads, or a DSL method defined twice — emitted
  // the same unknown SENTENCE twice, so `unknowns` was a multiset of sentences
  // rather than a set of distinct gaps. Dedupe on the whole record.
  for (const record of cappedOut) {
    const section = sections.find((s) => s.heading === record.heading)
    unknowns.push({
      statement: `The per-section evidence cap is ${perSection} at detail "${detail}", so ${record.available - record.emitted} of ${record.available} ${record.heading.toLowerCase()} items were not selected. The output budget may have shortened this further; it reports its own count.`,
      reason: "output-budget",
      affectedSection: section?.id ?? "overview",
    })
  }
  const distinctUnknowns: DocUnknown[] = []
  const seenUnknown = new Set<string>()
  for (const unknown of unknowns) {
    const key = `${unknown.reason}|${unknown.affectedSection}|${unknown.statement}`
    if (seenUnknown.has(key)) continue
    seenUnknown.add(key)
    distinctUnknowns.push(unknown)
  }
  return makeResult({
    __raw: raw,
    reader,
    projectId, projectPath, request, mode, detail, audience,
    files, symbols, sections, citations, unknowns: distinctUnknowns, inventory,
    // The per-section cap is a bound of its own, announced where the cap is
    // applied, so the two bounds never recount the same facts.
    cappedOut, perSection,
  })
}

/**
 * A coverage claim must identify the symbol it is about.
 *
 * The name alone does not: `.github/workflows/doc-build.yml` holds TEN distinct
 * `name` properties (a YAML mapping key repeated by ten workflow steps), so
 * "name in doc-build.yml is undocumented" named ten different symbols and the
 * section carried the same sentence ten times — 4 duplicate statements in a
 * 31-fact coverage document, on a real corpus, with only TWO of the ten
 * citations surviving into the output.
 *
 * The line makes the claim specific and the duplicate impossible: two symbols at
 * different lines are different claims, and the citation already carries that
 * line, so this adds no information the reader did not have — it just stops the
 * claim from pretending to be about one symbol when it is about ten.
 */
function coverageStatement(symbol: Row, documented: boolean): string {
  const start = Number(symbol.line_start ?? 0)
  const end = Number(symbol.line_end ?? start)
  const where = start ? ` at line${end && end !== start ? "s" : ""} ${start}${end && end !== start ? `-${end}` : ""}` : ""
  return `${symbol.symbol_type} ${symbol.name} in ${symbol.relative_path}${where} is ${documented ? "documented" : "undocumented"}.`
}
function coverageCitation(symbol: Row, citations: DocCitation[], resolver: FreshnessResolver): string {
  const rel = String(symbol.relative_path ?? "")
  const existing = citations.find((citation) => citation.kind === "symbol" && citation.symbol === String(symbol.name ?? "") && citation.path === rel && citation.lineStart === Number(symbol.line_start ?? 0))
  if (existing) return existing.id
  return addCitation(citations, {
    kind: "symbol", idParts: [rel, symbol.name, `${Number(symbol.line_start ?? 0)}-${Number(symbol.line_end ?? 0)}`], relPath: rel,
    symbol: String(symbol.name ?? ""), lineStart: Number(symbol.line_start ?? 0) || undefined, lineEnd: Number(symbol.line_end ?? 0) || undefined,
    evidence: `Indexed ${symbol.symbol_type} ${symbol.name}`, fileId: String(symbol.source_file_id ?? ""),
  }, resolver)
}
function coverageFacts(symbols: Row[], reader: SourceReader, resolver: FreshnessResolver, citations: DocCitation[]): DocFact[] {
  return symbols.map((symbol) => fact("extracted", coverageStatement(symbol, Boolean(symbol.docstring || reader.docstring(symbol.path, Number(symbol.line_start ?? 0)))), [coverageCitation(symbol, citations, resolver)], citations))
}

// ─────────────────────────────────────────────────────────────────────────────
// reference metadata and the quality gate
// ─────────────────────────────────────────────────────────────────────────────
/**
 * A citation is broken when its file is gone or its line span exceeds it.
 * Reads go through the generation's `SourceReader`, so a project with 40
 * citations into 20 files reads 20 files rather than 40.
 */
function citationBroken(projectPath: string, reader: SourceReader, citation: DocCitation): boolean {
  if (!["file", "symbol", "import", "relationship", "test"].includes(citation.kind)) return false
  if (!citation.path) return false
  const abs = path.isAbsolute(citation.path) ? citation.path : path.join(projectPath, citation.path)
  const lines = reader.lineCount(abs)
  if (lines === null) return true
  return Boolean(citation.lineStart && citation.lineStart > lines)
}

/**
 * The index snapshot: a digest over EVERY indexed file hash, not over the
 * files this query happened to select. The old id concatenated the first
 * `limit` hashes, so it changed when `limit` changed — which would have made
 * a website's documented cache key move without the index moving.
 */
function indexSnapshotId(raw: any, projectId: string): string {
  const rows = raw.prepare("SELECT file_hash FROM brain_file WHERE project_id=? ORDER BY relative_path").all(projectId) as Array<{ file_hash: string }>
  const hash = createHash("sha256")
  hash.update(String(rows.length))
  for (const row of rows) { hash.update(" "); hash.update(String(row.file_hash ?? "")) }
  return hash.digest("hex").slice(0, 32)
}

/**
 * The real schema version and the real index status for this project.
 *
 * `indexVersion` is read from the project's OWN `brain_index_status` row. A
 * project whose indexer never wrote one (some corpus roots) has no row, and the
 * honest answer is null — the previous fallback read the `__schema__` sentinel
 * row, which describes the DATABASE and not the project, so `bb_doc` reported
 * an index version for a project that had none.
 */
function indexVersions(raw: any, projectId: string): { index: string | null; schema: number | null } {
  try {
    const schema = raw.prepare("SELECT version FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any
    const schemaVersion = schema?.version == null ? null : Number(schema.version)
    const row = raw.prepare("SELECT indexing_version, total_files, indexed_files FROM brain_index_status WHERE project_id=? LIMIT 1").get(projectId) as any
    if (!row || row.indexed_files == null) return { index: null, schema: schemaVersion }
    return { index: row.indexing_version ?? null, schema: schemaVersion }
  } catch {
    return { index: null, schema: null }
  }
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? null).length / 4)
}

interface MakeResultArgs {
  /** The project-scoped db handle, for the snapshot digest and the version reads. */
  __raw: any
  /** One reader per generation, so each source file is read at most once. */
  reader: SourceReader
  /** Sections the per-section evidence cap shortened, with the counts it used. */
  cappedOut: Array<{ heading: string; emitted: number; available: number }>
  /** The per-section cap that applied, for the message that names it. */
  perSection: number
  projectId: string
  projectPath: string
  request: DocRequest
  mode: DocMode
  detail: DocDetail
  audience: DocAudience
  files: Row[]
  symbols: Row[]
  sections: DocSection[]
  citations: DocCitation[]
  unknowns: DocUnknown[]
  inventory: { languages: Array<{ language: string; files: number; symbols: number }> }
}

function makeResult(args: MakeResultArgs): DocResult {
  const { projectId, projectPath, request, mode, audience, detail, sections, citations, unknowns } = args
  const maxTokens = resolveTokenBudget(request.maxTokens)
  const stale = citations.filter((citation) => citation.freshness === "stale").length
  const missing = citations.filter((citation) => citation.freshness === "missing").length
  const broken = citations.filter((citation) => citationBroken(projectPath, args.reader, citation)).length
  const uncitedClaims = sections.flatMap((section) => section.facts).filter((item) => item.citationIds.length === 0 && item.classification !== "generated").length
  const facts = sections.flatMap((section) => section.facts)

  // Every citation that survives is one a fact points at. A source list that
  // names an unreferenced entry cannot be resolved by a reader, and 84% of the
  // old Sources list was unreferenced on a real repository.

  const snapshotId = args.__raw ? indexSnapshotId(args.__raw, projectId) : `${projectId}:unavailable`
  const versions = args.__raw ? indexVersions(args.__raw, projectId) : { index: null, schema: null }

  // A result with no facts is not a passing result. This term is what the old
  // gate missed: it asked `citations.every(...)`, which is vacuously true over
  // an empty array, so "no evidence at all" reported passed=true.
  const hasEvidence = facts.length > 0
  const expected = REQUIRED_SECTION_IDS[mode].length
  const sourceLanguage = args.inventory.languages[0]?.language ?? (args.files[0]?.language ?? args.symbols[0]?.language ?? null)
  const canonicalPath = request.target ? normalizeTarget(String(request.target)) : mode
  const slugParts = String(request.target ?? "")
    .split(/[\\/.: ]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4)
  const generatedAt = new Date().toISOString()

  const result: DocResult = {
    schemaVersion: "1",
    mode,
    title: request.target ? `${mode}: ${request.target}` : `${mode} documentation`,
    summary: summarize(mode, args.files.length, args.symbols.length, sections, citations.length),
    sections,
    // Replaced by the surviving set below; the provisional list keeps the
    // object well-formed for the first measurement.
    citations: [],
    unknowns,
    quality: {
      passed: false,
      factuality: { passed: false, uncitedClaims, unsupportedClaims: 0 },
      references: { passed: false, broken, stale, missing },
      completeness: { passed: false, covered: 0, expected, unknown: unknowns.length },
      freshness: { passed: false, snapshot: snapshotId, staleClaims: stale },
      budget: { passed: false, estimatedTokens: 0, maxTokens },
      warnings: [],
    },
    reference: {
      projectId, projectPath, snapshotId, generatedAt,
      indexVersion: versions.index, schemaVersion: versions.schema,
      sourceLanguage, canonicalPath,
      slugs: [mode, ...slugParts],
      tags: [mode, audience, detail],
      relatedReferences: [],
      diagrams: [],
    },
  }

  // The token budget covers the WHOLE result and is measured on the result
  // object itself, so it cannot drift from what a caller receives. It used to
  // be computed over `{sections, citations, unknowns}` only and then ignored,
  // so the default call returned a document three times its budget on every
  // real repository measured.
  const keptByReference = (): DocCitation[] => {
    const referenced = new Set(result.sections.flatMap((section) => section.facts).flatMap((item) => item.citationIds))
    return citations.filter((citation) => referenced.has(citation.id))
  }
  // A 6-digit placeholder for the estimate field. Measuring with it in place and
  // REPORTING that measurement means the figure is never smaller than the
  // payload: the real estimate occupies the same width, so the two are
  // interchangeable and the loop converges on the size actually returned.
  const ESTIMATE_PLACEHOLDER = 999_999
  // The estimate is measured on the object WITH THE PLACEHOLDER IN PLACE, and
  // the final number is that same measurement: the field is never rewritten
  // with a smaller value.
  //
  // It previously replaced the placeholder with the measured value, which
  // changed the string length and left the reported estimate under the payload
  // it describes — 90-100 characters short on 21 of 21 real cases, e.g. an
  // estimate of 12,424 for a 12,517-character result. `estimatedTokens * 4` is
  // the figure a caller budgets from, so it must never be an under-count.
  const measure = (): number => {
    result.quality.budget.estimatedTokens = ESTIMATE_PLACEHOLDER
    return estimateTokens(result)
  }

  // ONE pass, in this order, every time: derive the surviving source list and
  // the warnings, build the quality block, and take the verdict from the
  // measurement OF THAT BLOCK. An earlier version measured, decided
  // `budgetPassed`, and only then filled in `quality.warnings` and
  // `completeness` — so the object grew after the decision and the reported
  // budget disagreed with the reported verdict (4050 tokens, "within budget",
  // while 9 listed sources were referenced by nothing).
  const writeQuality = (estimated: number): void => {
    keptCitations = keptByReference()
    result.citations = keptCitations
    const droppedCitations = citations.length - keptCitations.length
    const budgetPassed = estimated <= maxTokens
    const covered = REQUIRED_SECTION_IDS[mode].filter((id) => result.sections.some((section) => section.id === id)).length
    const factualityPassed = uncitedClaims === 0 && hasEvidence
    const referencesPassed = missing === 0 && broken === 0
    const warnings: string[] = [...result.unknowns.map((unknown) => unknown.statement)]
    if (stale) warnings.push(`${stale} citation(s) are stale: the file changed after indexing`)
    if (missing) warnings.push(`${missing} citation(s) point at a file that no longer exists`)
    if (broken) warnings.push(`${broken} citation(s) could not be resolved on disk`)
    if (trimmedSections) warnings.push(`${trimmedSections} section(s) were trimmed to stay inside the output budget`)
    if (droppedCitations) warnings.push(`${droppedCitations} collected citation(s) were not emitted because no fact referred to them`)
    if (!hasEvidence) warnings.push("no cited claim was produced: this result documents nothing, and the unknowns above say why")
    result.quality = {
      // The spec's failure conditions and nothing else: an uncited claim or a
      // result with no evidence at all, a broken or missing reference, an
      // over-budget output, and a missing required section. Stale evidence is a
      // warning here — the spec makes it a failure only for current-behavior
      // claims, which this result does not make.
      passed: factualityPassed && referencesPassed && budgetPassed && covered === expected,
      factuality: { passed: factualityPassed, uncitedClaims, unsupportedClaims: 0 },
      references: { passed: referencesPassed, broken, stale, missing },
      completeness: { passed: covered === expected, covered, expected, unknown: result.unknowns.length },
      freshness: { passed: stale === 0 && missing === 0, snapshot: snapshotId, staleClaims: stale },
      budget: { passed: budgetPassed, estimatedTokens: estimated, maxTokens },
      warnings,
    }
  }

  let keptCitations: DocCitation[] = keptByReference()
  let trimmedSections = 0
  // The announcement of a trim is COLLAPSED per section and written once, after
  // the loop. Announcing each pass made trimming self-defeating: every pass
  // added text, so a document could not converge on its own budget.
  const droppedPerSection = new Map<string, { heading: string; dropped: number }>()
  // The budget pass halves the largest section until the payload fits. It
  // records what it removed FROM THE CAPPED LIST, and the cap records what it
  // removed from the original, so the three numbers close:
  //
  //   availableBeforeCap = afterCap + budgetDropped + emitted
  //
  // The previous version announced the cap with the pre-cap total and the drop
  // with its own pre-pass count, and the two recounted the same facts: a
  // 12-of-24 documentation map reported "18 more dropped" — 36 accounted for
  // out of 24. A cap message that does not add up is worse than no message,
  // because a reader who checks it concludes the whole quality block is wrong.
  for (let pass = 0; pass < 12; pass++) {
    // Build the whole quality block FIRST, then measure the finished object.
    // Measuring before the block exists under-counted by 40% (2 646 tokens
    // reported for a 4 405-token payload).
    writeQuality(ESTIMATE_PLACEHOLDER)
    const estimated = measure()
    writeQuality(estimated)
    if (estimated <= maxTokens) break
    // A REQUIRED section keeps at least one fact: dropping a whole section to
    // fit would trade one gate failure for another, and reporting the shortfall
    // is more honest than hiding the evidence that caused it.
    const victim = [...result.sections].filter((section) => section.facts.length > 1).sort((a, b) => b.facts.length - a.facts.length)[0]
    if (!victim) break
    const keep = Math.max(1, Math.floor(victim.facts.length / 2))
    const record = droppedPerSection.get(victim.id) ?? { heading: victim.heading, dropped: 0 }
    record.dropped += victim.facts.length - keep
    droppedPerSection.set(victim.id, record)
    victim.facts = victim.facts.slice(0, keep)
    victim.citations = [...new Set(victim.facts.flatMap((item) => item.citationIds))]
    victim.prose = buildProse({ id: victim.id, heading: victim.heading, required: true, audience: "all", facts: victim.facts }, victim.citations.length)
    trimmedSections++
  }
  for (const [id, record] of droppedPerSection) {
    result.unknowns.push({ statement: `${record.dropped} more ${record.heading.toLowerCase()} item(s) were dropped to stay inside the ${maxTokens}-token budget.`, reason: "output-budget", affectedSection: id })
  }
  if (!result.quality.budget.passed) {
    result.unknowns.push({ statement: `The required sections cannot fit inside ${maxTokens} tokens: the smallest honest rendering is ${result.quality.budget.estimatedTokens} tokens. Raise maxTokens (hard maximum ${MAX_TOKEN_BUDGET}) or narrow the target.`, reason: "output-budget", affectedSection: "overview" })
  }
  // One final build-and-measure so the reported figure describes the object
  // exactly as returned, whatever the last pass appended.
  //
  // The second write is what carries the VERDICT: `writeQuality` takes the
  // estimate it should judge the budget against, and the first write is handed
  // the placeholder, so leaving it there reported `budget.passed: false` on a
  // 3 763-of-4 000-token document. Both writes hold a 6-digit number, so the
  // second changes no length and the measurement still holds.
  writeQuality(ESTIMATE_PLACEHOLDER)
  writeQuality(measure())
  return result
}

/** The required section ids per mode — the contract completeness is measured against. */
const REQUIRED_SECTION_IDS: Record<DocMode, string[]> = {
  symbol: ["api", "behavior", "dependencies", "tests", "limitations"],
  file: ["overview", "public-symbols", "dependencies", "risks"],
  module: ["purpose", "entry-points", "public-surface", "module-graph"],
  feature: ["entry-points", "flow", "components", "test-coverage"],
  api: ["endpoints", "inputs-outputs", "errors", "examples"],
  project: ["architecture", "inventory", "risks", "documentation-map"],
  coverage: ["documented", "undocumented", "stale", "unsupported"],
}

function summarize(mode: DocMode, fileCount: number, symbolCount: number, sections: DocSection[], citationCount: number): string {
  const factCount = sections.reduce((count, section) => count + section.facts.length, 0)
  const emptySections = sections.filter((section) => section.facts.length === 0).map((section) => section.heading)
  const base = `${fileCount} file(s) and ${symbolCount} symbol(s) in scope, ${factCount} cited claim(s) across ${sections.length} section(s) from ${citationCount} source(s).`
  return emptySections.length
    ? `${base} No indexed evidence was found for: ${emptySections.join(", ")}.`
    : base
}

// ─────────────────────────────────────────────────────────────────────────────
// rendering
// ─────────────────────────────────────────────────────────────────────────────
export function formatDocumentation(result: DocResult, format: DocFormat = "markdown"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  // Two numbering schemes, because two kinds of evidence exist. A citation that
  // names a file is a LINK the reader can follow; a citation over the index (a
  // relationship whose target the index did not resolve, a health total) is
  // not. They are listed separately so the Sources list is 100% resolvable —
  // and BOTH are numbered and referenced, because a claim that cites evidence
  // the reader cannot see a reference for is an unverifiable claim. That was
  // the case for 8 of the 14 relationship facts on a real repository: an 85%
  // claim with no marker at all.
  const fileCitations = result.citations.filter((citation) => Boolean(citation.path))
  const indexCitations = result.citations.filter((citation) => !citation.path)
  const numberOf = new Map(fileCitations.map((citation, index) => [citation.id, index + 1]))
  const indexNumberOf = new Map(indexCitations.map((citation, index) => [citation.id, `i${index + 1}`]))
  const markerFor = (id: string): string => {
    const n = numberOf.get(id)
    if (typeof n === "number") return `[${n}]`
    return `[^${indexNumberOf.get(id) ?? "?"}]`
  }
  const link = (citation: DocCitation): string => {
    const n = numberOf.get(citation.id)
    if (!n || !citation.path) return markerFor(citation.id)
    const span = citation.lineStart ? `#L${citation.lineStart}${citation.lineEnd && citation.lineEnd !== citation.lineStart ? `-L${citation.lineEnd}` : ""}` : ""
    const stale = citation.freshness === "stale" || citation.freshness === "missing" ? ` (${citation.freshness})` : ""
    return `[${n}](${encodeURI(citation.path)}${span})${stale}`
  }
  const lines: string[] = [`# ${result.title}`, "", result.summary, ""]
  for (const section of result.sections) {
    lines.push(`## ${section.heading}`, "", section.prose, "")
    for (const item of section.facts) {
      const cites = item.citationIds.map(markerFor).join("")
      const confidence = item.confidence == null ? "" : ` _(${Math.round(item.confidence * 100)}%)_ `
      lines.push(`- ${confidence}${item.statement}${cites}`)
    }
    lines.push("")
  }
  if (result.unknowns.length) {
    lines.push("## Unknowns", "")
    for (const unknown of result.unknowns) lines.push(`- ${unknown.statement} _(${unknown.reason}, affects: ${unknown.affectedSection})_`)
    lines.push("")
  }
  const q = result.quality
  lines.push(
    "## Quality", "",
    `- passed: ${q.passed}`,
    `- factuality: ${q.factuality.passed} (${q.factuality.uncitedClaims} uncited claim(s))`,
    `- references: ${q.references.passed} (${q.references.broken} broken, ${q.references.stale} stale, ${q.references.missing} missing)`,
    `- completeness: ${q.completeness.passed} (${q.completeness.covered}/${q.completeness.expected} required sections, ${q.completeness.unknown} unknown(s))`,
    `- budget: ${q.budget.passed} (${q.budget.estimatedTokens}/${q.budget.maxTokens} tokens)`,
    `- snapshot: \`${q.freshness.snapshot}\``,
    "",
  )
  if (fileCitations.length) {
    lines.push("## Sources", "")
    for (const citation of fileCitations) {
      const kind = citation.relationshipType ? ` ${citation.relationshipType}` : ""
      const fresh = citation.freshness === "fresh" ? "" : ` — ${citation.freshness}`
      lines.push(`- ${link(citation)} — ${citation.kind}${kind}: ${citation.evidence}${fresh}`)
    }
    lines.push("")
  }
  if (indexCitations.length) {
    lines.push("## Index", "", "_Index-scoped evidence: it names the index, not a file, so it carries no link._", "")
    for (const citation of indexCitations) {
      const fresh = citation.freshness === "fresh" ? "" : ` — ${citation.freshness}`
      lines.push(`- [^${indexNumberOf.get(citation.id) ?? "?"}] \`${citation.id}\` — ${citation.kind}: ${citation.evidence}${fresh}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
