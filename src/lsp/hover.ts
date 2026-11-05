// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the `textDocument/hover` handler: resolve the symbol under
//   the cursor, then assemble the card (signature, type provenance, usage count
//   with its declared scope and unit, evidence tiers, connected/usage/containment
//   sections, actions, cross-language facts, annotations, freshness) and render
//   it as human markdown plus the structured `SymbolHoverData`.
// WHICH TOOL IT SERVES — the IDE surface of the index: every bb tool whose
//   evidence appears in a hover (bb_graph, bb_impact, bb_cross_language,
//   bb_annotate / bb_annotations) plus bb_lsp itself.
// WHY IT IS SHAPED THIS WAY — one collection feeds the count, the list and the
//   connected summary (§14 Truth Rule 1: count = rendered rows + declared
//   remainder); a stored row the surface refuses (a call-site line the source
//   cannot confirm) is OMITTED AND COUNTED on the card, never silently dropped;
//   absence is declared (an empty section, nothing rendered) rather than rendered
//   as zero; every rendered block states what its data is and how far to trust it.
// WHERE ITS EVIDENCE LIVES — script/m24/verify-hover-docs.ts,
//   script/m55/verify-hover-coverage.ts, script/m24/verify-usage-scope.ts,
//   script/m28/verify-annotation-ui.ts, validation/m55/results/T3.json (the
//   past-EOF omission), validation/tools/bb_annotate/ and
//   validation/tools/cross-language/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/rich_hover.ts (the one collector
//   and the section renderers), src/lsp/relations.ts (the usage vocabulary),
//   src/lsp/signature.ts (signature rendering), src/lsp/evidence_tier.ts (the
//   trust tier), src/lsp/cross_language_hover.ts, src/lsp/annotation_ui.ts,
//   src/brain/annotation-store.ts (annotation identity).
// CONTRACTS IT MUST NOT BREAK — every content block states what the data is, how
//   much to trust it, and whether it is stale; a section is empty (nothing
//   rendered) when its evidence is absent; the trust tier is derived, never
//   asserted; a zero usage count is stated together with the scope it was
//   measured over; an omitted row is declared with its count.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { checkFileFreshness } from "../brain/freshness"
import {
  createPositionMapper,
  PositionError,
  resolveRowByteColumns,
  type IndexPosition,
  type LspPosition,
  type PositionConverter,
} from "./positions"
import { storedCrossLanguageRows, factsFromRows, crossLanguageSection } from "./cross_language_hover"
import { annotationHoverSection, type AnnotationRow } from "./annotation_ui"
import { countUsageSites, countUnresolvedNameMatches, USAGE_SITE_FILTER_LABEL, type UnresolvedNameMatches } from "./relations"
import { classifyStoredRow, orderTiers, primaryTier, type EvidenceTier, type StoredTierRow } from "./evidence_tier"
import { parseParameters, renderSignature, UNRESOLVED_TYPE } from "./signature"
// PHASE C (inbound model companion): the parse is shared through ONE bounded, content-addressed cache
// (`src/lsp/hover_cache.ts`), the cursor occurrence is a targeted tree lookup instead of a linear scan over
// every identifier in the file, and the doc comment is read at the single point the rule can accept. This
// replaces `parseForSafety`, whose three full-tree walks accounted for 63% of a 225 KiB hover (measured in
// the cache module's header): hover used ONE occurrence and ONE comment out of all of them.
import { ParseUnavailable, docCommentAt, occurrenceAtPoint, parseForCursor, type CursorParse } from "./hover_cache"
import { renderTypeLine, resolveTypeLine, type TypeLine } from "./type_inference_surface"
import { actionsSection, connectedGroups, connectedSummarySection, containmentSection, definitionLink, richSitesForSymbol, usageSitesOf, usagesSection, type UsageCollectionOmissions } from "./rich_hover"

/** The launch set, its membership test, and the path→language map live in
 *  the single-owner module (one owner; the set was duplicated here
 *  and in server.ts — a drift hazard the wave found). */
import { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath } from "./launch_languages"
export { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath }

/** Evidence tiers for relationship data, per the evidence class vocabulary.
 *  the hover tier is derived by the SINGLE owner
 *  (src/lsp/evidence_tier.ts) — the same rule the W4 legend and the hub row
 *  chips use. Before T5 this file carried its own copy of the rule whose
 *  legacy coarse map answered "indexed" for `imports`/`references`/`uses`
 *  while the same stored row rendered `import_based`/`usage_contextual` in
 *  the hub and the legend declared a five-tier vocabulary with no "indexed"
 *  in it (found live by the T5 step-zero wire probe; see the owner's header).
 *  Rationale for the structural set and the 0.7 floor is the F7 fixture
 *  script/m29/r5-tier-fixture.ts: the pre-R5 map had 10 entries and dumped
 *  parser-deterministic facts (contains, instantiates, exports) into
 *  "inferred" — measured 42.5% of giant-corpus relationships downgraded.
 *  The vocabulary/derivation are drift-gated by script/m55/verify-tiers.ts
 *  and script/m29/verify-precision-improvements.ts (F6, retargeted to the
 *  owner when the rule moved). */
export type { EvidenceTier } from "./evidence_tier"

export interface SymbolHoverData {
  name: string
  qualifiedName: string | null
  symbolType: string
  signature: string
  /** (§14 Truth Rule 4): the STORED structured parameters, typed and
   *  unrendered — the wire keeps the machine data while the rendered signature
   *  is human text (a client that wants the structured form reads this, never
   *  the markdown). null when the index stores no structured list (declared
   *  absence); an empty array is a callable with zero parameters. */
  parameters: Array<{ name: string; type: string | null; isOptional: boolean; defaultValue: string | null; isRest: boolean }> | null
  usageCount: number
  /**
   * INBOUND MODEL phase B: stored rows that NAME this symbol's string but never resolved to an identity,
   * by their stored resolution basis. The usages list reads identity rows only (correct), so without this a
   * zero usage count could not distinguish "nothing references this" from "references exist but none
   * resolved" — the first of the three lies `script/m14/incoming-check.ts` documents. Null when the census
   * could not be taken (absent schema/read failure): an absence of measurement is not a measured zero.
   */
  unresolvedNameMatches: UnresolvedNameMatches | null
  /**
   * `§15.3` DECLARED OMISSION of stored usage rows. A stored `calls` row whose
   * call-site line the source file cannot confirm (the file on disk is shorter
   * than the line the store names) is not a position the index can vouch for, so
   * it is not served and not counted in `usageCount` — it is counted HERE and
   * named on the card. `textDocument/references` omits and counts the same rows
   * in its own `omittedUnresolvable`, so both surfaces answer the same set the
   * same way. Empty object / zero means "no row was refused" (a measured zero).
   */
  omittedUsageRows: Required<UsageCollectionOmissions>
  /**
   * How many files this project's index covers — the denominator for
   * `usageCount`. Null when it could not be measured; the renderer then says the
   * scope is unknown rather than implying one it does not know.
   */
  indexedFileCount: number | null
  evidenceTiers: EvidenceTier[]
  /** pre-rendered cross-language section — empty string when the
   *  index stores no cross-language rows for this symbol (the hover then
   *  renders NO cross-language text at all: absence declared in docs). */
  crossLanguageSection: string
  /** pre-rendered annotation section — empty string when the index
   *  stores no annotations for this symbol (same declared-absence contract
   *  as the cross-language section above). Author-labeled by the
   *  annotation_ui owner; an agent note never reads as index fact (D-6). */
  annotationSection: string
  stale: boolean
  freshnessStatus: "fresh" | "stale" | "missing"
  filePath: string
  lineStart: number | null
  lineEnd: number | null
  /** LSP location of the declaration (definition link); null when
   *  the range is not resolvable — the footnote then stays plain text. */
  definition: { line: number; character: number } | null
  /** pre-rendered connected-summary line — empty string when no
   *  connection facts exist (declared absence, never a placeholder). */
  connectedSection: string
  /** pre-rendered usages section — empty string when no usage
   *  sites exist (declared absence). */
  usagesSection: string
  /** Owner-decided ("show all the relationships, not just contains"): the
   *  DECLARATION CONTAINMENT section — the rows `relations.ts` deliberately
   *  excludes from the usage vocabulary (`contains`, `exports`), rendered in
   *  their own labelled block. Empty string when the symbol neither declares
   *  nor is declared by anything (declared absence). It is a separate section
   *  rather than a loosened usage list precisely so the usage law stays intact. */
  containmentSection: string
  /** pre-rendered hover-actions row (open in graph / impact /
   *  call hierarchy) — empty string when the symbol identity (declaration
   *  location) is not resolvable: no actions without a clickable target
   *  (§12.1 nothing unclickable). */
  actionsSection: string
  /** the type's PROVENANCE, decided by the one owner
   *  (src/lsp/type_inference_surface.ts). Exactly one of `stored` /
   *  `inferred` / `unknown` — the pre-T6 hover showed `brain_symbol.return_type`
   *  with no statement of whether the analyzer read it from an explicit
   *  annotation or inferred it, so a developer could not tell a declared type
   *  from a guess. `confidence` is non-null iff `inferred`; `unknown` is the
   *  declared marker, never a guess (§15.4). */
  typeLine: TypeLine
  /** the declaration's own doc comment, or "" when none is adjacent. */
  docComment: string
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
  /** The index's own spelling of the file. Annotations are written against
   *  this (or the absolute `path`), so the hover matches both. */
  relative_path: string
  language: string | null
}

// : the signature renderer moved to its ONE owner,
// src/lsp/signature.ts. The pre-M55 version interpolated the stored
// `parameters` column verbatim, so the card rendered the analyzer's raw JSON
// (`method greetAll([{"name":"names","type":"string[]",...}])`). Every
// surface that renders a signature now calls the owner with the symbol's
// language; nothing in the LSP lane interpolates `parameters` directly
// (asserted at source level by script/m55/verify-signatures.ts).
export { renderSignature, renderParameterList, UNRESOLVED_TYPE } from "./signature"

/**
 * Resolve the LSP position to an index position via the P1 component and
 * find the symbol whose indexed range contains it. Returns null when the
 * position is outside every indexed symbol (honest absence).
 */
const SYMBOL_ROW_SELECT = `s.id, s.name, s.qualified_name, s.symbol_type, s.line_start, s.line_end,
            s.byte_start, s.byte_end, s.return_type, s.parameters, s.visibility, s.file_id,
            f.id AS f_id, f.path, f.relative_path, f.language`

export function findSymbolAtPosition(
  raw: CoreDatabase,
  filePath: string,
  position: LspPosition,
  mapper?: PositionConverter,
): { symbol: SymbolRow; file: FileRow } | null {
  // Single index query: symbols in this file whose line range could contain
  // the requested line.
  //
  // Lane 6 (#the CC1 rule, §5.1): the line conversion goes through the P1
  // component. It used to be `position.line + 1` written inline in the SQL
  // argument list while the comment two lines above claimed "Position
  // conversion happens ONLY via P1" — a claim the same function contradicted,
  // which is how an off-by-one survives a gate that reads the comment. The
  // arithmetic happened to be right for a 0-based line and was wrong for
  // everything P1 owns: a line past the end of the file resolved to an index
  // line that does not exist, and the mapper's declared PositionError (the
  // contract's "never guess, fail" rule) could not be raised at all.
  //
  // `mapper` is the caller's already-built PositionMapper for this file (the
  // hover reads the file once for the occurrence path and hands it over). When
  // absent, one is built from the file's own text — the conversion is still
  // P1's, never inline arithmetic.
  let line1: number
  if (mapper !== undefined) {
    try {
      line1 = mapper.lspToIndex(position).line
    } catch (error) {
      // A position past the last line of the file is IMPOSSIBLE, not
      // not-indexed: declared absence (§13.10), and the distinction is the
      // whole reason the conversion has an owner.
      if (error instanceof PositionError) return null
      throw error
    }
  } else {
    let content: string
    try {
      content = readFileSync(filePath, "utf8")
    } catch {
      return null
    }
    try {
      line1 = createPositionMapper(content).lspToIndex(position).line
    } catch (error) {
      if (error instanceof PositionError) return null
      throw error
    }
  }

  const rows = raw
    .prepare(
      `SELECT ${SYMBOL_ROW_SELECT}
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.line_start IS NOT NULL AND s.line_end IS NOT NULL
         AND s.line_start <= ? AND s.line_end >= ?`,
    )
    .all(filePath, line1, line1) as Array<SymbolRow & { f_id: string; path: string; language: string | null }>

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
        file: { id: row.f_id, path: row.path, relative_path: (row as { relative_path?: string }).relative_path ?? "", language: row.language },
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
/**
 * How many files this project's index covers, or null when it could not be
 * measured.
 *
 * Null is NOT rendered as 0. A project whose file count cannot be read is not a
 * project with no files; "in 0 indexed files" would be a second invented zero on
 * the very line that exists to stop invented zeros.
 */
function indexedFileCountFor(raw: any, fileId: string | null | undefined): number | null {
  if (fileId === null || fileId === undefined || fileId === "") return null
  try {
    // The SAME project-from-file derivation the annotation query above uses
    // (`project_id = (SELECT project_id FROM brain_file WHERE id = ?)`), so the
    // scope is measured over exactly the project this symbol belongs to and the
    // two cannot drift. An earlier revision read `file.project_id`, which the
    // local FileRow does not carry — so it silently measured nothing and the
    // hover rendered "indexed scope unknown" on every symbol, which is honest and
    // useless.
    const row = raw
      .prepare("SELECT count(*) AS c FROM brain_file WHERE project_id = (SELECT project_id FROM brain_file WHERE id = ?)")
      .get(fileId) as { c?: number } | undefined
    const n = Number(row?.c)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export async function resolveOccurrenceSymbol(
  raw: CoreDatabase,
  filePath: string,
  position: LspPosition,
): Promise<{ symbol: SymbolRow; file: FileRow; occurrence: { startLine: number; startColumn: number; endColumn: number }; mapper: PositionConverter; docComment: string } | null> {
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
  let parsed: CursorParse
  try {
    parsed = await parseForCursor(filePath, content)
  } catch (error) {
    // Unparseable/unsupported file: honest degradation to the enclosing-symbol model — hover must never
    // reject over a parse failure. `ParseUnavailable` is the cache owner's named declaration of that case;
    // anything else is a real defect and is rethrown, never rendered as absence (§11.7).
    if (error instanceof ParseUnavailable) return null
    throw error
  }
  const cursorOcc = occurrenceAtPoint(parsed.tree, indexPos.line, indexPos.column)
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
    file: { id: row.f_id, path: row.path, relative_path: (row as { relative_path?: string }).relative_path ?? "", language: row.language },
    occurrence: { startLine: cursorOcc.startLine, startColumn: cursorOcc.startColumn, endColumn: cursorOcc.endColumn },
    // Lane 6: the mapper for THIS file's text, handed back so the containing-
    // symbol fallback can convert its line through the same owner without a
    // second read. Two P1 mappers over the same bytes would be two answers to
    // the same question, which is the drift §5.1 exists to prevent.
    mapper,
    // the declaration's own documentation, read from the comment sites
    // this parse already produced. Attached to the DECLARATION, not to the
    // cursor: a doc describes the symbol, and the cursor is often a use of it.
    // Same rule as doc_comment.ts (a comment ending on the line directly above), read from the point that
    // can satisfy it instead of a whole-file comment walk — equivalence gated line-by-line.
    docComment: docCommentAt(parsed.tree, row.line_start),
  }
}

/** Count usages of a symbol (the vocabulary's usage-site count).
 *
 * History: this counted EVERY row touching the symbol — both directions,
 * including the owning declaration and callees, undeduplicated by location.
 * On the demo index that made `greet` read "6 usages" while its list rendered
 * 6 rows (one of them its class) and the graph reported 3 callers; `greetAll`
 * read a usage it did not have while its caller set was empty. The count now
 * comes from src/lsp/relations.ts — the same rule, in SQL (independent of the
 * row materialization the hover list uses; the gate asserts the two
 * agree on a real index). */
export function countUsages(raw: CoreDatabase, symbolId: string): number {
  return countUsageSites(raw, symbolId)
}

/** Collect the symbol's evidence tiers across its stored relationships.
 *
 *  the derivation AND the ordering are the owner's
 *  (src/lsp/evidence_tier.ts) — this function only fetches the rows and
 *  hands them over. The pre-T5 version derived locally and returned
 *  `[...tiers].sort()`, an ALPHABETICAL order that made `indexed` the
 *  reported primary of any symbol that also carried structural evidence.
 *
 *  scale fix kept: UNION rewrite (see countUsages) — same tier set,
 *  two indexed probes instead of one full scan. */
export function evidenceTiersFor(raw: CoreDatabase, symbolId: string): EvidenceTier[] {
  const rows = raw
    .prepare(
      "SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE target_symbol_id = ? UNION SELECT relationship_type, confidence, metadata FROM brain_relationship WHERE source_symbol_id = ?",
    )
    .all(symbolId, symbolId) as StoredTierRow[]
  return orderTiers(rows.map(classifyStoredRow))
}

/** Format the hover markdown, including the honesty block. */
export function formatHoverMarkdown(data: SymbolHoverData): string {
  const lines: string[] = []
  lines.push(`\`\`\`\n${data.signature}\n\`\`\``)
  // the type line, rendered by its single owner. Placed DIRECTLY UNDER
  // the signature so the two cannot be read as unrelated facts, and it states
  // its own provenance: `inferred` carries the engine's confidence, `stored`
  // declares that the index records no origin, `unknown` is the declared
  // marker with the reason. §15.4 human text is human — this is a sentence, not
  // a serialization.
  // the author's own words about the symbol, rendered directly UNDER the
  // signature — the same position IntelliJ and rustdoc put it, so the prose and
  // the declaration read as one fact about one thing rather than as two
  // disconnected blocks.
  //
  // Rendered only when a comment is ADJACENT to the declaration (doc_comment.ts
  // decides). An absent doc contributes NO line: no empty section, no
  // placeholder. "This symbol has no documentation" is itself information, and a
  // blank heading would render it as an omission to be filled in later rather
  // than as the fact it is.
  if (data.docComment.length > 0) {
    lines.push(data.docComment)
    lines.push("")
  }
  lines.push(renderTypeLine(data.typeLine))
  // the count line declares what was counted, so a reader (and the
  // references surface, which legitimately answers a wider question when the
  // client asks for the declaration too) can never read two numbers as a
  // disagreement. Zero is stated, never omitted: a symbol with no stored
  // references reads "0 usages", not silence (§14 Truth Rule 1).
  lines.push(
    `**${data.name}** — ${data.symbolType}, ${data.usageCount} usage${data.usageCount === 1 ? "" : "s"}${
      data.indexedFileCount === null
        ? " (indexed scope unknown — this count is bounded by something not measured)"
        : ` in ${data.indexedFileCount} indexed file${data.indexedFileCount === 1 ? "" : "s"}`
    } _(${USAGE_SITE_FILTER_LABEL})_`,
  )
  if (data.evidenceTiers.length > 0) {
    lines.push(`evidence: ${data.evidenceTiers.join(", ")}`)
  } else {
    lines.push("evidence: none (no indexed relationships)")
  }
  // the rich sections. Empty strings render nothing — declared
  // absence (no connection facts / no usage sites) is never fabricated.
  if (data.connectedSection && data.connectedSection.length > 0) {
    lines.push(data.connectedSection)
  }
  if (data.usagesSection && data.usagesSection.length > 0) {
    lines.push(data.usagesSection)
  }
  // §15.3 DECLARED OMISSION. The usages list serves only positions the index can
  // vouch for, which means a stored row whose call-site line is past the end of
  // the caller's file is refused by the collector. A refusal that is not stated
  // is a silent under-count, so it is stated here, in the same words the
  // references surface uses for the same rows. The count line above stays the
  // truth about SERVED usages (zero stays zero); this line says what was omitted
  // and why, so the two can never be read as a complete account of the store.
  if (data.omittedUsageRows.unresolvable > 0) {
    const n = data.omittedUsageRows.unresolvable
    lines.push(
      `**usages omitted** — ${n} stored row${n === 1 ? "" : "s"} name a call-site line past the end of the source file, so ${n === 1 ? "it is" : "they are"} not served (§15.3: omitted and counted, never clamped); \`textDocument/references\` omits the same ${n === 1 ? "row" : "rows"}.`,
    )
  }
  // INBOUND MODEL phase B: the usages list is IDENTITY rows only, so a zero there is not the same claim as
  // "nothing names this". When the store holds string-only rows naming the symbol, say so — and say which of
  // the two states they are in (`external` = a known-external identity no declaration here can be,
  // `unresolved` = a reference the store could not attribute). This is the disclosure that turns the three
  // lies into three named states.
  if (data.unresolvedNameMatches && data.unresolvedNameMatches.total > 0) {
    const m = data.unresolvedNameMatches
    lines.push(
      `**name matches without identity** — ${m.total} stored row${m.total === 1 ? "" : "s"} name \`${m.name}\` but resolve to no indexed declaration (${m.external} classified external, ${m.unresolved} unresolved); these are not counted as usages.`,
    )
  }
  // The declaration-containment block, AFTER the usages section and in its own
  // labelled header. Order matters for the negative test: a reader (and the
  // gate) meets the usages list first, so a `contains` row can only ever be read
  // as the containment it is.
  if (data.containmentSection && data.containmentSection.length > 0) {
    lines.push(data.containmentSection)
  }
  // the actions row — the hover is the entry point to the deep
  // surfaces (graph, impact, call hierarchy). Empty row renders nothing
  // (declared absence: no symbol identity, no actions to offer).
  if (data.actionsSection && data.actionsSection.length > 0) {
    lines.push(data.actionsSection)
  }
  // cross-language facts ONLY from stored rows (is_cross_language = 1).
  // An empty section renders nothing — a pair with no stored rows states
  // nothing cross-language in the UI; absence is declared in docs, not faked
  // (; mutation-gated: a fabricated fact fails the W3 suite).
  if (data.crossLanguageSection && data.crossLanguageSection.length > 0) {
    lines.push(data.crossLanguageSection)
  }
  // agent/human annotations, author-labeled. Empty section renders
  // nothing — declared absence, never a placeholder (same law as W3 above).
  if (data.annotationSection && data.annotationSection.length > 0) {
    lines.push(data.annotationSection)
  }
  if (data.stale) {
    lines.push(`⚠️ **stale** — file changed since indexing (${data.freshnessStatus})`)
  }
  // the source footnote is the definition link — its target is the
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
  //
  // ONE file read feeds both resolvers (lane 6): `resolveOccurrenceSymbol`
  // already reads the file and builds a P1 mapper for the file at the cursor,
  // and `findSymbolAtPosition` now takes that mapper instead of re-reading and
  // re-deriving the line conversion. Before this the fallback path did its own
  // read AND its own inline `line + 1`.
  const occurrence = await resolveOccurrenceSymbol(raw, request.filePath, request.position)
  const containing = findSymbolAtPosition(raw, request.filePath, request.position, occurrence?.mapper)
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
  // usage sites = the L3 references row set, resolved through the
  // navigation location owner. Used for the connected summary, the top-3
  // usage links AND the count (one collection, three renderings).
  //
  // The THIRD argument is the §15.3 omission counter: a stored usage row whose
  // call-site line the source cannot confirm is refused by the collector and
  // counted here, so the card can declare it instead of silently under-counting.
  // `textDocument/references` applies the same bound to the same rows, which is
  // what makes hover's count and references' count the same answer.
  const omittedUsageRows: UsageCollectionOmissions = { unresolvable: 0 }
  const sites = richSitesForSymbol(raw, symbol.id, omittedUsageRows)
  // (§14 Truth Rule 1): the count IS this array's length — the number
  // of rows the usages list can show (the `+N more` rest included, since the
  // list is capped at MAX_USAGE_LINKS and reports the remainder). The
  // vocabulary filter (declaration/callee exclusion) lives in relations.ts;
  // it is applied once here, and the section renders the same filtered array.
  const usageSiteRows = usageSitesOf(sites)
  const usageCount = usageSiteRows.length
  // Rows that NAME this symbol's string but resolved to no identity: counted by stored basis so the absence
  // of a usage list can be NAMED rather than left as a bare zero (inbound model, phase B).
  const unresolvedNameMatches = countUnresolvedNameMatches(raw, symbol.id)
  // THE SCOPE THE COUNT WAS MEASURED OVER. A usage count is only
  // meaningful beside what was searched, and a zero is the case that misleads:
  // the owner hovered `formatAddress` and read "0 usages", which is TRUE of the
  // index (201 files, all of `src/`) and FALSE of the repository, where the
  // function is called 5 times in `script/`. Nothing was wrong with the number;
  // the sentence made a local measurement read as a global claim.
  //
  // The count stays — §14 Truth Rule 1 requires the zero to be stated rather
  // than omitted, and that is right. What was missing is the bound. The
  // qualifier is shown for EVERY count, not only for zero: a qualifier that
  // appeared only on the zero would imply the non-zero counts were global, which
  // is the same mistake in the other direction.
  const indexedFileCount = indexedFileCountFor(raw, file.id)
  // per-pair cross-language facts from stored rows only.
  const crossSection = crossLanguageSection(factsFromRows(storedCrossLanguageRows(raw, symbol.id), file.language))
  // annotation rows for this symbol, rendered by the single owner.
  // Project scoped via the symbol's file row (hover has no projectId param).
  //
  // Scoped to THIS FILE's copy of the name, plus name-level notes. It used to
  // select on symbol_name alone, so a note an agent attached to one file's
  // `force` was rendered under every other file's `force` too — the index holds
  // one symbol per (file, name, line), so a name measured on a real corpus in 8
  // files rendered one file's opinion as if it described the file under the
  // cursor. Name-level notes (written with no path) still show, because they
  // are about the name and apply wherever it appears.
  //
  // Both path spellings are matched: the index stores `relative_path`, and an
  // agent annotating with the absolute path it was just handed would otherwise
  // have its note silently invisible here.
  //
  // The name predicate matches BOTH name forms: the symbol's own name AND its
  // qualified name. It used to match only `name`, so a note an agent attached to
  // a qualified name — what it reads in source, and what the index publishes for
  // 27% of symbols — matched nothing. Measured on a real corpus, 1046 of 1046
  // qualified-name notes were stored, readable, reported as surfacing, and never
  // displayed. This is the same predicate annotationReachability() measures, so
  // the write door's surfacing claim and this read cannot drift apart again.
  const annotationRows = raw.prepare(
    "SELECT symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = (SELECT project_id FROM brain_file WHERE id = ?) AND (symbol_name = ? OR symbol_name = ?) AND (symbol_path IS NULL OR symbol_path = ? OR symbol_path = ?) ORDER BY time_updated DESC, id",
  ).all(file.id, symbol.name, symbol.qualified_name, file.relative_path, file.path) as AnnotationRow[]
  const annotationSection = annotationHoverSection(annotationRows)

  // The definition location (declaration of the hovered symbol) is the hover
  // response RANGE, resolved through the P1 component below; it is computed
  // BEFORE the data object so the footnote can carry it as the definition
  // link (§12.1: the source footnote must navigate).
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

  // the type's provenance, decided by the facade. It runs AFTER the
  // freshness check above so the line can carry the file's staleness (§4.3),
  // and it never throws out of the hover: a facade failure degrades to the
  // declared unknown marker, because a hover that rejects over a type is the
  // defect class all over again (one unresolvable row must not fail the
  // whole card).
  let typeLine: TypeLine
  try {
    const typeSource = readFileSync(file.path, "utf8")
    typeLine = (
      await resolveTypeLine(
        file.path,
        typeSource,
        {
          name: symbol.name,
          symbol_type: symbol.symbol_type,
          return_type: symbol.return_type,
          line_start: symbol.line_start,
          line_end: symbol.line_end,
          language: file.language,
        },
        symbol.return_type,
      )
    ).line
    typeLine.stale = stale
  } catch {
    typeLine = {
      provenance: "unknown",
      text: UNRESOLVED_TYPE,
      confidence: null,
      reason: "the type could not be resolved; the hover renders the declared marker",
      withheld: "parse-failed",
      withheldText: null,
      storedProvenanceUnknown: false,
      stale,
      witness: null,
    }
  }

  const data: SymbolHoverData = {
    name: symbol.name,
    qualifiedName: symbol.qualified_name,
    symbolType: symbol.symbol_type,
    signature: renderSignature(symbol, file.language),
    // structured data stays structured (see the field's declaration).
    parameters: (() => {
      const parsed = parseParameters(symbol.parameters)
      if (parsed.shape === "empty") return []
      if (parsed.shape !== "list") return null
      return parsed.entries.map((e) => ({
        name: e.name,
        type: e.type ?? null,
        isOptional: e.isOptional === true,
        defaultValue: e.defaultValue ?? null,
        isRest: e.isRest === true,
      }))
    })(),
    usageCount,
    unresolvedNameMatches,
    omittedUsageRows,
    indexedFileCount,
    evidenceTiers: tiers,
    // rich sections composed from stored relationship rows.
    connectedSection: connectedSummarySection(connectedGroups(sites)),
    usagesSection: usagesSection(usageSiteRows, usageCount, symbol.name, file.path, request.position.line, request.position.character),
    // The declaration-containment rows come from the SAME collected array the
    // usage list and the connected summary read (one collection, three
    // renderings), so a containment count can never disagree with a usage count
    // about the same rows.
    containmentSection: containmentSection(sites),
    // LSP definition location (range.start) when resolvable; null otherwise
    // (the footnote then renders the plain location — still honest).
    definition: range === null ? null : { line: range.start.line, character: range.start.character },
    // the actions row targets the same resolved declaration (the
    // actions carry the server-resolved symbol identity — ).
    actionsSection:
      range === null ? "" : actionsSection(symbol.name, file.path, range.start.line, range.start.character),
    crossLanguageSection: crossSection,
    annotationSection,
    stale,
    freshnessStatus,
    filePath: file.path,
    lineStart: symbol.line_start,
    lineEnd: symbol.line_end,
    typeLine,
    docComment: occurrence?.docComment ?? "",
  }

  const elapsed = (deps.now ?? Date.now)() - startedAt
  void elapsed // latency measured by the verifier; kept for symmetry

  return {
    contents: { value: formatHoverMarkdown(data), kind: "markdown" },
    range: responseRange,
    data,
    provenance: {
      source: "bb_index",
      // the primary is the STRONGEST tier the symbol carries, by the
      // declared rank — a member of `tiers` by construction, so the primary
      // can never disagree with the tier list it headlines.
      evidenceClass: stale ? "stale" : primaryTier(tiers),
      engine: "bb_lsp hover@m24.l2",
      limitations: [
        "index-sourced; no compiler-backed types (complement stance)",
      ],
      stale,
    },
  }
}
