// script/m13/verify-embedding-content-safety.ts
//
// The reconcile/backfill pass must isolate a provider CONTENT-SAFETY rejection
// (HTTP 422) to the offending item and keep going. The defect this pins, measured
// on 0.1.8:
//
//   "bb index --changed embedded 950 symbols, then hit 422 input rejected by
//    content safety screening and stopped with 44,250 still pending."
//
// The provider-only pass uses all-or-nothing embedding, so a 422 failed the whole
// batch — and because the poison item lives in every retry of that batch, the run
// made no further progress. A permanent per-item refusal was therefore treated as
// a transient outage.
//
// These assertions run the bisection policy directly with a fake provider, so they
// need no HTTP server, no credentials and no config on disk.

import { SemanticEngine } from "../../src/brain/semantic/engine"

type Fake = {
  /** Inputs the fake provider refuses with 422, exactly like a safety screen. */
  poison: (text: string) => boolean
  calls: number
  /** Largest batch the provider will accept; a whole-chunk call is the norm. */
}

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

function makeProvider(f: Fake) {
  return async (slice: string[]): Promise<number[][]> => {
    f.calls++
    // A real content-safety screen refuses the REQUEST if ANY input is rejected.
    if (slice.some((t) => f.poison(t))) {
      const err: any = new Error("input rejected by content safety screening")
      err.status = 422
      throw err
    }
    return slice.map((t) => [t.length, 1, 0])
  }
}

console.log("M13 embedding content-safety isolation\n")

// ── the reported case: one poison item among many ─────────────────────────────
{
  const texts = ["ok-1", "ok-2", "POISON", "ok-4", "ok-5"]
  const f: Fake = { poison: (t) => t === "POISON", calls: 0 }
  const r = await SemanticEngine.bisectContentSafetyRejections(texts, makeProvider(f))
  check("one refused item does not stop the run", r.vectors.filter(Boolean).length === 4, `embeddings=${r.vectors.filter(Boolean).length}`)
  check("the refused item is identified exactly", r.rejectedIndexes.length === 1 && r.rejectedIndexes[0] === 2, JSON.stringify(r.rejectedIndexes))
  check("every healthy item still got a vector", r.vectors[0] !== null && r.vectors[1] !== null && r.vectors[3] !== null && r.vectors[4] !== null)
  check("the refused slot holds no vector (never a fabricated one)", r.vectors[2] === null)
}

// ── several poison items, including both ends ─────────────────────────────────
{
  const texts = ["POISON-A", "ok", "ok", "POISON-B"]
  const f: Fake = { poison: (t) => t.startsWith("POISON"), calls: 0 }
  const r = await SemanticEngine.bisectContentSafetyRejections(texts, makeProvider(f))
  check("two refused items are both identified", JSON.stringify(r.rejectedIndexes) === "[0,3]", JSON.stringify(r.rejectedIndexes))
  check("the two healthy items still got vectors", r.vectors[1] !== null && r.vectors[2] !== null)
}

// ── everything refused is a per-item verdict, not an outage ───────────────────
{
  const texts = ["P1", "P2", "P3"]
  const f: Fake = { poison: () => true, calls: 0 }
  const r = await SemanticEngine.bisectContentSafetyRejections(texts, makeProvider(f))
  check("all-refused reports every index and NO error claim", r.rejectedIndexes.length === 3 && r.vectors.every((v) => v === null), JSON.stringify(r.rejectedIndexes))
}

// ── nothing refused: one call, no bisection ───────────────────────────────────
{
  const texts = ["a", "b", "c"]
  const f: Fake = { poison: () => false, calls: 0 }
  const r = await SemanticEngine.bisectContentSafetyRejections(texts, makeProvider(f))
  check("a clean batch costs exactly one provider call", f.calls === 1, `calls=${f.calls}`)
  check("a clean batch embeds everything", r.vectors.every((v) => v !== null) && r.rejectedIndexes.length === 0)
}

// ── NON-422 is NOT treated as per-item ────────────────────────────────────────
// A 429 or an auth failure must not be recorded as "this text is unsafe": that
// would permanently skip good text and hide an outage.
{
  let calls = 0
  const boom = async (): Promise<number[][]> => { calls++; const e: any = new Error("rate limited"); e.status = 429; throw e }
  const r = await SemanticEngine.bisectContentSafetyRejections(["a", "b"], boom)
  check("a 429 produces NO rejected indexes (outage, not an unsafe input)", r.rejectedIndexes.length === 0, JSON.stringify(r.rejectedIndexes))
  check("a 429 is surfaced as an error the caller can act on", typeof r.error === "string" && r.error.length > 0, String(r.error))
  check("a 429 is not bisected into a call storm", calls === 1, `calls=${calls}`)
}

// ── a short/malformed provider response is not silently accepted ─────────────
{
  const short = async (slice: string[]): Promise<number[][]> => [[1]]
  const r = await SemanticEngine.bisectContentSafetyRejections(["a", "b"], short)
  check("a short response is reported, not quietly misaligned onto items", typeof r.error === "string" && r.vectors.every((v) => v === null), String(r.error))
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "CONTENT SAFETY: PASS" : `CONTENT SAFETY: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
