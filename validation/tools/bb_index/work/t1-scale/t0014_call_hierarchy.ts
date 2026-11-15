// src/lsp/call_hierarchy.ts — M24.L5 (extended by M55.T2, issue #771).
//
// prepareCallHierarchy + incomingCalls/outgoingCalls backed by the bounded
// traverseGraph engine (M14-verified). This component is a thin adapter:
// it resolves the symbol at position, drives the engine with bounded
// options, and maps the result to LSP wire shapes. Every response declares
// its data provenance and surfaces truncation — a truncated hierarchy is
// declared, never silently cut (IDE Honesty Contract §2).
//
// Declared guarantees (gated by script/m24/verify-call-hierarchy.ts):
//   prepare:   symbol at position -> call hierarchy item (or declared
//              absence when not indexed)
//   expand:    incoming/outgoing edges from the engine -> LSP calls
//   truncate:  engine's truncated + truncationReason are carried into the
//              response metadata verbatim (never swallowed)
//   external:  unresolved targets (ext:*) render as declared external nodes
//   positions: all ranges convert via the P1 component only
//   latency:   prepare/expand p95 warm within 100 ms (contract §3)
//
// M55.T2 (Truth Rules 1/2/3 — docs/m55/M55-MASTER-PLAN.md):
//   call sites:  fromRanges are the INVOCATION sites found in the caller's own
//                source — every occurrence of the target being invoked. No
//                position is ever taken from the stored relationship row's
//                line: that column is the address owner's to interpret
//                (src/intelligence/graph/line-address.ts, M62.A2 — a legacy 0
//                or NULL means "no call-site line stored", and a labeled
//                substitute is the only thing it may stand for). When no invocation can be
//                resolved the response DECLARES it (callSitesResolved counts,
//                item detail says "position approximate") and the range falls
//                back to the caller's name token — a labeled substitute, never
//                a silent one.
//   identity:    a self-edge is classified from the invocation's receiver text
//                read at the call site: plain / `this.` / `new` = genuine
//                recursion (kept, labeled `recursive`); any other receiver is a
//                name-resolution artifact for a DIFFERENT target (e.g.
//                `this.items.get()` inside Store.get) — dropped and counted in
//                `droppedEdges` with its reason.
//   directness:  incoming/outgoing carry DIRECT relations only (LSP semantics —
//                the editor recurses itself). The engine's traversal returns
//                deeper hops too (depth > 0); a stored `calls` row from an
//                INDEXED caller whose own source never invokes the name is a
//                transitive hop or a stale row, and it is DROPPED and declared
//                in `droppedEdges` — never rendered as a caller with an
//                approximate position (found live: the demo's callers list
//                showed `top` as a caller of `deep` through `mid`, and a mutual
//                pair showed each function as its own caller).
//   selection:   selectionRange is the symbol's NAME token (the editor uses it
//                to highlight the symbol it navigates to), never its body.
//   filter:      every rule above is keyed on `relationshipType === "calls"`,
//                so this surface ASKS the engine for CALL rows
//                (CALL_HIERARCHY_RELATIONSHIP_TYPES) instead of inheriting the
//                engine's default ten-kind superset — a `contains`/`uses` row
//                names no invocation, and LSP requires a non-empty
//                `fromRanges`, so §15.3 admits exactly one honest rendering of
//                such a row: omit it and DECLARE it, never render a
//                plausible-looking range. The declared filter rides on EVERY
//                response (§15.1), so a reader can tell "the store holds no
//                call row" from "this surface reads no kind of row but calls",
//                and the defence-in-depth drop keeps the surface correct even
//                if the engine's option is ignored.
//   detail:      every item names its symbol type, its call-site count and its
//                evidence tier, plus `recursive` / `cycle` markers.
//
// Declared-absence + position-ownership wave (this lane):
//   absence:     prepare, incomingCalls and outgoingCalls each answer a file
//                outside the launch set, an unindexed file, an unknown symbol
//                id, an external node, or an unplaceable span with a
//                MACHINE-READABLE `absence.code` (contract §11.7). The pre-wave
//                answers were a bare `null` / a bare `[]`, which on the wire
//                read as "this position has no call hierarchy" / "no callers
//                found" — a different claim.
//   nodes:       an edge whose own file is outside the launch set is omitted
//                and listed in `declaredAbsentNodes` (never rendered as a
//                caller bb cannot vouch for).
//   positions:   the LINE dimension is converted by the position owner
//                (contract §5 Rule 1) and VALIDATED against the file text; the
//                pre-wave code clamped stored lines inline (`Math.max(0,
//                node.line - 1)`), which turned an external node's stored line 0
//                into a confident "line 1 of a file that does not exist".
//                A position the owner cannot place yields the protocol
//                placeholder plus `positionBasis: "declared_unresolvable"` —
//                never a plausible-looking range (contract §15.3).
//   freshness:   every response carries a machine-readable staleness marker
//                (contract §4); a stale answer without one is a defect of the
//                same severity as a wrong answer.
//   launch set:  read from src/lsp/launch_languages.ts, the single owner — not
//                through hover's re-export chain.
//
// D4 = TWO SOURCES OF TRUTH FOR "WHERE IS THIS CALLED?", decided as (a)
// CROSS-CHECK AND DECLARE (docs/m62/CALLSITE-MIGRATION.md §3.1):
//   This surface resolves positions from the CALLER'S OWN SOURCE and never
//   reads the stored `line_number`. Since M62.A1 the rest of the program reads
//   that column through its single owner
//   (src/intelligence/graph/line-address.ts: deriveCallSiteAddress,
//   addressLine0, isExactAddress). Two answers to one question is what §15.1
//   names: they must agree, or carry the declared reason they differ.
//   Measured on real indexed data (see the census on every response, and
//   script/m55/measure-address-agreement.ts):
//     agree        the store names one of the lines the source scan resolved.
//     disagree     the store names a DIFFERENT real call site for the same row.
//     source-only  the scan resolved it; the store names no call site.
//     store-only   the store names a call site the source cannot see (macro,
//                  template, dynamic dispatch).
//     neither      neither side has a call-site position (the declared
//                  approximate fallback).
//   `addressCrossCheck` is the partition on every response (the buckets sum to
//   `edges`), `addressDisagreements` carries both positions and the reason for
//   each non-agreeing row, and the store's verdict is READ from the owner, never
//   re-derived here. The comparison is LIKE-FOR-LIKE: a row is scanned for its
//   OWN target name in its OWN source symbol's text, and `direct` separates a
//   direct relation from a deeper hop. REJECTED: (b) source-first with the
//   stored line as the fallback — it would make the stored line a substitute
//   dressed as a call site (exactly what §15.3 forbids) and would delete the
//   labelled name-token fallback this surface has; (c) keep them apart and say
//   so in the legend — it defers the reconciliation to a reader, and a
//   reconciliation nobody measures cannot be gated.
//   §13.4 RE-UNIT: `callSitesResolved` / `callSitesApproximate` count RANGES, so
//   they equal the `fromRanges` this response renders; the previous unit counted
//   CALLER ENTRIES, which reported 1 while rendering 2 ranges on a real caller
//   with two call sites. `callSiteEntries` keeps the per-entry counts so the
//   re-unit loses nothing (§13.2 declares multiplicity, it does not collapse it).
//
// Mutation gates (script/m55/verify-call-hierarchy.ts): dropping the call-site
// resolution, re-admitting receiver-qualified self-edges, re-admitting
// transitive hops, returning a body selectionRange, swallowing an
// unresolvable call site, rendering a non-call row, dropping the declared
// relationship-kind filter, and dropping the declaration on an empty answer
// each fail the gate.

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import { checkFileFreshness } from "../brain/freshness";
import type { ProjectID } from "../project/schema";
import { createPositionMapper, resolveRowByteColumns } from "./positions";
// The launch set is read from its SINGLE owner (src/lsp/launch_languages.ts),
// never through hover's re-export chain — the chain is a drift hazard, and a
// caller hierarchy that answers "no callers" for a language the server does not
// serve is declared absence (contract §11.7), not an empty list.
import { languageForPath } from "./launch_languages";
// The declared-absence / staleness vocabulary is owned by symbols.ts so the two
// surfaces cannot drift into naming the same absence differently (§11.7, §4).
import {
  absenceWith,
  declaredAbsenceFor,
  type DeclaredAbsence,
  type StalenessMarker,
} from "./symbols";
import { renderSignature } from "./signature";
import { findIndexedSymbol } from "./navigation";
import { traverseGraph } from "../intelligence/graph/graph-engine"
// The stored-line ADDRESS OWNER (M62.A1, Lane 7's module — read-only here).
// D4 (a) needs its verdict, never a re-implementation of its rules: the whole
// point of the cross-check is that a second derivation of "what a stored line
// means" would be the defect the migration is trying to remove.
import { addressLine0, isExactAddress } from "../intelligence/graph/line-address";
import type {
  CallSiteAddress,
  GraphEdge,
  GraphNode,
  GraphTraversalOptions,
} from "../intelligence/contracts";

/** Engine-aligned budget defaults (the engine clamps to its own limits). */
export const CH_MAX_DEPTH = 5;
export const CH_FANOUT_BUDGET = 50;

/**
 * §15.1 + §15.3: the relationship kinds a CALL hierarchy may render.
 *
 * The graph engine's default projection is a deliberate, disclosed SUPERSET
 * (script/m48/verify-d1-doc-truth.ts gates that disclosure), and its owner
 * cascade folds rows stored against a member onto the owner. That is right for
 * the graph, impact and MCP surfaces, which render EDGES. This surface renders
 * `fromRanges`, so a row whose kind can name no invocation has no call site to
 * point at — and §15.3 forbids emitting a plausible-looking range for one.
 *
 * `instantiates`/`overrides` are deliberately absent rather than banned: a
 * `new Foo()` IS an invocation this surface's resolver already classifies
 * (`construct`), so including them is a separate declared decision for this
 * surface's owner. The law this constant encodes is narrower and does not
 * prejudge it: EVERY kind listed here must be able to name a call site.
 */
export const CALL_HIERARCHY_RELATIONSHIP_TYPES = ["calls"] as const;

/** LSP SymbolKind mapping for the symbol types the analyzers store. */
const KIND_MAP: Record<string, number> = {
  class: 5,        // Class
  interface: 11,   // Interface
  enum: 13,        // Enum
  function: 12,    // Function
  method: 6,       // Method
  constructor: 9,  // Constructor
  variable: 13,    // Variable (LSP has no variable kind; 13 is Enum — see below)
  field: 8,        // Field
  property: 10,    // Property
  struct: 23,      // Struct
  trait: 24,       // Trait (LSP SymbolKind has no trait; closest is Interface)
  macro: 25,       // Macro
}
// Override: variable -> 4 (Variable) is not in LSP SymbolKind; use 14 (Constant)
// is also absent; LSP SymbolKind includes: File(1) Module(2) Namespace(3)
// Package(4) Class(5) Method(6) Property(7) Field(8) Constructor(9) Enum(10)
// Interface(11) Function(12) Variable(13) Constant(14) String(15) Number(16)
// Boolean(17) Array(18) Object(19) Key(20) Null(21) EnumMember(22) Struct(23)
// Event(24) Operator(25) TypeParameter(26).
KIND_MAP["variable"] = 13; // Variable

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface CallHierarchyItem {
  name: string;
  kind: number;
  /** file URI — path as stored in brain_file */
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  /** M55.T2: human-readable identity line (type · call sites · tier). */
  detail?: string;
  /**
   * How `range`/`selectionRange` were derived (contract §15.3).
   *   source_resolved       the stored coordinates were converted by the
   *                         position owner against the real file text — this
   *                         item is navigable.
   *   declared_unresolvable the stored coordinates could not be placed (an
   *                         external node has no file at all, or the file text
   *                         is unreadable). The protocol REQUIRES a range, so
   *                         the placeholder is present — and this flag says the
   *                         item is NOT a location, so nothing renders it as one.
   */
  positionBasis: "source_resolved" | "declared_unresolvable";
  /** Symbol identity for expand requests. */
  data: { symbolId: string; isExternal: boolean };
}

export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  /** Call sites within `from` that target the expanded symbol. */
  fromRanges: LspRange[];
}

export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: LspRange[];
}

export interface PrepareRequest {
  filePath: string;
  line: number;
  character: number;
}

export interface PrepareResult {
  item: CallHierarchyItem | null;
  /** Declared absence when the symbol/file is not indexed. */
  notIndexed: boolean;
  /**
   * §11.7: WHY there is no item, as a machine-readable code. A bare
   * `item: null` reads to a generic client as "this position has no call
   * hierarchy" — which is a different claim from "bb does not serve this
   * language" or "this file is not indexed". Never null without a reason.
   */
  absence: DeclaredAbsence | null;
  /** §4: machine-readable staleness marker for the file this answer came from. */
  staleness: StalenessMarker;
}

export interface ExpandRequest {
  /** The item returned by prepare (or a client-echoed item). */
  item: CallHierarchyItem;
  direction: "incoming" | "outgoing";
  /** Optional cap overrides (must be positive). */
  maxDepth?: number;
}

/** M55.T2: an edge the engine returned that is NOT a genuine relation of the
 *  expanded symbol. Reported, never silently swallowed. */
export interface DroppedEdge {
  name: string;
  symbolId: string;
  reason: string;
}

/** An edge the engine returned that this surface does not serve and therefore
 *  omits — declared, never silently dropped (contract §11.7). */
export interface DeclaredAbsentNode {
  name: string;
  symbolId: string;
  /** Why the edge is not rendered (the language of the node's file). */
  reason: string;
}

/**
 * D4 (a) — how the SOURCE-resolved position and the STORE-derived address relate
 * for one edge.
 *
 * There are two independent answers to "where is the call": this surface scans
 * the caller's own source (exact UTF-16 columns through the position owner,
 * never reads the stored column), while the graph / hub / impact / MCP surfaces
 * read the stored `line_number` through its single owner,
 * `src/intelligence/graph/line-address.ts` (`deriveCallSiteAddress`,
 * `addressLine0`, `isExactAddress`). They can disagree, and when they do BOTH are
 * right about different things.
 *
 * Contract §15.1 requires that difference to be DECLARED — not averaged away,
 * not silently resolved by picking one side. Each bucket below is a distinct
 * fact about the same stored row, not an error:
 *
 *   agree       the store names one of the lines the source scan resolved.
 *   disagree    the store names a real call site and the source scan resolved a
 *               DIFFERENT line — the two owners contradict each other here.
 *   source-only the source scan resolved it; the store names NO call site (its
 *               address is the owner's declared `declaration` substitute, or
 *               `unknown`).
 *   store-only  the store names a real call site the source scan cannot see — the
 *               macro / template / dynamic-invocation case the truth table in
 *               docs/m62/CALLSITE-MIGRATION.md §1 predicts exists.
 *   neither     neither side has a call-site position (the declared approximate
 *               fallback, which renders the caller's own name token).
 *
 * THE COMPARISON MUST BE LIKE-FOR-LIKE, and that is the whole difficulty. A
 * stored row says "`edge.from` invokes `edge.to`". Measured on the real M55
 * fixture: the row for `top` in the incoming set of `deep` carries `depth: 2` and
 * a stored call site of line 4 — which is `top`'s own invocation of `mid`, on
 * `chain.ts:4`, exactly where the store says it is. Comparing that line against
 * "does `top`'s source invoke `deep`" reports a contradiction where the store is
 * RIGHT and the predicate was wrong; an earlier revision of this cross-check did
 * exactly that and re-labelled a transitive hop as "an invocation the source scan
 * cannot see". So every row is scanned for ITS OWN target name in ITS OWN source
 * symbol's text, and `direct` says whether the row is about the expanded symbol
 * (depth 1) or about a hop (depth > 1) — a different claim, declared as such.
 */
export type CallSiteAgreementKind =
  | "agree"
  | "disagree"
  | "source-only"
  | "store-only"
  | "neither";

export interface CallSiteAgreement {
  agreement: CallSiteAgreementKind;
  /** Every 0-based LSP line the source scan resolved. §13.2: one stored row may
   *  name several invocation sites, so this is a LIST and the multiplicity is
   *  declared rather than collapsed. */
  sourceLines0: number[];
  /** The address OWNER's verdict for this edge, verbatim — never re-derived
   *  here (line-address.ts L5: pure, single-owner). null when the engine
   *  attached none, which is a store-contract violation and is counted as such
   *  rather than read as "the store knows no call site". */
  address: CallSiteAddress | null;
  /** The 0-based LSP line the editor was actually handed, or null when none was. */
  renderedLine0: number | null;
  /** The name THIS row is about (`edge.to`'s own name), not necessarily the name
   *  the answer was asked about. */
  edgeTargetName: string;
  /** True when the row is a DIRECT relation of the expanded symbol (engine depth
   *  1). False = a deeper hop: the stored line names that hop's invocation, so a
   *  difference from the expanded symbol's own call sites is not a contradiction. */
  direct: boolean;
  /** The engine's own depth for the row, carried verbatim. */
  depth: number;
}

/** The §13.4 census over every stored edge this answer read. */
export interface AddressCrossCheck {
  /** Stored edges cross-checked (including the ones this surface drops). */
  edges: number;
  agree: number;
  disagree: number;
  sourceOnly: number;
  storeOnly: number;
  neither: number;
  /** Edges the engine returned WITHOUT an address — a store-contract violation,
   *  declared here instead of being read as "the store names no call site". */
  addressMissing: number;
  /** Rows that are a direct relation of the expanded symbol (depth 1). */
  direct: number;
  /** Rows about a deeper hop (depth > 1) — a different claim about a different
   *  relation, counted apart so an agreement rate is never averaged across two
   *  populations. */
  hop: number;
  /** Rows whose `depth` is not a positive integer, so directness could not be
   *  established. Declared, never assumed in either direction. */
  directnessUnstated: number;
  /** Rows whose source span or name could not be read, so NO comparison ran.
   *  These are tallied as `neither` as well; the separate counter exists so a
   *  reader can subtract them and get the population a rate was computed over. */
  comparisonNotRun: number;
}

export interface AddressDisagreement {
  name: string;
  symbolId: string;
  /** Why the two sources did not agree, in one sentence. */
  reason: string;
  agreement: CallSiteAgreement;
}

export interface ExpandResult {
  calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall>;
  /** Engine truncation carried verbatim — never swallowed. */
  truncated: boolean;
  truncationReason?: string;
  maxDepthReached: number;
  /** Declared provenance. */
  evidenceTier: "indexed" | "not_indexed";
  /**
   * M55.T2, re-unit-ed for §13.4. This counts RANGES, not caller entries:
   * `callSitesResolved + callSitesApproximate` equals the number of `fromRanges`
   * this response renders — the assertion §13.4 asks for, which nothing
   * asserted before. It used to count CALLER ENTRIES, so one stored row with two
   * invocations reported 1 while rendering 2 ranges: a header count the eye
   * could not verify against the list.
   */
  callSitesResolved: number;
  callSitesApproximate: number;
  /** The per-CALLER-ENTRY counts the previous unit expressed, kept so the
   *  re-unit loses nothing (§13.2 declares multiplicity, it does not collapse it). */
  callSiteEntries: { resolved: number; approximate: number };
  /** M55.T2: edges dropped as not-genuine, each with its reason. */
  droppedEdges: DroppedEdge[];
  /** §11.7: why `calls` is empty, as a machine-readable code. */
  absence: DeclaredAbsence | null;
  /** §11.7: edges omitted because their own file is outside the launch set. */
  declaredAbsentNodes: DeclaredAbsentNode[];
  /** §4: machine-readable staleness marker for every file this answer used. */
  staleness: StalenessMarker;
  /** D4 (a): the two sources of truth for "where is the call", cross-checked. */
  addressCrossCheck: AddressCrossCheck;
  /** §15.1: every edge whose two sources did not agree, with BOTH positions. */
  addressDisagreements: AddressDisagreement[];
  /**
   * §15.1: the relationship kinds THIS answer was built from, on every response.
   * A surface that filters differently from the engine's default superset STATES
   * its filter, so a reader can tell "the store holds no such row" from "this
   * surface does not read that kind of row".
   */
  relationshipTypes: string[];
}

/** Injectable traversal — the default wraps the real M14 engine. */
export type TraverseFn = (
  projectId: ProjectID,
  root: {
    id: string;
    name: string;
    symbolType: string;
    line: number;
    lineEnd: number;
    relativePath: string;
    filePath: string;
    language: string;
    complexity: number;
  },
  options: GraphTraversalOptions,
) => Promise<{
  callers: GraphEdge[];
  callees: GraphEdge[];
  nodes: Record<string, GraphNode>;
  truncated: boolean;
  truncationReason?: string;
  maxDepthReached: number;
}>;

/** Default traversal: the bounded traverseGraph engine itself. */
export const defaultTraverse: TraverseFn = traverseGraph;

/** Map an analyzer symbol_type to an LSP SymbolKind (with declared default). */
export function symbolKindFor(symbolType: string): number {
  return KIND_MAP[symbolType] ?? 2; // Module — declared fallback, never guessed
}

/**
 * The 0-based LSP line window for a stored 1-based index line span, or null
 * when the stored span cannot be placed.
 *
 * Contract §5 Rule 1: the conversion belongs to the position owner, and the
 * owner also VALIDATES — `indexToLsp` throws when the stored line is not in
 * the file (a legacy 0, a stale row pointing past EOF). The pre-wave code did
 * `Math.max(0, node.line - 1)`, which turned both into line 0 with the
 * confidence of a real answer; §15.3 forbids that. null here means "no
 * position", and every caller must declare it.
 *
 * Column 1 is the line's first byte, so the character is 0 and the owner's job
 * is purely the line — but it is still the owner's job.
 */
function lspLineWindow(
  mapper: ReturnType<typeof createPositionMapper>,
  line: number,
  lineEnd: number,
): { start: number; end: number } | null {
  try {
    const start = mapper.indexToLsp({ line, column: 1 }).line;
    const endLine = Number.isInteger(lineEnd) && lineEnd >= line ? lineEnd : line;
    const end = mapper.indexToLsp({ line: endLine, column: 1 }).line;
    // An ordering guard between two values the owner already produced, not a
    // coordinate conversion: a stored end before its start is inconsistent data.
    return { start, end: Math.max(start, end) };
  } catch {
    return null;
  }
}

/**
 * The protocol placeholder for an item whose position cannot be resolved. LSP
 * REQUIRES a range, so it is present — and every item carrying it also carries
 * `positionBasis: "declared_unresolvable"`, so no surface can present it as a
 * location (contract §15.3).
 */
function unresolvableRange(): LspRange {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

/**
 * A cross-check census over ZERO edges — the honest value for an answer that read
 * no stored row at all. It is NOT the same as "0 disagreements found": `edges: 0`
 * says nothing was cross-checked, and a caller that renders it must say so.
 */
function emptyCrossCheck(): AddressCrossCheck {
  return {
    edges: 0,
    agree: 0,
    disagree: 0,
    sourceOnly: 0,
    storeOnly: 0,
    neither: 0,
    addressMissing: 0,
    direct: 0,
    hop: 0,
    directnessUnstated: 0,
    comparisonNotRun: 0,
  };
}

/**
 * D4 (a) — cross-check one stored row's address against a LIKE-FOR-LIKE source
 * scan, and classify the relation.
 *
 * `sourceLines0` MUST be the invocation lines of the row's OWN target name in the
 * row's OWN source symbol's text (see the note on `CallSiteAgreementKind`); for a
 * depth-1 row that is the scan the answer already renders, so no second pass is
 * needed and no extra file is read.
 *
 * The store's verdict is read from the owner (`isExactAddress` / `addressLine0`),
 * never re-derived: a second derivation of "what a stored line means" is the
 * defect this migration exists to remove. The classification is a partition — each
 * edge lands in exactly one bucket — so the census sums to `edges`.
 */
function crossCheckEdge(
  edge: GraphEdge,
  sourceLines0: number[],
  renderedLine0: number | null,
  edgeTargetName: string,
): CallSiteAgreement {
  const address = (edge as { callSite?: CallSiteAddress }).callSite ?? null;
  const sourceLines = [...new Set(sourceLines0)].sort((a, b) => a - b);
  const storedLine0 = address === null ? null : addressLine0(address);
  const storeNamesCallSite = address !== null && isExactAddress(address);
  const depth = typeof edge.depth === "number" ? edge.depth : Number.NaN;
  // The engine's depth is 0-BASED: an edge ADJACENT to the traced symbol is
  // `depth: 0`, and `depth >= 1` is about a symbol the traversal DISCOVERED
  // (src/intelligence/contracts.ts, the `deeperCallers` note). Reading "direct"
  // as `depth === 1` is off by one against the real engine and would classify
  // every direct row as a hop — measured on a real 12-row index, where the
  // engine returned depth 0 for all six caller rows and 1 for the one deeper row.
  const direct = depth === 0;
  let agreement: CallSiteAgreementKind;
  if (storeNamesCallSite && storedLine0 !== null && sourceLines.includes(storedLine0)) {
    // The store named one of the lines the scan found. When the scan found
    // several, that is a multiplicity (§13.2), not a disagreement.
    agreement = "agree";
  } else if (storeNamesCallSite && storedLine0 !== null && sourceLines.length > 0) {
    agreement = "disagree";
  } else if (storeNamesCallSite && storedLine0 !== null) {
    // The store names a real call site for THIS ROW that the row's own source
    // does not show. On a direct row that is the macro / template / dynamic
    // invocation case; on a hop it is a row whose scan could not run, and both
    // are declared with `direct` so the reader knows which population it is in.
    agreement = "store-only";
  } else if (sourceLines.length > 0) {
    agreement = "source-only";
  } else {
    agreement = "neither";
  }
  return { agreement, sourceLines0: sourceLines, address, renderedLine0, edgeTargetName, direct, depth };
}

/** Fold one cross-check verdict into the census. A partition: the buckets sum to
 *  `edges`, which is what makes the agreement rate a rate over a known
 *  denominator rather than a number nobody can check. */
function tallyCrossCheck(census: AddressCrossCheck, agreement: CallSiteAgreement, addressPresent: boolean): void {
  census.edges++;
  if (!addressPresent) census.addressMissing++;
  const depth = agreement.depth;
  if (depth === 0) census.direct++;
  else if (Number.isInteger(depth) && depth >= 1) census.hop++;
  else census.directnessUnstated++;
  switch (agreement.agreement) {
    case "agree": census.agree++; break;
    case "disagree": census.disagree++; break;
    case "source-only": census.sourceOnly++; break;
    case "store-only": census.storeOnly++; break;
    case "neither": census.neither++; break;
  }
}

/**
 * The invoked name's DECLARATION token, when the invoked symbol is declared in
 * this very file at `declLine1`.
 *
 * A declaration is not an invocation. §15.3's first named prohibition is a range
 * that points at a declaration, and this is where that defect lived on real data:
 * on the M55 fixture, `Store`'s own body contains `get(key: string): T | undefined`
 * — the DECLARATION of `get` — which the name scan read as an invocation, so
 * `Store` was rendered as a caller of `get` with a range pointing at its own
 * member's signature (measured: `script/m55/verify-call-hierarchy.ts` W1, red on
 * real data at HEAD). The occurrence is excluded only on the declaration line of
 * the invoked symbol itself; DECLARED LIMITATION — an unrelated symbol with the
 * same name declared in the scanned span is still read as an invocation, because
 * deciding that needs a name-resolution pass this surface does not have.
 */
function declarationTokenOf(
  sourceText: string,
  mapper: ReturnType<typeof createPositionMapper>,
  name: string,
  declLine1: number,
): { line: number; character: number } | undefined {
  const window = lspLineWindow(mapper, declLine1, declLine1);
  if (window === null) return undefined;
  const token = nameTokenRange(sourceText, name, { start: window.start, end: window.start });
  return token === null ? undefined : token.start;
}

/** §4: a staleness marker for an answer that read no indexed file. */
function unknownStaleness(paths: string[] = []): StalenessMarker {
  return { stale: true, status: "unknown", filesChecked: 0, filesUnverified: paths };
}

/**
 * §4 staleness for one indexed file. A status the index cannot establish is
 * reported as `unknown` with `stale: true` — we cannot claim freshness for a
 * file we could not check, and silence is guilt.
 */
function symbolStaleness(
  raw: CoreDatabase,
  fileId: string,
  filePath: string,
): StalenessMarker {
  const status = checkFileFreshness(raw, fileId);
  if (status === null) return unknownStaleness([filePath]);
  return {
    stale: status.status !== "fresh",
    status: status.status,
    filesChecked: 1,
    filesUnverified: [],
  };
}

/**
 * §4 staleness for every file an expand answer used (the root plus every edge
 * file that was rendered). One batched lookup for the edge files, then one
 * `checkFileFreshness` per distinct file — bounded by the fanout budget, and
 * any file the index cannot resolve is DECLARED in `filesUnverified` rather
 * than assumed fresh.
 */
function expandStaleness(
  raw: CoreDatabase,
  rootFileId: string | null,
  rootFilePath: string,
  edgePaths: string[],
): StalenessMarker {
  const distinct = [...new Set(edgePaths)].filter((p) => p !== "" && p !== rootFilePath);
  const idByPath = new Map<string, string>();
  if (distinct.length > 0) {
    const placeholders = distinct.map(() => "?").join(", ");
    let rows: Array<{ id: string; path: string }> = [];
    try {
      rows = raw
        .prepare(`SELECT id, path FROM brain_file WHERE path IN (${placeholders})`)
        .all(...distinct) as Array<{ id: string; path: string }>;
    } catch {
      rows = [];
    }
    for (const row of rows) idByPath.set(row.path, row.id);
  }
  let fresh = 0;
  let stale = 0;
  let missing = 0;
  const unverified: string[] = [];
  const account = (fileId: string | null, filePath: string): void => {
    if (fileId === null) {
      unverified.push(filePath);
      return;
    }
    const status = checkFileFreshness(raw, fileId);
    if (status === null) unverified.push(filePath);
    else if (status.status === "fresh") fresh++;
    else if (status.status === "stale") stale++;
    else missing++;
  };
  account(rootFileId, rootFilePath);
  for (const path of distinct) account(idByPath.get(path) ?? null, path);
  return {
    stale: stale > 0 || missing > 0 || unverified.length > 0,
    status:
      missing > 0
        ? "missing"
        : stale > 0
          ? "stale"
          : unverified.length > 0
            ? "unknown"
            : fresh > 0
              ? "fresh"
              : "unknown",
    filesChecked: 1 + distinct.length - unverified.length,
    filesUnverified: unverified,
  };
}

// ---------------------------------------------------------------------------
// M55.T2: invocation reading — the ONE place a call site's position is derived
// ---------------------------------------------------------------------------

/** How a name was invoked at a call site (read from the caller's source). */
export type InvocationKind =
  /** `name(...)` — an unqualified call. */
  | "plain"
  /** `this.name(...)` — a call on the receiver itself (recursion candidate). */
  | "this"
  /** `new name(...)` — a construction. */
  | "construct"
  /** `something.name(...)` — a call whose receiver is another value. */
  | "receiver";

export interface ResolvedInvocation {
  /** Exact LSP range of the invoked NAME token (never the whole line). */
  range: LspRange;
  kind: InvocationKind;
  /** Receiver text before the name ("" for plain/this/construct). */
  receiver: string;
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/** Strip a trailing line comment. Declared limitation: a `//` inside a string
 *  literal is not modelled — every resolved invocation is additionally checked
 *  against the caller's own declaration range, so a comment-only match cannot
 *  invent an edge on its own. */
function codeBeforeComment(line: string): string {
  const i = line.indexOf("//");
  return i === -1 ? line : line.slice(0, i);
}

/** The receiver text immediately before `at` ("" when unqualified). */
function receiverBefore(line: string, at: number): string {
  let i = at - 1;
  while (i >= 0 && /\s/.test(line[i]!)) i--;
  if (line[i] !== ".") return "";
  let j = i - 1;
  while (j >= 0 && /\s/.test(line[j]!)) j--;
  const end = j + 1;
  while (j >= 0 && (isWordChar(line[j]!) || line[j] === ".")) j--;
  // Trailing separator stripped: the receiver is the VALUE (`this.items`), not
  // `this.items.` — the reason strings read `this.items.get(...)`.
  return line.slice(j + 1, end).replace(/\.+$/, "");
}

function classify(receiver: string, isConstruct: boolean, ownNames: ReadonlySet<string>): InvocationKind {
  if (isConstruct) return "construct";
  if (receiver === "") return "plain";
  // A receiver's LAST segment is the value the call is made on. `this.` means
  // the symbol itself; the symbol's own owner/first segment (e.g. `Store.get(`)
  // is a qualified self-call; anything else is another value entirely.
  //
  // M55.T2 fix: the old rule was `receiver.startsWith("this.")`, which read the
  // two-segment receiver of `this.items.get(...)` as `this.` and classified the
  // analyzer's name-resolution artifact as genuine recursion (the live demo's
  // `Store.get` listed itself as its own caller).
  const segments = receiver.split(".").filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? "";
  if (last === "this") return "this";
  if (ownNames.has(last)) return "this";
  return "receiver";
}

/** Every CALL of `targetName` inside a caller's 0-based line range, with exact
 *  UTF-16 columns and the receiver that qualified each one. Comments are
 *  ignored; BOTH coordinate dimensions come from the P1 position owner
 *  (contract §5 Rule 1) — the pre-wave code hand-built the index line
 *  (`line0 + 1`) and the index byte column (`Buffer.byteLength(...) + 1`).
 *
 *  A match whose position the owner refuses (a stored name that splits a
 *  surrogate pair, so the offset is not a character boundary) is not emitted as
 *  a call site; the caller then reports it as an APPROXIMATE call site, which is
 *  declared. It is never placed on a guessed position. */
export function resolveInvocations(
  sourceText: string,
  targetName: string,
  callerLines0: { start: number; end: number },
  /** The caller's OWN declaration name token position: a declaration is not an
   *  invocation, and for a self-edge the signature (`get(key: string)`) would
   *  otherwise be read as a receiver-free call of itself. */
  skip?: { line: number; character: number },
  /** The caller's own names (simple name + owning type): a receiver that names
   *  one of these is the symbol itself, not another value. */
  ownNames: ReadonlySet<string> = new Set<string>(),
  /** The INVOKED symbol's own declaration token, when it is declared in the
   *  scanned text. A LIST, because the two exclusions are different facts and
   *  neither may shadow the other: the caller's declaration makes a self-edge's
   *  signature readable as recursion, and the invoked symbol's declaration makes
   *  a containing type's member signature readable as a call of that member
   *  (measured on the real M55 fixture — `Store` was a caller of `Store.get`
   *  through its own `get(key: string)` signature). */
  skipDeclarations: ReadonlyArray<{ line: number; character: number }> = [],
): ResolvedInvocation[] {
  if (targetName.length === 0) return [];
  const mapper = createPositionMapper(sourceText);
  const out: ResolvedInvocation[] = [];
  const last = Math.min(callerLines0.end, mapper.lineTexts.length - 1);
  const excluded = skip === undefined ? skipDeclarations : [skip, ...skipDeclarations];
  for (let line0 = Math.max(0, callerLines0.start); line0 <= last; line0++) {
    const line = codeBeforeComment(mapper.lineTexts[line0] ?? "");
    let from = 0;
    for (;;) {
      const at = line.indexOf(targetName, from);
      if (at === -1) break;
      from = at + targetName.length;
      if (isWordChar(line[at - 1]) || isWordChar(line[at + targetName.length])) continue;
      if (excluded.some((p) => p.line === line0 && p.character === at)) continue;
      // A call: the name is followed by `(`, or preceded by `new`.
      let k = at + targetName.length;
      while (k < line.length && /\s/.test(line[k]!)) k++;
      const isCall = line[k] === "(";
      const isConstruct = /(^|[^\w$])new\s+$/.test(line.slice(0, at));
      if (!isCall && !isConstruct) continue;
      const receiver = receiverBefore(line, at);
      // The owner converts this 0-based LSP line and UTF-16 offset into the
      // index's 1-based line + 1-based byte column, and back. No arithmetic here.
      let range: LspRange;
      try {
        const start = mapper.lspToIndex({ line: line0, character: at });
        const end = mapper.lspToIndex({ line: line0, character: at + targetName.length });
        range = { start: mapper.indexToLsp(start), end: mapper.indexToLsp(end) };
      } catch {
        continue; // declared by the caller as an approximate call site
      }
      out.push({
        range,
        kind: classify(receiver, isConstruct, ownNames),
        receiver,
      });
    }
  }
  return out;
}

/** The NAME token's exact range anywhere in a 0-based line range (used for
 *  selectionRange — the editor highlights what this points at). Both
 *  dimensions are converted by the P1 position owner. */
export function nameTokenRange(
  sourceText: string,
  name: string,
  lines0: { start: number; end: number },
): LspRange | null {
  if (name.length === 0) return null;
  const mapper = createPositionMapper(sourceText);
  const last = Math.min(lines0.end, mapper.lineTexts.length - 1);
  for (let line0 = Math.max(0, lines0.start); line0 <= last; line0++) {
    const line = mapper.lineTexts[line0] ?? "";
    let from = 0;
    for (;;) {
      const at = line.indexOf(name, from);
      if (at === -1) break;
      from = at + name.length;
      if (isWordChar(line[at - 1]) || isWordChar(line[at + name.length])) continue;
      try {
        const start = mapper.lspToIndex({ line: line0, character: at });
        const end = mapper.lspToIndex({ line: line0, character: at + name.length });
        return { start: mapper.indexToLsp(start), end: mapper.indexToLsp(end) };
      } catch {
        return null; // declared by the caller, never guessed
      }
    }
  }
  return null;
}

/** First non-space column of a line (the declaration's visible start). */
function lineIndent(sourceText: string, line0: number): number {
  const line = (createPositionMapper(sourceText).lineTexts[line0] ?? "");
  const m = /^(\s*)/.exec(line);
  return (m?.[1] ?? "").length;
}

function lineLength(sourceText: string, line0: number): number {
  return (createPositionMapper(sourceText).lineTexts[line0] ?? "").length;
}

/** Read a file once per expand call; a missing file is a declared null. */
type SourceReader = (filePath: string) => string | null;

function makeSourceReader(): SourceReader {
  const cache = new Map<string, string | null>();
  return (filePath: string): string | null => {
    if (filePath === "") return null;
    const hit = cache.get(filePath);
    if (hit !== undefined) return hit;
    let text: string | null = null;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      text = null;
    }
    cache.set(filePath, text);
    return text;
  };
}

/** Prepare: resolve the symbol at position into a call hierarchy item. */
export function prepareCallHierarchy(
  raw: CoreDatabase,
  request: PrepareRequest,
): PrepareResult {
  // §11.7: a file the server does not serve is DECLARED ABSENT with a
  // machine-readable reason, checked BEFORE the index is touched. The
  // pre-lane code returned a bare `{item: null, notIndexed: true}` whose wire
  // body is a bare `null` — indistinguishable from "this position has no call
  // hierarchy", which is a different claim.
  const scope = declaredAbsenceFor(request.filePath);
  if (scope !== null) {
    return { item: null, notIndexed: true, absence: scope, staleness: unknownStaleness([request.filePath]) };
  }
  const symbol = findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return {
      item: null,
      notIndexed: true,
      absence: absenceWith(
        "symbol_not_at_position",
        "the index stores no symbol covering this position (this is a served language: the answer is 'no symbol here', not 'no call hierarchy')",
        request.filePath,
      ),
      staleness: unknownStaleness([request.filePath]),
    };
  }
  const staleness = symbolStaleness(raw, symbol.file_id, symbol.path);
  let sourceText: string;
  try {
    sourceText = readFileSync(symbol.path, "utf8");
  } catch {
    return {
      item: null,
      notIndexed: true,
      absence: absenceWith(
        "source_unreadable",
        "the file text could not be read, so no stored span can be converted to an LSP position (no item is placed)",
        symbol.path,
      ),
      staleness,
    };
  }
  if (
    symbol.byte_start === null || symbol.byte_end === null ||
    symbol.line_start === null || symbol.line_end === null
  ) {
    return {
      item: null,
      notIndexed: true,
      absence: absenceWith(
        "coordinates_missing",
        "the indexed symbol stored no byte/line coordinates, so no position can be derived from it (no item is placed)",
        symbol.path,
      ),
      staleness,
    };
  }
  const startCol = resolveRowByteColumns(sourceText, symbol.line_start, symbol.byte_start);
  const endCol = resolveRowByteColumns(sourceText, symbol.line_end, symbol.byte_end);
  if (startCol === null || endCol === null) {
    return {
      item: null,
      notIndexed: true,
      absence: absenceWith(
        "coordinates_missing",
        "the indexed span could not be resolved against the file's own byte columns (no item is placed)",
        symbol.path,
      ),
      staleness,
    };
  }
  const mapper = createPositionMapper(sourceText);
  const range = mapper.indexRangeToLsp({
    start: { line: startCol.line, column: startCol.column },
    end: { line: endCol.line, column: endCol.column },
  });
  const lspRange: LspRange = {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
  // M55.T2: the editor highlights selectionRange — point it at the NAME token.
  // The scan window is the range the position OWNER already produced, so no
  // coordinate is re-derived here (the pre-lane code rebuilt it inline with a
  // `?? 1` default that invented line 1 for a row that stored none).
  const nameRange = nameTokenRange(
    sourceText,
    symbol.name,
    { start: lspRange.start.line, end: lspRange.end.line },
  ) ?? lspRange;
  // M55.T4 (issue #772, §14 Truth Rule 4): the item's detail line carries the
  // HUMAN signature, rendered by the ONE owner (src/lsp/signature.ts) — the
  // call-hierarchy view is a place a developer reads a signature, and it used
  // to answer the bare symbol type. The row's parameters/return type are read
  // here (the position resolver never needed them); the language decides the
  // notation, and visibility is intentionally left out (the hover card owns
  // the identity line; this is a one-line editor label).
  const sigRow = raw
    .prepare("SELECT parameters, return_type, visibility FROM brain_symbol WHERE id = ?")
    .get(symbol.id) as { parameters: string | null; return_type: string | null; visibility: string | null } | undefined;
  const detail =
    sigRow === undefined
      ? symbol.symbol_type
      : renderSignature(
          {
            name: symbol.name,
            symbol_type: symbol.symbol_type,
            parameters: sigRow.parameters,
            return_type: sigRow.return_type,
            visibility: null,
          },
          languageForPath(symbol.path),
        );
  return {
    item: {
      name: symbol.name,
      kind: symbolKindFor(symbol.symbol_type),
      uri: `file://${symbol.path}`,
      range: lspRange,
      selectionRange: nameRange,
      detail,
      positionBasis: "source_resolved",
      data: { symbolId: symbol.id, isExternal: false },
    },
    notIndexed: false,
    absence: null,
    staleness,
  };
}

/** Build a CallHierarchyItem from an engine node, with exact positions when the
 *  node's source is readable. `detail` is the declared identity line. */
function itemFromNode(
  node: GraphNode,
  source: string | null,
  detail: string,
): CallHierarchyItem {
  const filePath = node.filePath !== "" ? node.filePath : node.file;
  // §5 Rule 1 / §15.3: the stored line window is converted by the position
  // owner (which also validates it against the real file). The pre-lane code
  // wrote `Math.max(0, node.line - 1)` inline, so an external node's stored
  // line 0 became a confident "line 1 of a file that does not exist".
  const mapper = source === null ? null : createPositionMapper(source);
  const window = mapper === null ? null : lspLineWindow(mapper, node.line, node.lineEnd);
  const start0 = window === null ? 0 : window.start;
  const end0 = window === null ? 0 : window.end;
  let range: LspRange = unresolvableRange();
  let selectionRange: LspRange = range;
  if (source !== null && window !== null) {
    // Visible declaration span (from the indentation to the end of the last
    // line) + the NAME token for the highlight.
    range = {
      start: { line: start0, character: lineIndent(source, start0) },
      end: { line: end0, character: lineLength(source, end0) },
    };
    selectionRange = nameTokenRange(source, node.name, { start: start0, end: end0 }) ?? range;
  }
  const resolved = source !== null && window !== null;
  return {
    name: node.name,
    kind: symbolKindFor(node.symbolType),
    uri: filePath !== "" ? `file://${filePath}` : "",
    range,
    selectionRange,
    detail: resolved ? detail : `${detail} · position unresolvable (no readable source for this node)`,
    positionBasis: resolved ? "source_resolved" : "declared_unresolvable",
    data: { symbolId: node.id, isExternal: node.isExternal },
  };
}

/** Expand: incoming/outgoing calls via the bounded engine. */
export async function expandCalls(
  raw: CoreDatabase,
  projectId: ProjectID,
  request: ExpandRequest,
  traverse: TraverseFn = defaultTraverse,
  readSource: SourceReader = makeSourceReader(),
): Promise<ExpandResult> {
  const { item } = request;
  if (item.data.isExternal) {
    // External nodes have no index identity to traverse — declared empty, and
    // §11.7 requires the reason to be machine-readable rather than a bare [].
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
      callSitesResolved: 0,
      callSitesApproximate: 0,
      droppedEdges: [],
      absence: absenceWith(
        "external_target",
        "the expanded item is an external node with no index identity, so there is nothing for bb to traverse (this is NOT 'this symbol has no callers')",
      ),
      declaredAbsentNodes: [],
      staleness: unknownStaleness(),
      callSiteEntries: { resolved: 0, approximate: 0 },
      addressCrossCheck: emptyCrossCheck(),
      addressDisagreements: [],
      relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],
    };
  }
  // Re-resolve the root row from the index for the engine's root shape.
  const rootRow = raw
    .prepare(
      `SELECT s.id, s.name, s.symbol_type, COALESCE(s.qualified_name,'') AS qualifiedName,
              COALESCE(s.line_start,0) AS line,
              COALESCE(s.line_end,0) AS lineEnd,
              COALESCE(f.relative_path,'') AS relativePath,
              COALESCE(f.path,'') AS filePath,
              f.id AS fileId,
              COALESCE(f.language,'unknown') AS language,
              COALESCE(s.complexity,0) AS complexity
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.id = ?`,
    )
    .get(item.data.symbolId) as
    | {
        id: string;
        name: string;
        symbol_type: string;
        qualifiedName: string;
        line: number;
        lineEnd: number;
        relativePath: string;
        filePath: string;
        fileId: string | null;
        language: string;
        complexity: number;
      }
    | undefined;
  if (rootRow === undefined) {
    // §11.7: an unknown symbol id is declared absence with its own code. The
    // pre-lane answer was `calls: []` + `evidenceTier: "not_indexed"`, which on
    // the wire is a bare [] that reads as "no callers found".
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
      callSitesResolved: 0,
      callSitesApproximate: 0,
      droppedEdges: [],
      absence: absenceWith(
        "symbol_not_in_index",
        `the index stores no symbol with id "${item.data.symbolId}", so there is no hierarchy to traverse (this is NOT 'this symbol has no callers')`,
      ),
      declaredAbsentNodes: [],
      staleness: unknownStaleness(),
      callSiteEntries: { resolved: 0, approximate: 0 },
      addressCrossCheck: emptyCrossCheck(),
      addressDisagreements: [],
      relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],
    };
  }
  // §11.7: the ROOT's own file decides whether this surface serves the request
  // at all. A non-launch language is declared absent here — before the engine
  // runs — instead of answering "no callers" for a language bb does not serve.
  const rootScope = declaredAbsenceFor(rootRow.filePath);
  if (rootScope !== null) {
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
      callSitesResolved: 0,
      callSitesApproximate: 0,
      droppedEdges: [],
      absence: rootScope,
      declaredAbsentNodes: [],
      staleness: unknownStaleness([rootRow.filePath]),
      callSiteEntries: { resolved: 0, approximate: 0 },
      addressCrossCheck: emptyCrossCheck(),
      addressDisagreements: [],
      relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],
    };
  }

  // The root's own names: its simple name plus its owning type's simple name
  // (`Store.get` -> {get, Store}). A receiver naming one of these is the symbol
  // itself (a qualified self-call); any other receiver names another value.
  const ownNames = new Set<string>([rootRow.name]);
  const qualified = rootRow.qualifiedName ?? "";
  if (qualified.includes(".")) {
    const ownerSegment = qualified.slice(0, qualified.lastIndexOf(".")).split(".").pop() ?? "";
    if (ownerSegment.length > 0) ownNames.add(ownerSegment);
  }

  const maxDepth = Math.max(1, Math.min(request.maxDepth ?? CH_MAX_DEPTH, 10));
  const direction = request.direction === "incoming" ? "callers" : "callees";
  const engineRoot = {
    id: rootRow.id,
    name: rootRow.name,
    symbolType: rootRow.symbol_type,
    line: rootRow.line,
    lineEnd: rootRow.lineEnd,
    relativePath: rootRow.relativePath,
    filePath: rootRow.filePath,
    language: rootRow.language,
    complexity: rootRow.complexity,
  };
  const result = await traverse(projectId, engineRoot, {
    direction,
    maxDepth,
    callerBudget: CH_FANOUT_BUDGET,
    calleeBudget: CH_FANOUT_BUDGET,
    // §15.3: ask for CALL rows only. Without this the engine's default ten-kind
    // superset reaches a renderer whose `fromRanges` must name a call site.
    relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],
  });

  const rootSource = readSource(rootRow.filePath);
  const edges = direction === "callers" ? result.callers : result.callees;
  const calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall> = [];
  const seenFrom = new Set<string>();
  const droppedEdges: DroppedEdge[] = [];
  const declaredAbsentNodes: DeclaredAbsentNode[] = [];
  const addressDisagreements: AddressDisagreement[] = [];
  const edgePaths: string[] = [];
  // §13.4: these count RANGES, so the header count equals the rendered list. The
  // per-ENTRY counts live beside them so the re-unit loses nothing.
  let callSitesResolved = 0;
  let callSitesApproximate = 0;
  let resolvedEntries = 0;
  let approximateEntries = 0;
  const crossCheck: AddressCrossCheck = emptyCrossCheck();

  for (const edge of edges) {
    const otherId = direction === "callers" ? edge.from : edge.to;
    if (seenFrom.has(otherId)) continue;
    const node = result.nodes[otherId];
    if (node === undefined) continue;

    const nodePath = node.filePath !== "" ? node.filePath : node.file;
    // §11.7: an edge into a file this server does not serve is DECLARED ABSENT
    // and omitted, not rendered as a caller with a position bb cannot vouch
    // for. An external node has no file at all and is handled by itemFromNode's
    // declared-unresolvable position instead.
    if (!node.isExternal && declaredAbsenceFor(nodePath) !== null) {
      declaredAbsentNodes.push({
        name: node.name,
        symbolId: otherId,
        reason: `the node's own file (${nodePath}) is outside the bb launch set, so bb declares no call sites for it`,
      });
      continue;
    }
    edgePaths.push(nodePath);

    // The caller's own source + declaration range: incoming edges are invoked
    // from the caller's body; outgoing edges are invoked from the ROOT's body.
    const callerSource = direction === "callers" ? readSource(nodePath) : rootSource;
    // §5 Rule 1: the scan window is converted by the position owner, which also
    // validates it against the caller's own source. `null` = the stored
    // declaration line cannot be placed, which is NOT the same as "this caller
    // does not invoke the name" — the pre-lane code clamped both to line 0 and
    // could not tell the two apart, so an unplaceable caller was reported as a
    // stale/transitive row. Unplaceable now means an APPROXIMATE call site,
    // which is declared.
    const callerWindow = callerSource === null
      ? null
      : lspLineWindow(
          createPositionMapper(callerSource),
          direction === "callers" ? node.line : rootRow.line,
          direction === "callers" ? node.lineEnd : rootRow.lineEnd,
        );
    const callerLines0 = callerWindow;
    const invokedName = direction === "callers" ? rootRow.name : node.name;
    // The caller's own declaration name (never an invocation of anything).
    const callerOwnName = direction === "callers" ? node.name : rootRow.name;
    const callerNamePos = callerSource === null || callerLines0 === null
      ? undefined
      : nameTokenRange(callerSource, callerOwnName, callerLines0)?.start;
    // §15.3: the invoked symbol's own DECLARATION token, when it is declared in
    // the scanned file. A signature `get(key: string): T | undefined` is a
    // declaration, not a call, and reading it as a call is what made `Store` a
    // caller of `Store.get` on the real M55 fixture.
    const scannedPath = direction === "callers" ? nodePath : rootRow.filePath;
    const targetDeclLine1 = direction === "callers" ? rootRow.line : node.line;
    const targetDeclPath = direction === "callers" ? rootRow.filePath : nodePath;
    const targetDeclPos = callerSource === null || scannedPath !== targetDeclPath
      ? undefined
      : declarationTokenOf(callerSource, createPositionMapper(callerSource), invokedName, targetDeclLine1);
    const invocations = callerSource === null || callerLines0 === null
      ? []
      : resolveInvocations(
          callerSource,
          invokedName,
          callerLines0,
          callerNamePos,
          ownNames,
          targetDeclPos === undefined ? [] : [targetDeclPos],
        );

    const isSelfEdge = otherId === item.data.symbolId;
    if (isSelfEdge) {
      // A self-edge is genuine only when the name is invoked on itself
      // (plain / this. / new). A receiver-qualified invocation is a
      // name-resolution artifact for a DIFFERENT target — e.g.
      // `this.items.get()` inside Store.get resolves to Map.get, and the
      // analyzer's name resolution stored it back onto Store.get.
      const receiverQualified = invocations.length > 0 && invocations.every((i) => i.kind === "receiver");
      if (receiverQualified) {
        droppedEdges.push({
          name: node.name,
          symbolId: otherId,
          reason: `receiver-qualified self-name call (${invocations[0]!.receiver}.${invokedName}) targets another value, not this symbol`,
        });
        continue;
      }
    }
    // M55.T2 directness: LSP's incoming/outgoing lists are DIRECT edges (the
    // editor performs its own recursion). A `calls` row from an INDEXED caller
    // whose own source never invokes this name is a deeper hop of the engine's
    // traversal (depth > 0) or a stale row — dropped and DECLARED, never
    // rendered as a caller with an approximate position.
    // D4 (a): cross-check BEFORE that rule decides this edge's fate, over every
    // stored edge the answer read including the ones it drops — a census that
    // only counted rendered edges could not see a disagreement.
    const scanLines0 = invocations.map((i) => i.range.start.line);
    const edgeTarget = result.nodes[edge.to];
    const edgeTargetName = edgeTarget?.name ?? "";
    const edgeSource = result.nodes[edge.from];
    const likeForLike = edge.depth === 0 && edgeTargetName === invokedName && edgeSource !== undefined;
    let crossLines0 = scanLines0;
    let crossScanRan = true;
    if (!likeForLike) {
      // The row's own source symbol: a second, narrow scan of ONE more file
      // (already cached per expand). An unavailable source or span is NOT an
      // absence of invocations; it is a comparison that could not run, declared
      // as such and never counted as agreement.
      crossScanRan = false;
      const hopPath = edgeSource === undefined ? "" : edgeSource.filePath !== "" ? edgeSource.filePath : edgeSource.file;
      const hopSource = hopPath === "" ? null : readSource(hopPath);
      if (hopSource !== null && edgeSource !== undefined && edgeTargetName !== "") {
        const hopMapper = createPositionMapper(hopSource);
        const hopWindow = lspLineWindow(hopMapper, edgeSource.line, edgeSource.lineEnd);
        if (hopWindow !== null) {
          const hopTargetPath = edgeTarget === undefined ? "" : edgeTarget.filePath !== "" ? edgeTarget.filePath : edgeTarget.file;
          const hopDeclPos = hopTargetPath !== "" && hopPath === hopTargetPath
            ? declarationTokenOf(hopSource, hopMapper, edgeTargetName, edgeTarget!.line)
            : undefined;
          crossLines0 = resolveInvocations(
            hopSource,
            edgeTargetName,
            hopWindow,
            undefined,
            new Set<string>(),
            hopDeclPos === undefined ? [] : [hopDeclPos],
          ).map((i) => i.range.start.line);
          crossScanRan = true;
        }
      }
    }
    const agreement = crossCheckEdge(edge, crossLines0, scanLines0[0] ?? null, edgeTargetName);
    // An unrunnable comparison is not a bucket the census may quietly claim: it
    // is tallied as `neither` (nothing was compared) plus a declared
    // `comparisonNotRun`, so no rate is ever computed over a denominator that
    // silently included rows nobody compared.
    if (!crossScanRan) agreement.agreement = "neither";
    tallyCrossCheck(crossCheck, agreement, agreement.address !== null);
    if (!crossScanRan) crossCheck.comparisonNotRun++;

    // §15.3, defence in depth: whatever the engine returns, a RENDERED range must
    // belong to a call. A row of another kind names no invocation, so it is
    // omitted and DECLARED with its kind — never rendered with a
    // plausible-looking range and never relabelled as a call. Placed AFTER the
    // cross-check so the census still partitions every stored edge this answer
    // read, not only the ones it renders.
    //
    // This guard is REDUNDANT while the request above is honoured, and that is
    // the point of keeping it: measured on the T2 fixture, with the request
    // present the engine returns 1 caller row (all `calls`) and with it removed 8
    // (6 of them `contains`/`uses`). A surface that renders `fromRanges` must not
    // be one engine option away from emitting a range for a relation that names
    // no call.
    //
    // Also redundant, and also deliberate: `edge.relationshipType === "calls"` is
    // still carried on the directness rule below. It is left in place because
    // removing it would change THAT rule's meaning for a future non-`calls` kind
    // that reaches this far, and this lane's disposition was to narrow what is
    // RENDERED, not to redefine what the directness rule means. Narrowing it is
    // that rule's owner's call; this comment says so rather than leaving the
    // redundancy looking accidental.
    if (!(CALL_HIERARCHY_RELATIONSHIP_TYPES as readonly string[]).includes(edge.relationshipType)) {
      droppedEdges.push({
        name: node.name,
        symbolId: otherId,
        reason: `the stored row is a "${edge.relationshipType}" relation, not a call; a call hierarchy renders call sites and this relation names none, so the row is omitted rather than rendered with a range (contract 15.3)`,
      });
      continue;
    }

    if (
      invocations.length === 0 &&
      callerSource !== null &&
      callerLines0 !== null &&
      !node.isExternal &&
      edge.relationshipType === "calls"
    ) {
      // The cause is the ENGINE'S OWN depth when it states one, not a guess:
      // depth > 1 IS a transitive hop (an LSP list is direct edges), and depth 1
      // with no invocation in the caller's own source is a stored row the text
      // does not support. The previous wording offered BOTH possibilities for
      // every row, including the rows where the engine had already answered.
      // The engine's depth is 0-based (an adjacent edge is depth 0), so a hop is
      // `depth >= 1`. Declared rather than assumed: an absent or non-integer
      // depth is `directnessUnstated` in the census and falls through to the
      // store-vs-text reasons below instead of being called a hop.
      const hop = Number.isInteger(edge.depth) && edge.depth >= 1;
      const storeLine = agreement.address !== null && isExactAddress(agreement.address)
        ? agreement.address.line
        : null;
      const reason = hop
        ? `${node.name} does not invoke ${invokedName} in its own source; the engine reports this row at depth ${edge.depth}, so it is a transitive hop (${node.name} reaches ${invokedName} through an intermediate symbol), not a direct ${direction === "callers" ? "caller" : "callee"}`
        : storeLine !== null
          ? `${node.name} does not invoke ${invokedName} anywhere in its own source, yet the stored row names call site line ${storeLine} - the store and the caller's own text disagree about this DIRECT row; this surface renders the source-resolved position and declares the difference (contract 15.1), because rendering the stored line would be rendering a position this surface cannot verify (15.3)`
          : `${node.name} does not invoke ${invokedName} in its own source and the stored row names no call site for it - a stale stored row, not a direct ${direction === "callers" ? "caller" : "callee"}`;
      droppedEdges.push({ name: node.name, symbolId: otherId, reason });
      if (agreement.agreement !== "neither") {
        addressDisagreements.push({
          name: node.name,
          symbolId: otherId,
          reason,
          agreement,
        });
      }
      continue;
    }
    seenFrom.add(otherId);

    const recursiveMarker = isSelfEdge ? " · recursive" : "";
    const unplaceable = callerLines0 === null && callerSource !== null;
    const baseDetail = `${node.symbolType} · ${edge.relationshipType} · ${recursiveMarker ? "self" : "1 call site"}${recursiveMarker}`;
    // The unplaceable-caller declaration rides on the item's own identity line
    // (declared, not silent): the stored declaration line could not be placed in
    // the caller's own source, so no call site could be read from it.
    const detail = unplaceable
      ? `${baseDetail} · caller declaration line unresolvable in its own source`
      : baseDetail;
    const expanded = itemFromNode(node, direction === "callers" ? callerSource : readSource(nodePath), detail);

    // M55.T2: the call sites are the invocations found in the caller's source —
    // every occurrence, exactly positioned. A caller whose invocation cannot be
    // found falls back to its NAME token and is counted as approximate.
    let fromRanges: LspRange[];
    if (invocations.length > 0) {
      fromRanges = invocations.map((i) => i.range);
      // §13.4: count what is RENDERED. One stored row with two invocations renders
      // two ranges, so it counts 2 — and §13.2's multiplicity is declared by the
      // per-entry counter beside it, not collapsed away.
      callSitesResolved += invocations.length;
      resolvedEntries++;
    } else {
      fromRanges = [expanded.selectionRange];
      callSitesApproximate += 1;
      approximateEntries++;
    }
    const withPosition = invocations.length === 0
      ? { ...expanded, detail: `${expanded.detail} · position approximate` }
      : expanded;

    if (direction === "callers") {
      calls.push({ from: withPosition, fromRanges });
    } else {
      calls.push({ to: withPosition, fromRanges });
    }
    if (agreement.agreement !== "agree" && agreement.agreement !== "neither") {
      // §15.1: the difference is DECLARED with both positions and the reason it
      // exists. The population (`direct` vs `hop`) rides along, because a
      // difference on a hop row is a fact about a different relation and a reader
      // must not read it as a contradiction about the symbol they asked for.
      const storeLineText = agreement.address !== null && isExactAddress(agreement.address)
        ? `${agreement.address.file}:${agreement.address.line}`
        : agreement.address === null ? "no address at all" : `address kind "${agreement.address.kind}"`;
      addressDisagreements.push({
        name: node.name,
        symbolId: otherId,
        reason: agreement.agreement === "disagree"
          ? `the store names call site ${storeLineText} while a like-for-like scan of ${agreement.edgeTargetName} in the row's own source resolved ${JSON.stringify(agreement.sourceLines0.map((l) => l + 1))} (1-based) - the two sources of truth contradict each other for this ${agreement.direct ? "direct" : `depth-${agreement.depth} hop`} row, and this surface renders the source-resolved position`
          : agreement.agreement === "store-only"
            ? `the store names call site ${storeLineText} and a like-for-like scan of ${agreement.edgeTargetName} in the row's own source resolves nothing - the invocation is not in the text this surface reads (a macro, a template or a dynamic dispatch), on a ${agreement.direct ? "direct" : `depth-${agreement.depth} hop`} row`
            : `a like-for-like scan resolved ${JSON.stringify(agreement.sourceLines0.map((l) => l + 1))} (1-based) while the store's address is ${storeLineText} - the store names no call site for this row`,
        agreement: { ...agreement, renderedLine0: fromRanges[0]?.start.line ?? null },
      });
    }
  }

  return {
    calls,
    truncated: result.truncated,
    truncationReason: result.truncationReason,
    maxDepthReached: result.maxDepthReached,
    evidenceTier: "indexed",
    callSitesResolved,
    callSitesApproximate,
    callSiteEntries: { resolved: resolvedEntries, approximate: approximateEntries },
    droppedEdges,
    absence: calls.length === 0
      ? absenceWith(
          "symbol_not_at_position",
          // §11.7 + §15.1: the absence names the filter, because an answer
          // emptied BY the filter is a different claim from an answer emptied
          // because the STORE holds no row.
          //
          // TWO BRANCHES, and MEASUREMENT decided which sentence goes where. The
          // engine still returns the depth-0 `calls` row for a symbol with no
          // genuine caller even under `relationshipTypes: ["calls"]` — the
          // receiver-qualified artifact (measured on the T2 fixture: callers
          // .length 1, not 0) — so an answer that the filter emptied does NOT
          // take a "no rows at all" branch. A reword confined to that branch
          // left the branch actually taken still implying the store holds
          // nothing, which is false there (it holds `contains` and `uses` rows
          // for the same symbol). Both are stated now.
          //
          // WHAT EACH BRANCH MAY CLAIM, kept strictly to what this answer read:
          //   edges.length === 0   no stored row of ANY kind reached this answer.
          //                        "none stored" is a claim about the kind this
          //                        surface read, and that is all it says.
          //   edges.length >  0    this many stored CALL rows were read and this
          //                        many were dropped or declared absent. A
          //                        non-call row the surface DID see is named in
          //                        `droppedEdges` with its kind, so a reader can
          //                        find the rows this answer declined rather than
          //                        being told they do not exist.
          //
          // DELIBERATELY NOT CLAIMED: that the store holds no relationship row of
          // any kind. This surface cannot know that — it asked for one kind.
          edges.length === 0
            ? `the engine returned no stored ${direction === "callers" ? "caller" : "callee"} edge of any kind for this symbol (none stored). This surface reads the ${CALL_HIERARCHY_RELATIONSHIP_TYPES.length} relationship kind(s) ${JSON.stringify(CALL_HIERARCHY_RELATIONSHIP_TYPES)} and declares that filter (§15.1), so "none stored" is a statement about ${JSON.stringify(CALL_HIERARCHY_RELATIONSHIP_TYPES)} only — it is NOT a statement that the store holds no relationship row of any other kind`
            : `no stored ${direction === "callers" ? "caller" : "callee"} CALL row of this symbol is rendered. This surface reads the ${CALL_HIERARCHY_RELATIONSHIP_TYPES.length} relationship kind(s) ${JSON.stringify(CALL_HIERARCHY_RELATIONSHIP_TYPES)} only and declares that filter on every response (§15.1): ${edges.length} stored CALL row(s) were read and ${droppedEdges.length} were dropped or declared absent, each with its reason and kind named — rows of other kinds may be stored for this symbol and are not ${direction === "callers" ? "callers" : "callees"} here, so this answer is "no stored call rendered", not "no stored relationship"`,
          rootRow.filePath,
        )
      : null,
    declaredAbsentNodes,
    staleness: expandStaleness(raw, rootRow.fileId ?? null, rootRow.filePath, edgePaths),
    addressCrossCheck: crossCheck,
    addressDisagreements,
    // §15.1: stated on the NORMAL answer too, not only on the absence paths —
    // a reader of a non-empty caller list needs the same filter declaration as
    // a reader of an empty one.
    relationshipTypes: [...CALL_HIERARCHY_RELATIONSHIP_TYPES],
  };
}

// Re-export for response-layer convenience. Sourced from the launch-set OWNER
// (src/lsp/launch_languages.ts), not from hover's re-export chain.
export { languageForPath };
