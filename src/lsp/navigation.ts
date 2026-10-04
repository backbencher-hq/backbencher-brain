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
//   §11.7:        a file whose language is outside the launch set is DECLARED
//                 ABSENT with a machine-readable reason
//                 (`absence.reason === "language_not_launched"`, and
//                 `searchedIndex: false`). Never a bare `null` (definition) or
//                 a bare `[]` (references), which read as "nothing here".
//   §15.3:        a stored position that cannot be resolved from the source is
//                 OMITTED AND DECLARED (`absence.reason ===
//                 "unresolvable_location"`, and `omittedUnresolvable` counts
//                 the dropped reference rows). Never emitted as a
//                 plausible-looking zero-width range.
//
// Position handling is delegated exclusively to the P1 component
// (src/lsp/positions.ts). All coordinates in the index are 1-based lines
// and 1-based byte columns; conversion to LSP (0-based, UTF-16) happens at
// the response boundary via indexRangeToLsp. §5 rule 1 — no inline conversion
// — is enforced source-level by script/m24/verify-position-arithmetic.ts.

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import { createPositionMapper, resolveRowByteColumns, PositionError } from "./positions";
// M55.T3: the ONE relation vocabulary — a declaration row is never a usage,
// and neither is a row that references the symbol from itself.
import { isUsageSiteRow } from "./relations";
// The launch set from its SINGLE OWNER (src/lsp/launch_languages.ts).
//
// HISTORY (M24 lane 4, found by reading the handler path): this module
// imported `languageForPath` from ./hover and re-exported it at the bottom,
// and never consulted `isLaunchLanguage` at all. Two consequences:
//   1. §11.7 was unenforced here — a file outside the launch set received a
//      bare `null` from the definition handler and a bare `[]` from the
//      references handler, which is precisely the "silent empty result that
//      looks like 'no references found'" the contract calls a violation.
//   2. the launch set reached navigation through hover, one hop too far. The
//      set changes by an owner-approved wave record; a consumer two modules
//      away from the owner is a drift hazard the moment hover's re-export
//      changes shape. The owner is imported directly now; the re-export at the
//      bottom of this file is kept (callers import it from here) but names the
//      owner, not hover.
import { LAUNCH_LANGUAGES, isLaunchLanguage, languageForPath } from "./launch_languages";

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
  /** WHY there is no location, machine-readably (contract §11.7). Null when a
   *  location was returned. Absent-before-this-field meant the client saw a
   *  bare `null` and could not distinguish "not your language" from "nothing
   *  indexed here". */
  absence: NavigationAbsence | null;
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
  /** WHY the list is what it is, machine-readably (contract §11.7). Null when
   *  locations were served. `totalCount: 0` with no absence is the violation
   *  this field exists to end: an empty array that reads as "no references
   *  found" when in fact the file's language was never served. */
  absence: NavigationAbsence | null;
  /** Stored relationship rows that were OMITTED because their position could
   *  not be resolved from the source (contract §15.3: an unresolvable relation
   *  is omitted AND DECLARED). Empty when none were dropped — this is a count
   *  the client can render, not a silent drop. */
  omittedUnresolvable: number;
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

/** Machine-readable reasons a handler can declare an absence (contract §11.7:
 *  "the absence is verifiable by a negative test"; the wire shape is a caller
 *  concern, but the REASON must be produced here or nowhere). */
export type NavigationAbsenceReason =
  /** The file's language is outside the launch set: this server does not serve
   *  it. Nothing was searched. */
  | "language_not_launched"
  /** The language is served and the index WAS searched; no symbol names this
   *  position. A real "not indexed". */
  | "not_indexed"
  /** A stored row exists but its range cannot be converted from the source
   *  text. Omitted, never guessed (contract §15.3). */
  | "unresolvable_location";

export interface NavigationAbsence {
  reason: NavigationAbsenceReason;
  /** The language the file resolved to (null when the extension is unmapped). */
  language: string | null;
  /** Human-readable detail. Never the only carrier of the truth — `reason` is. */
  detail: string;
  /** Whether the index was actually queried. `false` means no answer could
   *  exist, so a count beside it (0) is not a claim about the workspace. */
  searchedIndex: boolean;
  /** Present on references results: the count the client would otherwise read
   *  as "no references found". Meaningless when `searchedIndex` is false. */
  totalCount?: number;
}

/** The §11.7 gate: the reason this file's language is declared absent, or null
 *  when the language is served. Single source of truth — the launch set is
 *  read from its owner, and the detail text names BOTH the language and the
 *  set, so a client (and a human reading the log) never has to guess what
 *  "unsupported" excludes. */
export function languageAbsence(filePath: string): NavigationAbsence | null {
  const language = languageForPath(filePath);
  if (isLaunchLanguage(language)) return null;
  return {
    reason: "language_not_launched",
    language,
    detail:
      language === null
        ? `file type not in the launch language set (launch: ${LAUNCH_LANGUAGES.join(", ")})`
        : `${language} is not a launch language (launch: ${LAUNCH_LANGUAGES.join(", ")})`,
    searchedIndex: false,
  };
}

/** The not-indexed absence — a DIFFERENT reason from language_not_launched, and
 *  it says so with `searchedIndex: true`. A component that answered "absent"
 *  for every case would satisfy the launch gate while lying about the index. */
function notIndexedAbsence(filePath: string): NavigationAbsence {
  return {
    reason: "not_indexed",
    language: languageForPath(filePath),
    detail: "no indexed symbol at this position",
    searchedIndex: true,
  };
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
  // The identifier under the cursor, from the actual file text.
  //
  // The 1-based BYTE column -> 0-based UTF-16 column conversion is the mapper's
  // and only the mapper's (contract §5 rule 1). It used to be hand-rolled here
  // (:228-238 at the time of this edit): an ASCII fast path plus a byte-by-byte
  // accumulation loop that walked each code unit with Buffer.byteLength, and a
  // `jsCol -= 0` no-op that asserted a decrement it never performed. That walk
  // is a §5 rule 1 violation and it is WRONG in a way the ASCII fast path hid:
  // it silently snapped a mid-code-point byte column to the preceding code unit
  // instead of failing, so on a line with multi-byte text the cursor resolved
  // to the identifier one character to the LEFT of the one under it. The
  // mapper owns the conversion and VALIDATES it (PositionError on a
  // mid-codepoint byte offset); this handler turns that error into declared
  // absence, the same way it treats an out-of-range line.
  let jsCol: number;
  try {
    // indexToLsp is the owner performing the SAME conversion the hand-rolled
    // walk performed (1-based byte column -> 0-based UTF-16 column), with the
    // boundary validation the walk lacked.
    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;
  } catch (err) {
    if (err instanceof PositionError) return null;
    throw err;
  }
  // The line text the column indexes is the mapper's OWN line table — the same
  // split its byte lengths were measured over (`\r\n`, `\r` or `\n`), not a
  // second `split("\n")` that disagrees on every CRLF file.
  const lineText = mapper.lineTexts[indexPos.line - 1] ?? "";
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
  const languageGate = languageAbsence(request.filePath);
  if (languageGate !== null) {
    return {
      found: false,
      location: null,
      symbol: null,
      evidenceTier: "not_indexed",
      absence: languageGate,
    };
  }
  const named = findNamedSymbolAtPosition(raw, request.filePath, request.line, request.character);
  const symbol = named ?? findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return {
      found: false,
      location: null,
      symbol: null,
      evidenceTier: "not_indexed",
      absence: notIndexedAbsence(request.filePath),
    };
  }
  const location = symbolLocation(symbol);
  if (location === null) {
    // The symbol IS indexed but its stored range will not convert against the
    // source on disk. §15.3: that is a declared approximation, not a guessed
    // position — found:false with a reason, never a plausible-looking range.
    return {
      found: false,
      location: null,
      symbol: {
        id: symbol.id,
        name: symbol.name,
        qualifiedName: symbol.qualified_name,
        symbolType: symbol.symbol_type,
      },
      evidenceTier: "indexed",
      absence: {
        reason: "unresolvable_location",
        language: symbol.language ?? languageForPath(request.filePath),
        detail: `symbol ${symbol.name} is indexed at lines ${symbol.line_start}..${symbol.line_end} but its stored byte columns do not convert against the source on disk`,
        searchedIndex: true,
      },
    };
  }
  return {
    found: true,
    location,
    symbol: {
      id: symbol.id,
      name: symbol.name,
      qualifiedName: symbol.qualified_name,
      symbolType: symbol.symbol_type,
    },
    evidenceTier: "indexed",
    absence: null,
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
  return edgeLocationDetailed(path, byteStart, byteEnd, lineStart, lineEnd).location;
}

/** The §15.3 law, stated at the only place it can be enforced: "A stored
 *  position that cannot be resolved from the source is a declared approximation,
 *  and an unresolvable relation is omitted and declared — never emitted with a
 *  plausible-looking range." This function previously returned
 *  `{path, line: lineStart - 1, character: 0, endLine: same, endCharacter: 0}`
 *  when the source file could not be read — a fabricated zero-width range at a
 *  line the component could not verify, which the editor would present exactly
 *  like a real navigation target. It now returns a declared absence with a
 *  machine-readable reason.
 *
 *  Split from `edgeLocation` rather than changing its return type: the hover
 *  (src/lsp/rich_hover.ts:235) calls `edgeLocation` and owns its own
 *  declared-absence handling, and that file is another lane's. The wrapper
 *  keeps the old signature honest (null means "no location"), and this
 *  function carries the reason for callers that can report it. */
export interface EdgeLocationResult {
  location: NavigationLocation | null;
  absence: NavigationAbsence | null;
}

export function edgeLocationDetailed(
  path: string | null,
  byteStart: number | null,
  byteEnd: number | null,
  lineStart: number | null,
  lineEnd: number | null,
): EdgeLocationResult {
  if (
    path === null || byteStart === null || byteEnd === null ||
    lineStart === null || lineEnd === null
  ) {
    return {
      location: null,
      absence: {
        reason: "unresolvable_location",
        language: null,
        detail: "stored relationship endpoint carries no complete range (path, line, or byte columns are null)",
        searchedIndex: true,
      },
    };
  }
  let sourceText: string;
  try {
    sourceText = readFileSync(path, "utf8");
  } catch (error) {
    // §15.3: the source text could not be read, so there is no mapper and no
    // honest conversion. A fabricated zero-width range would point the editor
    // at a line the component cannot vouch for — declared absence instead.
    return {
      location: null,
      absence: {
        reason: "unresolvable_location",
        language: languageForPath(path),
        detail: `source file could not be read (${(error as Error).message}); the stored line is omitted rather than emitted unverified`,
        searchedIndex: true,
      },
    };
  }
  const startCol = resolveRowByteColumns(sourceText, lineStart, byteStart);
  const endCol = resolveRowByteColumns(sourceText, lineEnd, byteEnd);
  if (startCol === null || endCol === null) {
    return {
      location: null,
      absence: {
        reason: "unresolvable_location",
        language: languageForPath(path),
        detail: `stored byte columns (${byteStart}..${byteEnd} on lines ${lineStart}..${lineEnd}) do not convert against this source text`,
        searchedIndex: true,
      },
    };
  }
  const mapper = createPositionMapper(sourceText);
  let range;
  try {
    range = mapper.indexRangeToLsp({
      start: { line: startCol.line, column: startCol.column },
      end: { line: endCol.line, column: endCol.column },
    });
  } catch (error) {
    // The mapper refuses an impossible range (a line past EOF, a mid-code-point
    // byte column). Omitted and declared — never snapped.
    return {
      location: null,
      absence: {
        reason: "unresolvable_location",
        language: languageForPath(path),
        detail: `stored range does not convert to an LSP range (${(error as Error).message})`,
        searchedIndex: true,
      },
    };
  }
  return {
    location: {
      path,
      line: range.start.line,
      character: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character,
    },
    absence: null,
  };
}

/** Resolve textDocument/references for a symbol position. */
export function resolveReferences(
  raw: CoreDatabase,
  request: ReferencesRequest,
): ReferencesResult {
  const limit = Math.max(1, Math.min(request.limit ?? MAX_LOCATIONS, MAX_LOCATIONS));
  // §11.7: the launch gate comes FIRST and short-circuits the query. A
  // references result for a language this server does not serve is not an empty
  // list of references — it is a declared absence, and the client must be able
  // to tell the two apart (an empty array is exactly the shape the contract
  // calls a violation).
  const languageGate = languageAbsence(request.filePath);
  if (languageGate !== null) {
    return referencesAbsent(languageGate, limit);
  }
  const symbol = findIndexedSymbol(raw, request.filePath, request.line, request.character);
  if (symbol === null) {
    return referencesAbsent({ ...notIndexedAbsence(request.filePath), totalCount: 0 }, limit);
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
  let omittedUnresolvable = 0;
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
    //
    // `edgeLocationDetailed`, not `edgeLocation`: a location this component
    // cannot resolve from the source is OMITTED AND DECLARED (§15.3). The
    // count of omissions rides the result so the client can say "2 of 3 shown,
    // 1 omitted: the stored position does not resolve against the file on disk"
    // instead of showing a confident, quietly-incomplete list. Before this,
    // `edgeLocation` fabricated a zero-width range at `lineStart - 1` when the
    // file could not be read — a plausible-looking target for a row the
    // component could not verify.
    const resolved = edgeLocationDetailed(
      edge.source_path,
      edge.source_byte_start,
      edge.source_byte_end,
      edge.source_line_start,
      edge.source_line_end,
    );
    const loc = resolved.location;
    if (loc === null) {
      omittedUnresolvable++;
      continue;
    }
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
    // Locations WERE served, so there is no absence — but the omission count is
    // not an absence marker and must not be dropped: a caller showing 3 of 4
    // rows needs to know the fourth was dropped on purpose.
    absence: null,
    omittedUnresolvable,
  };
}

/** The declared-absence shape for references: no locations, and a reason that
 *  says WHY there are none. Centralized so both handlers emit the SAME shape —
 *  a gate on the wire would otherwise see two different emptinesses. */
function referencesAbsent(absence: NavigationAbsence, limit: number): ReferencesResult {
  return {
    locations: [],
    truncated: false,
    totalCount: 0,
    limit,
    evidenceTier: "not_indexed",
    // The count is restated INSIDE the absence, beside `searchedIndex`. A
    // client that reads the absence must be able to see "0 matches, and the
    // index was not searched for this language" as one fact; leaving the count
    // only on the result invites a reader to treat it as a workspace-wide
    // claim about a language this server never served.
    absence: { ...absence, totalCount: 0 },
    omittedUnresolvable: 0,
  };
}

// Re-export for response-layer convenience. The set and the predicate come from
// the single owner (./launch_languages) — before this change they were read
// through hover's re-export, one hop further from the owner than necessary.
export { languageForPath, isLaunchLanguage, LAUNCH_LANGUAGES };
