import { readFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../brain/database"
import { checkFileFreshness } from "../../brain/freshness"
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

function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback
}

function quote(value: unknown): string { return String(value ?? "").replace(/`/g, "'") }

/**
 * Languages whose SYMBOL NAMES ARE PROSE, so a source-text scan over the file means
 * nothing for them.
 *
 * `markdown` is here for a measured reason, not a stylistic one. A markdown symbol is
 * a heading, a table, a code fence or a front-matter block, so its "name" is English
 * text — and both scanners below read the file as if those names were code:
 *
 *  1. `sourceDocstring` is a C-family `/**` `*` `//` comment scanner. In markdown `*`
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

function isProseNameFile(filePath: unknown): boolean {
  if (typeof filePath !== "string" || filePath.length === 0) return false
  const dot = filePath.lastIndexOf(".")
  if (dot < 0) return false
  const ext = filePath.slice(dot + 1).toLowerCase()
  // `language-detection.ts`'s own answer for this extension, so the doc lane cannot
  // drift from the router the indexer used.
  const entries = languageExtensionEntries()
  for (const [e, lang] of entries) {
    if (e === ext) return PROSE_NAME_LANGUAGES.has(lang)
  }
  return false
}

function sourceDocstring(filePath: string, lineStart: number): string | null {
  // See PROSE_NAME_LANGUAGES: for a markdown heading the preceding `*bold*` prose
  // line is not a comment, and emitting it as a docstring at confidence 1.0 is a
  // fabrication rather than a weak inference.
  if (isProseNameFile(filePath)) return null
  try {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/)
    const before = lines.slice(0, Math.max(0, lineStart - 1)).reverse()
    const comments: string[] = []
    for (const line of before) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (comments.length) break
        continue
      }
      if (trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed.startsWith("//")) {
        comments.unshift(trimmed.replace(/^\/\*\*?\s?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").replace(/^\/\/\s?/, ""))
        if (trimmed.startsWith("/**")) break
      } else break
    }
    return comments.length ? comments.join(" ").trim() : null
  } catch { return null }
}

function makeCitationId(kind: string, pathValue: string, symbol: string, line: number): string {
  return `${kind}:${pathValue}:${symbol}:${line}`.replace(/[^a-zA-Z0-9:_./-]/g, "_")
}

function sourceFreshness(raw: any, fileId: string): "fresh" | "stale" | "missing" | "unknown" {
  const result = checkFileFreshness(raw, fileId)
  return result?.status ?? "unknown"
}

function addCitation(citations: DocCitation[], row: Row, kind: DocCitation["kind"], evidence: string, confidence: number | null = 1): string {
  const filePath = String(row.path ?? row.relative_path ?? "")
  const symbol = String(row.name ?? "")
  const line = Number(row.line_start ?? row.line_number ?? 0)
  const id = makeCitationId(kind, filePath, symbol, line)
  if (!citations.some((citation) => citation.id === id)) {
    citations.push({ id, kind, path: row.relative_path ?? row.path, symbol: symbol || undefined, lineStart: line || undefined, lineEnd: Number(row.line_end ?? line) || undefined, relationshipType: row.relationship_type, evidence, freshness: row.file_id ? sourceFreshness((row as any).__raw, row.file_id) : "unknown", confidence })
  }
  return id
}

function section(id: string, heading: string, facts: DocFact[], citations: DocCitation[]): DocSection {
  const citationIds = [...new Set(facts.flatMap((fact) => fact.citationIds))]
  const prose = facts.length ? facts.map((fact) => fact.statement).join(" ") : `No indexed evidence was found for ${heading.toLowerCase()}.`
  return { id, heading, prose, facts, citations: citationIds }
}

function fact(classification: DocFact["classification"], statement: string, citationIds: string[], confidence: number | null = 1): DocFact {
  return { classification, statement, confidence, citationIds }
}

function queryRows(raw: any, sql: string, ...params: any[]): Row[] {
  return raw.prepare(sql).all(...params).map((row: Row) => ({ ...row, __raw: raw }))
}

function targetFiles(raw: any, projectId: string, request: DocRequest): Row[] {
  const target = request.target ? String(request.target) : ""
  if (request.mode === "file") return queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND (relative_path=? OR path=? OR relative_path LIKE ?) ORDER BY relative_path LIMIT ?", projectId, target, target, `%${target}`, clamp(request.limit, 20, 100))
  if (request.mode === "module") return queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND (relative_path LIKE ? OR relative_path LIKE ?) ORDER BY relative_path LIMIT ?", projectId, `${target}/%`, `${target}%`, clamp(request.limit, 20, 100))
  if (request.mode === "coverage") return queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND (?='' OR relative_path LIKE ? OR relative_path LIKE ?) ORDER BY relative_path LIMIT ?", projectId, target, `${target}/%`, `${target}%`, clamp(request.limit, 20, 100))
  if (request.mode === "project" || request.mode === "api") return queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT ?", projectId, clamp(request.limit, 20, 100))
  return []
}

async function targetSymbols(raw: any, projectId: string, request: DocRequest, files: Row[]): Promise<Row[]> {
  const limit = clamp(request.limit, 20, 100)
  const target = String(request.target ?? "")
  if (request.mode === "symbol") return queryRows(raw, "SELECT s.*, f.path, f.relative_path, f.file_hash, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.name=? OR s.qualified_name=?) ORDER BY s.line_start LIMIT ?", projectId, target, target, limit)
  if (request.mode === "api") return queryRows(raw, "SELECT s.*, f.path, f.relative_path, f.file_hash, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (s.api_contract_path IS NOT NULL OR lower(s.symbol_type) IN ('route','endpoint','controller')) AND (?='' OR s.api_contract_path=? OR f.relative_path=? OR f.relative_path LIKE ?) ORDER BY f.relative_path,s.line_start LIMIT ?", projectId, target, target, target, `${target}/%`, limit)
  if (files.length) return queryRows(raw, `SELECT s.*, f.path, f.relative_path, f.file_hash, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.file_id IN (${files.map(() => "?").join(",")}) ORDER BY f.relative_path,s.line_start LIMIT ?`, projectId, ...files.map((file) => file.id), limit)
  if (request.mode === "feature") {
    const lexical = queryRows(raw, "SELECT s.*, f.path, f.relative_path, f.file_hash, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND (lower(s.name) LIKE ? OR lower(COALESCE(s.docstring,'')) LIKE ? OR lower(COALESCE(s.qualified_name,'')) LIKE ?) ORDER BY s.gravity_score DESC,s.line_start LIMIT ?", projectId, `%${target.toLowerCase()}%`, `%${target.toLowerCase()}%`, `%${target.toLowerCase()}%`, limit)
    let semanticIds: string[] = []
    try {
      const discovered = await semanticVectorSearch(projectId as any, target, { maxResults: limit })
      semanticIds = discovered.results.map((result) => result.entityId).filter((id) => id && !lexical.some((row) => row.id === id))
    } catch {}
    if (!semanticIds.length) return lexical
    const semantic = queryRows(raw, `SELECT s.*, f.path, f.relative_path, f.file_hash, f.id AS source_file_id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.id IN (${semanticIds.map(() => "?").join(",")}) ORDER BY s.gravity_score DESC,s.line_start LIMIT ?`, projectId, ...semanticIds, limit)
    return [...lexical, ...semantic].slice(0, limit)
  }
  return []
}

function addFileFacts(raw: any, files: Row[], citations: DocCitation[], unknowns: DocUnknown[]): DocFact[] {
  const facts: DocFact[] = []
  for (const file of files) {
    const id = addCitation(citations, { ...file, file_id: file.id, __raw: raw }, "file", `Indexed file ${file.relative_path}`, 1)
    facts.push(fact("extracted", `${file.relative_path} is an indexed ${file.language ?? "unknown-language"} file with ${file.line_count ?? "unknown"} lines.`, [id], 1))
    if (file.has_syntax_errors) unknowns.push({ statement: `Syntax validity for ${file.relative_path} is unknown because the index recorded parser errors.`, reason: "not-observed", affectedSection: "files" })
    if (sourceFreshness(raw, file.id) !== "fresh") unknowns.push({ statement: `Current source for ${file.relative_path} cannot be fully confirmed.`, reason: sourceFreshness(raw, file.id) === "missing" ? "not-observed" : "stale-evidence", affectedSection: "files" })
  }
  return facts
}

function addSymbolFacts(raw: any, symbols: Row[], citations: DocCitation[], unknowns: DocUnknown[], includeTests: boolean): DocFact[] {
  const facts: DocFact[] = []
  for (const symbol of symbols) {
    const id = addCitation(citations, { ...symbol, path: symbol.path, relative_path: symbol.relative_path, file_id: symbol.source_file_id, __raw: raw }, "symbol", `Indexed ${symbol.symbol_type} ${symbol.name}`, 1)
    const returnType = symbol.return_type ? ` returns ${symbol.return_type}` : ""
    facts.push(fact("extracted", `${symbol.symbol_type} ${quote(symbol.name)} is defined in ${symbol.relative_path} at line ${symbol.line_start ?? "unknown"}${returnType}.`, [id], 1))
    const docstring = symbol.docstring || sourceDocstring(symbol.path, Number(symbol.line_start ?? 0))
    if (docstring) facts.push(fact("extracted", `Its source documentation says: ${String(docstring).replace(/\s+/g, " ")}`, [id], 1))
    else unknowns.push({ statement: `No indexed docstring was found for ${symbol.name}.`, reason: "not-observed", affectedSection: "symbols" })
    if (includeTests) {
      const tests = queryRows(raw, "SELECT DISTINCT f.* FROM brain_relationship r JOIN brain_symbol ts ON ts.id=r.source_symbol_id JOIN brain_file f ON f.id=ts.file_id WHERE r.project_id=? AND r.target_symbol_id=? AND f.is_test_file=1 LIMIT 10", symbol.project_id, symbol.id)
      if (tests.length) {
        const testId = addCitation(citations, { ...tests[0], __raw: raw }, "test", `Test file references ${symbol.name}`, 0.9)
        facts.push(fact("extracted", `${symbol.name} has indexed test evidence in ${tests.map((test) => test.relative_path).join(", ")}.`, [testId], 0.9))
      } else {
        const testFiles = queryRows(raw, "SELECT * FROM brain_file WHERE project_id=? AND is_test_file=1 ORDER BY relative_path LIMIT 50", symbol.project_id)
        // A markdown symbol's name is a heading, so substring-matching it against test
        // source matches English prose: measured, 5 of 2,321 distinct markdown names
        // in this index (`File`, `Contract`, `Decisions`, `ack`, `value`) would each
        // attach a real test file at confidence 0.7. See PROSE_NAME_LANGUAGES — the
        // honest state for these is the `not-observed` unknown below, not a match.
        const referencing = isProseNameFile(symbol.path) ? undefined : testFiles.find((test) => {
          try { return readFileSync(test.path, "utf8").includes(symbol.name) } catch { return false }
        })
        if (referencing) {
          const testId = addCitation(citations, { ...referencing, file_id: referencing.id, __raw: raw }, "test", `Test file directly references ${symbol.name}`, 0.7)
          facts.push(fact("inferred", `${symbol.name} is directly referenced by test source in ${referencing.relative_path}.`, [testId], 0.7))
        } else unknowns.push({ statement: `No indexed test relationship was found for ${symbol.name}.`, reason: "not-observed", affectedSection: "tests" })
      }
    }
    if (symbol.api_contract_path) facts.push(fact("extracted", `${symbol.name} is associated with API contract ${symbol.api_contract_path}.`, [id], 1))
  }
  return facts
}

function addRelationshipFacts(raw: any, symbols: Row[], citations: DocCitation[]): DocFact[] {
  const facts: DocFact[] = []
  for (const symbol of symbols) {
    const relationships = queryRows(raw, "SELECT r.*, sf.relative_path AS source_path, tf.relative_path AS target_path FROM brain_relationship r LEFT JOIN brain_symbol ss ON ss.id=r.source_symbol_id LEFT JOIN brain_file sf ON sf.id=ss.file_id LEFT JOIN brain_symbol ts ON ts.id=r.target_symbol_id LEFT JOIN brain_file tf ON tf.id=ts.file_id WHERE r.project_id=? AND (r.source_symbol_id=? OR r.target_symbol_id=?) ORDER BY r.line_number LIMIT 20", symbol.project_id, symbol.id, symbol.id)
    for (const relationship of relationships) {
      const id = addCitation(citations, { ...relationship, relative_path: relationship.source_path ?? relationship.target_path, file_id: relationship.source_symbol_id ? symbol.source_file_id : undefined, __raw: raw }, "relationship", `${relationship.relationship_type} relationship`, Number(relationship.confidence ?? 0.5))
      const other = relationship.source_symbol_id === symbol.id ? relationship.target_path ?? relationship.target_external ?? "external target" : relationship.source_path ?? relationship.source_external ?? "external source"
      facts.push(fact("extracted", `${symbol.name} ${relationship.relationship_type} ${other}.`, [id], Number(relationship.confidence ?? 0.5)))
    }
  }
  return facts
}

function addImportFacts(raw: any, files: Row[], citations: DocCitation[]): DocFact[] {
  const facts: DocFact[] = []
  for (const file of files) {
    const imports = queryRows(raw, "SELECT * FROM brain_import WHERE project_id=? AND file_id=? ORDER BY line_number LIMIT 30", file.project_id, file.id)
    for (const item of imports) {
      const id = addCitation(citations, { ...item, path: file.path, relative_path: file.relative_path, file_id: file.id, __raw: raw }, "import", `Import ${item.import_path}`, 1)
      facts.push(fact("extracted", `${file.relative_path} imports ${item.import_path}${item.is_external ? " as an external dependency" : ""}.`, [id], 1))
    }
  }
  return facts
}

function addFindingFacts(raw: any, projectId: string, citations: DocCitation[]): DocFact[] {
  const rows = queryRows(raw, "SELECT * FROM brain_analysis_finding WHERE project_id=? AND state NOT IN ('resolved','suppressed') ORDER BY severity,last_seen_at DESC LIMIT 20", projectId)
  return rows.map((finding) => {
    const evidence = typeof finding.evidence === "string" ? finding.evidence : JSON.stringify(finding.evidence ?? {})
    const location = typeof finding.location === "string" ? finding.location : ""
    const id = addCitation(citations, { ...finding, relative_path: location, file_id: undefined, __raw: raw }, "finding", `${finding.severity} ${finding.title}`, Number(finding.confidence ?? 0.5))
    return fact("extracted", `Finding ${finding.title} is ${finding.state} with ${finding.severity} severity${evidence && evidence !== "{}" ? ` (${evidence.slice(0, 180)})` : ""}.`, [id], Number(finding.confidence ?? 0.5))
  })
}

function addOptionalUnknowns(request: DocRequest, unknowns: DocUnknown[]): void {
  if (request.includeExamples === true) unknowns.push({ statement: "No generated examples are emitted unless source-backed API or snippet evidence is available.", reason: "not-observed", affectedSection: "examples" })
  if (request.includeDiagrams === true) unknowns.push({ statement: "No diagram is emitted because this implementation requires cited graph nodes and links.", reason: "not-observed", affectedSection: "diagrams" })
}



// A citation is broken when its source path no longer exists on disk or its
// line span exceeds the current file. Findings carry a "file:line" location
// string, not a real path, so they are excluded from the broken count.
function citationBroken(projectPath: string, citation: DocCitation): boolean {
  if (!["file", "symbol", "import", "relationship", "test"].includes(citation.kind)) return false
  if (!citation.path) return false
  try {
    const abs = path.isAbsolute(citation.path) ? citation.path : path.join(projectPath, citation.path)
    const content = readFileSync(abs, "utf8")
    if (citation.lineStart && citation.lineStart > content.split(/\r?\n/).length) return true
    return false
  } catch {
    return true
  }
}

function makeResult(projectId: string, projectPath: string, request: DocRequest, files: Row[], symbols: Row[], sections: DocSection[], citations: DocCitation[], unknowns: DocUnknown[]): DocResult {
  const maxTokens = clamp(request.maxTokens, 4000, 16000)
  const estimatedTokens = Math.ceil(JSON.stringify({ sections, citations, unknowns }).length / 4)
  const stale = citations.filter((citation) => citation.freshness === "stale").length
  const missing = citations.filter((citation) => citation.freshness === "missing").length
  const broken = citations.filter((citation) => citationBroken(projectPath, citation)).length
  const covered = sections.reduce((count, item) => count + item.facts.length, 0)
  const snapshotId = `${projectId}:${files.map((file) => file.file_hash).join(",")}`
  const quality: DocQuality = { passed: estimatedTokens <= maxTokens && citations.every((citation) => citation.id && citation.evidence), factuality: { passed: sections.every((item) => item.facts.every((itemFact) => itemFact.citationIds.length > 0)), uncitedClaims: sections.flatMap((item) => item.facts).filter((itemFact) => !itemFact.citationIds.length).length, unsupportedClaims: 0 }, references: { passed: missing === 0 && broken === 0, broken, stale, missing }, completeness: { passed: unknowns.length === 0, covered, expected: covered + unknowns.length, unknown: unknowns.length }, freshness: { passed: stale === 0 && missing === 0, snapshot: snapshotId, staleClaims: stale }, budget: { passed: estimatedTokens <= maxTokens, estimatedTokens, maxTokens }, warnings: [...unknowns.map((unknown) => unknown.statement), ...(stale ? [`${stale} stale citations`] : []), ...(broken ? [`${broken} broken citations`] : [])] }
  const language = files[0]?.language ?? symbols[0]?.language ?? null
  const canonicalPath = request.target ? String(request.target).replace(/^\/+/, "") : request.mode
  return { schemaVersion: "1", mode: request.mode, title: request.target ? `${request.mode}: ${request.target}` : `${request.mode} documentation`, summary: sections[0]?.prose ?? "No indexed evidence was found.", sections, citations, unknowns, quality, reference: { projectId, projectPath, snapshotId, generatedAt: new Date().toISOString(), indexVersion: null, schemaVersion: null, sourceLanguage: language, canonicalPath, slugs: [request.mode, ...(request.target ? String(request.target).split(/[\\/.: ]+/).filter(Boolean).slice(0, 4) : [])], tags: [request.mode, request.audience ?? "developer"], relatedReferences: [], diagrams: [] } }
}

export async function generateDocumentation(projectId: string, projectPath: string, request: DocRequest): Promise<DocResult> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  let files = targetFiles(raw, projectId, request)
  const symbols = await targetSymbols(raw, projectId, request, files)
  if (!files.length && symbols.length) {
    const fileIds = [...new Set(symbols.map((symbol) => symbol.source_file_id).filter(Boolean))]
    files = queryRows(raw, `SELECT * FROM brain_file WHERE project_id=? AND id IN (${fileIds.map(() => "?").join(",")}) ORDER BY relative_path`, projectId, ...fileIds)
  }
  const citations: DocCitation[] = []
  const unknowns: DocUnknown[] = []
  const sections: DocSection[] = []
  const fileFacts = addFileFacts(raw, files, citations, unknowns)
  const symbolFacts = addSymbolFacts(raw, symbols, citations, unknowns, request.includeTests === true || request.mode === "symbol" || request.mode === "coverage")
  const relationshipFacts = addRelationshipFacts(raw, symbols, citations)
  const importFacts = addImportFacts(raw, files, citations)
  if (request.mode === "coverage") {
    sections.push(section("coverage", "Documentation coverage", symbols.map((symbol) => { const documented = Boolean(symbol.docstring || sourceDocstring(symbol.path, Number(symbol.line_start ?? 0))); return fact(documented ? "extracted" : "unknown", `${symbol.name} is ${documented ? "documented" : "undocumented"}.`, citations.filter((citation) => citation.symbol === symbol.name).map((citation) => citation.id), documented ? 1 : null) }), citations))
  } else {
    sections.push(section("overview", "Overview", [...fileFacts, ...symbolFacts].slice(0, clamp(request.limit, 20, 100)), citations))
    if (relationshipFacts.length) sections.push(section("relationships", "Relationships", relationshipFacts.slice(0, clamp(request.limit, 20, 100)), citations))
    if (importFacts.length) sections.push(section("dependencies", "Dependencies", importFacts.slice(0, clamp(request.limit, 20, 100)), citations))
  }
  if (!files.length && !symbols.length) unknowns.push({ statement: `No indexed evidence matched ${request.target ?? request.mode}.`, reason: "not-indexed", affectedSection: "overview" })
  addOptionalUnknowns(request, unknowns)
  return makeResult(projectId, projectPath, request, files, symbols, sections, citations, unknowns)
}

export function formatDocumentation(result: DocResult, format: DocFormat = "markdown"): string {
  if (format === "json") return JSON.stringify(result, null, 2)
  const lines = [`# ${result.title}`, "", result.summary, ""]
  for (const item of result.sections) {
    lines.push(`## ${item.heading}`, "", item.prose, "")
    for (const itemFact of item.facts) lines.push(`- ${itemFact.statement} ${itemFact.citationIds.map((id) => `[${result.citations.findIndex((citation) => citation.id === id) + 1}]`).join(" ")}`)
    lines.push("")
  }
  if (result.unknowns.length) { lines.push("## Unknowns", "", ...result.unknowns.map((unknown) => `- ${unknown.statement} (${unknown.reason})`), "") }
  lines.push("## Quality", "", `- passed: ${result.quality.passed}`, `- estimated tokens: ${result.quality.budget.estimatedTokens}/${result.quality.budget.maxTokens}`, `- stale citations: ${result.quality.references.stale}`, "", "## Sources", "", ...result.citations.map((citation, index) => `- [${index + 1}] ${citation.path ?? "unknown"}${citation.lineStart ? `#L${citation.lineStart}${citation.lineEnd ? `-L${citation.lineEnd}` : ""}` : ""} (${citation.freshness})`))
  return lines.join("\n")
}
