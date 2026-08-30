// src/lsp/positions.ts — M24.P1 (blood-tested foundation #2).
//
// The single owner of all position conversion between the index format and
// the LSP wire format. No other M24 code may convert positions inline
// (IDE Honesty Contract §5).
//
// Index format (what analyzers store, see ast/real-*-analyzer.ts):
//   1-based lines, 1-based BYTE columns (Tree-sitter startPosition.column
//   counts bytes). Range end is inclusive of the last character's position.
//
// LSP format (protocol 3.18):
//   0-based lines, 0-based columns in UTF-16 code units. Range end is
//   exclusive.
//
// Conversion therefore requires three simultaneous corrections:
//   line:   -1
//   column: byte offset -> UTF-16 code units, -1
//   range:  end inclusive -> exclusive
//
// Byte-to-UTF-16 conversion requires the actual line text: a byte offset is
// meaningless without the bytes of its line. The component takes the source
// text (or a per-line memo) and never guesses.

export interface IndexPosition {
  /** 1-based line */
  line: number
  /** 1-based BYTE column (Tree-sitter convention) */
  column: number
}

export interface IndexRange {
  start: IndexPosition
  /** inclusive of the last character */
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

export interface PositionConverter {
  /** index (1-based line, 1-based byte col) -> LSP (0-based line, UTF-16 col) */
  indexToLsp(pos: IndexPosition): LspPosition
  /** LSP (0-based line, UTF-16 col) -> index (1-based line, 1-based byte col) */
  lspToIndex(pos: LspPosition): IndexPosition
  /** index range (end inclusive) -> LSP range (end exclusive) */
  indexRangeToLsp(range: IndexRange): LspRange
  /** LSP range (end exclusive) -> index range (end inclusive) */
  lspRangeToIndex(range: LspRange): IndexRange
}

export class PositionMapper implements PositionConverter {
  /** 0-based line -> UTF-16 code unit length of that line (excluding terminator) */
  private lineUtf16Lengths: number[]
  /** 0-based line -> byte length of that line (excluding terminator) */
  private lineByteLengths: number[]
  /** 0-based line -> the line's text (excluding terminator) */
  private lineTexts: string[]

  constructor(sourceText: string) {
    // Split keeping the content; terminators are \n, \r\n, or \r.
    this.lineTexts = sourceText.split(/\r\n|\r|\n/)
    // A trailing terminator produces a final empty line — keep it: LSP
    // allows a position on the phantom line after the last newline.
    this.lineUtf16Lengths = this.lineTexts.map((line) => line.length)
    this.lineByteLengths = this.lineTexts.map((line) => Buffer.byteLength(line, "utf8"))
  }

  private lineText(line0: number): string {
    this.assertLine(line0)
    return this.lineTexts[line0]
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
    const text = this.lineText(line0)
    const byteLen = this.lineByteLengths[line0]
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > byteLen) {
      throw new PositionError(`byte offset ${byteOffset} out of range (0..${byteLen}) on line ${line0 + 1}`)
    }
    if (byteOffset === byteLen) return text.length
    if (byteOffset === 0) return 0
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
   * Surrogate halves are invalid positions (they are not character starts).
   */
  private utf16OffsetToByteOffset(line0: number, utf16Offset: number): number {
    const text = this.lineText(line0)
    const utf16Len = this.lineUtf16Lengths[line0]
    if (!Number.isInteger(utf16Offset) || utf16Offset < 0 || utf16Offset > utf16Len) {
      throw new PositionError(`utf16 offset ${utf16Offset} out of range (0..${utf16Len}) on line ${line0 + 1}`)
    }
    if (utf16Offset === 0) return 0
    if (utf16Offset === utf16Len) return this.lineByteLengths[line0]
    // A position on a low surrogate (second half of a pair) is not a character
    // start — LSP allows it syntactically, but it is not a valid symbol
    // boundary for byte conversion; fail rather than guess.
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
    const line0 = pos.line
    this.assertLine(line0)
    if (!Number.isInteger(pos.character) || pos.character < 0) {
      throw new PositionError(`LSP character must be >= 0, got ${pos.character}`)
    }
    const byteOffset = this.utf16OffsetToByteOffset(line0, pos.character)
    return { line: line0 + 1, column: byteOffset + 1 }
  }

  indexRangeToLsp(range: IndexRange): LspRange {
    const start = this.indexToLsp(range.start)
    // Index end is inclusive of the last character; LSP end is exclusive.
    // Advance the end position by one character (which may roll to the next
    // line when the end column is the last character of its line).
    const endLine0 = range.end.line - 1
    this.assertLine(endLine0)
    const endText = this.lineTexts[endLine0]
    const endByteOffset = range.end.column - 1
    if (endByteOffset === this.lineByteLengths[endLine0]) {
      // End sits past the last character of its line: exclusive end rolls to
      // the start of the next line (or the phantom line after the file).
      return { start, end: { line: endLine0 + 1, character: 0 } }
    }
    const endUtf16 = this.byteOffsetToUtf16Offset(endLine0, endByteOffset)
    // Advance one character — by code point, not code unit.
    const codePoint = endText.codePointAt(endUtf16)
    const advance = codePoint !== undefined && codePoint >= 0x10000 ? 2 : 1
    return { start, end: { line: endLine0, character: endUtf16 + advance } }
  }

  lspRangeToIndex(range: LspRange): IndexRange {
    const start = this.lspToIndex(range.start)
    // LSP end is exclusive; index end is inclusive. Step back one character.
    const endLine0 = range.end.line
    // Exclusive end may sit on the phantom line after the file.
    if (endLine0 === this.lineTexts.length && range.end.character === 0) {
      // End rolled past the last line: index end is the last byte of the
      // previous line.
      const lastLine0 = this.lineTexts.length - 1
      return { start, end: { line: lastLine0 + 1, column: this.lineByteLengths[lastLine0] } }
    }
    this.assertLine(endLine0)
    if (range.end.character === 0) {
      // Exclusive end at column 0 = inclusive end at the last byte of the
      // previous line.
      if (endLine0 === 0) throw new PositionError("empty LSP range cannot map to an index range")
      return { start, end: { line: endLine0, column: this.lineByteLengths[endLine0 - 1] } }
    }
    const byteOffset = this.utf16OffsetToByteOffset(endLine0, range.end.character)
    // Step back one character — by code point, not code unit.
    const text = this.lineTexts[endLine0]
    // Walk back over the code point ending at byteOffset.
    const buf = Buffer.from(text, "utf8")
    let byteBack = byteOffset - 1
    if (byteBack < 0) throw new PositionError("empty LSP range cannot map to an index range")
    while (byteBack > 0 && (buf[byteBack]! & 0xc0) === 0x80) byteBack--
    return { start, end: { line: endLine0 + 1, column: byteBack + 1 } }
  }
}

export function createPositionMapper(sourceText: string): PositionMapper & { lineCount: number } {
  const mapper = new PositionMapper(sourceText)
  return Object.assign(mapper, { lineCount: mapper.lineTexts.length })
}
