// src/lsp/hover.ts — M24.L2: hover over the persisted index.
//
// The only hover implementation for bb_lsp. Reads brain_symbol +
// brain_relationship and produces an LSP hover whose content states what the
// data is, how much to trust it, and whether it is stale — the differentiator
// claim: "the only hover that states how much to trust itself" (issue #491).
//
// Complement stance (IDE Honesty Contract §7): the hover is labeled as coming
// from the bb index; it never pretends to be compiler-grade semantics.
//
// Declared guarantees (gated by script/m24/verify-hover.ts):
//   G1 content:     hover at an indexed symbol returns name, signature,
//                   usage count, and evidence tier(s) of its edges
//   G2 consistency: usage count agrees with a direct count of
//                   brain_relationship rows for the same symbol
//   G3 honesty:     symbol not in index → declared "not indexed" hover,
//                   never a fabricated entry
//   G4 positions:   position resolution via the P1 component ONLY
//                   (no inline conversion — contract §5)
//   G5 freshness:   stale file (hash differs from disk) → stale marker on
//                   the hover, per the freshness gate (P2)
//   G6 latency:     p95 warm hover under the 50 ms budget on the fixture
//                   workspace (contract §3) — measured, machine-recorded
//
// Declared limitations:
//   - index-sourced only; no compiler-backed types (complement stance)
//   - evidence tiers describe relationship data quality, not symbol truth
//
// Run: imported by src/lsp/server.ts (registered as textDocument/hover in L2)

import { readFileSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { checkFileFreshness } from "../brain/freshness"
import {
  createPositionMapper,
  PositionError,
  resolveRowByteColumns,
  type IndexPosition,
  type LspPosition,
} from "./positions"
import { storedCrossLanguageRows, factsFromRows, crossLanguageSection } from "./cross_language_hover"
import { annotationHoverSection, type AnnotationRow } from "./annotation_ui"
import { countUsageSites, USAGE_SITE_FILTER_LABEL } from "./relations"
import { parseForSafety } from "../ast/safety-primitives"
import { actionsSection, connectedGroups, connectedSummarySection, definitionLink, richSitesForSymbol, usageSitesOf, usagesSection } from "./rich_hover"

/** The launch set, its membership test, and the path→language map live in
 *  the single-owner module (M29.R2: one owner; the set was duplicated here
 *  and in server.ts — a drift hazard the wave found). */
import { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath } from "./launch_languages"
export { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath }

/** Evidence tiers for relationship data, per the evidence class vocabulary.
 *  M29.R5: the hover tier is the five-class vocabulary (structural,
 *  import_based, usage_contextual, reference_qualified, inferred) plus the
 *  coarse "indexed" legacy bucket mapped through tierForRelationship below.
 *  Rationale (F7 fixture script/m29/r5-tier-fixture.ts): the pre-R5 map had
 *  10 entries and dumped parser-deterministic facts (contains, instantiates,
 *  exports) into "inferred" — measured 42.5% of giant-corpus relationships
 *  downgraded. The structural set and the 0.7 floor mirror the W4 decision
 *  (script/m26/graph-core.ts TIER_MEANINGS; drift-gated by
 *  script/m26/verify-evidence-badges.ts P4 and
 *  script/m29/verify-precision-improvements.ts). */
export type EvidenceTier = "structural" | "import_based" | "usage_contextual" | "reference_qualified" | "indexed" | "inferred" | "semantic_candidate" | "unknown"

const RELATIONSHIP_TIER: Record<string, EvidenceTier> = {
  call: "indexed",
  calls: "indexed",
  import: "indexed",
  imports: "indexed",
  extends: "indexed",
  implements: "indexed",
  override: "indexed",
  reference: "indexed",
  references: "indexed",
  uses: "indexed",
}

/** Structural relationship types: parser-deterministic facts. Same set as the
 *  W4 badge owner (script/m26/graph-core.ts STRUCTURAL_TYPES) plus the
 *  containment/exports/instantiates facts the analyzers stamp structural. */
const STRUCTURAL_RELATIONSHIPS = new Set(["call", "calls", "extends", "implements", "overrides", "contains", "exports", "instantiates", "inherits"])

/** Tier for one relationship row (M29.R5 rule):
 *  1. a STORED metadata.evidenceClass wins (the analyzer's own
 *     classification — same "stored wins" rule as tierForCrossLanguageEdge
 *     and the W4 webview badge);
 *  2. else a structural relationship type at confidence >= 0.7 is structural
 *     (the W4 floor — below it the edge is a guess and must read inferred);
 *  3. else the legacy coarse map (indexed vocabulary);
 *  4. else sub-0.5 confidence is a semantic candidate; everything else is
 *     honestly inferred. */
function tierForRelationship(relType: string, confidence: number | null, evidenceClass: string | null): EvidenceTier {
  if (evidenceClass === "structural" || evidenceClass === "import_based" || evidenceClass === "usage_contextual" || evidenceClass === "reference_qualified" || evidenceClass === "inferred") {
    return evidenceClass
  }
  const t = relType.toLowerCase()
  if (STRUCTURAL_RELATIONSHIPS.has(t)) return (confidence ?? 0) >= 0.7 ? "structural" : "inferred"
  const coarse = RELATIONSHIP_TIER[t]
  if (coarse) return coarse
  if (confidence !== null && confidence < 0.5) return "semantic_candidate"
  return "inferred"
}

export interface SymbolHoverData {
  name: string
  qualifiedName: string | null
  symbolType: string
  signature: string
  usageCount: number
  evidenceTiers: EvidenceTier[]
  /** M26.W3: pre-rendered cross-language section — empty string when the
   *  index stores no cross-language rows for this symbol (the hover then
   *  renders NO cross-language text at all: absence declared in docs). */
  crossLanguageSection: string
  /** M28.A2: pre-rendered annotation section — empty string when the index
   *  stores no annotations for this symbol (same declared-absence contract
   *  as the cross-language section above). Author-labeled by the
   *  annotation_ui owner; an agent note never reads as index fact (D-6). */
  annotationSection: string
  stale: boolean
  freshnessStatus: "fresh" | "stale" | "missing"
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  /** M42.H2: LSP location of the declaration (definition link); null when
   *  the range is not resolvable — the footnote then stays plain text. */
  definition: { line: number; character: number } | null
  /** M42.H2: pre-rendered connected-summary line — empty string when no
   *  connection facts exist (declared absence, never a placeholder). */
  connectedSection: string
  /** M42.H2: pre-rendered usages section — empty string when no usage
   *  sites exist (declared absence). */
  usagesSection: string
  /** M42.H4: pre-rendered hover-actions row (open in graph / impact /
   *  call hierarchy) — empty string when the symbol identity (declaration
   *  location) is not resolvable: no actions without a clickable target
   *  (§12.1 nothing unclickable). */
  actionsSection: string
}

export interface HoverRequest {
  /** absolute file path */
  filePath: string
  /** LSP position (0-based line, 0-based UTF-16 character) */
  position: LspPosition
}

export interface HoverResult {
  /** null when nothing is hoverable — declared absence, never fabricated */
  contents: {
    value: string
    kind: "markdown"
  } | null
  range: { start: LspPosition; end: LspPosition } | null
  data: SymbolHoverData | null
  /** machine-readable honesty block, always present */
  provenance: {
    source: "bb_index"
    evidenceClass: EvidenceTier | "stale"
    engine: string
    limitations: string[]
    stale: boolean
  }
}

interface SymbolRow {
  id: string
  name: string
  qualified_name: string | null
  symbol_type: string
  line_start: number | null
  line_end: number | null
  byte_start: number | null
  byte_end: number | null
  return_type: string | null
  parameters: string | null
  visibility: string | null
  file_id: string
}

interface FileRow {
  id: string
  path: string
  language: string | null
}

/** Build a human-readable signature from the indexed symbol fields. */
export function buildSignature(row: {
  name: string
  symbol_type: string
  return_type: string | null
  parameters: string | null
  visibility: string | null
}): string {
  const parts: string[] = []
  if (row.visibility) parts.push(row.visibility)
  parts.push(row.symbol_type)
  let sig = parts.join(" ") + " " + row.name
  if (row.parameters !== null && row.parameters !== undefined) {
    sig += `(${row.parameters})`
  } else if (row.symbol_type === "function" || row.symbol_type === "method") {
    sig += "(…)"
  }
  if (row.return_type) sig += ` → ${row.return_type}`
  return sig
}

/**
 * Resolve the LSP position to an index position via the P1 component and
 * find the symbol whose indexed range contains it. Returns null when the
 * position is outside every indexed symbol (honest absence).
 */
const SYMBOL_ROW_SELECT = `s.id, s.name, s.qualified_name, s.symbol_type, s.line_start, s.line_end,
            s.byte_start, s.byte_end, s.return_type, s.parameters, s.visibility, s.file_id,
            f.id AS f_id, f.path, f.language`

export function findSymbolAtPosition(
  raw: CoreDatabase,
  filePath: string,
  position: LspPosition,
): { symbol: SymbolRow; file: FileRow } | null {
  // Single index query: symbols in this file whose line range could contain
  // the requested line. Position conversion happens ONLY via P1.
  const rows = raw
    .prepare(
      `SELECT ${SYMBOL_ROW_SELECT}
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.line_start IS NOT NULL AND s.line_end IS NOT NULL
         AND s.line_start <= ? AND s.line_end >= ?`,
    )
    .all(filePath, position.line + 1, position.line + 1) as Array<SymbolRow & { f_id: string; path: string; language: string | null }>

  if (rows.length === 0) return null

  // Prefer the innermost symbol (smallest range) containing the position.
  let best: { symbol: SymbolRow; file: FileRow } | null = null
  let bestWidth = Number.MAX_SAFE_INTEGER
  for (const row of rows) {
    const width = (row.line_end ?? 0) - (row.line_start ?? 0)
    if (width < bestWidth) {
      bestWidth = width
      best = {
        symbol: row,
        file: { id: row.f_id, path: row.path, language: row.language },
      }
    }
  }
  return best
}

/** Occurrence-first resolution (owner test, 2026-09-05): when the cursor sits
 *  ON an identifier (a call site `g.greet()`, a member read `this.items`, a
 *  cross-file reference), resolve that identifier to ITS declaration — the
 *  enclosing-symbol fallback alone made hovering a call inside a function
 *  body show the FUNCTION (main) instead of the callee. Resolution order
 *  mirrors document highlight's proven rule: unique same-file declaration,
 *  else unique workspace declaration, else null (declared ambiguity — the
 *  caller then falls back to the enclosing symbol). Parses only the file at
 *  the cursor via the shared safety machinery; comments/strings excluded. */
export async function resolveOccurrenceSymbol(
  raw: CoreDatabase,
  filePath: string,
  position: LspPosition,
): Promise<{ symbol: SymbolRow; file: FileRow; occurrence: { startLine: number; startColumn: number; endColumn: number } } | null> {
  let content: string
  try {
    content = readFileSync(filePath, "utf8")
  } catch {
    return null
  }
  const mapper = createPositionMapper(content)
  let indexPos
  try {
    indexPos = mapper.lspToIndex({ line: position.line, character: position.character })
  } catch (e) {
    if (e instanceof PositionError) return null
    throw e
  }
  let safety: Awaited<ReturnType<typeof parseForSafety>>
  try {
    safety = await parseForSafety(filePath, content)
  } catch {
    // Unparseable/unsupported file: honest degradation to the enclosing-
    // symbol model — hover must never reject over a parse failure.
    return null
  }
  const cursorOcc = safety.occurrences.find(
    (o) => o.startLine === indexPos.line && o.startColumn <= indexPos.column && indexPos.column < o.endColumn,
  )
  if (!cursorOcc) return null
  const sameFile = raw
    .prepare(`SELECT ${SYMBOL_ROW_SELECT} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path = ? AND s.name = ?`)
    .all(filePath, cursorOcc.text) as Array<SymbolRow & { f_id: string; path: string; language: string | null }>
  let rows = sameFile
  if (sameFile.length === 0) {
    const workspace = raw
      .prepare(`SELECT ${SYMBOL_ROW_SELECT} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.name = ?`)
      .all(cursorOcc.text) as Array<SymbolRow & { f_id: string; path: string; language: string | null }>
    rows = workspace
  }
  if (rows.length !== 1) return null // declared ambiguity or unknown name → enclosing fallback
  const row = rows[0]!
  return {
    symbol: row,
    file: { id: row.f_id, path: row.path, language: row.language },
    occurrence: { startLine: cursorOcc.startLine, startColumn: cursorOcc.startColumn, endColumn: cursorOcc.endColumn },
  }
}

/** Count usages of a symbol (M55.T3: the vocabulary's usage-site count).
 *
 * History: this counted EVERY row touching the symbol — both directions,
 * including the owning declaration and callees, undeduplicated by location.
 * On the demo index that made `greet` read "6 usages" while its list rendered
 * 6 rows (one of them its class) and the graph reported 3 callers; `greetAll`
 * read a usage it did not have while its caller set was empty. The count now
 * comes from src/lsp/relations.ts — the same rule, in SQL (independent of the
 * row materialization the hover list uses; the M55.T3 gate asserts the two
 * agree on a real index). */
export function countUsages(raw: CoreDatabase, symbolId: string): number {
  return countUsageSites(raw, symbolId)
}

/** Collect evidence tiers across the symbol's relationships. */
export function evidenceTiersFor(raw: CoreDatabase, symbolId: string): EvidenceTier[] {
  // M29.R3 scale fix: UNION rewrite (see countUsages) — same tier set, two
  // indexed probes instead of one full scan.
  const rows = raw
    .prepare(
      "SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE target_symbol_id = ? UNION SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE source_symbol_id = ?",
    )
    .all(symbolId, symbolId) as Array<{ relationship_type: string; confidence: number | null; metadata: string | null }>
  const tiers = new Set<EvidenceTier>()
  for (const r of rows) {
    let evidenceClass: string | null = null
    if (r.metadata) {
      try {
        const cls = (JSON.parse(r.metadata) as { evidenceClass?: unknown }).evidenceClass
        if (typeof cls === "string") evidenceClass = cls
      } catch {
        // unreadable metadata is not evidence — fall through to derivation
      }
    }
    tiers.add(tierForRelationship(r.relationship_type, r.confidence, evidenceClass))
  }
  return [...tiers].sort()
}

/** Format the hover markdown, including the honesty block. */
export function formatHoverMarkdown(data: SymbolHoverData): string {
  const lines: string[] = []
  lines.push(`\`\`\`\n${data.signature}\n\`\`\``)
  // M55.T3: the count line declares what was counted, so a reader (and the
  // references surface, which legitimately answers a wider question when the
  // client asks for the declaration too) can never read two numbers as a
  // disagreement. Zero is stated, never omitted: a symbol with no stored
  // references reads "0 usages", not silence (§14 Truth Rule 1).
  lines.push(
    `**${data.name}** — ${data.symbolType}, ${data.usageCount} usage${data.usageCount === 1 ? "" : "s"} _(${USAGE_SITE_FILTER_LABEL})_`,
  )
  if (data.evidenceTiers.length > 0) {
    lines.push(`evidence: ${data.evidenceTiers.join(", ")}`)
  } else {
    lines.push("evidence: none (no indexed relationships)")
  }
  // M42.H2: the rich sections. Empty strings render nothing — declared
  // absence (no connection facts / no usage sites) is never fabricated.
  if (data.connectedSection && data.connectedSection.length > 0) {
    lines.push(data.connectedSection)
  }
  if (data.usagesSection && data.usagesSection.length > 0) {
    lines.push(data.usagesSection)
  }
  // M42.H4: the actions row — the hover is the entry point to the deep
  // surfaces (graph, impact, call hierarchy). Empty row renders nothing
  // (declared absence: no symbol identity, no actions to offer).
  if (data.actionsSection && data.actionsSection.length > 0) {
    lines.push(data.actionsSection)
  }
  // M26.W3: cross-language facts ONLY from stored rows (is_cross_language = 1).
  // An empty section renders nothing — a pair with no stored rows states
  // nothing cross-language in the UI; absence is declared in docs, not faked
  // (issue #511; mutation-gated: a fabricated fact fails the W3 suite).
  if (data.crossLanguageSection && data.crossLanguageSection.length > 0) {
    lines.push(data.crossLanguageSection)
  }
  // M28.A2: agent/human annotations, author-labeled. Empty section renders
  // nothing — declared absence, never a placeholder (same law as W3 above).
  if (data.annotationSection && data.annotationSection.length > 0) {
    lines.push(data.annotationSection)
  }
  if (data.stale) {
    lines.push(`⚠️ **stale** — file changed since indexing (${data.freshnessStatus})`)
  }
  // M42.H2: the source footnote is the definition link — its target is the
  // hovered symbol's own indexed location (nothing unclickable, §12.1).
  if (data.definition !== null) {
    lines.push(definitionLink(data.filePath, data.definition.line, data.definition.character))
  } else {
    lines.push(`_source: bb index (${data.filePath}:${data.lineStart ?? "?"})_`)
  }
  return lines.join("\n\n")
}

export interface HoverDeps {
  /** injectable clock for latency measurement (tests) */
  now?: () => number
}

/**
 * The hover handler. Reads through the persisted index; every response
 * carries the honesty block. Never fabricates: no symbol at the position →
 * contents null with provenance explaining why.
 */
export async function hover(
  raw: CoreDatabase,
  request: HoverRequest,
  deps: HoverDeps = {},
): Promise<HoverResult> {
  const startedAt = (deps.now ?? Date.now)()
  const language = languageForPath(request.filePath)

  // Declared-absent languages: not an error, an honest limitation.
  if (!isLaunchLanguage(language)) {
    return {
      contents: null,
      range: null,
      data: null,
      provenance: {
        source: "bb_index",
        evidenceClass: "unknown",
        engine: "bb_lsp hover@m24.l2",
        limitations: [
          language === null
            ? "file type not in the launch language set"
            : `${language} is not a launch language (launch: ${LAUNCH_LANGUAGES.join(", ")})`,
        ],
        stale: false,
      },
    }
  }

  // Occurrence-first (call sites / member reads resolve to the referenced
  // declaration); the containing-symbol model stays as the fallback for
  // positions that are not on a resolvable identifier.
  const occurrence = await resolveOccurrenceSymbol(raw, request.filePath, request.position)
  const containing = findSymbolAtPosition(raw, request.filePath, request.position)
  const found = occurrence ?? containing
  if (!found) {
    return {
      contents: null,
      range: null,
      data: null,
      provenance: {
        source: "bb_index",
        evidenceClass: "unknown",
        engine: "bb_lsp hover@m24.l2",
        limitations: ["no indexed symbol at this position (not indexed)"],
        stale: false,
      },
    }
  }

  const { symbol, file } = found
  const freshness = checkFileFreshness(raw, file.id)
  const freshnessStatus = freshness?.status ?? "missing"
  const stale = freshnessStatus !== "fresh"

  const tiers = evidenceTiersFor(raw, symbol.id)
  // M42.H2: usage sites = the L3 references row set, resolved through the
  // navigation location owner. Used for the connected summary, the top-3
  // usage links AND the count (one collection, three renderings).
  const sites = richSitesForSymbol(raw, symbol.id)
  // M55.T3 (§14 Truth Rule 1): the count IS this array's length — the number
  // of rows the usages list can show (the `+N more` rest included, since the
  // list is capped at MAX_USAGE_LINKS and reports the remainder). The
  // vocabulary filter (declaration/callee exclusion) lives in relations.ts;
  // it is applied once here, and the section renders the same filtered array.
  const usageSiteRows = usageSitesOf(sites)
  const usageCount = usageSiteRows.length
  // M26.W3: per-pair cross-language facts from stored rows only.
  const crossSection = crossLanguageSection(factsFromRows(storedCrossLanguageRows(raw, symbol.id), file.language))
  // M28.A2: annotation rows for this symbol, rendered by the single owner.
  // Project scoped via the symbol's file row (hover has no projectId param).
  const annotationRows = raw.prepare("SELECT symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = (SELECT project_id FROM brain_file WHERE id = ?) AND symbol_name = ? ORDER BY time_updated DESC").all(file.id, symbol.name) as AnnotationRow[]
  const annotationSection = annotationHoverSection(annotationRows)

  // The definition location (declaration of the hovered symbol) is the hover
  // response RANGE, resolved through the P1 component below; it is computed
  // BEFORE the data object so the footnote can carry it as the definition
  // link (M42.H2 §12.1: the source footnote must navigate).
  let range: HoverResult["range"] = null
  if (symbol.line_start !== null && symbol.line_end !== null && symbol.byte_start !== null && symbol.byte_end !== null) {
    try {
      const sourceText = readFileSync(file.path, "utf8")
      const startCol = resolveRowByteColumns(sourceText, symbol.line_start, symbol.byte_start)
      const endCol = resolveRowByteColumns(sourceText, symbol.line_end, symbol.byte_end)
      if (startCol === null || endCol === null) {
        // Impossible coordinates: omit the range, keep the honest content.
      } else {
        const mapper = createPositionMapper(sourceText)
        const indexRange = {
          start: { line: startCol.line, column: startCol.column } satisfies IndexPosition,
          end: { line: endCol.line, column: endCol.column } satisfies IndexPosition,
        }
        range = mapper.indexRangeToLsp(indexRange)
      }
    } catch (error) {
      if (!(error instanceof PositionError)) throw error
      // Unreadable file or impossible positions: omit the range honestly,
      // keep the hover content.
    }
  }

  // Response range: when the cursor sat on an identifier that resolved to a
  // declaration OUTSIDE the containing range (a call site or member read),
  // highlight the identifier AT THE CURSOR — not the remote declaration.
  // Falls back to null (no decoration) on any impossible coordinate; the
  // decl range stays the definition/actions anchor below.
  // "Jumped" = resolved through an occurrence to a declaration that does NOT
  // contain the cursor (call site / member read / cross-file reference).
  const jumped = occurrence !== null && (containing === null || containing.symbol.id !== symbol.id)
  let responseRange = range
  if (jumped) {
    try {
      const sourceText = readFileSync(request.filePath, "utf8")
      const startCol = resolveRowByteColumns(sourceText, occurrence.occurrence.startLine, occurrence.occurrence.startColumn)
      const endCol = resolveRowByteColumns(sourceText, occurrence.occurrence.startLine, occurrence.occurrence.endColumn)
      if (startCol !== null && endCol !== null) {
        const cursorMapper = createPositionMapper(sourceText)
        responseRange = cursorMapper.indexRangeToLsp({
          start: { line: startCol.line, column: startCol.column } satisfies IndexPosition,
          end: { line: endCol.line, column: endCol.column } satisfies IndexPosition,
        })
      }
    } catch (error) {
      if (!(error instanceof PositionError)) throw error
      responseRange = null
    }
  }

  const data: SymbolHoverData = {
    name: symbol.name,
    qualifiedName: symbol.qualified_name,
    symbolType: symbol.symbol_type,
    signature: buildSignature(symbol),
    usageCount,
    evidenceTiers: tiers,
    // M42.H2: rich sections composed from stored relationship rows.
    connectedSection: connectedSummarySection(connectedGroups(sites)),
    usagesSection: usagesSection(usageSiteRows, usageCount, symbol.name, file.path, request.position.line, request.position.character),
    // LSP definition location (range.start) when resolvable; null otherwise
    // (the footnote then renders the plain location — still honest).
    definition: range === null ? null : { line: range.start.line, character: range.start.character },
    // M42.H4: the actions row targets the same resolved declaration (the
    // actions carry the server-resolved symbol identity — issue #652).
    actionsSection:
      range === null ? "" : actionsSection(symbol.name, file.path, range.start.line, range.start.character),
    crossLanguageSection: crossSection,
    annotationSection,
    stale,
    freshnessStatus,
    filePath: file.path,
    lineStart: symbol.line_start,
    lineEnd: symbol.line_end,
  }

  const elapsed = (deps.now ?? Date.now)() - startedAt
  void elapsed // latency measured by the verifier; kept for symmetry

  return {
    contents: { value: formatHoverMarkdown(data), kind: "markdown" },
    range: responseRange,
    data,
    provenance: {
      source: "bb_index",
      evidenceClass: stale ? "stale" : (tiers[0] ?? "unknown"),
      engine: "bb_lsp hover@m24.l2",
      limitations: [
        "index-sourced; no compiler-backed types (complement stance)",
      ],
      stale,
    },
  }
}
