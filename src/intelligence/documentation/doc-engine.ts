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
  /**
   * The two evidence bounds, per section, as numbers rather than as prose.
   *
   * The per-section cap was reported in a sentence and never applied, so the
   * sentence was the only description of it and it was false. Publishing the
   * arithmetic makes the claim checkable by a consumer and by the gate:
   * `emitted + droppedForBudget === capped`, and `emitted` is the section's real
   * fact count. `available` is what the section had before any bound.
   */
  bounds: {
    perSection: number
    sections: Array<{ id: string; available: number; capped: number; droppedForBudget: number; emitted: number }>
  }
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
    // Two disjoint routes to the same surface, because only one of them has ever
    // matched anything: a declared contract or a route-ish symbol type, and a
    // symbol the index attributes to a file it marks as an HTTP framework. The
    // first was empty on all 8 measured corpora; the second is not.
    const placeholders = HTTP_FRAMEWORK_TYPES.map(() => "?").join(",")
    return {
      symbols: queryRows(
        raw,
        `SELECT s.*, f.path, f.relative_path, f.id AS source_file_id, f.framework_type FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
         WHERE s.project_id=?
           AND (s.api_contract_path IS NOT NULL
                OR lower(s.symbol_type) IN ('route','endpoint','controller')
                OR (f.framework_type IN (${placeholders}) AND lower(s.symbol_type) IN ('function','method')))
           AND s.visibility IN ('export','public')
           AND (?='' OR s.api_contract_path=? OR f.relative_path=? OR f.relative_path LIKE ?) ORDER BY f.relative_path, s.line_start LIMIT ?`,
        projectId, ...HTTP_FRAMEWORK_TYPES, target, target, target, `${normalizeTarget(target)}/%`, limit,
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
      unknowns.push({ statement: `Syntax validity for ${rel} is unknown because the index recorded parser errors, so its symbols and byte bounds may be wrong.`, reason: "not-observed", affectedSection: concern("syntax") })
    }
    const freshness = resolver.of(String(file.id))
    if (freshness === "stale") {
      unknowns.push({ statement: `Current source for ${rel} cannot be confirmed: the file changed after indexing.`, reason: "stale-evidence", affectedSection: concern("freshness") })
    } else if (freshness === "missing") {
      unknowns.push({ statement: `${rel} is indexed but no longer exists on disk.`, reason: "not-indexed", affectedSection: concern("freshness") })
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
/**
 * How a signature is rendered when the index records no parameter list.
 *
 * `name()` is a CLAIM that the symbol takes no arguments, and where the index
 * has no parameter list that claim is false. Measured across six languages by
 * reading the declaration off disk for every sampled symbol whose `parameters`
 * column is empty: **1 218 of 1 218 have a real parameter list** (excluding
 * declarations whose list is genuinely empty or C's explicit `(void)`).
 * Concrete: `Malloc(size_t size)` in a C header rendered as `Malloc()`,
 * `application(app)` in Ruby as `application()`, `empty?(head, tail)` in Ruby
 * as `empty?()`. 842 Ruby callables, 1 681 Perl, and every C and C++ header
 * declaration the analyzer does not record are affected.
 *
 * So an absent list renders as an absent list — the parentheses are omitted
 * rather than emptied — and the caller says the arguments are not described.
 * This is the same asymmetry the return type already had: an absent
 * `return_type` produced no clause, while an absent `parameters` produced one.
 */
/**
 * Symbol kinds that take arguments, so a missing parameter list is a GAP in the
 * document rather than the expected shape of the symbol.
 *
 * Measured across the eight indexed corpora, by counting how often each symbol
 * type carries a parameter list at all: `function` 14 267 of 80 047 do not,
 * `method` 2 702 of 42 177, `constructor` 188 of 1 351, `macro` none. Every
 * other type is empty by nature and stays empty — `constant` 62 031,
 * `property` 59 280, `enum_member` 28 844, `variable` 24 280, `type` 12 470,
 * `class` 12 335, `struct` 8 841, `module` 7 334, `interface` 1 025 — and a
 * caveat attached to those would be nonsense, since a field or a class does not
 * take arguments. `property` is 99% empty and `function` only 18%, so the two
 * cannot be lumped together.
 */
const CALLABLE_SYMBOL_TYPES: ReadonlySet<string> = new Set(["function", "method", "constructor", "macro"])

function renderSignature(kind: string, name: string, parameters: string | null): string {
  return parameters === null ? `${kind} ${name}` : `${kind} ${name}(${parameters})`
}

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

function addSymbolFacts(raw: any, reader: SourceReader, resolver: FreshnessResolver, symbols: Row[], citations: DocCitation[], unknowns: DocUnknown[], includeTests: boolean, includeLimitations: boolean): { api: DocFact[]; behavior: DocFact[]; tests: DocFact[]; limitations: DocFact[] } {
  const api: DocFact[] = []
  const behavior: DocFact[] = []
  const tests: DocFact[] = []
  // The `limitations` section used to be a literal `facts: []` behind a
  // reassuring lead, so it was empty in 100% of cases on every corpus and every
  // detail level, and nothing said why. It is now built from the SAME branch
  // that decides each gap, so the section and the note cannot disagree: there is
  // no second measurement to drift, and no limit asserted without a citation.
  const limitations: DocFact[] = []
  const syntaxErrorFiles = includeLimitations
    ? new Map(queryRows(raw, "SELECT id, relative_path, error_report FROM brain_file WHERE project_id=? AND has_syntax_errors=1", symbols[0]?.project_id ?? "")
        .map((row) => [String(row.id), row] as const))
    : new Map<string, Row>()
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
    const signature = renderSignature(String(symbol.symbol_type), String(symbol.name), parameters)
    const returns = symbol.return_type ? `: ${collapse(symbol.return_type)}` : ""
    // The caveat rides on the signature itself, not in a separate fact and not
    // only in `limitations`: this fact is rendered as symbol mode's API and as
    // feature mode's Entry points, and a bare `name` with no clause anywhere
    // beside it is how a reader concludes the symbol takes no arguments. One
    // sentence, on the line where the misreading would happen.
    const noArgs = parameters === null && CALLABLE_SYMBOL_TYPES.has(String(symbol.symbol_type).toLowerCase())
      ? "; the index records no parameter list for it, so its arguments are not described here"
      : ""
    api.push(fact("extracted", `${signature}${returns} is defined in ${rel} at lines ${start}-${end}${noArgs}.`, [id], citations))
    if (symbol.api_contract_path) api.push(fact("extracted", `${symbol.name} is bound to the API contract ${symbol.api_contract_path}.`, [id], citations))
    if (symbol.visibility) api.push(fact("extracted", `${symbol.name} is declared ${symbol.visibility}.`, [id], citations))

    // The parameters belong here, not only inside the signature rendered into
    // the `api` section: `inputs-outputs` is handed these facts, and it was
    // reporting "returns void" while never stating what the function takes, so
    // the section named for inputs said nothing about them.
    const takes = parameters ? `, takes ${parameters}` : ""
    behavior.push(fact("extracted", `${symbol.name} is defined in ${rel} at line ${start}${takes}${symbol.return_type ? ` and returns ${collapse(symbol.return_type)}` : ""}.`, [id], citations))
    const docstring = symbol.docstring || reader.docstring(symbol.path, start)
    if (docstring) {
      const from = symbol.docstring ? "the index" : "the source file on disk"
      behavior.push(fact("extracted", `Its documentation (${from}) says: ${collapse(docstring)}`, [id], citations))
    } else {
      unknowns.push({ statement: `No docstring was indexed for ${symbol.name} and none is present in the comment style this tool reads.`, reason: "not-observed", affectedSection: concern("docstring") })
      if (includeLimitations) {
        // "Has no documentation" and "this tool cannot see its documentation"
        // are different claims, and the language's own comment marker is what
        // tells them apart. Reporting the second as the first is a false
        // negative about the code, produced by a limit of the reader.
        const language = String(symbol.language ?? "").toLowerCase()
        const marker = UNREADABLE_COMMENT_MARKERS[language]
        limitations.push(marker === undefined
          ? fact("extracted", `${symbol.name} has no indexed docstring, and ${language || "this language"} uses a comment marker this tool's source reader does read, so the absence of documentation is a finding about the code.`, [id], citations)
          : fact("extracted", `${symbol.name} has no indexed docstring, but ${language} documentation is written with "${marker}" and this tool's source reader reads only ${READABLE_COMMENT_MARKERS.join(", ")} — whether it is documented is unverified, not absent.`, [id], citations))
      }
    }
    if (includeLimitations) {
      const freshness = resolver.of(String(symbol.source_file_id ?? ""))
      if (freshness !== "fresh") {
        limitations.push(fact("extracted", `${rel} is ${freshness === "stale" ? "changed on disk since it was indexed" : freshness === "missing" ? "indexed but no longer present on disk" : "not among the files whose freshness could be resolved"}, so every statement about ${symbol.name} here describes the indexed state rather than the current source.`, [id], citations))
      }
      const broken = syntaxErrorFiles.get(String(symbol.source_file_id ?? ""))
      if (broken) {
        const brokenId = addCitation(citations, {
          kind: "file", idParts: [String(broken.relative_path ?? "")], relPath: String(broken.relative_path ?? ""),
          evidence: `Indexed with parser errors: ${String(broken.error_report ?? "errors recorded")}`.slice(0, 300),
          fileId: String(broken.id ?? ""),
        }, resolver)
        limitations.push(fact("extracted", `${rel} is indexed with parser errors, so ${symbol.name}'s symbol bounds and any relationship touching it may be wrong.`, [brokenId], citations))
      }
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
            reason: "not-observed", affectedSection: concern("tests"),
          })
          if (includeLimitations) {
            limitations.push(fact("extracted", testFiles.length
              ? `${testFiles.length} test file(s) are indexed in this project and none names ${symbol.name}, so its test coverage is unestablished rather than absent.`
              : `No test file is indexed in this project, so ${symbol.name} cannot be checked for test coverage at all.`, [id], citations))
          }
        }
      }
    }
  }
  return { api, behavior, tests, limitations }
}

/**
 * One honest statement per endpoint.
 *
 * Selecting every exported symbol of an HTTP-attributed file was wrong in a way
 * only a real repository showed: measured on go_tools, the 25 `net_http` files
 * hold 281 exported symbols, of which 121 are property accessors, 25 are module
 * declarations, 19 are structs, 18 are variables and 3 are interfaces. A section
 * called Endpoints reported `module blog()` and `struct Config()` as endpoints,
 * which is the name-against-content defect this review exists to remove.
 *
 * So a symbol reaches this section only if the index gives it an authoritative
 * route signal (a contract path, or a route/endpoint/controller type) or it is
 * callable in a file the index attributes to an HTTP framework. And every
 * statement says what the index does and does not record about the route: the
 * framework attribution is a property of the FILE, so it establishes that the
 * file is on an HTTP surface, not that any particular symbol answers a request.
 */
function addEndpointFacts(symbols: Row[], citations: DocCitation[], resolver: FreshnessResolver): DocFact[] {
  const facts: DocFact[] = []
  for (const symbol of symbols) {
    const rel = String(symbol.relative_path ?? "")
    const start = Number(symbol.line_start ?? 0)
    const end = Number(symbol.line_end ?? start)
    const parameters = formatParameters(symbol.parameters)
    const signature = renderSignature(String(symbol.symbol_type), String(symbol.name), parameters)
    const framework = String(symbol.framework_type ?? "")
    const id = addCitation(citations, {
      kind: "symbol", idParts: [rel, symbol.name, `${start}-${end}`], relPath: rel, symbol: String(symbol.name ?? ""),
      lineStart: start || undefined, lineEnd: end || undefined,
      evidence: `${symbol.symbol_type} ${symbol.name} in ${rel}${framework ? ` (index framework: ${framework})` : ""}`,
      fileId: String(symbol.source_file_id ?? ""),
    }, resolver)
    if (symbol.api_contract_path) {
      facts.push(fact("extracted", `${signature} is defined in ${rel} at lines ${start}-${end} and is bound to the API contract ${symbol.api_contract_path}.`, [id], citations))
      continue
    }
    if (framework) {
      const noArgs = parameters === null ? " The index records no parameter list for it either, so the inputs this endpoint accepts are not described." : ""
      // An endpoint is callable by construction here — the selection admits only
      // a route-signalled symbol or a function/method — so no type test is needed.
      facts.push(fact("extracted", `${signature} is defined in ${rel} at lines ${start}-${end}, in a file the index attributes to the HTTP framework ${framework}. The index records no method, path or route for it, so the endpoint it answers cannot be named.${noArgs}`, [id], citations))
      continue
    }
    // The selection admits `controller` as well as `route` and `endpoint`, so
    // this must not claim the symbol IS a route: it says the index typed it as
    // route-bearing and that the request it answers is not recorded.
    facts.push(fact("extracted", `${signature} is defined in ${rel} at lines ${start}-${end} and the index types it ${String(symbol.symbol_type)}, one of the types it records for a route-bearing symbol. No method or path is recorded for it.`, [id], citations))
  }
  return facts
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
    unknowns.push({ statement: "No open analysis finding, no recorded parser error and no complexity outlier is indexed for this project, so no risk is asserted here — the absence of evidence is not evidence of absence.", reason: "not-indexed", affectedSection: concern("risk") })
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
    unknowns.push({ statement: "No example was emitted: an example requires a cited source snippet or a verified API contract, and neither was available in this scope.", reason: "not-observed", affectedSection: concern("examples") })
  }
  if (request.includeDiagrams === true) {
    unknowns.push({ statement: "No diagram was emitted: a diagram requires cited graph nodes and links, and this implementation does not resolve them.", reason: "not-observed", affectedSection: concern("diagrams") })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// section assembly
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Exported, with `explainEmptyRequiredSections` and
 * `assertUnknownsNameRenderedSections`, so the gate can prove each guard can
 * actually fail. A guard that is only ever exercised by the code it guards
 * cannot be evidence about that code: it would pass if it were `return`.
 */
export interface SectionDraft {
  id: string
  heading: string
  required: boolean
  audience: DocAudience[] | "all"
  /** Optional sections are dropped for `brief`. */
  optional?: boolean
  facts: DocFact[]
  /** Prose that adds orientation only — never a restatement of the facts. */
  lead?: string
  /**
   * What this section would have contained, stated as a search that was run and
   * came back empty — never "no data available".
   *
   * Every REQUIRED section declares one, and `explainEmptyRequiredSections`
   * throws if a required section renders empty with neither a fact nor a note:
   * a section wired to a source nothing produces is indistinguishable from a
   * measurement that found nothing, and that is how `Risks` shipped empty on
   * every corpus and eight more sections audited empty in 100% of cases.
   */
  emptyExplanation?: string
}

/**
 * Every rendered required section that has no facts must say why, in its own
 * words, naming the section it applies to.
 *
 * This is the sweep that makes the rule structural instead of per-mode: a
 * required section cannot reach a reader unexplained, and a new mode or a
 * renamed section fails here rather than quietly shipping a placeholder.
 */
export function explainEmptyRequiredSections(sections: DocSection[], drafts: SectionDraft[], unknowns: DocUnknown[], explaining?: Map<string, Set<UnknownConcern | "declared">>): void {
  for (const draft of drafts) {
    if (!draft.required) continue
    const section = sections.find((item) => item.id === draft.id)
    // The RENDERED section is the truth here, not the draft: the draft is capped
    // on its way into the section, so a draft with facts can still render empty.
    if (!section || section.facts.length > 0) continue
    const reasons = explaining?.get(section.id)
    if (reasons && [...reasons].some((reason) => reason === "declared" || EMPTINESS_EXPLAINING.has(reason))) continue
    if (explaining === undefined && unknowns.some((unknown) => unknown.affectedSection === section.id)) continue
    if (draft.emptyExplanation === undefined) {
      throw new Error(`bb_doc: required section "${draft.id}" can render empty and declares no emptyExplanation, so it would ship unexplained. Every required section must state what would have filled it.`)
    }
    unknowns.push({ statement: draft.emptyExplanation, reason: "not-indexed", affectedSection: section.id })
  }
}

/**
 * The comment markers this tool's source reader recognises.
 *
 * A doc comment written with any other marker is invisible to the reader, so a
 * symbol whose only documentation uses one is counted as undocumented by a
 * measurement that could not have seen it. That is a false negative about the
 * CODE, produced by a limit of this tool, and the `unsupported` section is where
 * it belongs. The analyzer lane owns the other markers; this is the honest
 * statement of what the reader does with.
 */
const READABLE_COMMENT_MARKERS = ["/**", "*", "//"] as const

/** Line-comment marker per language whose doc comments this reader cannot see. */
const UNREADABLE_COMMENT_MARKERS: Record<string, string> = {
  python: "#", ruby: "#", bash: "#", shell: "#", yaml: "#", toml: "#", perl: "#", r: "#",
  lua: "--", sql: "--", haskell: "--", ada: "--", vhdl: "--",
  clojure: ";", lisp: ";", assembly: ";", vb: "'", erlang: "%", tex: "%",
}

/**
 * What this tool could not measure about a coverage scope.
 *
 * Two real sources, both cited:
 *  1. files the index recorded parser errors for, whose symbols and byte bounds
 *     may be wrong, so their documentation verdict is unreliable;
 *  2. symbols in a language whose comment marker the reader does not read and
 *     which the analyzer left without a docstring — the verdict "undocumented"
 *     is then a statement about the reader, not about the code.
 */
function unsupportedFacts(symbols: Row[], files: Row[], reader: SourceReader, citations: DocCitation[], resolver: FreshnessResolver): DocFact[] {
  const facts: DocFact[] = []
  const broken = files.filter((row) => Boolean(row.has_syntax_errors))
  for (const row of broken.slice(0, 3)) {
    const rel = String(row.relative_path ?? "")
    const id = addCitation(citations, {
      kind: "file", idParts: [rel], relPath: rel,
      evidence: `Indexed with parser errors: ${String(row.error_report ?? "errors recorded")}`.slice(0, 300),
      fileId: String(row.id ?? ""),
    }, resolver)
    facts.push(fact("extracted", `${rel} is indexed with parser errors (${String(row.error_report ?? "no report stored").slice(0, 120)}), so its symbols and byte bounds may be wrong and its documentation verdict is unreliable.`, [id], citations))
  }
  if (broken.length > 3) {
    facts.push(fact("extracted", `${broken.length - 3} further file(s) in this scope are indexed with parser errors and are not listed here.`, facts.map((item) => item.citationIds[0]).filter(Boolean), citations))
  }
  // Grouped by language so the count is a measurement, not a per-symbol recital.
  const unverifiable = new Map<string, { symbols: number; citations: string[] }>()
  for (const symbol of symbols) {
    if (symbol.docstring) continue
    const start = Number(symbol.line_start ?? 0)
    if (start > 0 && reader.docstring(symbol.path, start)) continue
    const language = String(symbol.language ?? files.find((row) => row.id === symbol.file_id)?.language ?? "").toLowerCase()
    const marker = UNREADABLE_COMMENT_MARKERS[language]
    if (marker === undefined) continue
    const group = unverifiable.get(marker) ?? { symbols: 0, citations: [] }
    group.symbols += 1
    if (group.citations.length < 3) group.citations.push(coverageCitation(symbol, citations, resolver))
    unverifiable.set(marker, group)
  }
  for (const [marker, group] of [...unverifiable].sort((a, b) => b[1].symbols - a[1].symbols)) {
    facts.push(fact("extracted", `${group.symbols} symbol(s) counted as undocumented are in a language whose comment marker is "${marker}", which this tool's source reader does not read (it reads ${READABLE_COMMENT_MARKERS.join(", ")}). Their documentation verdict is unverified rather than absent.`, group.citations, citations))
  }
  return facts
}

/**
 * How much of an HTTP surface the index actually attributes to this project.
 *
 * `api` mode was measured against 8 corpora and found `api_contract_path` empty
 * in every one and no route/endpoint/controller symbol type anywhere, so its
 * four required sections rendered empty on 100% of cases while the only content
 * it produced — a list of imports — landed in the OPTIONAL dependencies section.
 * The mode had no honest input, and said nothing about that.
 *
 * What the index does hold is `framework_type` on the file, so the surface is
 * the exported symbols of files the index attributes to an HTTP framework. The
 * set below is the index's own vocabulary as measured across those corpora, not
 * a guess at what frameworks exist; a framework absent from it contributes no
 * endpoint, and `apiSurface` is what lets the document say so.
 */
const HTTP_FRAMEWORK_TYPES = ["net_http"] as const

function apiSurfaceIndex(raw: any, projectId: string): { files: number; placeholders: string[]; contracts: number; routes: number; callables: number } {
  const placeholders = HTTP_FRAMEWORK_TYPES.map(() => "?").join(",")
  const counts = (sql: string, ...params: any[]): number => {
    try { return Number((raw.prepare(sql).get(projectId, ...params) as any)?.c ?? 0) } catch { return 0 }
  }
  return {
    placeholders: HTTP_FRAMEWORK_TYPES.map(String),
    files: counts("SELECT count(*) c FROM brain_file WHERE project_id=? AND framework_type IN (" + placeholders + ")", ...HTTP_FRAMEWORK_TYPES),
    contracts: counts("SELECT count(*) c FROM brain_symbol WHERE project_id=? AND api_contract_path IS NOT NULL"),
    routes: counts("SELECT count(*) c FROM brain_symbol WHERE project_id=? AND lower(symbol_type) IN ('route','endpoint','controller')"),
    callables: counts(
      `SELECT count(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
       WHERE s.project_id=? AND f.framework_type IN (${placeholders}) AND s.visibility IN ('export','public')
         AND s.line_start>0 AND lower(s.symbol_type) IN ('function','method')`,
      ...HTTP_FRAMEWORK_TYPES,
    ),
  }
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
    unknowns.push({ statement: `The scope contains more indexed files than the evidence limit allows; ${scope.truncated} file(s) were not examined.`, reason: "output-budget", affectedSection: concern("scope") })
  }
  if (feature?.semanticError) {
    unknowns.push({ statement: `Semantic candidate discovery did not run: ${feature.semanticError}. Only lexical candidates are used, so feature recall is lower than the mode's ceiling.`, reason: "not-observed", affectedSection: concern("semantic") })
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
    ? addSymbolFacts(raw, reader, resolver, symbols, citations, unknowns, includeTests, mode === "symbol")
    : { api: [] as DocFact[], behavior: [] as DocFact[], tests: [] as DocFact[], limitations: [] as DocFact[] }
  const apiSurface = mode === "api" ? apiSurfaceIndex(raw, projectId) : null
  const relationshipParts = addRelationshipFacts(raw, resolver, symbols, citations)
  const importFacts = addImportFacts(raw, resolver, files, citations, local)
  const inventory = mode === "project" || mode === "module" ? addInventoryFacts(raw, resolver, projectId, files, citations) : { facts: [] as DocFact[], languages: [] as Array<{ language: string; files: number; symbols: number }> }
  const findingFacts = mode === "file" || mode === "project" || mode === "module" ? addFindingFacts(raw, resolver, projectId, files, citations, unknowns) : []
  const entryPointFacts = mode === "project" || mode === "module" ? addEntryPointFacts(raw, resolver, projectId, citations) : []
  if (relationshipParts.unresolved > 0) {
    unknowns.push({ statement: `${relationshipParts.unresolved} relationship(s) name a target the index did not resolve to a symbol; those edges are reported as inferred, not extracted.`, reason: "not-indexed", affectedSection: concern("graph") })
  }

  // Every mode emits its DECLARED section set (docs/BB_DOC.md), whether or not
  // evidence was found, so the completeness gate measures the contract rather
  // than whatever the code path happened to produce.
  const drafts: SectionDraft[] = []
  const push = (draft: SectionDraft) => { drafts.push(draft) }

  if (mode === "symbol") {
    push({ id: "api", heading: "API", required: true, audience: "all", facts: symbolParts.api, emptyExplanation: "No declaration with a return type or parameter list is indexed for this symbol, so its API shape is not described here." })
    push({ id: "behavior", heading: "Behavior", required: true, audience: "all", facts: symbolParts.behavior, lead: "Read from the index and, where the index has none, from the comment block above the definition on disk.", emptyExplanation: "No docstring is indexed for this symbol and none is present in the comment styles this tool reads, and no relationship or import describes what it does." })
    push({ id: "dependencies", heading: "Dependencies", required: true, audience: "all", facts: [...relationshipParts.facts, ...importFacts], lead: "Edges are read from the graph; an edge whose target the index did not resolve is marked inferred.", emptyExplanation: "No indexed relationship or import names this symbol, so it has no dependency edge to report." })
    push({ id: "tests", heading: "Tests", required: true, audience: "all", facts: symbolParts.tests, emptyExplanation: "No indexed test file names this symbol and no indexed relationship reaches it from a test, so its test coverage is not established." })
    push({ id: "limitations", heading: "Limitations", required: true, audience: ["maintainer", "website"], facts: symbolParts.limitations, lead: "What this document cannot say is stated here rather than filled in.", emptyExplanation: "None of the measured limits applies to this symbol: its docstring, test, relationship and source-freshness checks all returned a result." })
  } else if (mode === "file") {
    push({ id: "overview", heading: "Overview", required: true, audience: "all", facts: fileFacts, emptyExplanation: "No indexed file matched this target, so there is nothing about it to describe." })
    push({ id: "public-symbols", heading: "Public symbols", required: true, audience: "all", facts: addPublicSymbolFacts(raw, resolver, symbols, citations), emptyExplanation: "No exported or public symbol is indexed in this file." })
    push({ id: "dependencies", heading: "Dependencies", required: true, audience: "all", facts: [...importFacts, ...relationshipParts.facts], emptyExplanation: "No import of this file and no relationship out of it is indexed, so its dependency edge is not established." })
    push({ id: "risks", heading: "Risks", required: true, audience: "all", facts: findingFacts, emptyExplanation: "No analysis finding, parser error or complexity outlier is indexed for this file, so no risk is asserted — the absence of evidence is not evidence of absence." })
  } else if (mode === "module") {
    push({ id: "purpose", heading: "Purpose", required: true, audience: "all", facts: fileFacts, lead: "The files this module is made of, as the index sees them.", emptyExplanation: "No indexed file lies under this module, so its composition is not established." })
    push({ id: "entry-points", heading: "Entry points", required: true, audience: "all", facts: entryPointFacts, emptyExplanation: "No indexed file in this module is marked as an entry point, and no exported symbol is reachable from the module root without passing through another module." })
    push({ id: "public-surface", heading: "Public surface", required: true, audience: "all", facts: addPublicSymbolFacts(raw, resolver, symbols, citations), emptyExplanation: "No exported or public symbol is indexed in this module." })
    push({ id: "module-graph", heading: "Module graph", required: true, audience: "all", facts: [...importFacts, ...relationshipParts.facts, ...inventory.facts], emptyExplanation: "No import between the files of this module, and no relationship or inventory row, is indexed for it." })
  } else if (mode === "feature") {
    push({ id: "entry-points", heading: "Entry points", required: true, audience: "all", facts: symbolParts.api, emptyExplanation: "No declaration with a return type or parameter list was found among this feature's candidates, so no entry point is described." })
    push({ id: "flow", heading: "Flow", required: true, audience: "all", facts: relationshipParts.facts, lead: feature ? `Candidates came from ${feature.lexical} lexical and ${feature.semantic} semantic match(es) in ${feature.ms}ms.` : undefined, emptyExplanation: "No indexed relationship connects this feature's candidates, so no flow is described." })
    push({ id: "components", heading: "Components", required: true, audience: "all", facts: [...fileFacts, ...symbolParts.behavior], emptyExplanation: "No indexed file and no described behaviour was resolved for this feature, so no component is listed." })
    push({ id: "test-coverage", heading: "Test coverage", required: true, audience: "all", facts: symbolParts.tests, emptyExplanation: "No indexed test file names a candidate of this feature and no indexed relationship reaches one from a test, so its test coverage is not established." })
  } else if (mode === "api") {
    const surface = apiSurface ?? { files: 0, placeholders: [] as string[], contracts: 0, routes: 0, callables: 0 }
    push({ id: "endpoints", heading: "Endpoints", required: true, audience: "all", facts: addEndpointFacts(symbols, citations, resolver), lead: symbols.length === 0
        ? `No HTTP surface is indexed for this project: ${surface.contracts} API contract path(s), ${surface.routes} route/endpoint/controller symbol(s), and ${surface.files} file(s) attributed to an HTTP framework holding ${surface.callables} callable exported symbol(s). This tool will not infer an endpoint from a function's name.`
        : `The index attributes ${surface.files} file(s) to an HTTP framework and holds ${surface.callables} callable exported symbol(s) in them. Framework attribution is a property of the FILE, so it places a symbol on an HTTP surface; it does not say which request the symbol answers, and no method or path is recorded.`, emptyExplanation: `No endpoint is indexed. This tool looked for an API contract path, a route, endpoint or controller symbol, and a callable symbol in a file the index attributes to an HTTP framework; the index holds ${surface.contracts} contract path(s), ${surface.routes} route-ish symbol type(s), and ${surface.files} HTTP-attributed file(s) with ${surface.callables} callable exported symbol(s). It will not infer an endpoint from a function's name.` })
    push({ id: "inputs-outputs", heading: "Inputs and outputs", required: true, audience: "all", facts: symbolParts.behavior, emptyExplanation: "No endpoint is indexed, so there is no signature whose parameters or return type could be reported." })
    push({ id: "errors", heading: "Errors", required: true, audience: ["developer", "maintainer", "website"], facts: [], lead: "No error surface is asserted: an endpoint's failures are not inferable from its signature, and the index does not record them.", emptyExplanation: "The index has no table, column or symbol type that records a thrown, raised or returned error, so no error surface can be reported for any endpoint. This is a limit of what is indexed, not a finding that the code cannot fail." })
    push({ id: "examples", heading: "Examples", required: true, audience: "all", facts: [], emptyExplanation: "No endpoint carries a docstring containing a call to itself and no indexed test names one, so no usage example can be quoted from cited source." })
  } else if (mode === "project") {
    push({ id: "architecture", heading: "Architecture", required: true, audience: "all", facts: inventory.facts, lead: "Counts and language mix as measured in the index.", emptyExplanation: "The index holds no file row for this project, so no architecture is measured." })
    push({ id: "inventory", heading: "Inventory", required: true, audience: "all", facts: [...entryPointFacts, ...fileFacts], emptyExplanation: "No indexed file and no entry point is recorded for this project." })
    push({ id: "risks", heading: "Risks", required: true, audience: "all", facts: findingFacts, emptyExplanation: "No analysis finding, parser error or complexity outlier is indexed for this project, so no risk is asserted — the absence of evidence is not evidence of absence." })
    push({ id: "documentation-map", heading: "Documentation map", required: true, audience: "all", facts: coverageFacts(symbols, reader, resolver, citations), emptyExplanation: "No symbol is indexed for this project, so its documentation state cannot be mapped." })
  } else {
    // coverage
    const documented = symbols.filter((symbol) => Boolean(symbol.docstring || reader.docstring(symbol.path, Number(symbol.line_start ?? 0))))
    const undocumented = symbols.filter((symbol) => !documented.includes(symbol))
    const staleSymbols = symbols.filter((symbol) => resolver.of(String(symbol.source_file_id ?? "")) !== "fresh")
    const documentedFacts = documented.map((symbol) => fact("extracted", coverageStatement(symbol, true), [coverageCitation(symbol, citations, resolver)], citations))
    const undocumentedFacts = undocumented.map((symbol) => fact("unknown", coverageStatement(symbol, false), [coverageCitation(symbol, citations, resolver)], citations))
    const staleFacts = staleSymbols.map((symbol) => fact("extracted", `${symbol.name} is in a file that changed after indexing.`, [coverageCitation(symbol, citations, resolver)], citations))
    // An EMPTY `undocumented` or `stale` section is a POSITIVE result, not a gap:
    // "every symbol here is documented" and "nothing here is stale" are the
    // answers a reader came for. Emitting an empty section instead made a good
    // result indistinguishable from a section wired to a source nothing writes.
    const documentedCitations = documentedFacts.flatMap((item) => item.citationIds)
    const staleCitations = staleFacts.flatMap((item) => item.citationIds)
    const verifiedFreshCitations = files
      .filter((row) => resolver.of(String(row.id ?? "")) === "fresh")
      .slice(0, 3)
      .map((row) => addCitation(citations, { kind: "file", idParts: [String(row.relative_path ?? "")], relPath: String(row.relative_path ?? ""), evidence: `Source freshness verified against disk: ${row.relative_path}`, fileId: String(row.id ?? "") }, resolver))
    if (documented.length > 0 && undocumented.length === 0) {
      undocumentedFacts.push(fact("extracted", `All ${documented.length} indexed symbol(s) in this scope carry a docstring, so no symbol is listed as undocumented.`, documentedCitations.slice(0, 3), citations))
    }
    if (symbols.length > 0 && staleSymbols.length === 0 && verifiedFreshCitations.length > 0) {
      staleFacts.push(fact("extracted", `No cited source in this scope changed after indexing: the on-disk hash and mtime of all ${files.length} file(s) examined still match the index.`, verifiedFreshCitations, citations))
    }
    push({ id: "documented", heading: "Documented", required: true, audience: "all", facts: documentedFacts, emptyExplanation: "No symbol is indexed in this scope, so its documentation state cannot be measured." })
    push({ id: "undocumented", heading: "Undocumented", required: true, audience: "all", facts: undocumentedFacts, emptyExplanation: "No symbol is indexed in this scope, so nothing can be listed as undocumented." })
    push({ id: "stale", heading: "Stale", required: true, audience: "all", facts: staleFacts, emptyExplanation: "No symbol is indexed in this scope, so no citation can be stale." })
    push({ id: "unsupported", heading: "Unsupported", required: true, audience: ["maintainer", "website"], facts: unsupportedFacts(symbols, files, reader, citations, resolver), lead: "What this tool could not measure about the scope, so the verdicts above are read with it in hand.", emptyExplanation: "Every file in this scope parsed without error and is in a language whose comment style this tool reads, so nothing in the documentation verdicts above is unmeasured." })
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
  // The id travels with the record so the note names the section it capped.
  // Matching back by heading and falling back to a literal "overview" made a
  // note possible that pointed at a section the result does not render.
  const cappedOut: Array<{ id: string; heading: string; emitted: number; available: number }> = []
  for (const draft of selectedDrafts) {
    const capped = draft.facts.slice(0, perSection)
    if (capped.length < draft.facts.length) {
      cappedOut.push({ id: draft.id, heading: draft.heading, emitted: capped.length, available: draft.facts.length })
    }
    // The cap is APPLIED here, to the list that is emitted.
    //
    // It used to be measured and reported but the section was assembled from the
    // UNCAPPED draft, so the note said the opposite of what the document did:
    // measured on rebar3 at `brief`, it claimed "115 of 120 inventory items were
    // not selected" while emitting far more than the 5 it said it had kept, and
    // on go_tools at `standard` it claimed 20 dependencies items and emitted 12 —
    // a number that came from the token budget's halving, not from this cap. The
    // note was a fabricated bound, and it was the only description of the cap the
    // reader got.
    sections.push(assembleSection({ ...draft, facts: capped }, citations))
  }

  if (!files.length && !symbols.length) {
    unknowns.push({ statement: `No indexed evidence matched ${request.target ?? mode}.`, reason: "not-indexed", affectedSection: concern("evidence") })
  }
  addOptionalUnknowns(request, unknowns)

  // Two same-named symbols — overloads, or a DSL method defined twice — emitted
  // the same unknown SENTENCE twice, so `unknowns` was a multiset of sentences
  // rather than a set of distinct gaps. Dedupe on the whole record.
  for (const record of cappedOut) {
    unknowns.push({
      statement: `The per-section evidence cap is ${perSection} at detail "${detail}", so ${record.available - record.emitted} of ${record.available} ${record.heading.toLowerCase()} items were not selected. The output budget may have shortened this further; it reports its own count.`,
      reason: "output-budget",
      affectedSection: record.id,
    })
  }
  // Every section now exists, so every concern becomes a section id. Dedupe runs
  // afterwards, on the ids the reader will actually see, so two notes that land in
  // the same section are collapsed only when the rendered claim is identical.
  const explaining = resolveUnknownSections(sections, unknowns)
  // Then the sweep: anything still unexplained is a required section that would
  // ship as a placeholder, and it either declares what would have filled it or
  // the generation throws.
  explainEmptyRequiredSections(sections, selectedDrafts, unknowns, explaining)
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
    availableCounts: selectedDrafts.map((draft) => ({ id: draft.id, available: draft.facts.length })),
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
 *//**
 * Field separator for the scope fingerprint. Written as an escape on purpose:
 * a raw 0x00 byte inside a string literal is valid TypeScript but makes the
 * source file read as BINARY to every text tool, so `read` refuses it and grep
 * stops reporting line numbers.
 */
const HASH_FIELD_SEPARATOR = "\u0000"

function indexSnapshotId(raw: any, projectId: string): string {
  const rows = raw.prepare("SELECT file_hash FROM brain_file WHERE project_id=? ORDER BY relative_path").all(projectId) as Array<{ file_hash: string }>
  const hash = createHash("sha256")
  hash.update(String(rows.length))
  for (const row of rows) { hash.update(HASH_FIELD_SEPARATOR); hash.update(String(row.file_hash ?? "")) }
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
  cappedOut: Array<{ id: string; heading: string; emitted: number; available: number }>
  /**
   * Every section's fact count BEFORE any bound, keyed by id.
   *
   * It has to be captured here rather than read off the finished section: the
   * budget pass trims first, so a count read afterwards is the post-trim number
   * and the bounds then report `9 emitted + 10 dropped != 9 available` — a real
   * miscount that the identity check caught on its first run.
   */
  availableCounts: Array<{ id: string; available: number }>
  /** The per-section cap that applied, for the bounds and the message that names it. */
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
      // The real figures are written once the budget pass has finished trimming;
      // this placeholder exists only so that pass can measure the payload.
      bounds: { perSection: 0, sections: [] },
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
      bounds: result.quality.bounds,
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
    result.unknowns.push({ statement: `The required sections cannot fit inside ${maxTokens} tokens: the smallest honest rendering is ${result.quality.budget.estimatedTokens} tokens. Raise maxTokens (hard maximum ${MAX_TOKEN_BUDGET}) or narrow the target.`, reason: "output-budget", affectedSection: result.sections[0].id })
  }
  // One final build-and-measure so the reported figure describes the object
  // exactly as returned, whatever the last pass appended.
  //
  // The second write is what carries the VERDICT: `writeQuality` takes the
  // estimate it should judge the budget against, and the first write is handed
  // the placeholder, so leaving it there reported `budget.passed: false` on a
  // 3 763-of-4 000-token document. Both writes hold a 6-digit number, so the
  // second changes no length and the measurement still holds.
  // The bounds, as numbers. `emitted` is read back off the section rather than
  // carried forward, so the identity below is a check and not a restatement.
  const availableById = new Map(args.availableCounts.map((record) => [record.id, record.available]))
  result.quality.bounds = {
    perSection: args.perSection,
    sections: result.sections.map((section) => {
      const available = availableById.get(section.id) ?? section.facts.length
      const capped = Math.min(available, args.perSection)
      const droppedForBudget = droppedPerSection.get(section.id)?.dropped ?? 0
      return { id: section.id, available, capped, droppedForBudget, emitted: section.facts.length }
    }),
  }
  const miscounted = result.quality.bounds.sections.filter((row) => row.emitted + row.droppedForBudget !== row.capped)
  if (miscounted.length > 0) {
    throw new Error(`bb_doc: evidence bounds do not account for every fact in ${miscounted.length} section(s), first "${miscounted[0].id}": ${miscounted[0].emitted} emitted + ${miscounted[0].droppedForBudget} dropped != ${miscounted[0].capped} capped of ${miscounted[0].available} available`)
  }
  writeQuality(ESTIMATE_PLACEHOLDER)
  writeQuality(measure())
  // Last, so it covers the notes the budget pass appended above as well as the
  // ones assembly produced.
  assertUnknownsNameRenderedSections(result)
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

/**
 * What a note is ABOUT, as distinct from which section it lands in.
 *
 * Every unknown used to carry a hardcoded section id, and eight of those ids
 * named a section that only exists in ONE mode: the test gap said `tests` while
 * `feature` renders `test-coverage`, the unresolved-edge note said `flow` while
 * `module` renders `module-graph` and `project` renders no `flow` at all, and
 * the scope-truncation note said `inventory` while four modes have no such
 * section. A note aimed at a section the reader cannot see is not an
 * explanation, so those sections read as unexplained placeholders while a
 * message appeared to cover them — which is how a placeholder survives a gate
 * that asks "is this section explained?".
 *
 * A note now names its CONCERN, and the section is resolved once, after the
 * mode's sections exist, against the sections that are actually rendered.
 */
type UnknownConcern =
  | "tests" | "graph" | "scope" | "risk" | "examples" | "diagrams"
  | "semantic" | "freshness" | "docstring" | "syntax" | "evidence" | "budget"

/** Marks an `affectedSection` that is still a concern and not yet a section id. */
const CONCERN_PREFIX = "@concern:"

/**
 * For each concern, the sections that can carry it, best first. The first one
 * the result RENDERS wins, so a mode without a graph section gets its own
 * architecture section rather than a pointer to a section it does not have.
 */
const CONCERN_SECTION_PREFERENCE: Record<UnknownConcern, string[]> = {
  // `symbol` renders `tests`; `feature` renders `test-coverage`; no other mode
  // builds test facts at all.
  tests: ["tests", "test-coverage"],
  // Where the edge facts themselves are rendered.
  graph: ["dependencies", "module-graph", "flow", "endpoints"],
  // Truncation removes evidence from the whole document, so it belongs on
  // whichever section enumerates the scope, and otherwise on the document lead.
  scope: ["overview", "purpose", "inventory", "documented"],
  risk: ["risks", "overview", "purpose", "inventory"],
  examples: ["examples", "api"],
  // No mode has a `diagrams` section: a diagram is only ever emitted into the
  // examples or API surface, so those are the only honest targets.
  diagrams: ["examples", "api"],
  semantic: ["entry-points", "flow", "components"],
  freshness: ["stale", "overview", "purpose", "inventory", "api", "components", "endpoints", "architecture", "documented", "public-symbols"],
  docstring: ["behavior", "components", "inputs-outputs", "public-surface", "documented"],
  syntax: ["overview", "purpose", "inventory", "stale", "architecture", "public-symbols", "components", "api", "entry-points", "documented"],
  // Both of these describe the document as a whole, so they take the lead.
  evidence: [],
  budget: [],
}

/** Name a concern now; `resolveUnknownSections` turns it into a section id later. */
function concern(about: UnknownConcern): string {
  return `${CONCERN_PREFIX}${about}`
}

/**
 * Rewrite every concern token into the id of a section this result renders.
 *
 * Resolution happens HERE, after assembly, because only now is the rendered set
 * known — and the rendered set is not the declared set: `project` and `api` gain
 * an optional `dependencies` section, and `deep` adds `all-edges` everywhere. A
 * resolver that read only the declared table would aim project-mode edges at
 * `architecture` while the edges are rendered under `dependencies`.
 *
 * A concern with no candidate in this mode falls to the document's lead section,
 * which every mode renders and which is where "this document is partial" belongs.
 */
export function resolveUnknownSections(sections: DocSection[], unknowns: DocUnknown[]): Map<string, Set<UnknownConcern | "declared">> {
  const rendered = sections.map((section) => section.id)
  const bySection = new Map<string, Set<UnknownConcern | "declared">>()
  const note = (id: string, about: UnknownConcern | "declared") => {
    const set = bySection.get(id) ?? new Set<UnknownConcern | "declared">()
    set.add(about)
    bySection.set(id, set)
  }
  // Whether a resolution was CHOSEN or DEFAULTED. A concern whose preferred
  // section does not exist in this mode falls to the document's lead, and a note
  // that landed there by fallback was never about that section: the scope note
  // says how much of the project was not examined, which is not a reason the
  // Endpoints section has no endpoints. It was enough to explain one anyway,
  // because a 5 282-file typescript index truncated its scope and the Endpoints
  // section then showed only that and never said no endpoint was indexed.
  const aimed = new Map<string, boolean>()
  const lead = rendered[0]
  if (lead === undefined) return bySection
  for (const unknown of unknowns) {
    if (!unknown.affectedSection.startsWith(CONCERN_PREFIX)) {
      // A note that names its section outright — the evidence-cap and budget
      // notes — is about that section's own contents, so it can explain it.
      note(unknown.affectedSection, "declared")
      continue
    }
    const about = unknown.affectedSection.slice(CONCERN_PREFIX.length) as UnknownConcern
    const preference = CONCERN_SECTION_PREFERENCE[about]
    if (preference === undefined) {
      throw new Error(`bb_doc: unknown concerns cannot be resolved: ${about}`)
    }
    const chosen = preference.find((id) => rendered.includes(id))
    unknown.affectedSection = chosen ?? lead
    // A note that names the section outright is aimed at it by construction.
    aimed.set(`${unknown.affectedSection}|${about}`, chosen !== undefined)
    note(unknown.affectedSection, about)
  }
  // Only an AIMED absence-explaining note can excuse an empty section.
  for (const [id, set] of bySection) {
    for (const about of set) {
      if (about === "declared") continue
      if (!EMPTINESS_EXPLAINING.has(about)) continue
      if (aimed.get(`${id}|${about}`) !== true) set.delete(about)
    }
  }
  return bySection
}

/**
 * Concerns whose subject IS the absence of evidence, so a note about one
 * explains why its section is empty.
 *
 * The rest are CAVEATS. `freshness` says a source moved under the index and
 * `syntax` says a file did not parse; both are true, both belong on the section
 * whose facts they qualify, and neither says why that section has no facts. When
 * they were allowed to stand in for an explanation, an `api` document whose
 * endpoints section was empty showed only "src/server.ts changed after indexing"
 * and never said that no endpoint is indexed — a section that looked accounted
 * for and was not.
 */
const EMPTINESS_EXPLAINING: ReadonlySet<UnknownConcern> = new Set<UnknownConcern>([
  "tests", "graph", "scope", "risk", "examples", "diagrams", "semantic", "docstring", "evidence",
])

/**
 * The invariant every result must satisfy: no note points at a section the
 * reader cannot see.
 *
 * A note that names a section the result does not render is a claim about
 * something invisible, and it is the failure mode that let eight sections read
 * as unexplained. This runs on every returned result, so a future section rename
 * fails loudly here instead of quietly producing a dangling pointer. It is
 * checked again from outside the tool (T21) because an assertion inside the code
 * under test cannot be evidence about that code.
 */
export function assertUnknownsNameRenderedSections(result: Pick<DocResult, "mode" | "sections" | "unknowns">): void {
  const rendered = new Set(result.sections.map((section) => section.id))
  const dangling = result.unknowns.filter((unknown) => !rendered.has(unknown.affectedSection))
  if (dangling.length > 0) {
    throw new Error(`bb_doc: ${dangling.length} note(s) name a section that is not rendered, first: ${dangling[0].affectedSection} in ${result.mode} (rendered: ${[...rendered].join(", ")})`)
  }
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
