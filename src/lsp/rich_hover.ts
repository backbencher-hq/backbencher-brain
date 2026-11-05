// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — M42.H2 (issue #650): the rich hover sections, and the ONE
//   collector of the rows a symbol's card can render (connected summary, usage
//   sites, declaration containment, actions). It owns the per-request location
//   resolution and the served-position dedupe, and it owns the omission of a
//   stored position the source cannot confirm (§12.1, §15.3).
// WHICH TOOL IT SERVES — bb_lsp `textDocument/hover` (the editor card), and every
//   consumer that needs the same row set: script/m24/verify-hover.ts,
//   script/m42/verify-rich-hover.ts, script/m55/verify-hover-coverage.ts,
//   script/m55/verify-relations.ts.
// WHY IT IS SHAPED THIS WAY — the hover is the most-read surface in the product,
//   so a row that cannot be rendered honestly is OMITTED AND COUNTED rather than
//   snapped to a plausible range: the usage vocabulary comes from the one owner
//   (src/lsp/relations.ts), the address verdict comes from the one owner
//   (src/intelligence/graph/line-address.ts), and the line table used to bound a
//   stored call site is the one positions.ts mapper — never a second `split("\n")`.
// WHERE ITS EVIDENCE LIVES — validation/m24/results/HOVER.json,
//   validation/m42/results/, validation/m55/results/T3.json and
//   HOV-COVERAGE.json; the past-end-of-file omission is measured by the M55.T3 R5
//   fixture and reported on the card as "usages omitted".
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/hover.ts (the caller and the
//   renderer), src/lsp/relations.ts (the usage vocabulary), src/lsp/navigation.ts
//   (the L3 references surface: the same address rule and the same omission
//   taxonomy must be applied by both surfaces), src/intelligence/graph/
//   line-address.ts (the address owner).
// CONTRACTS IT MUST NOT BREAK — one collection feeds the count, the list and the
//   connected summary (§14 rule 1: count == rendered rows + declared remainder);
//   a declaration containment and a callee are never usage sites (the vocabulary
//   owner decides, this file obeys); a row whose stored position the source
//   cannot confirm is omitted and counted, never served (§12.1, §15.3); a
//   row-level failure never throws out of the hover.
// ─────────────────────────────────────────────────────────────────────────────
// src/lsp/rich_hover.ts — M42.H2 (issue #650): the rich hover sections.
//
// The SINGLE owner of the H2 surface:
//   1. connected summary — "calls X, called by Y, implements Z" from STORED
//      brain_relationship rows (relationship_type as the analyzer wrote it),
//      display verbs assigned by direction (never guessed from names).
//   2. top-3 usage links + "N more" — every link target is an index-stored
//      location, resolved through navigation.ts's edgeLocation (the SAME
//      location builder the L3 references surface uses — one owner, so the
//      hover's links and the native references tree can never disagree).
//   3. definition link (declaration of the hovered symbol).
//
// Honesty law (IDE Honesty Contract §12.1): nothing unclickable, no guessed
// link. A site renders only when its other end is a REAL indexed symbol with
// a resolvable location; rows whose other end is NULL/external never render.
// Rows of purely structural kinds (contains/exports) are DECLARATIONS, not
// usages: they render in their own labelled containment section and never in
// the connection summary or the usage list.
// Staleness is inherited from the hover response — this module never claims
// freshness (contract §12.2).
//
// DECLARED ABSENCE, in ONE place, with reasons (contract §11.7 + the owner's
// ratified decision "the hover should show all the relationships, not just
// contains" — every stored kind reaches the card as a labelled relationship or
// is DECLARED here, with the reason it is not; nothing is silently unlabelled).
//
// The table lives beside the verb tables (not in a gate) because it is a
// statement about the SURFACE, and a statement about a surface has to live with
// the surface: a register only a test owns is a register the surface can fail to
// keep honest.

import { readFileSync, statSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { edgeLocation } from "./navigation"
import { PositionError, createPositionMapper } from "./positions"
import {
  isDeclarationRelationship,
  usageSites,
  USAGE_COUNT_UNIT_LABEL,
  USAGE_SITE_FILTER_LABEL,
} from "./relations"
import {
  ADDRESS_NOTES,
  addressLine0,
  deriveCallSiteAddress,
  isExactAddress,
  STORED_LINE_SELECT,
  storedLineFromRow,
} from "../intelligence/graph/line-address"
import type { CallSiteAddress } from "../intelligence/contracts"
import { enrichmentIsStale, hasDisplayableEnrichment, describeEnrichment, parseEnrichment, type Enrichment } from "./enrichment"

/** A resolved usage site: the OTHER end of an edge touching the hovered
 *  symbol, with the index-stored location (LSP coordinates via P1). */
export interface RichSite {
  /** other-end symbol name as indexed */
  name: string
  symbolType: string | null
  /** index-stored location — LSP 0-based, via navigation.edgeLocation */
  path: string
  line: number
  character: number
  endLine: number
  endCharacter: number
  /** relationship_type as the analyzer wrote it (source -> target) — the FIRST
   *  stored kind at this location, kept as the primary so existing readers of
   *  this field keep working. Read `relationshipTypes` for the whole set. */
  relationshipType: string
  /** EVERY stored kind at this location, in stored order.
   *
   *  This field exists because the collector deduplicates sites by location, and
   *  two stored rows of DIFFERENT kinds can share one location: `reset uses
   *  items` and `reset references items` are two stored relationships whose far
   *  end is the same symbol on the same line. The first draft kept only the
   *  first kind and dropped the second, so a real stored row of a real kind
   *  rendered NOWHERE — and the coverage audit scored `references` at 0% for a
   *  reason that had nothing to do with its verb table. §13.2: "when a symbol
   *  relates through several relationship types, the group states the count and
   *  names the types. Nothing is merged into silence." One location may still
   *  render ONE usage row (§13.1), and it does — but the kinds are all named. */
  relationshipTypes: string[]
  /** true when the hovered symbol is the TARGET of the row */
  reversed: boolean
  /** confidence as stored (ordering only; tiers render globally) */
  confidence: number | null
  /** M42.H3: stored enrichment of the relationship row — null when the row
   *  is un-enriched (declared absence); parsed only, never inferred here. */
  enrichment: Enrichment | null
  /** M42.H3: enrichment is stale when computed before the row last changed. */
  enrichmentStale: boolean
  /** Lane 6 (§14 rule 3): where this site is, as the ONE address owner
   *  (src/intelligence/graph/line-address.ts) classified the row's STORED
   *  call-site line — derived from the row's SOURCE end, because the store
   *  records the line where the source wrote the reference, never a line in the
   *  far end's file. This is the owner's verdict, passed through and never
   *  re-derived here.
   *
   *  - "call-site": the store holds a real call-site line. It is SERVED when the
   *    row is a usage row (incoming, non-declaration), where the link opens THAT
   *    line in the caller's file. For an outgoing or declaration row the link
   *    opens the far end's index-stored DECLARATION instead — a call-site line
   *    from this symbol's file would be an invented position in the far end's
   *    file, which is the §6 defect this field's `opening` rule fixes.
   *  - "declaration": the store holds no call-site line (NULL, or the legacy
   *    `0` placeholder), so a usage link opens the referencing symbol's
   *    declaration and SAYS SO on the card (ADDRESS_NOTES.substitute). The
   *    substitution is declared, never silent (§14 rule 2).
   *  - "unknown": the store holds something that is not a position at all.
   *    No line is claimed; the row falls back to the declaration location and
   *    the card states the store-contract fact.
   *
   *  Before this field the hover had NO way to say which of the three it was
   *  doing — it always linked the declaration and never said so, which is how
   *  validation/m42/results/KNOWN-GAPS.json came to carry "usage links point
   *  at the referencing symbol's declaration" as a limitation while
   *  `brain_relationship.line_number` sat unread in the very row it was
   *  reading. */
  callSite: CallSiteAddress
}

export const MAX_USAGE_LINKS = 3

// ---------------------------------------------------------------------------
// THE LINE-COUNT CACHE — a stat-keyed, bounded, cross-request cache of one fact
// ---------------------------------------------------------------------------
//
// Why it exists: the §12.1/§15.3 source bound (a stored call-site line must be a
// line the file actually has) needs the file's line count for every usage row.
// Deriving it from bytes is a whole-file read + split + mapper build, and a WARM
// hover pays that again on every request; on the M55 R6 "many distinct files"
// shape that alone pushed the warm p95 from 34.4 ms to 51.3 ms — a red latency
// gate for a bound the product genuinely needs. The count is a property of the
// FILE, not of the request, so it is cached here.
//
// THE HONESTY CONTRACT (mirrors src/brain/freshness.ts's own evidence choice):
// an entry is used only when `statSync` now reports the SAME `mtimeMs` and
// `size` that were recorded with the count. Any mismatch discards the entry and
// the count is re-derived from current bytes. The declared residual: a file
// replaced with different bytes of exactly the same size while its mtime is also
// preserved is treated as unchanged — mtime+size is the same evidence the
// freshness system itself accepts, and the alternative (re-reading every file on
// every hover) is the latency defect this cache exists to remove. Bounded to
// LINE_COUNT_CACHE_MAX entries, recency-refreshed on hit; each entry is a path
// plus three numbers.
const LINE_COUNT_CACHE_MAX = 512
const lineCountCache = new Map<string, { mtimeMs: number; size: number; lineCount: number }>()

/** The cached line count for `path`, or null when there is no entry or its
 *  recorded `(mtimeMs, size)` no longer matches the file on disk. Never invents:
 *  an unreadable file returns null and is not cached. */
function cachedLineCount(path: string): number | null {
  let stat: { mtimeMs: number; size: number }
  try {
    const st = statSync(path)
    stat = { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
  const entry = lineCountCache.get(path)
  if (entry === undefined) return null
  if (entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
    // The file changed since the count was taken: drop the stale entry and let
    // the caller re-derive from current bytes. A stale count is an honesty
    // defect (it would omit a real row or serve a past-EOF one), so this branch
    // is the contract, not an optimisation detail.
    lineCountCache.delete(path)
    return null
  }
  // Recency refresh: Map preserves insertion order, so re-inserting the hit
  // moves it to the newest position and the eviction below removes the least
  // recently used entry.
  lineCountCache.delete(path)
  lineCountCache.set(path, entry)
  return entry.lineCount
}

/** Record a line count under the file's CURRENT `(mtimeMs, size)`, evicting the
 *  least-recently-used entry past the bound. A stat failure records nothing:
 *  without the evidence the entry could never be validated. */
function rememberLineCount(path: string, lineCount: number): void {
  let stat: { mtimeMs: number; size: number }
  try {
    const st = statSync(path)
    stat = { mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return
  }
  lineCountCache.delete(path)
  lineCountCache.set(path, { ...stat, lineCount })
  while (lineCountCache.size > LINE_COUNT_CACHE_MAX) {
    const oldest = lineCountCache.keys().next()
    if (oldest.done === true) break
    lineCountCache.delete(oldest.value)
  }
}

/** Test/ops hook: the cache's current size (0 after a reset). Exported so a gate
 *  can prove the cache is bounded and actually used, rather than assume it. */
export function lineCountCacheSize(): number {
  return lineCountCache.size
}

/** Test/ops hook: drop every entry. Only a gate needs this (to measure a cold
 *  run against a warm one); the product never calls it. */
export function resetLineCountCache(): void {
  lineCountCache.clear()
}

// ---------------------------------------------------------------------------
// THE COVERAGE DENOMINATOR
//
// The FOURTEEN relationship kinds the index EMITS, enumerated by the MCP graph
// tool's own `relationshipTypes` parameter description
// (src/mcp/tools/bb_graph/descriptor.ts; it lived inline in
// src/mcp/tool-registry.ts before the registry was split into per-tool
// descriptors, and the drift gate's anchor follows it). This list is the
// denominator for "does the hover show all the relationships". It is duplicated
// here rather than imported — the tool descriptor is a large module and the LSP
// lane does not depend on it — so the two are COMPARED by the drift gate in
// script/m55/verify-hover-coverage.ts instead of being assumed equal. A
// denominator nobody re-checks is a denominator that rots.
//
// THE FOUR EXTENDED KINDS (2026-10-18 vocabulary extension, src/ast/types.ts):
//   decorates  decorated declaration -> decorator (parser-deterministic)
//   renders    rendering component -> rendered component (parser-deterministic)
//   mixes_in   class -> mixin composed into its supertype chain (parser-deterministic)
//   part_of    a `part`/`part of` DIRECTIVE, whose direction is the directive's
//              own (module-level, like imports; metadata.partRole names which end
//              is the library)
// The hover's tier owner (src/lsp/evidence_tier.ts) already classifies all four:
// the first three structural, `part_of` import-based. Leaving them out of THIS
// list was the drift: a card could not even say "this row is not a symbol
// relationship" for a kind the index stores, and the M55 drift gate (V1c) was
// the only thing that noticed.
// ---------------------------------------------------------------------------
export const CANONICAL_RELATIONSHIP_KINDS = [
  "calls",
  "extends",
  "implements",
  "uses",
  "instantiates",
  "overrides",
  "contains",
  "references",
  "imports",
  "exports",
  "decorates",
  "renders",
  "mixes_in",
  "part_of",
] as const

export type CanonicalRelationshipKind = (typeof CANONICAL_RELATIONSHIP_KINDS)[number]

/**
 * Stored spellings that are NOT canonical kinds, kept because the index really
 * carries them and a table with no entry for a spelling that exists is how
 * `references` stayed invisible for waves. Each alias names the canonical kind
 * it is a spelling OF, so an alias cannot become a second answer.
 *
 * `call` and `inherits` are real: the M24-era fixtures write `call` and five
 * analyzers write `inherits`. `import`/`use`/`reference`/`usage` are the
 * singular spellings `evidence_tier.ts` already recognizes as tier inputs.
 */
export const RELATIONSHIP_KIND_ALIASES: Readonly<Record<string, CanonicalRelationshipKind>> = {
  call: "calls",
  inherits: "extends",
  import: "imports",
  use: "uses",
  usage: "uses",
  reference: "references",
}

/** The canonical kind a stored spelling names, or null when the index carries a
 *  kind outside the fourteen (a non-canonical writer's spelling). */
export function canonicalKind(relationshipType: string): CanonicalRelationshipKind | null {
  const t = relationshipType.trim().toLowerCase()
  if ((CANONICAL_RELATIONSHIP_KINDS as readonly string[]).includes(t)) return t as CanonicalRelationshipKind
  return RELATIONSHIP_KIND_ALIASES[t] ?? null
}

// ---------------------------------------------------------------------------
// VERB TABLE — every canonical kind, both directions
// ---------------------------------------------------------------------------
//
// The owner's ratified decision: "the hover should show all the relationships,
// not just contains". Before this wave the table carried SEVEN spellings and no
// entry for `uses`, `references` or `imports`, so those kinds rendered with no
// label at all — most of a measured 12.5% verb coverage.
//
// ONE table, keyed on the canonical kind, both directions. Keyed on the KIND
// rather than on the stored spelling so `call` and `calls` cannot read
// differently; the lookup canonicalizes through RELATIONSHIP_KIND_ALIASES first.
//
// The table answers "what word does this relationship read as". It does NOT
// decide which SECTION the row renders in — `isDeclarationRelationship`
// (src/lsp/relations.ts, the single owner of the usage vocabulary) does that.
// Splitting the two is what lets every kind carry a word while a declaration
// containment can never reach the CONNECTION summary: the table is total over
// the fourteen kinds, and the section is chosen by the owner's class.
const RELATIONSHIP_VERB: Record<CanonicalRelationshipKind, { outgoing: string; incoming: string }> = {
  calls: { outgoing: "calls", incoming: "called by" },
  extends: { outgoing: "extends", incoming: "extended by" },
  implements: { outgoing: "implements", incoming: "implemented by" },
  uses: { outgoing: "uses", incoming: "used by" },
  instantiates: { outgoing: "instantiates", incoming: "instantiated by" },
  overrides: { outgoing: "overrides", incoming: "overridden by" },
  // §14 rule 4 + the owner's decision: `contains` reads as a CONTAINMENT verb,
  // never as a usage or a connection. The words are chosen so that
  // "Hub contains greet" and "greet — contained by Hub" are statements about
  // DECLARATION from either end, and so that no reader can take either for
  // "someone uses this". The negative test that proves it is in the gate.
  contains: { outgoing: "contains", incoming: "contained by" },
  references: { outgoing: "references", incoming: "referenced by" },
  imports: { outgoing: "imports", incoming: "imported by" },
  // `exports` is the other declaration containment (relations.ts). Same law.
  exports: { outgoing: "exports", incoming: "exported by" },
  // ── the four EXTENDED kinds (2026-10-18 vocabulary extension) ─────────────
  // `decorates`: the EMITTED direction is decorated declaration -> decorator, so
  // a card for the decorated declaration reads "carries decorator [X]" and a card
  // for the decorator reads "decorates [Y]". Not "called by": nothing invokes a
  // decorator at the source level (src/ast/types.ts says so in as many words).
  decorates: { outgoing: "carries decorator", incoming: "decorates" },
  // `renders`: rendering component -> rendered component (JSX element creation;
  // NOT `instantiates` — nothing is `new`ed in the source).
  renders: { outgoing: "renders", incoming: "rendered by" },
  // `mixes_in`: class -> mixin composed into its supertype chain (Dart `with`).
  // A supertype-composition relation, like `extends`/`implements`.
  mixes_in: { outgoing: "mixes in", incoming: "mixed in by" },
  // `part_of`: a `part`/`part of` DIRECTIVE. Its emitted direction is the
  // directive's own and metadata.partRole names which end is the library, so the
  // two direction words describe the DIRECTIVE, not a symbol-usage claim: a card
  // reading "part-of directive" or "named by part-of directive" is true whichever
  // role this row carries. The card never claims a part USES a library (§13.5:
  // a module-level edge is a directive, not a symbol usage). Rows whose far end
  // the index could not resolve as a symbol are declared in DECLARED_ABSENCE.
  part_of: { outgoing: "part-of directive", incoming: "named by part-of directive" },
}

/** The verb a stored kind renders with in a given direction, or null when the
 *  index carries a kind outside the canonical fourteen (no declared word exists,
 *  so the row is a DECLARED absence with a reason — never an unlabelled render). */
export function verbFor(relationshipType: string, direction: "incoming" | "outgoing"): string | null {
  const canonical = canonicalKind(relationshipType)
  if (canonical === null) return null
  const entry = RELATIONSHIP_VERB[canonical]
  return direction === "incoming" ? entry.incoming : entry.outgoing
}

/** The words a DECLARATION containment is allowed to use. Anything a reader
 *  could take for "someone uses this" is not in this set, which is what makes
 *  the containment section's label safe — and it is the list the gate's negative
 *  test runs against. */
export const CONTAINMENT_VERBS: ReadonlySet<string> = new Set([
  "contains",
  "contained by",
  "declares",
  "declared in",
  "exports",
  "exported by",
])

/** True when a verb is a declaration-containment word rather than a connection
 *  word. The surface-side half of relations.ts's vocabulary owner: the KIND
 *  class comes from the owner, and this only asserts the WORDS agree with that
 *  class — a `contains` row rendering "used by" would be the right fact under
 *  the wrong label, which §14 rule 1 names as a defect. */
export function isContainmentVerb(verb: string): boolean {
  return CONTAINMENT_VERBS.has(verb)
}

/** The words the CONTAINMENT SECTION prints, one per direction. Named constants
 *  so the gate's negative test can read them off the source rather than off a
 *  copy, and so the two directions can never drift into one word. */
export const CONTAINMENT_VERB_DECLARES = "declares"
export const CONTAINMENT_VERB_DECLARED_IN = "declared in"

// ---------------------------------------------------------------------------
// DECLARED ABSENCE — one table, in the surface, with reasons
// ---------------------------------------------------------------------------
//
// A stored relationship row can only be honest in one of three ways on this
// card:
//
//   1. rendered, under a verb, with a clickable index-stored target;
//   2. rendered as a USAGE row (relations.ts's own vocabulary);
//   3. DECLARED here, with a reason.
//
// Without (3), a row that is neither rendered nor declared is a SILENT GAP — the
// defect the coverage gate exists to find, and the defect that let `uses` and
// `references` render unlabelled for waves. §11.7: absence is declared, and a
// declared absence is verifiable by a NEGATIVE test. The negative test lives
// with the gate (script/m55/verify-hover-coverage.ts), not here: a test a surface
// also owned would be a test the surface could pass by lying in its own favour.
//
// Every entry is a DEBT. It names rows the index holds and this card does not
// show, and the coverage metric counts those rows as NOT RENDERED. An entry
// whose rows ARE rendered is stale, and the gate fails it.
export interface DeclaredAbsence {
  /** the canonical kind whose rows are not rendered, or one of the structural
   *  classes that are not about a kind at all */
  kind: CanonicalRelationshipKind | "external" | "self" | "unknown-kind"
  /** the reason, in one sentence a reader can check */
  reason: string
}

export const DECLARED_ABSENCE: readonly DeclaredAbsence[] = [
  {
    kind: "external",
    reason:
      "a stored row whose far end is an external name the index holds no symbol row for cannot be rendered as a link: §12.1 requires every target to equal an index-stored location, and this row stores none. The count is reported, the row is not named as a link.",
  },
  {
    kind: "self",
    reason:
      "a self-loop row (both ends are this symbol) is an analyzer artifact, not a relationship to another symbol; rendering it would make a symbol appear to relate to itself.",
  },
  {
    kind: "unknown-kind",
    reason:
      "a stored kind outside the canonical fourteen has no declared verb and no declared meaning; it renders nothing rather than being guessed at. The count is reported.",
  },
  {
    kind: "imports",
    reason:
      "an `imports` row is a FILE-level edge: its far end is a module path, not an indexed symbol, so it has no index-stored location to navigate to. It is counted and named as a file-level row, never rendered as a symbol link (§13.5 noise is labelled, not hidden; §12.1 nothing unclickable).",
  },
  {
    kind: "part_of",
    reason:
      "a `part_of` row is a `part`/`part of` DIRECTIVE (a compilation-unit inclusion, module-level like `imports`): its far end is a file or module, not a symbol the card can navigate to, and its direction is the directive's own (`metadata.partRole` names which end is the library). It is declared here — never read as one symbol using another — and counted rather than drawn as a link when the far end has no indexed location (§13.5 labelled, §12.1 nothing unclickable).",
  },
]

/** The declared-absence entry for a kind, or null when the kind is one this
 *  surface renders. */
export function declaredAbsenceFor(kind: string): DeclaredAbsence | null {
  const canonical = canonicalKind(kind)
  const target = canonical ?? (kind.trim().toLowerCase() as DeclaredAbsence["kind"])
  return DECLARED_ABSENCE.find((d) => d.kind === target) ?? null
}

/** Command URI scheme for hover links (executed by the editor client). */
export const USAGE_COMMAND = "bb.openUsage"
export const DEFINITION_COMMAND = "bb.openDefinition"
export const SHOW_ALL_USAGES_COMMAND = "bb.showAllUsages"
// M42.H4 (issue #652): the hover action commands. One constant set — the
// hover markdown embeds these exact ids, the extension registers them, and
// the drift gate asserts both sides agree.
export const OPEN_GRAPH_COMMAND = "bb.openGraph"
export const OPEN_IMPACT_COMMAND = "bb.openImpact"
export const SHOW_CALL_HIERARCHY_COMMAND = "bb.showCallHierarchy"

/** Wire args for bb.openUsage / bb.openDefinition: the index-stored LSP
 *  location. Encoded once here — every hover link shares this encoding. */
export function encodeLocationArgs(path: string, line: number, character: number): string {
  // Command-URI args are a JSON ARRAY (one element per handler argument); a
  // bare object is off-spec and delivered inconsistently across VS Code
  // versions (owner test, 2026-09-05: hover links did nothing in 1.136.1).
  return encodeURIComponent(JSON.stringify([{ file: path, line, character }]))
}

export function openUsageUri(site: { path: string; line: number; character: number }): string {
  return `command:${USAGE_COMMAND}?${encodeLocationArgs(site.path, site.line, site.character)}`
}

export function openDefinitionUri(path: string, line: number, character: number): string {
  return `command:${DEFINITION_COMMAND}?${encodeLocationArgs(path, line, character)}`
}

// --- M42.H4: hover action URIs -------------------------------------------------
// The action args carry the SERVER-RESOLVED symbol identity: the name and
// the index-stored declaration location of the hovered symbol (the same
// location the definition link uses). The client never guesses the symbol
// from its own cursor — it executes what the index resolved (issue #652
// negative list: no client-side position guessing).
export interface HoverActionArgs {
  /** name of the hovered symbol, resolved server-side from the index row */
  symbol: string
  /** absolute path of the declaration file (index-stored) */
  file: string
  /** LSP 0-based declaration position (index-stored) */
  line: number
  character: number
}

export function encodeActionArgs(symbol: string, path: string, line: number, character: number): string {
  return encodeURIComponent(JSON.stringify([{ symbol, file: path, line, character } satisfies HoverActionArgs]))
}

export function openGraphUri(a: HoverActionArgs): string {
  return `command:${OPEN_GRAPH_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

export function openImpactUri(a: HoverActionArgs): string {
  return `command:${OPEN_IMPACT_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

export function showCallHierarchyUri(a: HoverActionArgs): string {
  return `command:${SHOW_CALL_HIERARCHY_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

/** The hover actions row: graph, impact, and call hierarchy one click away
 *  from the hover. Composed ONLY when the symbol identity is complete (a
 *  symbol without a resolvable declaration line renders no actions row —
 *  declared absence; an unclickable action would violate §12.1). */
export function actionsSection(symbol: string, filePath: string, line: number, character: number): string {
  if (symbol.length === 0 || filePath.length === 0 || line < 0 || character < 0) return ""
  const a: HoverActionArgs = { symbol, file: filePath, line, character }
  return `**actions**: [Open in graph](${openGraphUri(a)}) · [Impact analysis](${openImpactUri(a)}) · [Call hierarchy](${showCallHierarchyUri(a)})`
}

/** M44.U6: the link carries the SERVER-RESOLVED identity — the symbol name
 *  rides alongside the location so the client fallback can open the hub
 *  usages surface for the symbol without client-side guessing (issue #693;
 *  issue #652's no-client-guessing rule applies to the fallback too). */
export function showAllUsagesUri(a: { file: string; line: number; character: number; symbol: string }): string {
  return `command:${SHOW_ALL_USAGES_COMMAND}?${encodeURIComponent(JSON.stringify([{ file: a.file, line: a.line, character: a.character, symbol: a.symbol }]))}`
}

/** Human label: `main — App.java:12` (file base name, 1-based human line).
 *  The LINK target stays the 0-based LSP coordinate; the label is display.
 *
 *  Lane 6 (§14 rule 2, identity is stated): a site whose address is a labeled
 *  SUBSTITUTE — the store holds no call-site line, so the link opens the
 *  referencing symbol's declaration — gets that fact in its label. Before this,
 *  a reader who clicked `main — App.java:12` and landed on `main`'s function
 *  header had no way to know the index had a call-site line for that row and
 *  this surface chose not to use it. The vocabulary is the address owner's
 *  (`ADDRESS_NOTES`), never invented here. */
export function siteLabel(site: { name: string; path: string; line: number; callSite?: CallSiteAddress }): string {
  // Separator-independent base name: win32 paths use backslashes, POSIX
  // forward slashes (found by the E7 win32 CI leg, 2026-09-05).
  const base = site.path.split(/[\\/]/).pop() ?? site.path
  const label = `${site.name} — ${base}:${site.line + 1}`
  return addressNoteSuffix(site.callSite) === null ? label : `${label} ${addressNoteSuffix(site.callSite)}`
}

/** The ONE place a site's address becomes a stated caveat, or null when the
 *  address is exact (a real call site: nothing to declare). Returns null for an
 *  absent address so a caller that has no verdict renders no caveat rather than
 *  a fabricated one. */
export function addressNoteSuffix(address: CallSiteAddress | undefined | null): string | null {
  if (address === undefined || address === null) return null
  if (isExactAddress(address)) return null
  return address.kind === "declaration" ? `_(${ADDRESS_NOTES.substitute})_` : `(${address.kind === "unknown" ? address.note : ""})`
}

/**
 * The rows this collector REFUSED to serve, and why — passed in by the caller so
 * the hover can DECLARE them (§15.3: an omission is counted and named, never
 * silently dropped). The taxonomy mirrors `textDocument/references`
 * (`NavigationReferencesResult.omittedUnresolvable`) so the two surfaces speak
 * one language: a row whose stored call-site line the source cannot confirm is
 * `unresolvable` on both, and both decline to serve it.
 */
export interface UsageCollectionOmissions {
  /**
   * Stored usage rows whose call-site address is EXACT (a real stored line) but
   * whose line does not exist in the caller's source file — the file on disk is
   * shorter than the line the store names. `textDocument/references` omits these
   * and counts them in `omittedUnresolvable`; before this field the hover served
   * them as links opening past the end of the file, so two surfaces disagreed
   * about the same stored rows (§12.1 / §14 rule 1; the M55.T3 record's
   * `knownGaps[0]`, measured on its R5 fixture: references 0 locations + 2
   * omissions, hover 2 sites at lines 40 and 41 of a three-line file).
   */
  unresolvable: number
}

/**
 * Collect the usage sites of a symbol: every stored relationship row whose
 * OTHER end is a real indexed symbol with a resolvable location, in the same
 * row order (confidence DESC, id) and with the same dedup key
 * (path:line:character) as the L3 references surface — one location owner.
 *
 * A row whose stored call-site line the source cannot confirm is OMITTED and
 * counted in `omissions.unresolvable` — the same verdict `textDocument/references`
 * produces for the same row (§12.1: a navigation target must equal an
 * index-stored location the source can be checked against; §15.3: the omission is
 * declared, not clamped and not silently dropped).
 *
 * The OR-free UNION shape mirrors the M29.R3 scale fix: two indexed probes
 * (source_symbol_id / target_symbol_id are both indexed) instead of one
 * OR-scan of brain_relationship.
 */
export function richSitesForSymbol(raw: CoreDatabase, symbolId: string, omissions?: UsageCollectionOmissions): RichSite[] {
  // Lane 6 (§3 budget): PER-CALL location memo.
  //
  // `edgeLocation` re-reads the source file and rebuilds a PositionMapper on
  // every call, and this collector calls it once per relationship row. Measured
  // on a real index (this machine, backbencher-brain, 183 files / 52,597 rows):
  // a symbol with 128 stored rows resolved 128 locations across 34 distinct
  // files — 1.5 MB read and 30,250 lines re-split for every hover, 560 ms of
  // the hover's cost on that one symbol, against a 50 ms budget.
  //
  // 128 rows collapse to 73 DISTINCT (path, byte columns, lines) tuples on that
  // symbol, so memoizing inside the call removes 55 of 128 resolutions and,
  // more importantly, makes the cost proportional to distinct locations rather
  // than to row count. Measured: 560 ms -> 356 ms per call, same outputs.
  //
  // The memo is scoped to ONE call on purpose. A process-wide cache would make
  // the hover answer from bytes the file watcher has not re-read yet — which is
  // the §4 staleness violation the freshness marker exists to prevent. Within
  // a single request the bytes cannot meaningfully change under us, and the
  // staleness marker is computed from a fresh read on the same request.
  const locationMemo = new Map<string, ReturnType<typeof edgeLocation> | undefined>()
  // ONE source-text read per FILE for this request: a symbol whose usages live in the same large file paid a
  // full read + mapper PER ROW before this (nearest-location memo only collapsed identical ranges). Scoped to
  // this call, like the memo above, so no stale bytes can outlive the request.
  const edgeSourceCache = new Map<string, { text: string; lines: readonly string[]; mapper?: any } | { readError: string }>()
  const locationOf = (p: string, bs: number, be: number, ls: number, le: number): ReturnType<typeof edgeLocation> => {
    const key = `${p}:${bs}:${be}:${ls}:${le}`
    const hit = locationMemo.get(key)
    if (hit !== undefined || locationMemo.has(key)) return hit ?? null
    let loc: ReturnType<typeof edgeLocation>
    try {
      loc = edgeLocation(p, bs, be, ls, le, edgeSourceCache)
    } catch (error) {
      if (!(error instanceof PositionError)) throw error
      loc = null
    }
    locationMemo.set(key, loc)
    return loc
  }
  // THE LINE TABLE A STORED CALL SITE IS CHECKED AGAINST (§12.1, §15.3).
  // The line count comes from the ONE positions mapper —
  // `createPositionMapper(text).lineTexts.length` splits on the line endings the
  // file actually uses, exactly the bound `navigation.referenceLocation` applies
  // to the same row. A second `text.split("\n")` would disagree with that mapper
  // on every CRLF/CR file, and two surfaces using two bounds is the disagreement
  // this file exists to prevent. `null` = the source cannot be read, so no stored
  // line in it can be confirmed either.
  //
  // MEASURED COST, AND WHY THIS IS CACHED ACROSS REQUESTS (M55 R6, shape A
  // "many distinct files"): the first version of this bound read and split the
  // whole file on EVERY hover. The per-request `edgeSourceCache` cannot help a
  // WARM hover — a new request starts with an empty map — so on the gate's shape
  // A (32 distinct files behind one symbol) every warm hover re-read and
  // re-split all 32 files and rebuilt 32 position mappers, and the warm p95 went
  // from 34.4 ms (pre-bound) to 51.3 ms, a red budget. The line count is a
  // property of the FILE, not of the request, so it is cached here keyed by
  // `(absolute path, mtimeMs, size)`.
  //
  // THE HONESTY CONTRACT OF THIS CACHE (why it cannot trade latency for a wrong
  // omission): an entry is used ONLY when the file's CURRENT `stat` matches the
  // `mtimeMs` and `size` recorded with the count. Any mismatch re-reads and
  // re-splits. The one residual case — a file replaced by different bytes of
  // exactly the same size while its mtime is also unchanged — is the git
  // index-stat-cache trade-off, and it is DECLARED not hidden: the risk is a
  // file that a filesystem/user has preserved `mtime` across (mtime + same size
  // is the same evidence `src/brain/freshness.ts` itself uses to call a file
  // unchanged). It is bounded (LINE_COUNT_CACHE_MAX), recency-refreshed on hit,
  // and stores only three numbers per path.
  const lineCountOf = (p: string): number | null => {
    const cached = edgeSourceCache.get(p)
    if (cached !== undefined) {
      // The location resolver already read this file IN THIS REQUEST, so its
      // bytes are the ones being reasoned about — no extra read, and no chance
      // of the count disagreeing with the text the other sites were placed by.
      if ("readError" in cached) return null
      if (cached.mapper === undefined) cached.mapper = createPositionMapper(cached.text)
      const count = (cached.mapper as ReturnType<typeof createPositionMapper>).lineTexts.length
      rememberLineCount(p, count)
      return count
    }
    const hit = cachedLineCount(p)
    if (hit !== null) return hit
    try {
      const text = readFileSync(p, "utf8")
      const lines = text.split("\n")
      const mapper = createPositionMapper(text)
      edgeSourceCache.set(p, { text, lines, mapper })
      rememberLineCount(p, mapper.lineTexts.length)
      return mapper.lineTexts.length
    } catch (error) {
      edgeSourceCache.set(p, { readError: (error as Error).message })
      return null
    }
  }

  const rows = raw
    .prepare(
      `SELECT r.id, r.relationship_type, r.confidence, r.metadata, r.time_updated,
              r.source_symbol_id, r.target_symbol_id, ${STORED_LINE_SELECT},
              ss.name AS src_name, ss.symbol_type AS src_type,
              ss.byte_start AS src_bs, ss.byte_end AS src_be,
              ss.line_start AS src_ls, ss.line_end AS src_le, sf.path AS src_path,
              ss.line_start AS src_decl, sf.relative_path AS src_rel,
              ts.name AS tgt_name, ts.symbol_type AS tgt_type,
              ts.byte_start AS tgt_bs, ts.byte_end AS tgt_be,
              ts.line_start AS tgt_ls, ts.line_end AS tgt_le, tf.path AS tgt_path,
              ts.line_start AS tgt_decl, tf.relative_path AS tgt_rel
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = ss.file_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       LEFT JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.source_symbol_id = ? OR r.target_symbol_id = ?
       ORDER BY r.confidence DESC, r.id`,
    )
    .all(symbolId, symbolId) as Array<{
    id: string
    relationship_type: string
    confidence: number | null
    source_symbol_id: string | null
    target_symbol_id: string | null
    bb_stored_call_line: number | null
    src_name: string | null
    src_type: string | null
    src_bs: number | null
    src_be: number | null
    src_ls: number | null
    src_le: number | null
    src_path: string | null
    src_decl: number | null
    src_rel: string | null
    tgt_name: string | null
    tgt_type: string | null
    tgt_bs: number | null
    tgt_be: number | null
    tgt_ls: number | null
    tgt_le: number | null
    tgt_path: string | null
    tgt_decl: number | null
    tgt_rel: string | null
    metadata: string | null
    time_updated: number | null
  }>

  const sites: RichSite[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    // Degenerate self-loop rows (both ends resolve to S itself — an
    // analyzer artifact, e.g. an @Override row whose target collided with
    // its own symbol) are not connections and not usages: skip them. The L3
    // tree's visible outcome is unchanged (such a row dedups with the
    // declaration entry).
    if (row.source_symbol_id === symbolId && row.target_symbol_id === symbolId) continue
    // The site is the OTHER end: for incoming rows (S is target) it is the
    // source; for outgoing rows (S is source) it is the target.
    const incoming = row.target_symbol_id === symbolId && row.source_symbol_id !== symbolId
    const other = incoming
      ? { name: row.src_name, type: row.src_type, path: row.src_path, bs: row.src_bs, be: row.src_be, ls: row.src_ls, le: row.src_le, decl: row.src_decl, rel: row.src_rel }
      : { name: row.tgt_name, type: row.tgt_type, path: row.tgt_path, bs: row.tgt_bs, be: row.tgt_be, ls: row.tgt_ls, le: row.tgt_le, decl: row.tgt_decl, rel: row.tgt_rel }
    if (!other.name || !other.path) continue
    // THE STORED CALL-SITE LINE BELONGS TO THE ROW'S SOURCE END — the symbol
    // that WROTE the reference — in both directions. The store records the line
    // where the source wrote it, not a line in the far end's file. Deriving the
    // address from `other` was right only for incoming rows (where `other` IS the
    // source) and wrong for outgoing rows: that is how a link labelled
    // "instantiates [Greeter]" on `main` came to open `greeter.ts:4` while the
    // instantiation is `app.ts:4` — a position nobody stored, told at click time.
    // The address owner is fed the SOURCE side now, so its verdict is about the
    // file the line actually lives in.
    const sourceRel = incoming ? other.rel : row.src_rel
    const sourceDeclLine = incoming ? other.decl : row.src_decl
    // §12.1/§15.3 — a declared declaration substitute for a SOURCE whose own
    // declaration line is not a position must not fall back to the far end's:
    // `deriveCallSiteAddress` sees only what it is given, and the caller here is
    // the source symbol, so a NULL source declaration correctly produces the
    // owner's declared `unknown` rather than a borrowed line.
    const address = deriveCallSiteAddress({
      storedLine: storedLineFromRow(row as unknown as Record<string, unknown>),
      file: sourceRel ?? "",
      callerDeclaration: { line: sourceDeclLine },
    })
    const callLine0 = addressLine0(address)
    const declarationRow = isDeclarationRelationship(row.relationship_type)
    // WHERE A STORED CALL-SITE LINE MAY BE SERVED (M55.T3, §12.1/§14 rule 3).
    //
    // Only a USAGE row — incoming, non-declaration — serves the call-site line:
    // there the far end IS the caller that wrote it, so the served place is the
    // caller's file at the stored line, verified below against that file's own
    // line table (the OLD behaviour for every row, kept here and only here).
    //
    // An OUTGOING row is a CONNECTION claim ("this symbol calls X") and a
    // DECLARATION row is a CONTAINMENT claim ("X declares this"): the link to
    // the far end must open that symbol's INDEX-STORED DECLARATION. A stored
    // call-site line belongs to THIS symbol's file, so opening it in the far
    // end's file invents a position — the defect this branch fixes.
    const servesCallSite = callLine0 !== null && incoming && !declarationRow
    // THE FAST PATH, and the reason the §3 budget can be met at all.
    //
    // A USAGE site with a REAL stored call-site line does not need the declaring
    // symbol's byte columns: the served position is `(the caller's file, the
    // stored line)` and it is verified against that file's line table. Resolving
    // `edgeLocation` for these rows only obtained the SAME path (and a
    // declaration range the call-site branch then overrode) at the cost of a full
    // file read + PositionMapper build per distinct caller file on EVERY warm
    // hover — the M55 R6 "many distinct files" shape, where a symbol used from 30
    // files paid 30 reads and 30 mapper builds for positions no later code read.
    let loc: ReturnType<typeof edgeLocation>
    if (servesCallSite) {
      const lineCount = lineCountOf(other.path)
      if (lineCount === null || callLine0 >= lineCount) {
        if (omissions !== undefined) omissions.unresolvable++
        continue
      }
      loc = { path: other.path, line: callLine0, character: 0, endLine: callLine0, endCharacter: 0 }
    } else {
      if (other.bs === null || other.be === null || other.ls === null || other.le === null) continue
      // Lane 6 (measured on a real index, script/m55/verify-hover-coverage.ts
      // R6): edgeLocation THROWS PositionError on a stored row whose byte column
      // lands mid-code-point — a row the indexer wrote for a line containing a
      // multi-byte character. This collector called it unguarded, so ONE such row
      // anywhere in a symbol's relationship set threw out of `hover()` itself. The
      // server has no try/catch on the hover path, so the LSP request REJECTED:
      // VS Code logged "provider FAILED" and silently fell back to the native
      // hover, which is the §12 contract rendered as a crash with no content at
      // all. Measured on this machine's backbencher-brain index: 46 of the 400
      // busiest source symbols (11.5%) and 71 of 4000 symbols swept (1.8%).
      //
      // The guard lives INSIDE `locationOf`, which is the single choke point
      // every resolution passes through — one guard, one place, and the memo
      // cannot serve a value the guard would have refused. A second try/catch at
      // this call site was tried first and the mutation suite caught the
      // consequence: removing the inner guard changed nothing, so the mutant
      // SURVIVED. One guard, at the choke point.
      //
      // When the far end has NO resolvable declaration either, the row is
      // omitted and counted by DECLARED_ABSENCE (external / unknown-kind), never
      // served at a guessed position — that is the same declared-absence law the
      // coverage gate measures, applied here by omission instead of a link.
      const resolved = locationOf(other.path, other.bs, other.be, other.ls, other.le)
      if (resolved === null) continue
      loc = resolved
    }
    // §14 rule 3: a USAGE row with a REAL stored call site opens the CALL SITE;
    // every other row opens the far end's index-stored DECLARATION (the address
    // owner's range), which is the only position such a connection can honestly
    // claim.
    const opening: { path: string; line: number; character: number; endLine: number; endCharacter: number } =
      servesCallSite
        ? { path: loc.path, line: callLine0 as number, character: 0, endLine: callLine0 as number, endCharacter: 0 }
        : { path: loc.path, line: loc.line, character: loc.character, endLine: loc.endLine, endCharacter: loc.endCharacter }
    // Dedup by location AND DIRECTION, but never by dropping a kind.
//
// Direction is part of the row's identity: `Greeter contains greet` and
// `greet -> Greeter` (the return type) both name the same far end at the same
// line, and they are two DIFFERENT relationships — one says something uses
// greet, the other says greet refers to something. Merging them made the
// declaration's site inherit `reversed: true` from whichever row sorted first,
// and a containment row that also carried a non-declaration kind then read as a
// usage site: the m24 gate measured greet at 4 usages where the vocabulary says
// 3. A site is "someone uses this" only if it is an INCOMING row, so the key
// carries the direction.
//
// Within one direction, two stored rows of DIFFERENT kinds at one location stay
// merged — `reset uses items` and `reset references items` are two stored
// relationships whose far end is the same symbol on the same line, and the first
// draft kept only the first kind and dropped the second, so a real stored row of
// a real kind rendered NOWHERE and the coverage audit scored `references` at 0%
// for a reason that had nothing to do with its verb table. §13.1: one row per
// symbol per direction; §13.2: multiplicity is named, never merged into silence.
const key = `${opening.path}:${opening.line}:${opening.character}:${incoming ? "in" : "out"}`
    const existing = sites.find((x) => `${x.path}:${x.line}:${x.character}:${x.reversed ? "in" : "out"}` === key)
    if (existing !== undefined) {
      if (!existing.relationshipTypes.includes(row.relationship_type)) {
        existing.relationshipTypes.push(row.relationship_type)
      }
      continue
    }
    seen.add(key)
    const enrichment = parseEnrichment(row.metadata)
    sites.push({
      name: other.name,
      symbolType: other.type,
      path: opening.path,
      line: opening.line,
      character: opening.character,
      endLine: opening.endLine,
      endCharacter: opening.endCharacter,
      relationshipType: row.relationship_type,
      relationshipTypes: [row.relationship_type],
      reversed: incoming,
      confidence: row.confidence,
      enrichment,
      enrichmentStale: enrichment === null ? false : enrichmentIsStale(enrichment, row.time_updated),
      callSite: address,
    })
  }
  return sites
}

export interface ConnectedGroup {
  verb: string
  sites: RichSite[]
}

/** The usage sites of a symbol as they come off the index (M55.T3): the one
 *  collection every count on the hover surface is taken from. */
export function usageSitesForSymbol(raw: CoreDatabase, symbolId: string): RichSite[] {
  return usageSitesOf(richSitesForSymbol(raw, symbolId))
}

/** Group sites into CONNECTION facts (the `**connected**:` summary).
 *
 *  The law, unchanged and now enforced by the owner's CLASS rather than by the
 *  verb table's silence: a DECLARATION CONTAINMENT (`contains`, `exports` —
 *  `relations.ts`'s `isDeclarationRelationship`, the single owner of the
 *  vocabulary) can never become a connection claim. This function does not
 *  decide; it asks the owner and obeys. Before this wave the same outcome came
 *  from the verb table having no entry, which is a different mechanism with the
 *  same result — and it is why a `contains` row could not be RENDERED anywhere,
 *  which is the half of the owner's decision this wave changes.
 *
 *  Every non-declaration kind now HAS a verb, so no row reaches this function
 *  and renders with no label: `verbFor` returning null means the index stores a
 *  kind outside the canonical fourteen, and that row is a declared absence with a
 *  reason (DECLARED_ABSENCE), never an unlabelled link. */
export function connectedGroups(sites: RichSite[]): ConnectedGroup[] {
  const groups = new Map<string, ConnectedGroup>()
  for (const site of sites) {
    // A site may carry SEVERAL stored kinds (§13.2 multiplicity). Each kind is
    // grouped under its own verb, so `reset uses items` and
    // `reset references items` render as two relationships rather than one
    // silently standing for both.
    for (const kind of siteKinds(site)) {
      // The owner's law, applied before the word is looked up: a declaration is
      // never a connection.
      if (isDeclarationRelationship(kind)) continue
      const verb = verbFor(kind, site.reversed ? "incoming" : "outgoing")
      if (verb === null) continue
      let g = groups.get(verb)
      if (!g) {
        g = { verb, sites: [] }
        groups.set(verb, g)
      }
      g.sites.push(site)
    }
  }
  // First-appearance order (stable across runs).
  return [...groups.values()]
}

/** Every stored kind a site carries, in stored order. A site authored before
 *  this field (a hand-built fixture in a verifier) carries its single
 *  `relationshipType`, so no caller has to special-case the old shape. */
function siteKinds(site: { relationshipType: string; relationshipTypes?: readonly string[] }): string[] {
  const kinds = site.relationshipTypes
  return kinds === undefined || kinds.length === 0 ? [site.relationshipType] : [...kinds]
}

export const MAX_SUMMARY_PER_VERB = 3

/** Render the connected summary line. Empty string = declared absence: no
 *  connection facts exist — nothing is rendered, nothing is fabricated. */
export function connectedSummarySection(groups: ConnectedGroup[]): string {
  if (groups.length === 0) return ""
  const parts: string[] = []
  for (const group of groups) {
    const names = group.sites.slice(0, MAX_SUMMARY_PER_VERB)
    const overflow = group.sites.length - names.length
    const seen = new Set<string>()
    const links = names.map((s) => {
      // Same-named sites (e.g. two `displayName` methods in different files)
      // are disambiguated by file:line so the link's target is never a guess.
      const dup = seen.has(s.name)
      seen.add(s.name)
      const label = dup ? siteLabel(s) : s.name
      return `[${label}](${openUsageUri(s)})`
    })
    if (overflow > 0) links.push(`+${overflow}`)
    let groupText = `${group.verb} ${links.join(", ")}`
    // M42.H3: a single-site verb group whose row carries enrichment annotates
    // the connection with the stored facts, labeled as index-inferred — never
    // at parser-fact tier (§12.3). Multi-site groups skip per-site annotations
    // (bounded hover); the graph/webview surface carries per-edge enrichment.
    if (group.sites.length === 1 && hasDisplayableEnrichment(group.sites[0]!.enrichment)) {
      const s = group.sites[0]!
      const desc = describeEnrichment(s.enrichment!)
      const staleNote = s.enrichmentStale ? ", stale — row changed after enrichment" : ""
      groupText += ` · _${desc} (enriched by index${staleNote})_`
    }
    parts.push(groupText)
  }
  return `**connected**: ${parts.join("; ")}`
}

/** The usage sites of a symbol's collected rows — the vocabulary's own filter
 *  (src/lsp/relations.ts). Exported so a caller can COUNT exactly what this
 *  module renders: count and list are the same array, never two filters. */
export function usageSitesOf(sites: readonly RichSite[]): RichSite[] {
  return usageSites(sites)
}

/** Render the usages section: top-MAX_USAGE_LINKS clickable file:line links
 *  plus the "N more" escape hatch — native references view where available,
 *  our hub usages surface otherwise (M44.U6: never a message-only dead end).
 *  Empty string = declared absence (zero usage sites).
 *
 * M55.T3 (issue #772): the section renders USAGE SITES only — the owning
 * declaration and callees are filtered out by the vocabulary owner before
 * anything is rendered (the pre-M55 list offered the hovered method's own
 * class as a "usage"). The header declares what the rows ARE: a row's
 * file:line is the REFERENCING symbol's indexed location, where the call is.
 *
 * M62.A2 (issue #876): that stays true by construction — this section reads
 * the referencing symbol's own indexed range (src/lsp/relations.ts), never the
 * stored `line_number`, so it can never present a call-site line it does not
 * have. The exact stored call-site address (real line, labeled substitute, or
 * declared unknown) is served by the address owner
 * (src/intelligence/graph/line-address.ts) on the hub/graph/MCP surfaces; the
 * hover's vocabulary is the referencing location, and it says so. */
export function usagesSection(sites: RichSite[], total: number, forSymbol: string, forFile: string, forLine: number, forCharacter: number): string {
  // Defensive: filter here as well as at the caller — a caller that forgets
  // cannot leak a declaration into the list (the filter is idempotent).
  const usage = usageSitesOf(sites)
  if (usage.length === 0) return ""
  const lines: string[] = [`**usages** — ${usage.length} stored reference${usage.length === 1 ? "" : "s"} (${USAGE_SITE_FILTER_LABEL})`]
  // Lane 6: the header now says WHAT each row's position is, per §14 rule 3.
  // `sitesRendered` are rows the store gave a real call-site line for (the link
  // opens the CALL); `usage.length - sitesRendered` are rows where the store
  // held no call-site line and the link opens the referencing declaration, each
  // labeled at the row. Before this the header said "stored references" and the
  // rows said nothing, which is how a reader could not tell which of the two
  // they were looking at.
  const exact = usage.filter((s) => isExactAddress(s.callSite)).length
  lines[0] += exact === usage.length
    ? " — each opens the stored call site"
    : exact === 0
      ? ` — the index stores no call-site line for these, so each opens the referencing declaration`
      : ` — ${exact} open the stored call site, ${usage.length - exact} open the referencing declaration (no call-site line stored)`
  // M55.T3 integration, §14 rule 1 second half. This number is a count of
  // SERVED POSITIONS — one per place the link can open — and `textDocument/
  // references` counts the same thing. Saying so here is what makes the two
  // surfaces' agreement checkable by a reader instead of inferred: before this,
  // a reader who found four stored rows behind three links had no way to tell
  // whether one row had been dropped or whether the count had a different unit.
  lines[0] += ` _(${USAGE_COUNT_UNIT_LABEL})_`
  const shown = usage.slice(0, MAX_USAGE_LINKS)
  shown.forEach((s, i) => {
    lines.push(`${i + 1}. [${siteLabel(s)}](${openUsageUri(s)})`)
  })
  // total is the authoritative site count (caller passes usage.length or a
  // truncated count); rest = sites beyond the rendered top-3.
  const rest = Math.max(0, Math.min(total, usage.length) - shown.length)
  if (rest > 0) {
    lines.push(`+${rest} more — [show all usages](${showAllUsagesUri({ file: forFile, line: forLine, character: forCharacter, symbol: forSymbol })})`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// THE CONTAINMENT SECTION
// ---------------------------------------------------------------------------
//
// `src/lsp/relations.ts` is the single owner of the USAGE vocabulary and its law
// is correct and unchanged: a usage site is a stored row whose TARGET is this
// symbol and whose kind is not a declaration containment, so `Greeter contains
// greet` is how greet is DECLARED and never how it is USED. That law is not
// weakened here — it is not touched.
//
// The consequence the owner ruled on is that the declaration row still has to
// REACH the reader, somewhere a reader cannot mistake for a usage. That is this
// section: a separately-labelled block whose header says in words that these are
// declarations, and whose verbs are drawn from CONTAINMENT_VERBS (no word any
// reader could take for "someone uses this").
//
// Three laws, each with a negative test in script/m55/verify-hover-coverage.ts
// and script/m42/verify-rich-hover.ts:
//
//   L1 a `contains` row NEVER appears in the usages list, the usages header
//      count, or the connected summary. It appears here and nowhere else.
//   L2 the header count is the RENDERED truth (§13.4): the number of rows under
//      the header is the number the header names, with an explicit "+N more" for
//      the cap so the two can never silently disagree.
//   L3 every row carries a working navigation target EQUAL to an index-stored
//      location (§12.1). A member row with no resolvable location does not
//      render; the count of such rows is declared instead.

/** The cap on rendered containment rows, and its declared remainder. */
export const MAX_CONTAINMENT_ROWS = 6

/** The declaration-containment rows of a symbol, as ONE array — the same array
 *  the count and the list are taken from, never two filters (§13.4). */
export function containmentSitesOf(sites: readonly RichSite[]): RichSite[] {
  return sites.filter((s) => siteKinds(s).some((k) => isDeclarationRelationship(k)))
}

/** Render the containment section. Empty string = declared absence: this symbol
 *  declares nothing and is declared by nothing. */
export function containmentSection(sites: RichSite[]): string {
  // Defensive filter, as with usagesSection: a caller that forgets cannot leak a
  // declaration into the usages list, and one that passes the wrong array cannot
  // render a usage here. The filter is idempotent.
  const declared = containmentSitesOf(sites)
  if (declared.length === 0) return ""
  // Two named lists, never merged: the rows a reader would ask for differ
  // completely between them (a class's members vs a member's owner), and merging
  // them is how a containment row came to read as a usage in the first place.
  const members = declared.filter((s) => !s.reversed)
  const owners = declared.filter((s) => s.reversed)
  const parts: string[] = []
  if (members.length > 0) parts.push(`${CONTAINMENT_VERB_DECLARES} ${linkedList(members)}`)
  if (owners.length > 0) parts.push(`${CONTAINMENT_VERB_DECLARED_IN} ${linkedList(owners)}`)
  // §13.2: multiplicity is DECLARED. A location reached by more than one stored
  // containment kind names the kinds rather than merging them into one row that
  // reads as a single fact.
  const multi = declared
    .map((s) => ({ site: s, kinds: siteKinds(s).filter((k) => isDeclarationRelationship(k)) }))
    .filter((x) => x.kinds.length > 1)
  for (const x of multi) parts.push(`_(also declared by ${x.kinds.join(", ")})_`)
  // The header names the rendered total and says what the rows ARE. §13.4: a
  // number the eye cannot verify against the list is a violation, so the number
  // here is the array's own length, and the cap when reached is stated with its
  // remainder rather than by omission.
  const shown = Math.min(declared.length, MAX_CONTAINMENT_ROWS)
  const rest = declared.length - shown
  const header =
    `**contained** — declares ${members.length} member${members.length === 1 ? "" : "s"}, ` +
    `declared in ${owners.length} (declaration containment; never a usage)` +
    (rest > 0 ? ` — showing ${shown} of ${declared.length}, +${rest} more on the symbol's own list` : "")
  return [header, ...parts].join("\n")
}

/** The shared "verb + links" rendering for a containment list. Same-named rows
 *  are disambiguated by file:line so a link's target is never a guess (§12.1),
 *  and every link opens the row's OWN index-stored location. */
function linkedList(sites: RichSite[]): string {
  const seen = new Set<string>()
  const links = sites.map((s) => {
    const dup = seen.has(s.name)
    seen.add(s.name)
    const label = dup ? siteLabel(s) : s.name
    return `[${label}](${openUsageUri(s)})`
  })
  return links.join(", ")
}

/** Render the clickable definition line (replaces the plain location in the
 *  source footnote). */
export function definitionLink(path: string, line: number, character: number): string {
  return `_source: bb index ([${path}:${line + 1}](${openDefinitionUri(path, line, character)}))_`
}
