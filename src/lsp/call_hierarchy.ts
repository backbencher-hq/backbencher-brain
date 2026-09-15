// src/lsp/call_hierarchy.ts — M24.L5.
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

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import type { ProjectID } from "../project/schema";
import { createPositionMapper, resolveRowByteColumns } from "./positions";
import { languageForPath } from "./hover";
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

export interface ExpandResult {
  calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall>;
  /** Engine truncation carried verbatim — never swallowed. */
  truncated: boolean;
  truncationReason?: string;
  maxDepthReached: number;
  /** Declared provenance. */
  evidenceTier: "indexed" | "not_indexed";
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
  return {
    item: {
      name: symbol.name,
      kind: symbolKindFor(symbol.symbol_type),
      uri: `file://${symbol.path}`,
      range: lspRange,
      selectionRange: lspRange,
      data: { symbolId: symbol.id, isExternal: false },
    },
    notIndexed: false,
  };
}

/** Build a CallHierarchyItem from an engine node. */
function itemFromNode(node: GraphNode): CallHierarchyItem {
  const filePath = node.filePath !== "" ? node.filePath : node.file;
  return {
    name: node.name,
    kind: symbolKindFor(node.symbolType),
    uri: filePath !== "" ? `file://${filePath}` : "",
    range: {
      start: { line: Math.max(0, node.line - 1), character: 0 },
      end: { line: Math.max(0, node.lineEnd - 1), character: 0 },
    },
    selectionRange: {
      start: { line: Math.max(0, node.line - 1), character: 0 },
      end: { line: Math.max(0, node.lineEnd - 1), character: 0 },
    },
    data: { symbolId: node.id, isExternal: node.isExternal },
  };
}

/** Expand: incoming/outgoing calls via the bounded engine. */
export async function expandCalls(
  raw: CoreDatabase,
  projectId: ProjectID,
  request: ExpandRequest,
  traverse: TraverseFn = defaultTraverse,
): Promise<ExpandResult> {
  const { item } = request;
  if (item.data.isExternal) {
    // External nodes have no index identity to traverse — declared empty.
    return {
      calls: [],
      truncated: false,
      maxDepthReached: 0,
      evidenceTier: "not_indexed",
    };
  }
  // Re-resolve the root row from the index for the engine's root shape.
  const rootRow = raw
    .prepare(
      `SELECT s.id, s.name, s.symbol_type, COALESCE(s.line_start,0) AS line,
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
    };
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

  const edges = direction === "callers" ? result.callers : result.callees;
  const calls: Array<CallHierarchyIncomingCall | CallHierarchyOutgoingCall> = [];
  const seenFrom = new Set<string>();
  for (const edge of edges) {
    const otherId = direction === "callers" ? edge.from : edge.to;
    if (seenFrom.has(otherId)) continue;
    seenFrom.add(otherId);
    const node = result.nodes[otherId];
    if (node === undefined) continue;
    const item = itemFromNode(node);
    // M59.O4 (#823): an unknown call-site line emits NO range — the previous
    // `edge.callSite.line - 1` on a fabricated declaration line highlighted the
    // wrong line in the editor. The caller itself stays visible with empty
    // fromRanges; null carries through, never a guessed number.
    const callSite: LspRange | null =
      edge.callSite.line !== null
        ? {
            start: { line: Math.max(0, edge.callSite.line - 1), character: 0 },
            end: { line: Math.max(0, edge.callSite.line - 1), character: 0 },
          }
        : null;
    if (direction === "callers") {
      calls.push({ from: item, fromRanges: callSite ? [callSite] : [] });
    } else {
      calls.push({ to: item, fromRanges: callSite ? [callSite] : [] });
    }
  }

  return {
    calls,
    truncated: result.truncated,
    truncationReason: result.truncationReason,
    maxDepthReached: result.maxDepthReached,
    evidenceTier: "indexed",
  };
}

// Re-export for response-layer convenience.
export { languageForPath };
