// src/lsp/positions.ts — M24.P1 (blood-tested foundation #2).
//
// The single owner of all position conversion between the index format and
// the LSP wire format. No other M24 code may convert positions inline
// (IDE Honesty Contract §5).
//
// Index format (what the analyzers actually store — verified against
// ast/real-*-analyzer.ts, e.g. real-swift-analyzer.ts:
//   startLine: node.startPosition.row + 1      startColumn: n.startPosition.column + 1
//   endLine:   node.endPosition.row + 1        endColumn:   n.endPosition.column + 1):
//   1-based lines. 1-based BYTE columns (Tree-sitter startPosition.column
//   counts bytes). The END column is endPosition.column + 1 — i.e. the
//   1-based column ONE PAST the last byte. Tree-sitter endPosition is
//   exclusive, so the stored end is exclusive expressed in 1-based columns.
//   Example: identifier "main" at bytes 8..11 stores start col 9, end col 13.
//
// LSP format (protocol 3.18):
//   0-based lines, 0-based columns in UTF-16 code units. Range end is
//   exclusive.
//
// Because BOTH ends are exclusive (one in 1-based byte columns, one in
// 0-based UTF-16 units), the end conversion is the same operation as the
// start conversion — no advancing, no stepping back. Any such adjustment
// here was a bug; the mutation suite guards against reintroducing one.
//
// Byte-to-UTF-16 conversion requires the actual line text: a byte offset is
// meaningless without the bytes of its line. The component takes the source
// text and never guesses.

export interface IndexPosition {
  /** 1-based line */
  line: number
  /** 1-based BYTE column (Tree-sitter convention) */
  column: number
}

export interface IndexRange {
  start: IndexPosition
  /** end column = 1-based column one past the last byte (exclusive) */
  end: IndexPosition
}

export interface LspPosition {
  /** 0-based line */
  line: number
  /** 0-based UTF-16 code unit offset within the line */
  character: number
}

export interface LspRange {
  start: LspPosition
  /** exclusive */
  end: LspPosition
}

/** Thrown when a position is impossible for the given text. Never guess — fail. */
export class PositionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PositionError"
  }
}

/**
 * Resolve a symbol row's byte columns into the declared per-line convention
 * (1-based byte column within `line`), or null when the row cannot be
 * converted honestly.
 *
 * WHY THIS EXISTS (found live by M25.E6): the index carries rows written by
 * two conventions. The analyzers' declared convention is 1-based byte columns
 * per line; the parallel indexer (storeResults) binds Tree-sitter's
 * file-absolute `startIndex`/`endIndex` directly. A file-absolute offset can
 * exceed a line's byte length (e.g. byte 57 on a 3-byte line), which the
 * strict converter correctly rejects — as a crash that killed fork sessions.
 *
 * Classification (declared, mechanical — never a guess):
 *   fits  (byte <= lineByteLen + 1)  -> already per-line, use as-is
 *   shift (byte in (cumStart, cumEnd]) where the line is the one containing
 *         that absolute byte         -> file-absolute, subtract the line's
 *         cumulative byte start
 *   else                              -> not convertible: return null; callers
 *         must render declared-absence, never invent a position
 *
 * The `fits` case is ambiguous in principle (a per-line column can equal a
 * small absolute offset on line 1); rows on line 1 with byte <= len+1 convert
 * identically under both readings, so `fits` is safe there too.
 *
 * M55.T2 (issue #771) — the byte-0 hole. Per-line columns are 1-based, so a
 * stored 0 can NEVER be a per-line column: it is unambiguously the
 * file-absolute offset 0, the first byte of line 1 (the first declaration of a
 * file, which the parallel indexer stores as byte_start = 0). The pre-M55
 * guard (`byte < 1` -> null) therefore made every such row unconvertible, and
 * `prepareCallHierarchy` returned a declared absence for the first symbol of
 * every file — found live by the M55.T2 gate on a fixture whose symbols start
 * at offset 0. A 0 stored against any OTHER line is a row the indexer never
 * writes; it is inconsistent data and stays declared-unconvertible (null).
 */
export function resolveRowByteColumns(
  sourceText: string,
  line: number,
  byte: number,
): { line: number; column: number } | null {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(byte) || byte < 0) return null
  const lines = sourceText.split("\n")
  if (line > lines.length) return null
  // Byte 0 is unambiguous (see the header): the file's first byte is line 1,
  // column 1. Any other line claiming byte 0 is inconsistent -> declared null.
  if (byte === 0) return line === 1 ? { line: 1, column: 1 } : null
  // byte -> 0-based offset within the line (per-line reading)
  const line0 = line - 1
  const lineByteLen = Buffer.byteLength(lines[line0]!, "utf8")
  if (byte <= lineByteLen + 1) return { line, column: byte }
  // Absolute reading: find the line containing this file-absolute byte.
  // Absolute offsets are 0-based here (Tree-sitter startIndex); a stored value
  // v points into the line whose [cumStart, cumEnd) window contains it.
  let cumStart = 0
  for (let i = 0; i < lines.length; i++) {
    const len = Buffer.byteLength(lines[i]!, "utf8") + 1 // +1 for the newline
    if (byte >= cumStart && byte < cumStart + len) {
      // Per-line column: 1-based byte column within that line.
      const col = byte - cumStart + 1
      if (col <= Buffer.byteLength(lines[i]!, "utf8") + 1) return { line: i + 1, column: col }
      return null
    }
    cumStart += len
  }
  return null
}

export interface PositionConverter {
  /** index (1-based line, 1-based byte col) -> LSP (0-based line, UTF-16 col) */
  indexToLsp(pos: IndexPosition): LspPosition
  /** LSP (0-based line, UTF-16 col) -> index (1-based line, 1-based byte col) */
  lspToIndex(pos: LspPosition): IndexPosition
  /** index range (exclusive 1-based end) -> LSP range (exclusive 0-based end) */
  indexRangeToLsp(range: IndexRange): LspRange
  /** LSP range (exclusive) -> index range (exclusive, 1-based) */
  lspRangeToIndex(range: LspRange): IndexRange
}

export class PositionMapper implements PositionConverter {
  /** 0-based line -> UTF-16 code unit length of that line (excluding terminator) */
  private lineUtf16Lengths: number[]
  /** 0-based line -> byte length of that line (excluding terminator) */
  private lineByteLengths: number[]
  /** 0-based line -> the line's text (excluding terminator) */
  lineTexts: string[]

  constructor(sourceText: string) {
    // Split keeping the content; terminators are \n, \r\n, or \r.
    // A trailing terminator produces a final empty "phantom" line — keep it:
    // both LSP and Tree-sitter allow positions on the line after the last
    // newline (e.g. an EOF node's endPosition).
    this.lineTexts = sourceText.split(/\r\n|\r|\n/)
    this.lineUtf16Lengths = this.lineTexts.map((line) => line.length)
    this.lineByteLengths = this.lineTexts.map((line) => Buffer.byteLength(line, "utf8"))
  }

  private assertLine(line0: number): void {
    if (!Number.isInteger(line0) || line0 < 0 || line0 >= this.lineTexts.length) {
      throw new PositionError(`line ${line0} out of range (0..${this.lineTexts.length - 1})`)
    }
  }

  /**
   * Convert a byte offset within a line to a UTF-16 code unit offset.
   * The byte offset must land on a code point boundary.
   */
  private byteOffsetToUtf16Offset(line0: number, byteOffset: number): number {
    this.assertLine(line0)
    const text = this.lineTexts[line0]
    const byteLen = this.lineByteLengths[line0]
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > byteLen) {
      throw new PositionError(`byte offset ${byteOffset} out of range (0..${byteLen}) on line ${line0 + 1}`)
    }
    if (byteOffset === 0) return 0
    if (byteOffset === byteLen) return text.length
    const buf = Buffer.from(text, "utf8")
    // Must land on a code point boundary; a mid-code-point byte is an invalid
    // position, not something to snap.
    if ((buf[byteOffset]! & 0xc0) === 0x80) {
      throw new PositionError(`byte offset ${byteOffset} on line ${line0 + 1} lands mid-code-point`)
    }
    return buf.subarray(0, byteOffset).toString("utf8").length
  }

  /**
   * Convert a UTF-16 code unit offset within a line to a byte offset.
   * A low-surrogate offset is not a character start — fail rather than guess.
   */
  private utf16OffsetToByteOffset(line0: number, utf16Offset: number): number {
    this.assertLine(line0)
    const text = this.lineTexts[line0]
    const utf16Len = this.lineUtf16Lengths[line0]
    if (!Number.isInteger(utf16Offset) || utf16Offset < 0 || utf16Offset > utf16Len) {
      throw new PositionError(`utf16 offset ${utf16Offset} out of range (0..${utf16Len}) on line ${line0 + 1}`)
    }
    if (utf16Offset === 0) return 0
    if (utf16Offset === utf16Len) return this.lineByteLengths[line0]
    const unit = text.charCodeAt(utf16Offset)
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new PositionError(`utf16 offset ${utf16Offset} on line ${line0 + 1} lands on a surrogate trailing half`)
    }
    return Buffer.byteLength(text.slice(0, utf16Offset), "utf8")
  }

  indexToLsp(pos: IndexPosition): LspPosition {
    if (!Number.isInteger(pos.line) || pos.line < 1) {
      throw new PositionError(`index line must be >= 1, got ${pos.line}`)
    }
    if (!Number.isInteger(pos.column) || pos.column < 1) {
      throw new PositionError(`index column must be >= 1, got ${pos.column}`)
    }
    const line0 = pos.line - 1
    // 1-based byte column -> 0-based byte offset.
    const character = this.byteOffsetToUtf16Offset(line0, pos.column - 1)
    return { line: line0, character }
  }

  lspToIndex(pos: LspPosition): IndexPosition {
    if (!Number.isInteger(pos.line) || pos.line < 0) {
      throw new PositionError(`LSP line must be >= 0, got ${pos.line}`)
    }
    if (!Number.isInteger(pos.character) || pos.character < 0) {
      throw new PositionError(`LSP character must be >= 0, got ${pos.character}`)
    }
    const line0 = pos.line
    const byteOffset = this.utf16OffsetToByteOffset(line0, pos.character)
    return { line: line0 + 1, column: byteOffset + 1 }
  }

  indexRangeToLsp(range: IndexRange): LspRange {
    // Both ends are exclusive (see header), so both convert identically.
    return {
      start: this.indexToLsp(range.start),
      end: this.indexToLsp(range.end),
    }
  }

  lspRangeToIndex(range: LspRange): IndexRange {
    return {
      start: this.lspToIndex(range.start),
      end: this.lspToIndex(range.end),
    }
  }
}

export function createPositionMapper(sourceText: string): PositionMapper & { lineCount: number } {
  const mapper = new PositionMapper(sourceText)
  return Object.assign(mapper, { get lineCount() { return mapper.lineTexts.length } })
}
