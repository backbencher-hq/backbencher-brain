// src/brain/semantic/vector-binary.ts — M50.A2 (#764)
// Binary vector codec + fast legacy-vector scanner for semantic retrieval.
//
// MEASURED PROBLEM (validation/m50/results/A2-ask-phases.json + A2-ask-parse.json,
// real index: 10,535 embeddings x 2048 dims, bb.json -> nvidia/nemotron-3-embed-1b):
//   * reading the vector TEXT    ~0.45s  (260 MB of JSON digits)
//   * JSON.parse + cosine        ~1.75s  (10,535 arrays of 2,048 JS numbers)
//   * provider round-trip        ~1.2s
// The storage format is the cost, not the search: a 2,048-float JSON array is
// ~25 KB of text where float32 is 8 KB, and every read re-parses it.
//
// This module gives the same vectors a binary form:
//   * encodeVectorBlob    — number[] -> little-endian float32 (8 KB per 2,048-dim)
//   * decodeVectorBlob    — Buffer -> Float32Array, dimension-checked; returns
//                           null (never garbage) when the blob is absent/short
//   * scanJsonVectorInto  — fast fallback parser for LEGACY rows, measured 1.74x
//                           faster than JSON.parse and bit-faithful to float32
//                           (max abs delta 2.9e-8, cosine sums identical to 6dp)
//   * cosineFloat32       — cosine over Float32Array, no per-row JS arrays
//
// HONESTY RULES
//  - `brain_semantic_embedding.embedding_vector` (JSON) stays the source of
//    truth. The blob column is an accelerator; its absence is a supported state
//    (legacy rows, other writers, gates that INSERT explicit column lists), and
//    every read path falls back to JSON in that case.
//  - Only DENSE numeric vectors get blobs. Sparse token lists (`tfidf-v1`) stay
//    JSON-only by design — a blob would misrepresent them as dense vectors.
//  - Encoding is explicitly little-endian, so a DB moved between machines (M23
//    portability) decodes identically. Big-endian hosts decode via DataView.

/** True on every mainstream host; explicit protocol means it does not matter. */
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/** Byte length of one vector blob for a given dimension. */
export function vectorBlobBytes(dimension: number): number {
  return dimension * 4
}

/**
 * Encode a dense numeric vector as little-endian float32 bytes.
 * Non-finite values are rejected by the caller's density check, never here:
 * this function encodes exactly the numbers it is given (float32 rounding is
 * the only loss, and it is the precision the model itself reports).
 */
export function encodeVectorBlob(vector: ArrayLike<number>): Buffer {
  const n = vector.length
  const bytes = Buffer.allocUnsafe(n * 4)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < n; i++) view.setFloat32(i * 4, vector[i], true)
  return bytes
}

/**
 * Decode a stored blob into a Float32Array of exactly `dimension` values.
 * Returns null when the value is not a usable vector (absent, wrong byte
 * length) — the caller must then use the JSON column. Never returns a
 * partially-filled or fabricated vector.
 */
export function decodeVectorBlob(value: unknown, dimension: number): Float32Array | null {
  if (!value || dimension <= 0) return null
  let bytes: Uint8Array
  if (value instanceof Uint8Array) bytes = value
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
  else return null
  const need = vectorBlobBytes(dimension)
  if (bytes.byteLength !== need) return null
  if (HOST_LITTLE_ENDIAN && bytes.byteOffset % 4 === 0) {
    // Zero-copy view: the whole point of the binary path.
    return new Float32Array(bytes.buffer, bytes.byteOffset, dimension)
  }
  // Big-endian host (or an unaligned view): explicit little-endian decode.
  const out = new Float32Array(dimension)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < dimension; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

/**
 * Parse a legacy JSON numeric array into `out` without allocating a JS array
 * per row. Returns the number of values written; the caller must treat any
 * value != out.length as "not a usable dense vector".
 *
 * Accepts the exact JSON shape this project writes (JSON.stringify(number[])):
 * `[`, comma-separated finite numbers (optional exponent), `]`. Anything else
 * (nested arrays, strings, trailing junk) yields a short count, which callers
 * treat as a fallback trigger — never as a valid vector.
 */
export function scanJsonVectorInto(text: string, out: Float32Array): number {
  const len = text.length
  let n = 0
  let i = 1 // skip '['
  let sign = 1
  let value = 0
  let fracDiv = 1
  let inFrac = false
  let seenDigit = false
  const cap = out.length
  while (i < len) {
    const c = text.charCodeAt(i)
    if (c === 45 /* - */) {
      sign = -1
      i++
      continue
    }
    if (c === 43 /* + */) {
      i++
      continue
    }
    if (c >= 48 && c <= 57) {
      const d = c - 48
      if (inFrac) {
        fracDiv *= 10
        value += d / fracDiv
      } else {
        value = value * 10 + d
      }
      seenDigit = true
      i++
      continue
    }
    if (c === 46 /* . */) {
      inFrac = true
      i++
      continue
    }
    if (c === 101 || c === 69 /* e / E */) {
      let j = i + 1
      let esign = 1
      if (text.charCodeAt(j) === 45) {
        esign = -1
        j++
      } else if (text.charCodeAt(j) === 43) {
        j++
      }
      let ev = 0
      let anyDigit = false
      while (j < len) {
        const d = text.charCodeAt(j)
        if (d < 48 || d > 57) break
        ev = ev * 10 + (d - 48)
        anyDigit = true
        j++
      }
      if (!anyDigit) return 0 // malformed exponent: unusable
      value *= Math.pow(10, esign * ev)
      i = j
      continue
    }
    if (c === 44 /* , */ || c === 93 /* ] */) {
      if (!seenDigit) return 0 // empty slot / leading comma: not a dense array
      if (n >= cap) return 0 // longer than the declared dimension: unusable
      out[n++] = sign * value
      sign = 1
      value = 0
      inFrac = false
      fracDiv = 1
      seenDigit = false
      if (c === 93) {
        // Anything after ']' must be whitespace for the text to be a vector.
        for (let k = i + 1; k < len; k++) {
          const w = text.charCodeAt(k)
          if (w !== 32 && w !== 9 && w !== 10 && w !== 13) return 0
        }
        return n
      }
      i++
      continue
    }
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 91 /* [ */) {
      i++
      continue
    }
    // Any other character makes the text not a numeric vector.
    return 0
  }
  return 0 // no closing ']'
}

/** Cosine similarity over two Float32Arrays of the same dimension. */
export function cosineFloat32(a: Float32Array, b: Float32Array, dimension: number): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < dimension; i++) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Precomputed L2 norm of a Float32Array (the query side only). */
export function l2Norm(a: Float32Array, dimension: number): number {
  let n = 0
  for (let i = 0; i < dimension; i++) n += a[i] * a[i]
  return Math.sqrt(n)
}

/**
 * One row's vector as a Float32Array, or null when the row carries no usable
 * dense vector. Prefers the binary blob; falls back to scanning the JSON text.
 * `scratch` is reused across rows so the fallback path allocates nothing.
 */
export function readRowVector(
  blob: unknown,
  jsonText: unknown,
  dimension: number,
  scratch: Float32Array,
): Float32Array | null {
  const fromBlob = decodeVectorBlob(blob, dimension)
  if (fromBlob) return fromBlob
  if (typeof jsonText !== "string" || jsonText.length === 0) return null
  const n = scanJsonVectorInto(jsonText, scratch)
  return n === dimension ? scratch : null
}
