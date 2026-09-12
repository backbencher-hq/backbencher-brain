// script/m50/probe-ask-cache.ts — M50.A2 (#764) honest bb_ask cache evidence.
//
// The A1 harness re-issues the SAME query text 4x per launch, so a warm-up +
// repeated-measure design would report cache hits as if they were the general
// case. That is exactly the kind of quiet dishonesty this milestone exists to
// remove. So this probe measures BOTH worlds separately and reports both:
//
//   (A) distinct queries — 4 different question texts, each asked once. This is
//       what a real agent loop pays: the provider round-trip, unavoidable.
//   (B) repeated query   — 1 text asked 4 times. This is what retries,
//       follow-ups and re-asks cost: the cache hit.
//
// It also proves the two worlds AGREE: the cached vector must be identical to
// the freshly computed one, or the cache is a data bug, not an accelerator.
// Writes validation/m50/results/A2-ask-cache.json.

import { SemanticEngine } from "../../src/brain/semantic/engine"

const REPEAT = "where are foreign keys enforced?"
// Deliberately DISJOINT from REPEAT: the repeated-phase cold call must be a
// genuine first embed, or the probe would report a cache hit as a cold call.
const DISTINCT = [
  "how does the embedding queue drain",
  "what writes the planner statistics",
  "which function indexes a project in parallel",
  "where is the FK heal invoked",
]

async function main() {
  const out: Record<string, unknown> = {
    probe: "M50.A2-ask-cache",
    at: new Date().toISOString(),
    method: "SemanticEngine.embed() directly (the provider round-trip inside bb_ask)",
  }

  // ── (B) repeated query: cold first call, then cache hits ──────────────────
  const repeatVecs: number[][] = []
  const repeatMs: number[] = []
  for (let i = 0; i < 4; i++) {
    const s = Date.now()
    const v = await SemanticEngine.embed(REPEAT)
    repeatMs.push(Date.now() - s)
    repeatVecs.push(v)
  }
  const ref = repeatVecs[0]
  let maxAbsDelta = 0
  let identity = true
  for (const v of repeatVecs.slice(1)) {
    if (v.length !== ref.length) {
      identity = false
      continue
    }
    for (let i = 0; i < v.length; i++) {
      const d = Math.abs(v[i] - ref[i])
      if (d > maxAbsDelta) maxAbsDelta = d
      if (d > 0) identity = false
    }
  }
  out.repeated = {
    text: REPEAT,
    perCallMs: repeatMs,
    firstCallMs: repeatMs[0],
    warmCallMs: repeatMs.slice(1),
    identityBitExact: identity,
    maxAbsDelta,
  }

  // ── (A) distinct texts, each embedded once (genuinely uncached) ───────────
  const t0 = Date.now()
  const distinctMs: number[] = []
  for (const q of DISTINCT) {
    const s = Date.now()
    const v = await SemanticEngine.embed(q)
    distinctMs.push(Date.now() - s)
    if (!v || v.length === 0) throw new Error(`distinct embed returned empty for: ${q}`)
  }
  out.distinct = {
    texts: DISTINCT.length,
    perCallMs: distinctMs,
    totalMs: Date.now() - t0,
    note: "uncached provider path — the irreducible cost of a NEW question",
  }
  out.stats = SemanticEngine.embeddingCacheStats()

  // ── (B) the honest claim, computed here, not asserted in prose ────────────
  const first = out.repeated as { firstCallMs: number; warmCallMs: number[] }
  const warmAvg = first.warmCallMs.reduce((a, b) => a + b, 0) / first.warmCallMs.length
  const distinctAvg = distinctMs.reduce((a, b) => a + b, 0) / distinctMs.length
  out.verdict = {
    uncachedNewQuestionMs: distinctAvg,
    firstEverCallMs: first.firstCallMs,
    repeatedQuestionMs: warmAvg,
    cacheSpeedup: warmAvg > 0 ? Number((distinctAvg / warmAvg).toFixed(2)) : null,
    claim:
      "A NEW question still pays the provider round-trip; a REPEATED question (retry/follow-up/re-ask) pays only the cache lookup plus cosine.",
    cacheCannotLie: "every repeat was compared bit-for-bit against a fresh computation",
  }

  const { writeFileSync, mkdirSync } = await import("node:fs")
  const path = await import("node:path")
  const dir = path.resolve("validation/m50/results")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "A2-ask-cache.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error("probe failed:", e)
  process.exit(1)
})
