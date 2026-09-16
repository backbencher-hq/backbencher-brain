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
// Mutation gates (script/m55/verify-call-hierarchy.ts): dropping the call-site
// resolution, re-admitting receiver-qualified self-edges, re-admitting
// transitive hops, returning a body selectionRange, and swallowing an
// unresolvable call site each fail the gate.

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import type { ProjectID } from "../project/schema";
import { createPositionMapper, resolveRowByteColumns } from "./positions";
import { languageForPath } from "./hover";
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
 *  ignored; positions come from the P1 position owner only. */
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
      const startByte = Buffer.byteLength(line.slice(0, at), "utf8") + 1;
      const endByte = Buffer.byteLength(line.slice(0, at + targetName.length), "utf8") + 1;
      out.push({
        range: {
          start: mapper.indexToLsp({ line: line0 + 1, column: startByte }),
          end: mapper.indexToLsp({ line: line0 + 1, column: endByte }),
        },
        kind: classify(receiver, isConstruct, ownNames),
        receiver,
      });
    }
  }
  return out;
}

/** The NAME token's exact range anywhere in a 0-based line range (used for
 *  selectionRange — the editor highlights what this points at). */
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
      const startByte = Buffer.byteLength(line.slice(0, at), "utf8") + 1;
      const endByte = Buffer.byteLength(line.slice(0, at + name.length), "utf8") + 1;
      return {
        start: mapper.indexToLsp({ line: line0 + 1, column: startByte }),
        end: mapper.indexToLsp({ line: line0 + 1, column: endByte }),
      };
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
  const symbol = findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return { item: null, notIndexed: true };
  }
  let sourceText: string;
  try {
    sourceText = readFileSync(symbol.path, "utf8");
  } catch {
    return { item: null, notIndexed: true };
  }
  if (
    symbol.byte_start === null || symbol.byte_end === null ||
    symbol.line_start === null || symbol.line_end === null
  ) {
    return { item: null, notIndexed: true };
  }
  const startCol = resolveRowByteColumns(sourceText, symbol.line_start, symbol.byte_start);
  const endCol = resolveRowByteColumns(sourceText, symbol.line_end, symbol.byte_end);
  if (startCol === null || endCol === null) {
    return { item: null, notIndexed: true };
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
  const nameRange = nameTokenRange(
    sourceText,
    symbol.name,
    { start: (symbol.line_start ?? 1) - 1, end: (symbol.line_end ?? 1) - 1 },
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
      data: { symbolId: symbol.id, isExternal: false },
    },
    notIndexed: false,
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
  const start0 = Math.max(0, node.line - 1);
  const end0 = Math.max(start0, node.lineEnd - 1);
  let range: LspRange = {
    start: { line: start0, character: 0 },
    end: { line: end0, character: 0 },
  };
  let selectionRange: LspRange = range;
  if (source !== null) {
    // Visible declaration span (from the indentation to the end of the last
    // line) + the NAME token for the highlight.
    range = {
      start: { line: start0, character: lineIndent(source, start0) },
      end: { line: end0, character: lineLength(source, end0) },
    };
    selectionRange = nameTokenRange(source, node.name, { start: start0, end: end0 }) ?? range;
  }
  return {
    name: node.name,
    kind: symbolKindFor(node.symbolType),
    uri: filePath !== "" ? `file://${filePath}` : "",
    range,
    selectionRange,
    detail,
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
    // External nodes have no index identity to traverse — declared empty.
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
      callSitesResolved: 0,
      callSitesApproximate: 0,
      droppedEdges: [],
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
        language: string;
        complexity: number;
      }
    | undefined;
  if (rootRow === undefined) {
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
      callSitesResolved: 0,
      callSitesApproximate: 0,
      droppedEdges: [],
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
  let callSitesResolved = 0;
  let callSitesApproximate = 0;

  for (const edge of edges) {
    const otherId = direction === "callers" ? edge.from : edge.to;
    if (seenFrom.has(otherId)) continue;
    const node = result.nodes[otherId];
    if (node === undefined) continue;

    // The caller's own source + declaration range: incoming edges are invoked
    // from the caller's body; outgoing edges are invoked from the ROOT's body.
    const callerSource = direction === "callers"
      ? readSource(node.filePath !== "" ? node.filePath : node.file)
      : rootSource;
    const callerLines0 = direction === "callers"
      ? { start: Math.max(0, node.line - 1), end: Math.max(0, node.lineEnd - 1) }
      : { start: Math.max(0, rootRow.line - 1), end: Math.max(0, rootRow.lineEnd - 1) };
    const invokedName = direction === "callers" ? rootRow.name : node.name;
    // The caller's own declaration name (never an invocation of anything).
    const callerOwnName = direction === "callers" ? node.name : rootRow.name;
    const callerNamePos = callerSource === null
      ? undefined
      : nameTokenRange(callerSource, callerOwnName, callerLines0)?.start;
    const invocations = callerSource === null
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
    const detail = `${node.symbolType} · ${edge.relationshipType} · ${recursiveMarker ? "self" : "1 call site"}${recursiveMarker}`;
    const expanded = itemFromNode(node, direction === "callers" ? callerSource : readSource(node.filePath !== "" ? node.filePath : node.file), detail);

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
  };
}

// Re-export for response-layer convenience.
export { languageForPath };
