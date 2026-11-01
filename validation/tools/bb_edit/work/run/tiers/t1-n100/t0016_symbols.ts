// src/lsp/symbols.ts — M24.L4 (declared-absence + position-ownership wave).
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
//   positions:    every symbol range round-trips through the P1 component; the
//                 LINE dimension is converted by P1 as well (contract §5
//                 Rule 1 — no feature code converts a coordinate inline)
//   absence:      a file outside the launch set, an unreadable file, a file
//                 with no stored rows, and a row whose stored position cannot
//                 be resolved each answer with a MACHINE-READABLE reason
//                 (`absence`), never a bare [] (contract §11.7)
//   honesty:      a symbol the index stores but whose span cannot be converted
//                 is OMITTED and declared in `omitted`, never silently dropped
//                 and never placed at an invented line (contract §15.3)
//   freshness:    every response carries a staleness marker (contract §4); a
//                 stale result without one is a defect of the same severity as
//                 a wrong result
//   selection:    selectionRange is the symbol's IDENTIFIER when the stored
//                 start column provably lands on the symbol's own name in the
//                 source; otherwise it stays the stored span and the entry
//                 declares which basis it used (`selectionRangeBasis`)
//
// Index coordinates (analyzer convention, converted by P1 only): 1-based
// lines, 1-based per-line BYTE columns, end column exclusive.
//
// LAUNCH SET: read from its single owner, src/lsp/launch_languages.ts — never
// through hover's re-export chain. The chain is a drift hazard: a symbol tree
// for a language the server does not serve is declared absence, not an empty
// list, and the file that decides which languages exist must be the file that
// owns them (the M29.R2 lesson, applied here so the two surfaces cannot
// disagree about the set).

import { readFileSync } from "node:fs";
import type { CoreDatabase } from "../brain/database";
import { checkFileFreshness } from "../brain/freshness";
import { createPositionMapper, resolveRowByteColumns } from "./positions";
import {
  LAUNCH_LANGUAGES,
  isLaunchLanguage,
  languageForPath,
} from "./launch_languages";

/** Hard cap on workspace symbol results (contract §3 bounded result sets). */
export const MAX_WORKSPACE_SYMBOLS = 200;

/**
 * The declared-absence vocabulary for this surface, shared with
 * src/lsp/call_hierarchy.ts (which imports it from here — one owner, so the
 * two surfaces cannot drift into naming the same absence differently).
 *
 * A code is the CONTRACT: a client branches on it and renders `message`. An
 * empty array or a bare null with no `absence` beside it is the violation
 * contract §11.7 names ("silent empty results that look like 'no references
 * found'").
 */
export type DeclaredAbsenceCode =
  /** the file's language is known and is NOT in the launch set */
  | "language_outside_launch_set"
  /** the extension maps to no language at all */
  | "file_type_unknown"
  /** the file is served, but the index stores no row for it */
  | "not_in_index"
  /** no indexed symbol covers the requested position */
  | "symbol_not_at_position"
  /** the requested symbol id is not in the index */
  | "symbol_not_in_index"
  /** an external (unresolvable) target has no index identity to expand */
  | "external_target"
  /** the file text could not be read, so no position can be converted */
  | "source_unreadable"
  /** the row stored no usable coordinates */
  | "coordinates_missing";

export interface DeclaredAbsence {
  /** Machine-readable discriminator — branch on this, never on the message. */
  code: DeclaredAbsenceCode;
  /** One human sentence, safe to render verbatim. */
  message: string;
  /** The language the path resolved to (null when the extension is unknown). */
  language: string | null;
  /** The launch set in force, so a client can name the scope without a second call. */
  launchLanguages: readonly string[];
}

/**
 * The declared absence for a path, or null when the path IS served.
 *
 * Routed through src/lsp/launch_languages.ts, the single owner of the set.
 */
export function declaredAbsenceFor(
  filePath: string,
): DeclaredAbsence | null {
  const language = languageForPath(filePath);
  if (language === null) {
    return {
      code: "file_type_unknown",
      message:
        "the file's extension maps to no language in the launch map, so bb declares no symbols for it " +
        `(launch: ${LAUNCH_LANGUAGES.join(", ")})`,
      language: null,
      launchLanguages: LAUNCH_LANGUAGES,
    };
  }
  if (!isLaunchLanguage(language)) {
    return {
      code: "language_outside_launch_set",
      message: `${language} is not a launch language, so bb declares no symbols for it (launch: ${LAUNCH_LANGUAGES.join(", ")})`,
      language,
      launchLanguages: LAUNCH_LANGUAGES,
    };
  }
  return null;
}

/** A declared absence for a reason unrelated to the launch set. */
export function absenceWith(
  code: DeclaredAbsenceCode,
  message: string,
  filePath: string | null = null,
): DeclaredAbsence {
  return {
    code,
    message,
    language: filePath === null ? null : languageForPath(filePath),
    launchLanguages: LAUNCH_LANGUAGES,
  };
}

/**
 * The staleness marker every response on this surface carries (contract §4).
 * `status: "unknown"` is deliberately `stale: true`: we cannot claim freshness
 * for something we could not check, and silence is guilt.
 */
export interface StalenessMarker {
  stale: boolean;
  status: "fresh" | "stale" | "missing" | "unknown";
  /** How many indexed files had their freshness established for this answer. */
  filesChecked: number;
  /** Paths whose freshness could NOT be established — declared, never silent. */
  filesUnverified: string[];
}

/**
 * The staleness marker for the files behind a result (contract §4).
 *
 * `checkFileFreshness` returns null when it cannot establish a status; that is
 * reported as `stale: true, status: "unknown"`, never as fresh — we cannot
 * claim freshness for a file we could not check, and silence is guilt.
 */
function markerFor(
  raw: CoreDatabase,
  rows: Array<{ file_id: string; path: string }>,
): StalenessMarker {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!seen.has(row.file_id)) seen.set(row.file_id, row.path);
  }
  let fresh = 0;
  let stale = 0;
  let missing = 0;
  const filesUnverified: string[] = [];
  for (const [fileId, path] of seen) {
    const status = checkFileFreshness(raw, fileId);
    if (status === null) {
      filesUnverified.push(path);
    } else if (status.status === "fresh") {
      fresh++;
    } else if (status.status === "stale") {
      stale++;
    } else {
      missing++;
    }
  }
  return {
    stale: stale > 0 || missing > 0 || filesUnverified.length > 0,
    status:
      missing > 0
        ? "missing"
        : stale > 0
          ? "stale"
          : filesUnverified.length > 0
            ? "unknown"
            : fresh > 0
              ? "fresh"
              : "unknown",
    filesChecked: seen.size - filesUnverified.length,
    filesUnverified,
  };
}

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

/** Which span backs an entry's selectionRange — declared, never assumed. */
export type SelectionRangeBasis =
  /** the stored start column provably lands on the symbol's own name */
  | "identifier_at_stored_start"
  /** the index stores one span per symbol; the identifier span is not pinned */
  | "declaration_span";

/** A symbol the index stores that this answer does NOT render, with its reason. */
export interface OmittedSymbol {
  id: string;
  name: string;
  reason: string;
}

export interface DocumentSymbolEntry {
  id: string;
  name: string;
  qualifiedName: string | null;
  symbolType: string;
  /** Full stored span of the symbol (may cover the whole declaration). */
  range: SymbolRange;
  /**
   * The symbol's identifier span when it could be PROVEN from the stored
   * coordinates and the source text; otherwise the stored span. `basis` says
   * which, so an editor that highlights the selection range knows whether it
   * is pointing at the name or at the declaration.
   */
  selectionRange: SymbolRange;
  /** Which span backs `selectionRange` (see SelectionRangeBasis). */
  selectionRangeBasis: SelectionRangeBasis;
  /** Present when the analyzer stored containment. */
  children?: DocumentSymbolEntry[];
}

export interface DocumentSymbolsResult {
  symbols: DocumentSymbolEntry[];
  /** Declared provenance. */
  evidenceTier: "indexed" | "not_indexed";
  /** True when the file is not in the index (declared absence). */
  notIndexed: boolean;
  /** The declared absence with its machine-readable code; null when rendered. */
  absence: DeclaredAbsence | null;
  /** Symbols the index stores that this answer omits, each with its reason. */
  omitted: OmittedSymbol[];
  /** Machine-readable staleness marker (contract §4). */
  staleness: StalenessMarker;
  /** How every entry's selectionRange was derived (the honest simplification). */
  selectionRangeBasis: SelectionRangeBasis;
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
    /** First line of the symbol (0-based LSP, converted by the P1 owner). */
    line: number;
  }>;
  truncated: boolean;
  totalCount: number;
  limit: number;
  evidenceTier: "indexed" | "not_indexed";
  /** The declared absence with its machine-readable code; null when rendered. */
  absence: DeclaredAbsence | null;
  /** Matches the index stores whose position could not be resolved. */
  omitted: OmittedSymbol[];
  /** Machine-readable staleness marker (contract §4). */
  staleness: StalenessMarker;
}

interface SymbolRow {
  id: string;
  name: string;
  qualified_name: string | null;
  symbol_type: string;
  owner_symbol_id: string | null;
  file_id: string;
  byte_start: number | null;
  byte_end: number | null;
  line_start: number | null;
  line_end: number | null;
  gravity_score: number | null;
  path: string;
  language: string | null;
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * The identifier span, PROVEN against the source text.
 *
 * The index stores ONE span per symbol (`byte_start`/`byte_end` bound the
 * declaration node). `byte_start` usually lands on the identifier — but not
 * always: an analyzer that stores the `class`/`public` keyword puts it on the
 * declaration's first token. So the span is claimed ONLY when the stored start
 * column, read in the source, is exactly the symbol's own name with
 * non-identifier characters on both sides. Otherwise the identifier span is
 * NOT guessed: the entry keeps the stored span and DECLARES the basis.
 *
 * (What the index would need to remove the fallback: a second stored span per
 * symbol — e.g. `name_line`/`name_byte_start`/`name_byte_end` written by every
 * analyzer. Reported, not silently worked around.)
 */
function identifierSpanAt(
  mapper: ReturnType<typeof createPositionMapper>,
  start: { line: number; character: number },
  name: string,
): SymbolRange | null {
  if (name.length === 0) return null;
  const text = mapper.lineTexts[start.line];
  if (text === undefined) return null;
  const probed = text.slice(start.character, start.character + name.length);
  if (probed !== name) return null;
  if (isWordChar(text[start.character - 1])) return null;
  if (isWordChar(text[start.character + name.length])) return null;
  return {
    line: start.line,
    character: start.character,
    endLine: start.line,
    endCharacter: start.character + name.length,
  };
}

/** Build a P1-converted range from an index symbol row. Returns null when
 *  the row lacks the coordinates needed (never guesses). */
function symbolRanges(
  sourceText: string,
  row: SymbolRow,
): {
  range: SymbolRange;
  selectionRange: SymbolRange;
  selectionRangeBasis: SelectionRangeBasis;
} | null {
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
  const range: SymbolRange = {
    line: selection.start.line,
    character: selection.start.character,
    endLine: selection.end.line,
    endCharacter: selection.end.character,
  };
  // Declared, not assumed: the identifier span is claimed only when the
  // stored start provably lands on the symbol's own name in the source.
  const identifier = identifierSpanAt(mapper, selection.start, row.name);
  return {
    range,
    selectionRange: identifier ?? range,
    selectionRangeBasis:
      identifier === null ? "declaration_span" : "identifier_at_stored_start",
  };
}

/** textDocument/documentSymbol for one file. */
export function documentSymbols(
  raw: CoreDatabase,
  filePath: string,
): DocumentSymbolsResult {
  // §11.7: a file the server does not serve is DECLARED ABSENT, with the
  // reason machine-readable. This runs before the index is touched: answering
  // with the rows of an unserved language is the lie the rule names.
  const scope = declaredAbsenceFor(filePath);
  if (scope !== null) {
    return {
      symbols: [],
      evidenceTier: "not_indexed",
      notIndexed: true,
      absence: scope,
      omitted: [],
      staleness: {
        stale: true,
        status: "unknown",
        filesChecked: 0,
        filesUnverified: [filePath],
      },
      selectionRangeBasis: "declaration_span",
    };
  }

  const rows = raw
    .prepare(
      `SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.owner_symbol_id,
              s.file_id, s.byte_start, s.byte_end, s.line_start, s.line_end,
              s.gravity_score, f.path, f.language
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ?
       ORDER BY s.line_start, s.byte_start, s.id`,
    )
    .all(filePath) as SymbolRow[];

  const staleness = markerFor(raw, rows);

  if (rows.length === 0) {
    return {
      symbols: [],
      evidenceTier: "not_indexed",
      notIndexed: true,
      absence: absenceWith(
        "not_in_index",
        "the index stores no symbol rows for this file (bb has no declaration to show)",
        filePath,
      ),
      omitted: [],
      staleness,
      selectionRangeBasis: "declaration_span",
    };
  }

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
      absence: absenceWith(
        "source_unreadable",
        "the file text could not be read, so no stored span can be converted to an LSP position (no symbol is placed)",
        filePath,
      ),
      omitted: rows.map((row) => ({
        id: row.id,
        name: row.name,
        reason: "source_unreadable",
      })),
      staleness,
      selectionRangeBasis: "declaration_span",
    };
  }

  const byId = new Map<string, DocumentSymbolEntry>();
  const roots: DocumentSymbolEntry[] = [];
  const omitted: OmittedSymbol[] = [];
  let identifierPinned = 0;
  for (const row of rows) {
    const spans = symbolRanges(sourceText, row);
    if (spans === null) {
      // §15.3: an unresolvable relation is OMITTED AND DECLARED — never
      // dropped silently (the pre-wave behaviour), never placed at an
      // invented line.
      omitted.push({
        id: row.id,
        name: row.name,
        reason:
          row.byte_start === null || row.byte_end === null ||
          row.line_start === null || row.line_end === null
            ? "coordinates_missing"
            : "range_unresolvable_from_source",
      });
      continue;
    }
    if (spans.selectionRangeBasis === "identifier_at_stored_start") identifierPinned++;
    const entry: DocumentSymbolEntry = {
      id: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      symbolType: row.symbol_type,
      range: spans.range,
      selectionRange: spans.selectionRange,
      selectionRangeBasis: spans.selectionRangeBasis,
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
    evidenceTier: "indexed",
    notIndexed: false,
    absence: null,
    omitted,
    staleness,
    // The response-level basis is the WEAKEST basis any entry used: a client
    // that renders one declaration for the whole tree must not claim an
    // identifier-precision surface when some entries are declaration spans.
    selectionRangeBasis:
      identifierPinned === rows.length - omitted.length
        ? "identifier_at_stored_start"
        : "declaration_span",
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
  const emptyStaleness: StalenessMarker = {
    stale: true,
    status: "unknown",
    filesChecked: 0,
    filesUnverified: [],
  };
  if (query === "") {
    return {
      symbols: [],
      truncated: false,
      totalCount: 0,
      limit,
      evidenceTier: "indexed",
      absence: absenceWith(
        "not_in_index",
        "the query was empty, so no symbol name was searched for",
      ),
      omitted: [],
      staleness: emptyStaleness,
    };
  }

  const columns =
    "SELECT s.id, s.name, s.qualified_name, s.symbol_type, s.owner_symbol_id, " +
    "s.file_id, s.byte_start, s.byte_end, s.line_start, s.line_end, s.gravity_score, " +
    "f.path, f.language " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id ";
  // Gravity DESC, then name, then id — the same ranking resolveGraphRoot uses,
  // and the ORDER BY text the mutation suite anchors on.
  const order = "ORDER BY s.gravity_score DESC, s.name, s.id LIMIT ?";
  let rows = raw.prepare(columns + "WHERE s.name = ? " + order).all(query, limit) as SymbolRow[];
  if (rows.length === 0) {
    rows = raw.prepare(columns + "WHERE s.name LIKE ? " + order).all(`%${query}%`, limit) as SymbolRow[];
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

  // §5 Rule 1: the LINE dimension is converted by the position owner too. That
  // requires the file text (the owner validates the stored line against the
  // real file), so the text is read once per distinct path. The pre-wave code
  // inlined `(row.line_start ?? 1) - 1`, which INVENTED line 1 for a row that
  // stored no line at all and emitted a position no editor could navigate to.
  const sourceCache = new Map<string, string | null>();
  const readSource = (path: string): string | null => {
    const hit = sourceCache.get(path);
    if (hit !== undefined) return hit;
    let text: string | null = null;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = null;
    }
    sourceCache.set(path, text);
    return text;
  };

  const symbols: WorkspaceSymbolResult["symbols"] = [];
  const omitted: OmittedSymbol[] = [];
  for (const row of rows) {
    if (row.line_start === null) {
      omitted.push({
        id: row.id,
        name: row.name,
        reason: "coordinates_missing",
      });
      continue;
    }
    const text = readSource(row.path);
    if (text === null) {
      omitted.push({ id: row.id, name: row.name, reason: "source_unreadable" });
      continue;
    }
    let lspLine: number;
    try {
      // Column 1 is the line's first byte: this converts the LINE and
      // validates that the stored line exists in the file (a stale row
      // pointing past EOF is declared, not emitted).
      lspLine = createPositionMapper(text).indexToLsp({
        line: row.line_start,
        column: 1,
      }).line;
    } catch {
      omitted.push({
        id: row.id,
        name: row.name,
        reason: "line_outside_file",
      });
      continue;
    }
    symbols.push({
      id: row.id,
      name: row.name,
      qualifiedName: row.qualified_name,
      symbolType: row.symbol_type,
      path: row.path,
      line: lspLine,
    });
  }

  const staleness = markerFor(raw, rows);
  const totalCount = totalRow?.c ?? rows.length;
  return {
    symbols,
    truncated: totalCount > symbols.length,
    totalCount,
    limit,
    evidenceTier: symbols.length > 0 ? "indexed" : "not_indexed",
    absence:
      symbols.length === 0
        ? rows.length === 0
          ? absenceWith(
              "not_in_index",
              `no indexed symbol is named "${query}" (this is an indexed, served language: the answer is "no such symbol", not "no such language")`,
            )
          : absenceWith(
              "coordinates_missing",
              `every match for "${query}" was omitted because its stored position could not be resolved from the file (${omitted.length} omitted) — no symbol is placed at an invented line`,
            )
        : null,
    omitted,
    staleness,
  };
}

// Re-export for response-layer convenience. Sourced from the launch-set OWNER,
// not from hover's re-export chain (see the header note on drift).
export { languageForPath, isLaunchLanguage, LAUNCH_LANGUAGES };