// src/lsp/document_highlight.ts — M42.H1 (issue #649): semantic in-file
// document highlights.
//
// Contract §12.1 (nothing unclickable / nothing falsely highlighted): the
// highlight set is SEMANTIC, built in two independent layers, each of which
// alone would fail the honesty bar:
//
//   1. AST-identity occurrences (src/ast/safety-primitives.ts): every
//      highlight comes from a real identifier NODE in the syntax tree.
//      Comments and string literals never produce occurrences (masked /
//      non-identifier), so a decoy token inside them can never highlight —
//      there is no lexical text scan anywhere in this file.
//   2. Semantic containment: an occurrence highlights only when its
//      INNERMOST indexed containing symbol has a stored brain_relationship
//      edge to (or is) the symbol under the cursor. A same-named token in
//      an unrelated scope does not highlight even though it is a real
//      identifier node.
//
// Cursor resolution (the H1 law, found live by the fixture): the index
// stores DECLARATIONS only, so a cursor resting on a CALL site resolves to
// the enclosing symbol under declaration-based lookup — the wrong target
// for highlights. This component therefore resolves the queried symbol
// OCCURRENCE-FIRST: the identifier node under the cursor names the target;
// its unique same-file declaration is the queried symbol. Declared
// fallbacks, in order (never a guess, each returns a distinct tier):
//   same-file unique declaration -> queried symbol
//   workspace-unique declaration -> queried symbol (cross-file decl)
//   multiple same-name declarations (overloads) -> tier "ambiguous"
//   no occurrence under cursor / no declaration -> tier "not_indexed"
//   unrouteable language / parse throw -> tier "unsupported_language"
//
// Declared guarantees (gated by script/m42/verify-highlight.ts):
//   semantic:   every highlight is an AST occurrence whose innermost
//               containing symbol is edge-connected to the queried symbol.
//   same-file:  only the requested file is parsed; cross-file usages belong
//               to the references surface.
//   declared:   the response carries the evidence tier and staleness marker
//               so the client can label a stale render (§12.2); an
//               unindexed position returns declared absence.
//   routed-out: a file the language router cannot claim (or one whose parse
//               throws) returns declared absence at tier
//               "unsupported_language" — never a rejection. Gated by the R6
//               legs of script/m42/verify-highlight.ts; the rule "no LSP
//               surface calls parseForSafety unguarded" is gated by that
//               file's R7 source scan, so a third handler cannot re-land
//               this class silently.
//   kind:       occurrence inside the queried symbol's own range → Write
//               kind (3); a connected call/use site → Read kind (2).
//
// Position law: occurrences carry 1-based lines and 1-based per-line BYTE
// columns with an EXCLUSIVE end (tree-sitter convention, identical to the
// index's declared format) — conversion to LSP UTF-16 ranges goes through
// positions.ts (M24.P1), the single owner of position conversion (§5).

import { readFileSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { evidenceTiersFor } from "./hover"
import { checkFileFreshness } from "../brain/freshness"
import { parseForSafety } from "../ast/safety-primitives"
import { PositionMapper, resolveRowByteColumns, PositionError } from "./positions"

export interface HighlightRequest {
  filePath: string
  line: number
  character: number
}

export interface HighlightRange {
  /** LSP 0-based range, UTF-16 code units. */
  start: { line: number; character: number }
  end: { line: number; character: number }
  /** 1 = Text, 2 = Read, 3 = Write. */
  kind: 1 | 2 | 3
}

export interface HighlightResult {
  highlights: HighlightRange[]
  evidenceTier: string
  staleness: { stale: boolean; freshnessStatus: "fresh" | "stale" | "missing" } | null
  /** The index-located symbol the highlights belong to; null = declared absence. */
  symbol: { id: string; name: string } | null
}

interface SymbolRow {
  id: string
  name: string
  line_start: number | null
  line_end: number | null
  byte_start: number | null
  byte_end: number | null
  file_id: string
}

interface EdgeRow {
  source_symbol_id: string
  target_symbol_id: string
}

export async function documentHighlight(
  raw: CoreDatabase,
  request: HighlightRequest,
): Promise<HighlightResult> {
  let content: string
  try {
    content = readFileSync(request.filePath, "utf8")
  } catch {
    // Unreadable file: declared absence, not a crash and not a guess.
    return { highlights: [], evidenceTier: "not_indexed", staleness: null, symbol: null }
  }

  const mapper = new PositionMapper(content)
  const absence = (tier: string): HighlightResult => ({
    highlights: [],
    evidenceTier: tier,
    staleness: null,
    symbol: null,
  })

  // Layer 1: AST-identity occurrences (comments/strings already excluded).
  //
  // A file whose language the router cannot claim makes ASTEngine.parseTree
  // throw `Unsupported file type` (engine.ts:1609-1611, reached through
  // parseForSafety -> safety-primitives.ts:396); a parser timeout or a grammar
  // that fails to load throws too. This surface must NOT reject over any of
  // them: contract §11.7 requires DECLARED ABSENCE for a file outside the
  // launch-language set, and §13.10 names a wire error where the contract
  // requires honest emptiness a defect. At a0ed9eade this call was unguarded
  // and the throw reached server.ts's handler as JSON-RPC -32603 — the sibling
  // hover.ts:245-251 already guards the identical call and this one was missed.
  //
  // The tier says WHICH absence: `unsupported_language` states that no claim
  // was ever made about this file's language, where `not_indexed` would blame
  // the index for a file the router never routed. A surface cannot honestly
  // report "no occurrences here" for a file it could not read at all.
  let safety: Awaited<ReturnType<typeof parseForSafety>>
  try {
    safety = await parseForSafety(request.filePath, content)
  } catch {
    return absence("unsupported_language")
  }

  // --- Occurrence-first cursor resolution (the H1 law) ----------------------
  // An impossible cursor (past EOF, etc.) is declared absence, not an
  // exception: the P1 mapper throws PositionError for out-of-range lines and
  // the H1 contract (declared absence, never an error) governs here.
  let indexPos
  try {
    indexPos = mapper.lspToIndex({ line: request.line, character: request.character })
  } catch (e) {
    if (e instanceof PositionError) return absence("not_indexed")
    throw e
  }
  const cursorOcc = safety.occurrences.find(
    (o) =>
      o.startLine === indexPos.line &&
      o.startColumn <= indexPos.column &&
      indexPos.column < o.endColumn,
  )
  const DECL_COLS = `s.id, s.name, s.line_start, s.line_end, s.byte_start, s.byte_end, s.file_id`
  if (!cursorOcc) return absence("not_indexed")

  // Resolve the queried symbol from the occurrence's name: unique same-file
  // declaration, else workspace-unique declaration, else declared ambiguity.
  const sameFile = raw
    .prepare(
      `SELECT ${DECL_COLS} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
       WHERE f.path = ? AND s.name = ?`,
    )
    .all(request.filePath, cursorOcc.text) as SymbolRow[]
  let symbol: SymbolRow | null = sameFile.length === 1 ? sameFile[0]! : null
  if (symbol === null && sameFile.length === 0) {
    const workspace = raw
      .prepare(
        `SELECT ${DECL_COLS} FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
         WHERE s.name = ?`,
      )
      .all(cursorOcc.text) as SymbolRow[]
    if (workspace.length === 1) symbol = workspace[0]!
  }
  if (symbol === null) {
    // Ambiguous (overloads) or not in the index — declared, never guessed.
    return absence(sameFile.length > 1 ? "ambiguous" : "not_indexed")
  }

  // The semantic neighborhood: every symbol edge-connected to the queried
  // symbol, plus the queried symbol itself.
  const edges = raw
    .prepare(`SELECT source_symbol_id, target_symbol_id FROM brain_relationship
              WHERE target_symbol_id = ? OR source_symbol_id = ?`)
    .all(symbol.id, symbol.id) as EdgeRow[]
  const related = new Set<string>([symbol.id])
  for (const e of edges) {
    if (e.target_symbol_id === symbol.id) related.add(e.source_symbol_id)
    else related.add(e.target_symbol_id)
  }

  // Every indexed symbol of this file, for innermost-containment resolution.
  const fileSymbols = raw
    .prepare(`SELECT ${DECL_COLS}
              FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
              WHERE f.path = ? AND s.line_start IS NOT NULL AND s.line_end IS NOT NULL`)
    .all(request.filePath) as SymbolRow[]

  const highlights: HighlightRange[] = []

  for (const occ of safety.occurrences) {
    if (occ.text !== symbol.name) continue
    const occLine = occ.startLine
    // Innermost indexed symbol containing this occurrence (smallest line
    // span wins; byte spans break ties when both conventions resolve).
    let inner: SymbolRow | null = null
    let innerSpan = Number.MAX_SAFE_INTEGER
    for (const s of fileSymbols) {
      if (s.line_start === null || s.line_end === null) continue
      if (occLine < s.line_start || occLine > s.line_end) continue
      const span = s.line_end - s.line_start
      if (span < innerSpan) {
        inner = s
        innerSpan = span
      }
    }
    if (inner === null || !related.has(inner.id)) continue

    // Layer-1 + layer-2 both hold: convert through the P1 law. Occurrence
    // columns are 1-based per-line bytes, exclusive end — the index format.
    const start = resolveRowByteColumns(content, occ.startLine, occ.startColumn)
    const end = resolveRowByteColumns(content, occ.endLine, occ.endColumn)
    if (start === null || end === null) continue // not convertible: skip, never guess
    const range = mapper.indexRangeToLsp({
      start: { line: start.line, column: start.column },
      end: { line: end.line, column: end.column },
    })
    highlights.push({
      start: range.start,
      end: range.end,
      kind: inner.id === symbol.id ? 3 : 2,
    })
  }

  highlights.sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character)

  const tiers = evidenceTiersFor(raw, symbol.id)
  const freshness = checkFileFreshness(raw, symbol.file_id)
  const freshnessStatus = freshness?.status ?? "missing"
  return {
    highlights,
    evidenceTier: tiers[0] ?? "unknown",
    staleness: { stale: freshnessStatus !== "fresh", freshnessStatus },
    symbol: { id: symbol.id, name: symbol.name },
  }
}
