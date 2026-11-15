/**
 * Shared corpus reader for the VB lane's probes.
 *
 * ENCODING IS A REAL VB DEFECT, NOT A MEASUREMENT ARTIFACT. Windows Forms
 * Designer output — a large share of real VB.NET — is written UTF-16 with a BOM,
 * and 40 of P3D's 1880 .vb files are exactly that. A reader that decodes as
 * UTF-8 sees `N.a.m.e.s.p.a.c.e` and every grammar, however good, reports a
 * whole-file error. So the corpus reader here strips the BOM and decodes by it,
 * and the lane records the same requirement against the product's own file
 * reader: `readFileSync(path, "utf8")` is not a correct VB reader.
 *
 * Nothing else is normalised. Line endings, tabs and trailing whitespace are
 * left exactly as written, because the grammar's line-continuation and
 * `_terminator` rules are part of what is under test.
 */
import { readFileSync } from "node:fs"

export type Decoded = { text: string; encoding: "utf8" | "utf16le" | "utf16be"; hadBom: boolean }

/** Decode a .vb file the way a correct VB reader must. */
export function readVbSource(path: string): Decoded {
  const buf = readFileSync(path)
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      return { text: buf.subarray(2).toString("utf16le"), encoding: "utf16le", hadBom: true }
    }
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      // UTF-16BE: swap to LE and decode once, rather than hand-decoding.
      const body = Buffer.from(buf.subarray(2))
      if (body.length % 2 === 1) body = body.subarray(0, body.length - 1)
      for (let i = 0; i + 1 < body.length; i += 2) {
        const t = body[i]; body[i] = body[i + 1]; body[i + 1] = t
      }
      return { text: body.toString("utf16le"), encoding: "utf16be", hadBom: true }
    }
  }
  return { text: buf.toString("utf8"), encoding: "utf8", hadBom: false }
}
