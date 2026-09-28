// src/lsp/symbols.ts — M24.L4.
//
// textDocument/documentSymbol and workspace/symbol over the persisted index
// (IDE Honesty Contract §2: every response declares its data provenance).
//
// Declared guarantees (gated by script/m24/verify-symbols.ts):
//   document:     all of a file's symbols from brain_symbol, hierarchical
//                 where the analyzer stores containment (owner_symbol_id),
//                 ordered by line
//   workspace:    query over brain_symbol with the existing ranking/gravity
//                 convention (ORDER BY gravity_score DESC, exact-name before
//                 fuzzy LIKE — same semantics as resolveGraphRoot)
//   positions:    every symbol range round-trips through the P1 component;
//                 a range probe on the file text returns the symbol's own
//                 source text (the honesty check: the range must contain
//                 the symbol's text)
//   honesty:      no results / empty document -> empty result, never invented
//
// Index coordinates (analyzer convention, converted by P1 only): 1-based
// lines, 1-based per-line BYTE columns, end column exclusive.

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import { createPositionMapper, resolveRowByteColumns } from "./positions";
import { languageForPath } from "./hover";

/** Hard cap on workspace symbol results (contract §3 bounded result sets). */
export const MAX_WORKSPACE_SYMBOLS = 200;

export interface SymbolRange {
  /** 0-based LSP line */
  line: number;
  /** 0-based LSP UTF-16 character */
  character: number;
  /** 0-based LSP end line */
  endLine: number;
  /** 0-based LSP end character (UTF-16) */
  endCharacter: number;
}

export interface DocumentSymbolEntry {
  id: string;
  name: string;
  qualifiedName: string | null;
  symbolType: string;
  /** Range of the symbol's identifier (definition span). */
  range: SymbolRange;
  /** Full symbol span (may cover the whole declaration). */
  selectionRange: SymbolRange;
  /** Present when the analyzer stored containment. */
  children?: DocumentSymbolEntry[];
}

export interface DocumentSymbolsResult {
  symbols: DocumentSymbolEntry[];
  /** Declared provenance. */
  evidenceTier: "indexed" | "not_indexed";
  /** True when the file is not in the index (declared absence). */
  notIndexed: boolean;
}

export interface WorkspaceSymbolRequest {
  query: string;
  /** Optional cap override (must be <= MAX_WORKSPACE_SYMBOLS). */
  limit?: number;
}

export interface WorkspaceSymbolResult {
  symbols: Array<{
    id: string;
    name: string;
    qualifiedName: string | null;
    symbolType: string;
    /** File path as stored in brain_file. */
    path: string;
    /** First line of the symbol (0-based LSP). */
    line: number;
  }>;
  truncated: boolean;
  totalCount: number;
  limit: number;
  evidenceTier: "indexed" | "not_indexed";
}

interface SymbolRow {
  id: string;
  name: string;
  qualified_name: string | null;
  symbol_type: string;
  owner_symbol_id: string | null;
  byte_start: number | null;
  byte_end: number | null;
  line_start: number | null;
  line_end: number | null;
  gravity_score: number | null;
  path: string;
  language: string | null;
}

/** Build a P1-converted range from an index symbol row. Returns null when
 *  the row lacks the coordinates needed (never guesses). */
function symbolRanges(
  sourceText: string,
  row: SymbolRow,
): { range: SymbolRange; selectionRange: SymbolRange } | null {
  if (
    row.byte_start === null || row.byte_end === null ||
    row.line_start === null || row.line_end === null
  ) {
    return null;
  }
  // Normalize the index's dual byte conventions (per-line declared vs
  // file-absolute stored by the parallel indexer — see positions.ts).
  const startCol = resolveRowByteColumns(sourceText, row.line_start, row.byte_start);
  const endCol = resolveRowByteColumns(sourceText, row.line_end, row.byte_end);
  if (startCol === null || endCol === null) return null;
  const mapper = createPositionMapper(sourceText);
  const selection = mapper.indexRangeToLsp({
    start: { line: startCol.line, column: startCol.column },
    end: { line: endCol.line, column: endCol.column },
  });
  // The identifier range is the same span as the selection for now — the
  // index stores one span per symbol. Both round-trip through P1.
  return {
    range: {
      line: selection.start.line,
      character: selection.start.character,
      endLine: selection.end.line,
      endCharacter: selection.end.character,
    },
    selectionRange: {
      line: selection.start.line,
      character: selection.start.character,
      endLine: selection.end.line,
      endCharacter: selection.end.character,
    },
  };
}

/** textDocument/documentSymbol for one file. */
export function documentSymbols(
  raw: CoreDatabase,
  filePath: string,
): DocumentSymbolsResult {
  const rows = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.owner_symbol_id,
              s.byte_start, s.byte_end, s.line_start, s.line_end,
              s.gravity_score, f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ?
       ORDER BY s.line_start, s.byte_start, s.id`,
    )
    .all(filePath) as SymbolRow[];

  let sourceText: string | null = null;
  try {
    sourceText = readFileSync(filePath, "utf8");
  } catch {
    // Without the file text, ranges cannot be P1-converted. Return the
    // declared-absence result rather than fabricating coordinates.
    return {
      symbols: [],
      evidenceTier: "not_indexed",
      notIndexed: true,
    };
  }

  const byId = new Map<string, DocumentSymbolEntry>();
  const roots: DocumentSymbolEntry[] = [];
  for (const row of rows) {
    const spans = symbolRanges(sourceText, row);
    if (spans === null) continue;
    const entry: DocumentSymbolEntry = {
      id: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      symbolType: row.symbol_type,
      range: spans.range,
      selectionRange: spans.selectionRange,
      children: [],
    };
    byId.set(row.id, entry);
    const parentId = row.owner_symbol_id;
    const parent = parentId !== null ? byId.get(parentId) : undefined;
    if (parent !== undefined && parent.children !== undefined) {
      parent.children.push(entry);
    } else {
      roots.push(entry);
    }
  }

  return {
    symbols: roots,
    evidenceTier: rows.length > 0 ? "indexed" : "not_indexed",
    notIndexed: rows.length === 0,
  };
}

/** workspace/symbol: query over brain_symbol with existing gravity ranking.
 *  Exact-name match first, then fuzzy LIKE — same semantics as
 *  resolveGraphRoot in the graph engine. */
export function workspaceSymbols(
  raw: CoreDatabase,
  request: WorkspaceSymbolRequest,
): WorkspaceSymbolResult {
  const limit = Math.max(
    1,
    Math.min(request.limit ?? MAX_WORKSPACE_SYMBOLS, MAX_WORKSPACE_SYMBOLS),
  );
  const query = request.query.trim();
  if (query === "") {
    return {
      symbols: [],
      truncated: false,
      totalCount: 0,
      limit,
      evidenceTier: "indexed",
    };
  }

  const base =
    "SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.owner_symbol_id, " +
    "s.byte_start, s.byte_end, s.line_start, s.line_end, s.gravity_score, " +
    "f.path, f.language " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
    "WHERE s.name = ? " +
    "ORDER BY s.gravity_score DESC, s.name, s.id LIMIT ?";
  let rows = raw.prepare(base).all(query, limit) as SymbolRow[];
  if (rows.length === 0) {
    const fuzzy =
      "SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.owner_symbol_id, " +
      "s.byte_start, s.byte_end, s.line_start, s.line_end, s.gravity_score, " +
      "f.path, f.language " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.name LIKE ? " +
      "ORDER BY s.gravity_score DESC, s.name, s.id LIMIT ?";
    rows = raw.prepare(fuzzy).all(`%${query}%`, limit) as SymbolRow[];
  }

  // Total count is the untruncated match size (exact + fuzzy union is
  // approximated by the same query without LIMIT — kept in one pass below).
  const countBase =
    "SELECT COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
    "WHERE s.name = ?";
  let totalRow = raw.prepare(countBase).get(query) as { c: number } | undefined;
  if ((totalRow?.c ?? 0) === 0) {
    const fuzzyCount =
      "SELECT COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.name LIKE ?";
    totalRow = raw.prepare(fuzzyCount).get(`%${query}%`) as { c: number } | undefined;
  }

  const symbols = rows.map((row) => ({
    id: row.id,
    name: row.name,
    qualifiedName: row.qualified_name,
    symbolType: row.symbol_type,
    path: row.path,
    line: Math.max(0, (row.line_start ?? 1) - 1),
  }));
  const totalCount = totalRow?.c ?? symbols.length;
  return {
    symbols,
    truncated: totalCount > symbols.length,
    totalCount,
    limit,
    evidenceTier: symbols.length > 0 ? "indexed" : "not_indexed",
  };
}

// Re-export for response-layer convenience.
export { languageForPath };
