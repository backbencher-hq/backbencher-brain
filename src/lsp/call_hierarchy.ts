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
// Mutation gates (script/m55/verify-call-hierarchy.ts): dropping the call-site
// resolution, re-admitting receiver-qualified self-edges, re-admitting
// transitive hops, returning a body selectionRange, and swallowing an
// unresolvable call site each fail the gate.

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
import { traverseGraph } from "../intelligence/graph/graph-engine";
import type {
  GraphEdge,
  GraphNode,
  GraphTraversalOptions,
} from "../intelligence/contracts";

/** Engine-aligned budget defaults (the engine clamps to its own limits). */
export const CH_MAX_DEPTH = 5;
export const CH_FANOUT_BUDGET = 50;

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

export interface ExpandResult {
  calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall>;
  /** Engine truncation carried verbatim — never swallowed. */
  truncated: boolean;
  truncationReason?: string;
  maxDepthReached: number;
  /** Declared provenance. */
  evidenceTier: "indexed" | "not_indexed";
  /** M55.T2: call sites resolved from source / entries that had to fall back. */
  callSitesResolved: number;
  callSitesApproximate: number;
  /** M55.T2: edges dropped as not-genuine, each with its reason. */
  droppedEdges: DroppedEdge[];
  /** §11.7: why `calls` is empty, as a machine-readable code. */
  absence: DeclaredAbsence | null;
  /** §11.7: edges omitted because their own file is outside the launch set. */
  declaredAbsentNodes: DeclaredAbsentNode[];
  /** §4: machine-readable staleness marker for every file this answer used. */
  staleness: StalenessMarker;
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
): ResolvedInvocation[] {
  if (targetName.length === 0) return [];
  const mapper = createPositionMapper(sourceText);
  const out: ResolvedInvocation[] = [];
  const last = Math.min(callerLines0.end, mapper.lineTexts.length - 1);
  for (let line0 = Math.max(0, callerLines0.start); line0 <= last; line0++) {
    const line = codeBeforeComment(mapper.lineTexts[line0] ?? "");
    let from = 0;
    for (;;) {
      const at = line.indexOf(targetName, from);
      if (at === -1) break;
      from = at + targetName.length;
      if (isWordChar(line[at - 1]) || isWordChar(line[at + targetName.length])) continue;
      if (skip !== undefined && skip.line === line0 && skip.character === at) continue;
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
  });

  const rootSource = readSource(rootRow.filePath);
  const edges = direction === "callers" ? result.callers : result.callees;
  const calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall> = [];
  const seenFrom = new Set<string>();
  const droppedEdges: DroppedEdge[] = [];
  const declaredAbsentNodes: DeclaredAbsentNode[] = [];
  const edgePaths: string[] = [];
  let callSitesResolved = 0;
  let callSitesApproximate = 0;

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
    const invocations = callerSource === null || callerLines0 === null
      ? []
      : resolveInvocations(callerSource, invokedName, callerLines0, callerNamePos, ownNames);

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
    if (
      invocations.length === 0 &&
      callerSource !== null &&
      callerLines0 !== null &&
      !node.isExternal &&
      edge.relationshipType === "calls"
    ) {
      droppedEdges.push({
        name: node.name,
        symbolId: otherId,
        reason: `${node.name} does not invoke ${invokedName} in its own source — a transitive hop (engine depth > 0) or a stale stored row, not a direct ${direction === "callers" ? "caller" : "callee"}`,
      });
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
      callSitesResolved++;
    } else {
      fromRanges = [expanded.selectionRange];
      callSitesApproximate++;
    }
    const withPosition = invocations.length === 0
      ? { ...expanded, detail: `${expanded.detail} · position approximate` }
      : expanded;

    if (direction === "callers") {
      calls.push({ from: withPosition, fromRanges });
    } else {
      calls.push({ to: withPosition, fromRanges });
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
    droppedEdges,
    absence: calls.length === 0
      ? absenceWith(
          "symbol_not_at_position",
          edges.length === 0
            ? `the engine returned no stored ${direction === "callers" ? "caller" : "callee"} edge for ${rootRow.name} (this is an indexed, served symbol: the answer is "none stored", not "unknown")`
            : `every stored ${direction === "callers" ? "caller" : "callee"} edge was dropped or declared absent (${droppedEdges.length} dropped, ${declaredAbsentNodes.length} declared absent) — none is rendered`,
          rootRow.filePath,
        )
      : null,
    declaredAbsentNodes,
    staleness: expandStaleness(raw, rootRow.fileId ?? null, rootRow.filePath, edgePaths),
  };
}

// Re-export for response-layer convenience. Sourced from the launch-set OWNER
// (src/lsp/launch_languages.ts), not from hover's re-export chain.
export { languageForPath };
