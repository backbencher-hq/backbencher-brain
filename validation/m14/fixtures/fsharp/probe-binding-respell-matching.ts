#!/usr/bin/env npx tsx
/**
 * PROBE — can the oracle's local-binding re-spelling land INERT? (It cannot, and here is why.)
 *
 * The approved plan was: land the oracle's `<callable>#<binding>` derivation FIRST with MISSING
 * and unexplained UNCHANGED, as proof the oracle derives the right thing before any analyzer edge
 * is re-spelled. That expectation is impossible, and this probe demonstrates it with the
 * differential's OWN exported `normTarget` and its two match predicates copied verbatim from
 * `script/m14/differential.ts`:
 *
 *   MISSING      rels.some(r => r.label === te.label && normTarget(r.target) === normTarget(te.target))
 *                (:24217)
 *   unexplained  truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target)
 *                                                           || te.target.includes(normTarget(r.target))))
 *                (:24230)
 *
 * Note the asymmetry in the second: the analyzer side also matches when the TRUTH target CONTAINS
 * the analyzer's normalized target. That is what makes the two steps behave differently, and it is
 * the whole content of this probe.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-binding-respell-matching.ts
 */

import { normTarget } from "../../../../script/m14/differential"

// ── the differential's two predicates, verbatim (:24217 and :24230) ──────────────────────────
const missingHit = (te: { label: string; target: string }, rels: { label: string; target: string }[]): boolean =>
  rels.some((r) => r.label === te.label && normTarget(r.target) === normTarget(te.target))

const unexplainedHit = (r: { label: string; target: string }, truth: { label: string; target: string }[]): boolean =>
  truth.some(
    (te) =>
      te.label === r.label &&
      (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))),
  )

const BARE = { label: "calls", target: "asIndex" }
const RESPELT = { label: "calls", target: "dataLoader#asIndex" }

console.log("=".repeat(80))
console.log("PROBE — does an oracle-only local-binding re-spelling land inert?")
console.log("=".repeat(80))
console.log(`normTarget("asIndex")        = ${JSON.stringify(normTarget("asIndex"))}`)
console.log(`normTarget("dataLoader#asIndex") = ${JSON.stringify(normTarget("dataLoader#asIndex"))}`)
console.log("")

// STEP 1 — oracle re-spells, analyzer still bare.
const step1Truth = [RESPELT]
const step1Rels = [BARE]
const s1Missing = !missingHit(RESPELT, step1Rels)
const s1Unexplained = !unexplainedHit(BARE, step1Truth)
console.log("STEP 1  oracle re-spells, analyzer unchanged (the 'inert' step)")
console.log(`  truth   ${RESPELT.target}   vs analyzer ${BARE.target}`)
console.log(`  MISSING?      ${s1Missing ? "YES — the truth row is no longer covered" : "no"}`)
console.log(`  unexplained?  ${s1Unexplained ? "YES" : "no — the analyzer row is still explained, because truth.includes('k')"}`)
console.log("")

// STEP 2 — analyzer flips to the same spelling.
const step2Rels = [RESPELT]
const s2Missing = !missingHit(RESPELT, step2Rels)
const s2Unexplained = !unexplainedHit(RESPELT, step1Truth)
console.log("STEP 2  analyzer flips to the same spelling")
console.log(`  truth   ${RESPELT.target}   vs analyzer ${RESPELT.target}`)
console.log(`  MISSING?      ${s2Missing ? "YES" : "no — covered again"}`)
console.log(`  unexplained?  ${s2Unexplained ? "YES" : "no"}`)
console.log("")

// CONTROL — the probe must be able to report the OTHER answer, or it proves nothing.
const ctlMissing = !missingHit(BARE, [BARE])
const ctlUnexplained = !unexplainedHit(BARE, [BARE])
const ctlOk = !ctlMissing && !ctlUnexplained
console.log(`CONTROL  identical bare spellings on both sides -> MISSING ${ctlMissing ? "YES" : "no"}, unexplained ${ctlUnexplained ? "YES" : "no"}`)
console.log(`         ${ctlOk ? "OK — the predicates CAN report 'covered and explained', so the step-1 result above is not a constant" : "FAIL — the probe is stuck on one answer and proves nothing"}`)
console.log("")
console.log("-".repeat(80))
if (ctlOk && s1Missing && !s1Unexplained && !s2Missing && !s2Unexplained) {
  console.log("RESULT: an oracle-only re-spelling CANNOT be inert. Step 1 must raise MISSING by the")
  console.log("        number of re-spelled truth rows and leave unexplained UNCHANGED; step 2 must")
  console.log("        return MISSING to its baseline. A step-1 run that reads UNCHANGED would mean")
  console.log("        the oracle's new derivation is not firing at all — a bug, not a pass.")
  process.exit(0)
} else {
  console.log("RESULT: the predicted signature does NOT hold. Do not proceed on it; re-derive the")
  console.log("        matching rules before changing either side.")
  process.exit(1)
}
