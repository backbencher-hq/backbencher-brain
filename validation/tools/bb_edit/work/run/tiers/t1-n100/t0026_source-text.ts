/**
 * BOM-aware source-text decoding.
 *
 * M60 X12. `pool-worker.ts` read every source file with `readFile(path, "utf-8")`,
 * which is correct for the overwhelming majority of files and silently destroys
 * the rest. The 24 UTF-16 and UTF-32 files in the XML corpus produced **zero
 * symbols** each — among them docx4j's `styles.xml` (34 KB) and `numbering.xml`
 * (14 KB), which are ordinary WordprocessingML documents, real content, simply
 * unindexed. The bytes arrived at the parser NUL-interleaved, the grammar produced
 * an `ERROR` root, and the analyzer correctly published nothing for a tree it
 * could not read.
 *
 * The reason this is worth a shared utility rather than a cast at the call site:
 * the loss is not visible at the read. `readFile` succeeds, returns a string of
 * the right length, and throws nothing. The only symptom is an empty result
 * downstream, which reads as "a file with no declarations" rather than "a file
 * this system cannot decode". That is why it survived a review that measured
 * symbol-free files down to the last one.
 *
 * WHAT IS DETECTED, and why each case is here:
 *
 *   UTF-8 with BOM        EF BB BF           strip the BOM, decode as UTF-8
 *   UTF-16 LE with BOM    FF FE              decode UTF-16LE, strip the BOM
 *   UTF-16 BE with BOM    FE FF              byte-swap, then UTF-16LE
 *   UTF-32 LE with BOM    FF FE 00 00        decode UTF-32LE, strip the BOM
 *   UTF-32 BE with BOM    00 00 FE FF        byte-swap 4-byte groups, then UTF-32LE
 *   no BOM, NUL first     00 xx              sniff: a NUL in every other byte
 *   no BOM, NUL second    xx 00              sniff: a NUL in every other byte
 *   anything else                          UTF-8, unchanged
 *
 * The two no-BOM cases are why this is not only a BOM stripper. libxml2's test
 * corpus contains `utf16lebom.xml` variants and files that carry no BOM at all,
 * and a BOM-only reader would still miss them.
 *
 * WHAT IS NOT ATTEMPTED, deliberately:
 *
 *  - **Heuristic charset detection.** libxml2's corpus also holds EBcdic-encoded
 *    fixtures (`result/ebcdic_566012.xml`). There is no BOM, no NUL pattern, and
 *    nothing in the bytes that distinguishes EBCDIC from binary noise without a
 *    statistical guess. Guessing would be inventing an encoding the file never
 *    declared, and a wrong guess is worse than a refusal: it produces a confident
 *    parse of garbage. Those files stay undecoded and are reported as such.
 *
 *  - **Re-encoding the source on disk.** This changes what is PARSED, never what
 *    is stored. A symbol's `range.startIndex` is a byte offset into the string the
 *    parser was given, so it is consistent with the transcoded text — but it is
 *    not an offset into the file on disk, and for a UTF-16 file it never could
 *    be. Callers that need a disk offset must read the raw bytes; callers that
 *    need to slice source must slice the string this returns. That asymmetry is
 *    inherent to decoding, not introduced here, and it is why this returns the
 *    text plus what it did rather than only the text.
 *
 * Node's Buffer implements `utf8` and `utf16le` but not the big-endian variants,
 * so UTF-16BE and UTF-32BE are decoded by byte-swapping into the little-endian
 * form. That is a whole-buffer pass, which is the same cost the decode itself
 * costs, and it keeps the detection table readable instead of hand-rolling four
 * decoders.
 */

/** What {@link decodeSourceText} did, so callers can record it. */
export interface DecodedText {
  /** The decoded text, with any byte-order mark removed. */
  text: string
  /** The encoding that was applied. `utf8` includes "no BOM found, nothing done". */
  encoding: "utf8" | "utf8-bom" | "utf16le" | "utf16be" | "utf32le" | "utf32be"
  /** True when a byte-order mark was present and stripped. */
  hadBom: boolean
  /**
   * True when the encoding was inferred from a NUL pattern rather than declared
   * by a BOM. Recorded because an inference is weaker evidence than a
   * declaration, and a consumer reporting "this file is UTF-16" should be able to
   * say whether the file said so.
   */
  inferred: boolean
}

/**
 * Byte-order marks, LONGEST FIRST.
 *
 * Order is load-bearing and the reason is a real bug this table had: `FF FE` is
 * the first two bytes of BOTH `FF FE 00 00` (UTF-32LE) and `FF FE` (UTF-16LE). Test
 * the two-byte mark first and every UTF-32LE file is decoded as UTF-16LE, which
 * produces a string of CJK-looking characters rather than an error — the worst
 * failure mode available, because it is not obviously wrong to a reader.
 *
 * `bomLength` is the length of the MARK in bytes, which is what has to be skipped
 * to reach the body. It is not the code-unit width of the encoding: a UTF-8 BOM is
 * three bytes and UTF-8 is a one-byte code unit, and conflating the two left the
 * BOM in the decoded text, where it became part of the first tag name.
 */
const BOMS: ReadonlyArray<{ bytes: readonly number[]; encoding: DecodedText["encoding"]; bomLength: number }> = [
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: "utf32be", bomLength: 4 },
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: "utf32le", bomLength: 4 },
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf8-bom", bomLength: 3 },
  { bytes: [0xfe, 0xff], encoding: "utf16be", bomLength: 2 },
  { bytes: [0xff, 0xfe], encoding: "utf16le", bomLength: 2 },
]

/**
 * UTF-32LE, decoded by hand.
 *
 * Node's Buffer implements `utf8`, `utf16le` and `latin1` and nothing else —
 * there is no `utf32le` — so `buf.toString("utf32le")` throws
 * `ERR_UNKNOWN_ENCODING` rather than decoding. That is worth stating because the
 * obvious implementation of this file is four calls to `toString`, and one of
 * them is a runtime error on a real file rather than a compile error.
 *
 * Four bytes per code point, little-endian, with surrogate pairs recombined. A
 * truncated trailing group is dropped rather than padded: a file cut mid-code-point
 * is malformed, and inventing the missing bytes would put a character in the
 * source that the file does not contain.
 */
function decodeUtf32le(buf: Buffer): string {
  const groups = Math.floor(buf.length / 4)
  if (groups === 0) return ""
  // Built as an array of code units rather than appended to a string: a 4 MB
  // UTF-32 file is a million concatenations otherwise, and V8's rope
  // representation makes that quadratic in practice.
  const units: number[] = new Array(groups * 2)
  let n = 0
  for (let i = 0; i < groups; i++) {
    const o = i * 4
    const cp = (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
    // Outside the Basic Multilingual Plane a code point is a surrogate PAIR, and
    // a lone surrogate is not a character. Both are passed through as-is rather
    // than replaced, because a decoder that silently substitutes characters is a
    // decoder whose output cannot be compared against the file.
    if (cp > 0xffff) {
      const v = cp - 0x10000
      units[n++] = 0xd800 + (v >> 10)
      units[n++] = 0xdc00 + (v & 0x3ff)
    } else {
      units[n++] = cp
    }
  }
  let out = ""
  const CHUNK = 4096
  for (let i = 0; i < n; i += CHUNK) {
    out += String.fromCharCode(...units.slice(i, Math.min(i + CHUNK, n)))
  }
  return out
}

/** Reverses each group of `width` bytes, in place on a copy. */
function swapGroups(buf: Buffer, width: 2 | 4): Buffer {
  const out = Buffer.from(buf)
  for (let i = 0; i + width <= out.length; i += width) {
    for (let a = 0, b = width - 1; a < b; a++, b--) {
      const t = out[i + a]
      out[i + a] = out[i + b]
      out[i + b] = t
    }
  }
  return out
}

function startsWith(buf: Buffer, bytes: readonly number[]): boolean {
  if (buf.length < bytes.length) return false
  for (let i = 0; i < bytes.length; i++) if (buf[i] !== bytes[i]) return false
  return true
}

/**
 * Is this buffer UTF-16 with no byte-order mark?
 *
 * Decided by the NUL pattern only, and only over a prefix, because a document
 * that is mostly ASCII-with-NUL is UTF-16 and a document that merely contains a
 * NUL is not. UTF-16 ASCII text has a NUL in every OTHER byte; UTF-16 text
 * containing non-ASCII has none, which is a real limitation and is why the
 * sniffing is reported as `inferred` rather than presented as detection.
 */
function sniffUtf16(buf: Buffer): "utf16le" | "utf16be" | null {
  const limit = Math.min(buf.length, 512)
  if (limit < 4) return null
  let evenNuls = 0
  let oddNuls = 0
  let pairs = 0
  for (let i = 0; i + 1 < limit; i += 2) {
    pairs++
    if (buf[i] === 0) evenNuls++
    if (buf[i + 1] === 0) oddNuls++
  }
  if (pairs === 0) return null
  // A UTF-16 document written in ASCII has a NUL in one half of nearly every
  // pair. A threshold rather than "any" so a binary blob that happens to start
  // with a NUL is not read as text.
  if (oddNuls / pairs > 0.7 && evenNuls / pairs < 0.1) return "utf16le"
  if (evenNuls / pairs > 0.7 && oddNuls / pairs < 0.1) return "utf16be"
  return null
}

/**
 * Decode source bytes to text, honouring a byte-order mark and — where there is
 * none — a UTF-16 NUL pattern.
 *
 * Returns UTF-8 unchanged for anything it does not recognise, so this is safe to
 * call on every file: a file with no BOM and no UTF-16 shape comes back as the
 * same bytes decoded as UTF-8, which is what the reader was doing before.
 */
export function decodeSourceText(buf: Buffer): DecodedText {
  for (const bom of BOMS) {
    if (!startsWith(buf, bom.bytes)) continue
    const body = buf.subarray(bom.bomLength)
    switch (bom.encoding) {
      case "utf8-bom":
        return { text: body.toString("utf8"), encoding: "utf8-bom", hadBom: true, inferred: false }
      case "utf16be":
        return { text: swapGroups(body, 2).toString("utf16le"), encoding: "utf16be", hadBom: true, inferred: false }
      case "utf32be":
        return { text: decodeUtf32le(swapGroups(body, 4)), encoding: "utf32be", hadBom: true, inferred: false }
      case "utf32le":
        return { text: decodeUtf32le(body), encoding: "utf32le", hadBom: true, inferred: false }
      default:
        return { text: body.toString("utf16le"), encoding: "utf16le", hadBom: true, inferred: false }
    }
  }
  const sniffed = sniffUtf16(buf)
  if (sniffed) {
    return {
      text: sniffed === "utf16le" ? buf.toString("utf16le") : swapGroups(buf, 2).toString("utf16le"),
      encoding: sniffed,
      hadBom: false,
      inferred: true,
    }
  }
  return { text: buf.toString("utf8"), encoding: "utf8", hadBom: false, inferred: false }
}

/**
 * Read a source file as text, decoding its byte-order mark.
 *
 * The shape every caller wants, and the one place the encoding decision is made.
 * `Buffer` rather than a string encoding argument, because the whole point is that
 * the encoding is not known before the first four bytes are read.
 */
export async function readSourceText(filePath: string): Promise<DecodedText> {
  const fs = await import("node:fs/promises")
  return decodeSourceText(await fs.readFile(filePath))
}
