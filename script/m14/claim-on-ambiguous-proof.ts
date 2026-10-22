/**
 * script/m14/claim-on-ambiguous-proof.ts
 *
 * THE PROOF FOR THE CLAIM-RECORDING CHANGE (2026-10-21, Lead) in `incoming-rule.ts`'s tie-break
 * path, at the request of the typescript lane, which MEASURED the gap: 13 moved rows carried a
 * claim and the claim's disposition was DROPPED — the tie-break returned before the disposition
 * could be attached, so a claim that arrived on a row the project already had an answer for left
 * NO TRACE.
 *
 * THE THREE CLAIMS THIS PROVES, EACH WITH ITS OWN FALSIFIER:
 *
 *   1 · THE CLAIM IS RECORDED on the tie-break row (it was absent before).
 *   2 · THE OUTCOME IS UNCHANGED — the row is still `resolved` by the own file's declaration,
 *       which is production's own rule.
 *   3 · NO COUNT MOVES — the claim is a RECORDING, and `tally` reads `claimOnAmbiguous` in the
 *       AMBIGUOUS branch alone, so the resolved column is identical with and without the claim.
 *
 * AND IT FAILS LOUDLY: a wrong proof exits non-zero, because a proof that cannot fail is not a
 * proof (the rule this programme keeps learning).
 */
import { classifyEdge, tally, emptyOutcomes } from "./incoming-rule"

const declCount = new Map<string, number>([["target", 2]])
const kinds = new Map<string, Set<string>>([["target", new Set(["function"])]])
// THE CLAIM the typescript lane measured: kind `owner`, with its specifiers.
const claim = { kind: "owner", specifiers: ["node:path"] } as any

// 1 · THE TIE-BREAK ROW, WITH A CLAIM.
const withClaim = classifyEdge(declCount, kinds, "target", claim, undefined, undefined, true, undefined, "src/a.ts")
// 2 · THE SAME ROW, WITH NO CLAIM — the outcome must be IDENTICAL.
const withoutClaim = classifyEdge(declCount, kinds, "target", null, undefined, undefined, true, undefined, "src/a.ts")

console.log("== THE ROW ==")
console.log(`   outcome (with claim)     ${withClaim.outcome}`)
console.log(`   outcome (without claim)  ${withoutClaim.outcome}`)
console.log(`   decls                    ${withClaim.decls}`)
console.log(`   claimOnAmbiguous         ${JSON.stringify(withClaim.claimOnAmbiguous)}`)

// 3 · THE TALLY, TWICE.
const a = emptyOutcomes()
tally(a, withClaim, "target", "calls")
const b = emptyOutcomes()
tally(b, withoutClaim, "target", "calls")

console.log("\n== THE COUNTS ==")
console.log(`   resolved  with claim    ${a.resolved}`)
console.log(`   resolved  without claim ${b.resolved}`)
console.log(`   ambiguous with claim    ${a.ambiguousByDecl}   without ${b.ambiguousByDecl}`)
console.log(`   resolvedWithClaim       ${JSON.stringify(a.resolvedWithClaim)}`)
console.log(`   ambiguousWithClaim      ${JSON.stringify(a.ambiguousWithClaim)}  (must stay empty: the row is RESOLVED)`)

// THE FALSIFIERS.
let fail = 0
if (withClaim.outcome !== withoutClaim.outcome) {
  console.error(`FAIL: the outcome MOVED — ${withoutClaim.outcome} → ${withClaim.outcome}`)
  fail++
}
if (!withClaim.claimOnAmbiguous) {
  console.error("FAIL: the tie-break still DROPS the claim")
  fail++
}
if (a.resolved !== b.resolved) {
  console.error(`FAIL: a COUNT MOVED — resolved ${b.resolved} → ${a.resolved}`)
  fail++
}
if (a.ambiguousByDecl !== b.ambiguousByDecl) {
  console.error("FAIL: the ambiguous column MOVED")
  fail++
}
if (Object.keys(a.ambiguousWithClaim).length !== 0) {
  console.error("FAIL: a RESOLVED row was counted in the AMBIGUOUS claim bucket")
  fail++
}
if (fail > 0) process.exit(5)
console.log("\nPASS: the claim is RECORDED, the outcome is UNCHANGED, and NO count moved.")
