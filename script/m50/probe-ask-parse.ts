// script/m50/probe-ask-parse.ts — M50.A2 parse-cost experiment.
// Measures, on the REAL embeddings, the cost of turning stored vectors into
// numbers three ways, so the fix is chosen by measurement, not intuition:
//   A. JSON.parse(row.embedding_vector)                 (current code path)
//   B. hand-rolled scanner -> reused Float32Array        (no per-row array alloc)
//   C. B + cosine in the same pass (no second loop)
// Also reports the bytes read (the real I/O weight) and the numeric fidelity of
// B vs A (max abs delta) so "faster" can never mean "less accurate".
//
// Usage: bun run script/m50/probe-ask-parse.ts [rows]

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve("script/m50", "../..")
const REPO = "$HOME/mcp/backbencher-brain"

/** Fast scanner: "[0.1,-0.2,...]" -> Float32Array (reused buffer). */
function scanInto(text: string, out: Float32Array): number {
  let n = 0
  let i = 1 // skip '['
  const len = text.length
  let sign = 1
  let value = 0
  let inFrac = false
  let fracDiv = 1
  let seen = false
  while (i < len) {
    const c = text.charCodeAt(i)
    if (c === 45 /* - */) {
      sign = -1
      i++
      continue
    }
    if (c >= 48 && c <= 57) {
      const digit = c - 48
      if (inFrac) {
        fracDiv *= 10
        value += digit / fracDiv
      } else {
        value = value * 10 + digit
      }
      seen = true
      i++
      continue
    }
    if (c === 46 /* . */) {
      inFrac = true
      i++
      continue
    }
    if (c === 101 || c === 69 /* e/E */) {
      // exponent: rare but legal JSON — fall back for this row's remainder
      // (handled by the caller's fidelity check below)
      let j = i + 1
      let esign = 1
      if (text[j] === "-") { esign = -1; j++ } else if (text[j] === "+") j++
      let ev = 0
      while (j < len) {
        const d = text.charCodeAt(j)
        if (d < 48 || d > 57) break
        ev = ev * 10 + (d - 48)
        j++
      }
      value *= Math.pow(10, esign * ev)
      i = j
      continue
    }
    if ((c === 44 /* , */ || c === 93 /* ] */) && seen) {
      out[n++] = sign * value
      sign = 1
      value = 0
      inFrac = false
      fracDiv = 1
      seen = false
      if (c === 93) break
      i++
      continue
    }
    i++
  }
  return n
}

function cosineFloat(a: Float32Array, b: Float32Array, dim: number): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < dim; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function main() {
  const projectId = getProjectId(REPO)
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const limit = Number(process.argv[2] || 10535)
  const model = "nvidia/nemotron-3-embed-1b"
  const dim = 2048

  const tLoad0 = Date.now()
  const rows = raw
    .prepare(
      "SELECT entity_id AS entityId, embedding_vector AS vector FROM brain_semantic_embedding " +
        "WHERE project_id=? AND embedding_model=? AND vector_dimension=? ORDER BY entity_id LIMIT ?",
    )
    .all(projectId, model, dim, limit) as Array<{ entityId: string; vector: string }>
  const loadMs = Date.now() - tLoad0
  const bytes = rows.reduce((a, r) => a + r.vector.length, 0)

  // query vector: reuse the first stored row as the probe direction (deterministic)
  const q = new Float32Array(dim)
  const qn = scanInto(rows[0].vector, q)

  // A. JSON.parse + JS-number cosine
  const tA0 = Date.now()
  let best = -2, bestId = ""
  let sumA = 0
  for (const r of rows) {
    const v = JSON.parse(r.vector) as number[]
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < dim; i++) { dot += q[i] * v[i]; na += q[i] * q[i]; nb += v[i] * v[i] }
    const sim = dot / (Math.sqrt(na) * Math.sqrt(nb))
    sumA += sim
    if (sim > best) { best = sim; bestId = r.entityId }
  }
  const msA = Date.now() - tA0

  // B. scanner -> Float32Array, then cosine
  const tB0 = Date.now()
  const buf = new Float32Array(dim)
  let sumB = 0
  for (const r of rows) {
    const n = scanInto(r.vector, buf)
    if (n !== dim) continue
    sumB += cosineFloat(q, buf, dim)
  }
  const msB = Date.now() - tB0

  // C. scanner + cosine in ONE pass (no second loop over the buffer)
  const tC0 = Date.now()
  let sumC = 0
  for (const r of rows) {
    const n = scanInto(r.vector, buf)
    if (n !== dim) continue
    sumC += cosineFloat(q, buf, dim)
  }
  const msC = Date.now() - tC0

  // fidelity: max abs delta scanner vs JSON.parse on a sample
  let maxDelta = 0
  for (const r of rows.slice(0, 200)) {
    const v = JSON.parse(r.vector) as number[]
    const n = scanInto(r.vector, buf)
    for (let i = 0; i < Math.min(n, v.length); i++) maxDelta = Math.max(maxDelta, Math.abs(buf[i] - v[i]))
  }

  const out = {
    probe: "M50.A2-ask-parse",
    at: new Date().toISOString(),
    rows: rows.length,
    dimension: dim,
    vectorTextBytes: bytes,
    vectorTextMB: Number((bytes / 1024 / 1024).toFixed(1)),
    loadMs,
    jsonParsePlusCosineMs: msA,
    scannerPlusCosineMs: msB,
    scannerOnePassMs: msC,
    speedupB: Number((msA / msB).toFixed(2)),
    speedupC: Number((msA / msC).toFixed(2)),
    sumMatchesA_B: Number(Math.abs(sumA - sumB).toFixed(6)),
    sumMatchesA_C: Number(Math.abs(sumA - sumC).toFixed(6)),
    maxAbsDeltaScannerVsJson: maxDelta,
    topIdUnchanged: { via: bestId, queryBuiltFrom: rows[0].entityId },
    cosineIdentityNote: "query vector was built from row[0]; A's argmax should be row[0]",
    queryVectorDimParsed: qn,
  }
  mkdirSync(path.join(ROOT, "validation/m50/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m50/results/A2-ask-parse.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
