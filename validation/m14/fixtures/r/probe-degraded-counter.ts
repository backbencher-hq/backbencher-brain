#!/usr/bin/env npx tsx
/**
 * PROBE — can the lane's `degraded` counters actually FIRE? (A control on the counter, not the parse.)
 *
 * ## Why this exists
 *
 * HANDOFF §5.1 says the R hang appears with `degraded 2` in one artifact and `degraded 0` in
 * another, and treats the disagreement as evidence of a hang that abandons a measurement. Two
 * artifacts disagreeing is real; the interpretation is not the only one. This probe tests the
 * boring explanation first: ONE OF THE TWO COUNTERS CANNOT FIRE.
 *
 * The lane's artifacts do not share a predicate:
 *
 *   r-ambiguity-attribution.ts : `r?.fallback === true || r?.metadata?.fallback === true`  -> reported 2
 *   r-b-pair-verify.ts:104     : `r?.metadata?.degraded || r?.degraded`                    -> reported 0
 *
 * Production sets `fallback: true` in BOTH places a degraded parse can be returned
 * (`extractFallback`, pool-worker.ts:457, and the >5 MB early return, pool-worker.ts:931) and
 * sets a `degraded` key NOWHERE (`grep -rn degraded src/ast/*.ts` finds prose and comments only).
 * If that is right, the pair-verify predicate is a constant `undefined` and its `degraded 0` is
 * not a measurement of anything — which would explain the disagreement with no hang needed.
 *
 * ## The control
 *
 * A counter is only evidence if it can be shown to fire, so each predicate is run against REAL
 * production fallback objects, obtained without a WASM trap:
 *
 *   A  a file with an unsupported extension -> pool-worker's catch -> `return extractFallback(...)`
 *      at pool-worker.ts:1443. This is the SAME return statement a trap reaches; the only
 *      difference is that the trap also prints `[BB-PARSE-ERR]`.
 *   B  a >5 MB `.R` file -> the early return at pool-worker.ts:931, `fallback: true`.
 *
 * FALSIFIER: if the pair-verify predicate counts A (a known-degraded parse) as degraded, then the
 * predicate is fine and the two artifacts' disagreement needs the hang explanation after all.
 *
 * Run: `npx tsx validation/m14/fixtures/r/probe-degraded-counter.ts`  (exits 0 iff the control holds)
 */

import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const dir = mkdtempSync(path.join(tmpdir(), "bb-degctl-"))

// A: unsupported extension -> the catch path, the same `return extractFallback(...)` a trap takes.
const unsupported = path.join(dir, "control-unsupported.zzz")
writeFileSync(unsupported, "f <- function(x) x + 1\n")

// B: >5 MB -> the early return, `fallback: true`.
const big = path.join(dir, "control-big.R")
writeFileSync(big, "x <- 1\n".padEnd(6 * 1024 * 1024, "#"))

const A: any = await parseFile(unsupported, dir)
const B: any = await parseFile(big, dir)

/** The predicate r-ambiguity-attribution.ts uses. */
const attributionPredicate = (r: any) => r?.fallback === true || r?.metadata?.fallback === true
/** The predicate r-b-pair-verify.ts:104 uses. */
const pairVerifyPredicate = (r: any) => Boolean(r?.metadata?.degraded || r?.degraded)

const rows = [
  { name: "A  unsupported ext -> catch -> extractFallback (a trap's return statement)", r: A },
  { name: "B  >5 MB .R -> early return, fallback: true", r: B },
]

console.log("=".repeat(78))
console.log("PROBE — can the lane's `degraded` counters fire on a real degraded parse?")
console.log(`node ${process.version}`)
console.log("=".repeat(78))

let ok = true
for (const { name, r } of rows) {
  const att = attributionPredicate(r)
  const pv = pairVerifyPredicate(r)
  console.log()
  console.log(name)
  console.log(`  keys with a value: ${Object.keys(r ?? {}).filter((k) => (r as any)[k] !== undefined).join(", ")}`)
  console.log(`  fallback=${JSON.stringify(r?.fallback)}  degraded=${JSON.stringify(r?.degraded)}  metadata=${r?.metadata === undefined ? "undefined" : JSON.stringify(r.metadata)}`)
  console.log(`  attribution predicate (r?.fallback === true || r?.metadata?.fallback === true) -> ${att ? "DEGRADED" : "clean"}`)
  console.log(`  pair-verify predicate (r?.metadata?.degraded || r?.degraded)                   -> ${pv ? "DEGRADED" : "clean"}`)
  if (!att) ok = false // the known-degraded object must read degraded by the sound predicate
  if (pv) ok = false // ...and the dead predicate must NOT (the falsifier above)
}

console.log()
console.log("-".repeat(78))
if (ok) {
  console.log("RESULT: control holds. A REAL degraded parse is counted by the attribution predicate and")
  console.log("        MISSED by the pair-verify predicate, because production sets `fallback: true` and")
  console.log("        never sets `degraded`.")
  console.log()
  console.log("        => `r-b-pair-verify.txt`'s `degraded 0` is a DEAD COUNTER, not a clean walk.")
  console.log("        => the handoff's `degraded 2` vs `degraded 0` disagreement is explained")
  console.log("           WITHOUT a hang: the two artifacts count with different predicates, and one")
  console.log("           of them cannot return non-zero for any input.")
  process.exit(0)
} else {
  console.log("RESULT: the dead-counter reading is REFUTED. One of the predicates behaved against")
  console.log("        prediction; the disagreement between the two artifacts has another cause and")
  console.log("        must not be attributed to the counter.")
  process.exit(1)
}
