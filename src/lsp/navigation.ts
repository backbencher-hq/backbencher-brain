// src/lsp/navigation.ts — M24.L3.
//
// textDocument/definition and textDocument/references over the persisted
// brain.db index (IDE Honesty Contract §2 claim levels: every response
// declares where its truth comes from).
//
// Declared guarantees (gated by script/m24/verify-navigation.ts):
//   definition:   symbol at position -> its indexed location; unresolved
//                 positions return an empty result honestly (never a guess)
//   references:   reverse edges (incoming source_symbol_id for a target, and
//                 outgoing target_symbol_id when include_decl is set) -> one
//                 location per edge, deduplicated by file+line
//   truncation:   result sets are bounded by MAX_LOCATIONS; when the cut
//                 triggers, `truncated: true` and `totalCount` report the
//                 full size — the client always knows what it did not get
//   honesty:      symbols outside the index produce empty results, never
//                 fabricated locations
//
// Position handling is delegated exclusively to the P1 component
// (src/lsp/positions.ts). All coordinates in the index are 1-based lines
// and 1-based byte columns; conversion to LSP (0-based, UTF-16) happens at
// the response boundary via indexRangeToLsp.

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import { createPositionMapper, resolveRowByteColumns, PositionError } from "./positions";
// M55.T3: the ONE relation vocabulary — a declaration row is never a usage,
// and neither is a row that references the symbol from itself.
import { isUsageSiteRow } from "./relations";
import { languageForPath } from "./hover";

/** Hard cap on locations per response (contract §3 bounded result sets). */
export const MAX_LOCATIONS = 200;

export interface NavigationLocation {
  /** file path as stored in brain_file */
  path: string;
  /** 0-based LSP line */
  line: number;
  /** 0-based LSP UTF-16 character */
  character: number;
  /** 0-based LSP end line */
  endLine: number;
  /** 0-based LSP end character (UTF-16) */
  endCharacter: number;
}

export interface DefinitionRequest {
  /** absolute file path */
  filePath: string;
  /** 0-based LSP line */
  line: number;
  /** 0-based LSP UTF-16 character */
  character: number;
}

export interface DefinitionResult {
  found: boolean;
  /** The definition's own location (null when not found). */
  location: NavigationLocation | null;
  /** Symbol metadata for the response payload. */
  symbol: {
    id: string;
    name: string;
    qualifiedName: string | null;
    symbolType: string;
  } | null;
  /** Declared data provenance (contract §2). */
  evidenceTier: "indexed" | "not_indexed";
}

export interface ReferencesRequest extends DefinitionRequest {
  /** Include the declaration itself among the references. */
  includeDeclaration: boolean;
  /** Optional cap override (must be <= MAX_LOCATIONS). */
  limit?: number;
}

export interface ReferencesResult {
  locations: NavigationLocation[];
  /** True when locations.length < totalCount (the cap cut results). */
  truncated: boolean;
  /** Total matching locations before truncation. */
  totalCount: number;
  /** The effective cap applied. */
  limit: number;
  /** Declared data provenance. */
  evidenceTier: "indexed" | "not_indexed";
}

interface SymbolRow {
  id: string;
  name: string;
  qualified_name: string | null;
  symbol_type: string;
  file_id: string;
  byte_start: number | null;
  byte_end: number | null;
  line_start: number | null;
  line_end: number | null;
  path: string;
  language: string | null;
}

interface EdgeRow {
  id: string;
  source_symbol_id: string | null;
  target_symbol_id: string | null;
  confidence: number;
  relationship_type: string;
  source_path: string | null;
  source_byte_start: number | null;
  source_byte_end: number | null;
  source_line_start: number | null;
  source_line_end: number | null;
  target_path: string | null;
  target_byte_start: number | null;
  target_byte_end: number | null;
  target_line_start: number | null;
  target_line_end: number | null;
}

/** Find the indexed symbol containing the given LSP position. */
export function findIndexedSymbol(
  raw: CoreDatabase,
  filePath: string,
  line: number,
  character: number,
): SymbolRow | null {
  // Convert the LSP position to index 1-based line; byte-column resolution
  // needs the file text (P1 component owns that conversion).
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const mapper = createPositionMapper(sourceText);
  // M44.U5: an out-of-range editor position (past EOF, e.g. the derived
  // miss probes the honesty suite uses) is DECLARED ABSENCE — no indexed
  // symbol at that position — not a wire error. Before this guard the
  // PositionError propagated as -32603 on definition/references/call-hierarchy
  // while hover returned honest null at the identical position: the
  // declared-absence rule (contract §1) must hold on every surface.
  let indexPos;
  try {
    indexPos = mapper.lspToIndex({ line: line, character: character });
  } catch (err) {
    if (err instanceof PositionError) return null;
    throw err;
  }
  const rows = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.file_id,
              s.byte_start, s.byte_end, s.line_start, s.line_end,
              f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.line_start IS NOT NULL AND s.line_end IS NOT NULL
         AND s.line_start <= ? AND s.line_end >= ?`,
    )
    .all(filePath, indexPos.line, indexPos.line) as SymbolRow[];
  // Among candidates on the line, pick the one whose byte range contains the
  // position; fall back to the narrowest line span when byte data is absent
  // (inner symbol over outer class). Column containment only applies on the
  // symbol's start line — byte columns are per-line.
  let best: SymbolRow | null = null;
  let bestSpan = Number.MAX_SAFE_INTEGER;
  for (const row of rows) {
    if (
      row.byte_start !== null &&
      row.byte_end !== null &&
      row.line_start === indexPos.line &&
      indexPos.column >= row.byte_start &&
      indexPos.column < row.byte_end
    ) {
      return row;
    }
    const span = (row.line_end ?? 0) - (row.line_start ?? 0);
    if (best === null || span < bestSpan) {
      best = row;
      bestSpan = span;
    }
  }
  return best;
}

/** M53: the identifier under the cursor resolves to the indexed symbol it
 *  NAMES — reference-first resolution, the same truth hover uses. This is
 *  the call-site fix (found live during M53.R2): at a call site (`g.greet(`)
 *  the symbol containing the position is the ENCLOSING function, so the old
 *  containment-only model navigated to the wrong place (definition on
 *  `greet` landed on `main`). Resolution order, declared:
 *    1. exact-name symbol in the SAME FILE (owner of the identifier — this
 *       includes the identifier's own declaration position),
 *    2. else exact-name symbol UNIQUE in the workspace (cross-file use of a
 *       uniquely-named symbol),
 *    3. else null — declared absence. Ambiguity is NEVER guessed: a
 *       workspace-ambiguous name falls back to containment (the enclosing
 *       symbol is still a truthful answer), and callers keep their contract.
 *  Returns null when the position holds no identifier or the file cannot be
 *  read (containment remains the only model — honest degradation). */
export function findNamedSymbolAtPosition(
  raw: CoreDatabase,
  filePath: string,
  line: number,
  character: number,
): SymbolRow | null {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const mapper = createPositionMapper(sourceText);
  let indexPos;
  try {
    indexPos = mapper.lspToIndex({ line: line, character: character });
  } catch (err) {
    if (err instanceof PositionError) return null;
    throw err;
  }
  // The identifier under the cursor, from the actual file text (per-line
  // 1-based byte columns, the index convention P1 owns).
  const lines = sourceText.split("\n");
  const lineText = lines[indexPos.line - 1] ?? "";
  // Convert the 1-based byte column to a JS string index (UTF-8 bytes → code
  // units via a byte-accurate walk; ASCII fast path first).
  let jsCol = indexPos.column - 1;
  if (Buffer.byteLength(lineText, "utf8") !== lineText.length) {
    let bytes = 0;
    jsCol = 0;
    for (let i = 0; i < lineText.length; i++) {
      const b = Buffer.byteLength(lineText[i], "utf8");
      if (bytes + b > indexPos.column - 1) break;
      bytes += b;
      jsCol = i + 1;
    }
    if (jsCol > 0) jsCol -= 0; // jsCol = first code unit at/after the byte col
  }
  if (jsCol > lineText.length) return null;
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
  if (jsCol < lineText.length && !isWordChar(lineText[jsCol]!)) {
    // Cursor on a non-word char (dot, paren): step left onto the identifier.
    if (jsCol === 0 || !isWordChar(lineText[jsCol - 1]!)) return null;
    jsCol--;
  }
  let start = jsCol;
  let end = jsCol;
  while (start > 0 && isWordChar(lineText[start - 1]!)) start--;
  while (end < lineText.length && isWordChar(lineText[end]!)) end++;
  const identifier = lineText.slice(start, end);
  if (!identifier) return null;
  // 1. same-file exact name — the identifier's owner (declarations included).
  const sameFile = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.file_id,
              s.byte_start, s.byte_end, s.line_start, s.line_end,
              f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.name = ?`,
    )
    .all(filePath, identifier) as SymbolRow[];
  if (sameFile.length === 1) return sameFile[0]!;
  if (sameFile.length > 1) {
    // Several same-file rows share the name (overloads, member + local): the
    // narrowest span containing the column wins (inner symbol over outer).
    const hit = sameFile.find(
      (r) =>
        r.line_start !== null &&
        r.line_end !== null &&
        r.line_start <= indexPos.line &&
        r.line_end >= indexPos.line,
    );
    if (hit) return hit;
  }
  // 2. workspace-unique exact name.
  const rows = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.file_id,
              s.byte_start, s.byte_end, s.line_start, s.line_end,
              f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE s.name = ?`,
    )
    .all(identifier) as SymbolRow[];
  if (rows.length === 1) return rows[0]!;
  return null; // 3. ambiguous or unknown — declared absence (never a guess)
}

/** Resolve textDocument/definition for a position. */
export function resolveDefinition(
  raw: CoreDatabase,
  request: DefinitionRequest,
): DefinitionResult {
  // M53: reference-first — the identifier the cursor is ON wins over the
  // symbol that CONTAINS the cursor. Only when the position names nothing
  // indexed does containment answer (enclosing symbol — the old model).
  const named = findNamedSymbolAtPosition(raw, request.filePath, request.line, request.character);
  const symbol = named ?? findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return {
      found: false,
      location: null,
      symbol: null,
      evidenceTier: "not_indexed",
    };
  }
  const location = symbolLocation(symbol);
  return {
    found: location !== null,
    location,
    symbol: {
      id: symbol.id,
      name: symbol.name,
      qualifiedName: symbol.qualified_name,
      symbolType: symbol.symbol_type,
    },
    evidenceTier: "indexed",
  };
}

/** Build the definition location for a symbol row (LSP coordinates). */
function symbolLocation(symbol: SymbolRow): NavigationLocation | null {
  if (
    symbol.byte_start === null ||
    symbol.byte_end === null ||
    symbol.line_start === null ||
    symbol.line_end === null ||
    symbol.path === null
  ) {
    return null;
  }
  let sourceText: string;
  try {
    sourceText = readFileSync(symbol.path, "utf8");
  } catch {
    return null;
  }
  // Index coordinates: 1-based lines; byte columns normalized through the
  // P1 resolver (the index carries both per-line and file-absolute rows —
  // see positions.ts resolveRowByteColumns). Unconvertible rows return
  // null: declared absence, never a fabricated position.
  const startCol = resolveRowByteColumns(sourceText, symbol.line_start, symbol.byte_start);
  const endCol = resolveRowByteColumns(sourceText, symbol.line_end, symbol.byte_end);
  if (startCol === null || endCol === null) return null;
  const mapper = createPositionMapper(sourceText);
  const range = mapper.indexRangeToLsp({
    start: { line: startCol.line, column: startCol.column },
    end: { line: endCol.line, column: endCol.column },
  });
  return {
    path: symbol.path,
    line: range.start.line,
    character: range.start.character,
    endLine: range.end.line,
    endCharacter: range.end.character,
  };
}

/** Build a location from an edge endpoint symbol join. */
// Exported for M42.H2: the rich hover resolves its usage-link targets through
// this SAME builder, so hover links and the references surface share one
// location owner (a second implementation would be a drift hazard).
export function edgeLocation(
  path: string | null,
  byteStart: number | null,
  byteEnd: number | null,
  lineStart: number | null,
  lineEnd: number | null,
): NavigationLocation | null {
  if (
    path === null || byteStart === null || byteEnd === null ||
    lineStart === null || lineEnd === null
  ) {
    return null;
  }
  let sourceText: string;
  try {
    sourceText = readFileSync(path, "utf8");
  } catch {
    // Fall back to line-only coordinates when the file is unavailable.
    const line = Math.max(0, lineStart - 1);
    return { path, line, character: 0, endLine: line, endCharacter: 0 };
  }
  const startCol = resolveRowByteColumns(sourceText, lineStart, byteStart);
  const endCol = resolveRowByteColumns(sourceText, lineEnd, byteEnd);
  if (startCol === null || endCol === null) return null;
  const mapper = createPositionMapper(sourceText);
  const range = mapper.indexRangeToLsp({
    start: { line: startCol.line, column: startCol.column },
    end: { line: endCol.line, column: endCol.column },
  });
  return {
    path,
    line: range.start.line,
    character: range.start.character,
    endLine: range.end.line,
    endCharacter: range.end.character,
  };
}

/** Resolve textDocument/references for a symbol position. */
export function resolveReferences(
  raw: CoreDatabase,
  request: ReferencesRequest,
): ReferencesResult {
  const limit = Math.max(1, Math.min(request.limit ?? MAX_LOCATIONS, MAX_LOCATIONS));
  const symbol = findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return {
      locations: [],
      truncated: false,
      totalCount: 0,
      limit,
      evidenceTier: "not_indexed",
    };
  }

  // Reverse edges: the stored rows whose TARGET is this symbol — the usage
  // sites, by the one vocabulary in src/lsp/relations.ts (M55.T3, §14 Truth
  // Rule 1). History: this surface answered BOTH directions, so a callee (a
  // symbol the hovered one calls) and the hovered symbol's own owning class
  // (`contains`) were served as "references" — on the demo index greet
  // answered 7 while the graph reported 3 callers and the hover counted 6.
  // Declaration containments (`contains`/`exports`) are filtered by the same
  // predicate the hover list uses, so the two surfaces cannot disagree; the
  // declaration itself is still offered when the client asks for it
  // (includeDeclaration, the LSP context flag).
  const edges = raw
    .prepare(
      // M62.A2 (issue #876): the stored `r.line_number` is deliberately NOT
      // selected here. This surface navigates to the referencing symbol's own
      // indexed location (byte-accurate); presenting the stored call-site line
      // would be a line-only position (character 0) and a SECOND position
      // claim beside the address owner's. Where a real call-site line exists
      // it is served by the hub/graph/MCP address surfaces, which derive it
      // through src/intelligence/graph/line-address.ts. Keeping the raw column
      // out of this query is what the M62 permanence lint asserts for every
      // display-side consumer.
      `SELECT r.id, r.source_symbol_id, r.target_symbol_id,
              r.confidence, r.relationship_type,
              sf.path AS source_path, ss.byte_start AS source_byte_start,
              ss.byte_end AS source_byte_end, ss.line_start AS source_line_start,
              ss.line_end AS source_line_end,
              tf.path AS target_path, ts.byte_start AS target_byte_start,
              ts.byte_end AS target_byte_end, ts.line_start AS target_line_start,
              ts.line_end AS target_line_end
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = ss.file_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       LEFT JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.target_symbol_id = ?
       ORDER BY r.confidence DESC, r.id`,
    )
    .all(symbol.id) as EdgeRow[];

  const locations: NavigationLocation[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    // The ONE vocabulary (src/lsp/relations.ts): a reference is a stored row
    // whose target is this symbol and whose kind is not a declaration
    // containment. The same predicate is applied by the hover's collector and
    // by the SQL count, so the three surfaces cannot drift apart — including
    // on the rows that are easy to forget (a self-loop `calls` row written by
    // an analyzer is neither a declaration nor a reference; the first version
    // of this filter kept it and the T3 gate caught the extra location).
    if (
      !isUsageSiteRow(
        {
          source_symbol_id: edge.source_symbol_id,
          target_symbol_id: edge.target_symbol_id,
          relationship_type: edge.relationship_type,
        },
        symbol.id,
      )
    ) {
      continue;
    }
    // The reference site is the OTHER end — the referencing symbol, whose
    // indexed location is where the reference lives.
    const loc = edgeLocation(
      edge.source_path,
      edge.source_byte_start,
      edge.source_byte_end,
      edge.source_line_start,
      edge.source_line_end,
    );
    if (loc === null) continue;
    const key = `${loc.path}:${loc.line}:${loc.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (locations.length < limit) {
      locations.push(loc);
    }
  }

  if (request.includeDeclaration) {
    const decl = symbolLocation(symbol);
    if (decl !== null) {
      const key = `${decl.path}:${decl.line}:${decl.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (locations.length < limit) {
          locations.push(decl);
        }
      }
    }
  }

  const totalCount = seen.size;
  return {
    locations,
    truncated: totalCount > locations.length,
    totalCount,
    limit,
    evidenceTier: "indexed",
  };
}

// Re-export for response-layer convenience.
export { languageForPath };
