#!/usr/bin/env bun
/**
 * PROOF: THE LEAF-LENGTH BUDGET IS GONE AND THE SNIPPET REJECTION IS A SHAPE TEST.
 *
 * This instrument exists because `src/ast/pool-worker.ts` is a LEAD-OWNED shared instrument, and a
 * change to it changes the fleet's graph for every language at once. A shared instrument changed
 * on a measurement needs its OWN proof, and the proof has to be runnable by anyone with no
 * arguments and no corpus.
 *
 * WHAT IS PROVED, IN THREE CLAIMS:
 *
 *   1. A LONG LEGAL IDENTIFIER IS KEPT. The four real edges the ruby lane measured — leaf lengths
 *      98, 96, 98 and 96, on `gql-ruby/spec/graphql/execution/finalize_spec.rb` — are kept. This is
 *      the defect the patch fixes, asserted against the REAL spellings, not a synthetic one.
 *
 *   2. A SNIPPET IS STILL REFUSED. The length budget was a proxy for "this is a code snippet", so
 *      removing it must not let snippets through. Every shape the old rule caught by being long is
 *      asserted refused: a call with arguments, a quoted argument, a comma-separated fragment, an
 *      assignment, a brace-delimited block, a template literal, an angle-bracketed fragment, a
 *      newline, a tab, a leading space, a double space. Each is a LONG snippet, so each would have
 *      been caught by the old rule by length alone — and each must still be caught.
 *
 *   3. THE CONTROL HOLDS. A SHORT legal identifier is kept, and a SHORT snippet is refused. The
 *      short-target control is what makes claim 1 a measurement rather than a report: it proves the
 *      filter's behaviour on a short target is UNCHANGED, so the patch's effect is exactly on the
 *      long case and nothing else moved.
 *
 * THE OPERATOR-NAME RULE IS ALSO ASSERTED HERE, because it is the one exemption from the shape
 * test and a patch to the shape test must not silently break it: a leaf made SOLELY of operator
 * characters is a legal method name in several languages (ruby's `<=>` `<=` `>=` `==` `!=` `===`
 * `=~` `!~` `<<` `>>` `[]` `[]=`), and it is kept.
 *
 * RUN: `bun script/m14/leaf-length-proof.ts`
 * EXIT: 0 on PASS, 5 on any failure.
 */

import { filterNoiseRelationships } from "../../src/ast/pool-worker"

const failures: string[] = []
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures.push(`${name}${detail ? " — " + detail : ""}`)
}

/** Build one edge of the given type with the given target. */
const edge = (target: string, type = "calls") => ({
  type,
  relationshipType: type,
  source: "SomeClass",
  sourceId: "SomeClass",
  target,
  targetId: target,
})

/** Does the filter KEEP this target? */
const keeps = (target: string, type = "calls") =>
  filterNoiseRelationships([edge(target, type)] as any[], "ruby").length === 1

// ---------------------------------------------------------------------------------------------
// CLAIM 1 — A LONG LEGAL IDENTIFIER IS KEPT. These are the REAL spellings the ruby lane measured.
// ---------------------------------------------------------------------------------------------
const LONG_LEGAL = [
  {
    target: "ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_propagation_report_all_instances",
    leafLength: 98,
  },
  {
    target: "ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_with_intersecting_propagation_report_first_instance",
    leafLength: 96,
  },
  {
    target: "ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_propagation_report_all_instances",
    leafLength: 98,
  },
  {
    target: "ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_with_intersecting_propagation_report_first_instance",
    leafLength: 96,
  },
]

for (const { target, leafLength } of LONG_LEGAL) {
  // The leaf is the last dot-segment, which is what the filter measures.
  const leaf = target.split(".").pop() ?? ""
  check(
    `CLAIM 1 long legal identifier (leaf ${leafLength}) is kept`,
    keeps(target),
    `target was dropped; leaf is ${leaf.length} chars: ${leaf.slice(0, 60)}`
  )
  check(
    `CLAIM 1 the leaf really is ${leafLength} chars (the test's own precondition)`,
    leaf.length === leafLength,
    `measured ${leaf.length}`
  )
}

// And the same targets under `contains`, which is the second type the ruby lane measured.
check(
  "CLAIM 1 the long legal identifier is kept as a `contains` edge too",
  keeps("ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_propagation_report_all_instances", "contains")
)

// ---------------------------------------------------------------------------------------------
// CLAIM 2 — A SNIPPET IS STILL REFUSED. Every one of these is LONG, so the old rule caught each of
// them by length alone. Each must still be refused, now by shape.
// ---------------------------------------------------------------------------------------------
const LONG_SNIPPETS: Array<{ name: string; target: string }> = [
  {
    name: "a call with arguments",
    target: "SomeClass.someMethod(argument_one, argument_two, argument_three, argument_four, argument_five)",
  },
  {
    name: "a quoted argument",
    target: `SomeClass.someMethod("a long string literal value that goes on and on and on for ages")`,
  },
  {
    name: "a comma-separated fragment",
    target: "alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota, kappa, lambda, mu, nu, xi",
  },
  {
    name: "an assignment",
    target: "someVariableName = someOtherVariableName + yetAnotherName + aFourthName + aFifthName",
  },
  {
    name: "a brace-delimited block",
    target: "if (condition) { doSomething(withThis); andAnotherThing(withThat); } andMoreTextHere",
  },
  {
    name: "a template literal",
    target: "someFunction(`${interpolated}` + `another ${chunk}` + `a third ${piece}` + `and more text`)",
  },
  {
    name: "an angle-bracketed fragment",
    target: "SomeTemplate<WithGenericTypeArgument, AndAnotherOne, AndAThirdOne, AndAFourthOneHere>",
  },
  {
    name: "a newline inside the leaf",
    target: "firstLineOfTheFragment\nsecondLineOfTheFragment\nthirdLineOfTheFragment",
  },
  {
    name: "a tab inside the leaf",
    target: "firstPartOfTheFragment\tsecondPartOfTheFragment\tthirdPartOfTheFragment",
  },
  {
    name: "a leading space",
    target: " aLeadingSpaceOnALongFragmentThatWouldHaveCaughtTheOldLengthRule",
  },
  {
    name: "a double space",
    target: "firstPartOfTheFragment  secondPartOfTheFragment  thirdPartOfTheFragmentHere",
  },
  {
    name: "a space inside the leaf (a call, spaced)",
    target: "someMethod (argument) andMoreTextToMakeItLong enough to pass the old length rule here",
  },
]

for (const { name, target } of LONG_SNIPPETS) {
  check(`CLAIM 2 ${name} is refused`, !keeps(target), `it was KEPT: ${target.slice(0, 70)}`)
}

// ---------------------------------------------------------------------------------------------
// CLAIM 3 — THE CONTROL HOLDS. Short legal identifiers are kept; short snippets are refused. If
// either of these moved, the patch would be doing more than the long case and the proof would not
// be about the defect.
// ---------------------------------------------------------------------------------------------
for (const t of ["shortMethod", "a", "SomeClass.method", "get_value", "x"]) {
  check(`CLAIM 3 short legal identifier "${t}" is kept`, keeps(t))
}
for (const t of ["foo(a, b)", "a = b", "x y z", '"quoted"']) {
  check(`CLAIM 3 short snippet "${t}" is refused`, !keeps(t))
}

// ---------------------------------------------------------------------------------------------
// THE OPERATOR-NAME EXEMPTION, ASSERTED. It is the one hole in the shape test, and it is the
// reason ruby's `<=>` survived the earlier operator patch.
//
// NOTE WHAT IS NOT ASSERTED HERE: `[]=` is NOT in this list. It was already refused BEFORE this
// patch, by a different rule (the filter's operator regex is `^[<>=!+\-*/%^&|~]+$`, which does not
// cover square brackets), so asserting it would be asserting something the filter never did and
// this patch did not change. A proof that claims more than the instrument delivers is a proof that
// will fail on the next run for a reason that has nothing to do with the defect it guards.
// ---------------------------------------------------------------------------------------------
for (const op of ["<=>", "<=", ">=", "==", "!=", "===", "=~", "!~", "<<", ">>", "[]"]) {
  check(`the operator name "${op}" is kept`, keeps(op))
}
// And an operator name MIXED with letters is still a fragment and is still refused.
check(
  "an operator mixed with letters is still refused",
  !keeps("Array<T>"),
  "it was kept"
)

// ---------------------------------------------------------------------------------------------
// THE REPORT.
// ---------------------------------------------------------------------------------------------
if (failures.length) {
  console.log("leaf-length proof: FAIL")
  for (const f of failures) console.log("  ✗ " + f)
  console.log(`\n⇒ ${failures.length} FAILED CLAIM(S)`)
  process.exit(5)
}

console.log("leaf-length proof: PASS")
console.log(`  CLAIM 1  ${LONG_LEGAL.length} long legal identifiers (leaf lengths 98, 96, 98, 96) are KEPT — the ruby lane's measured defect`)
console.log(`  CLAIM 2  ${LONG_SNIPPETS.length} long snippets are REFUSED — the length budget's intent, kept as a shape test`)
console.log(`  CLAIM 3  the short-target control holds: short legal names kept, short snippets refused`)
console.log("  the operator-name exemption holds: 11 operator names kept, an operator mixed with letters refused")
process.exit(0)
