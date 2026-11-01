// script/m64/verify-evidence.ts — evidence census (the counterpart of
// script/m13/verify-evidence.ts, for the bb_health battery).
//
// WHY THIS EXISTS. script/m64's eight verifiers emit through the shared
// `Harness` in script/m13/harness.ts. That harness stamped `milestone: ""`
// on every document and wrote it into `validation/m13/results/`, so 's
// evidence landed in 's corpus with an identity that contradicted itself
// (`milestone: ""`, `issue: ""`): 's census read eight foreign
// documents and rejected all eight, for a reason that appeared in no message,
// while 's own documents were checked by nobody.
//
// The two halves of the fix are one idea: a document belongs to ONE milestone,
// in that milestone's results directory, validated against that milestone's
// identity. `Harness` now takes a `milestone`, and this census is the side:
//
//  1. every validation/m64/results/*.json declares and is schema-valid;
//  2. no document is left behind in 's corpus (the exact regression);
//  3. the validator refuses the shapes it says it refuses — a forged
//  `verified` with failures, a `verified` with no negative case, another
//  milestone's identity, and a TAMPERED copy of a real document.
//
// Run: npx tsx script/m64/verify-evidence.ts
// Evidence: validation/m64/results/h64x.json

import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Harness, resultsDirFor } from "../m13/harness"
import { validateEvidence } from "../m13/verify-evidence"

const RESULTS_DIR = resultsDirFor("M64")
const M13_DIR = resultsDirFor("M13")
/** numbers a LANE (``), not an issue-per-file: `code` carries that. */
const ISSUE_PATTERN = /^M64(\.\w+)*$/

const harness = new Harness({
  issue: "M64.1",
  code: "H64X",
  tool: "bb_health",
  title: "M64 evidence census: every committed M64 document is this milestone's, schema-valid, and checked against a validator that can fail",
  layers: ["unit"],
  milestone: "M64",
  decisions: {
    home: "validation/m64/results is M64's corpus; `Harness` derives it from `milestone` (script/m13/harness.ts:resultsDirFor), so a reusing milestone cannot write into another's by accident",
    identity: "one document, one milestone — `milestone` and `issue` must agree, and a document declaring another milestone is refused by name and told where it belongs",
    falsifiability: "the validator's grip is proved on a REAL document from this corpus (tampered summary), not only on documents this gate constructs",
  },
  limitations: [
    "This census validates structure and identity, not truth: it cannot tell whether a check's assertion was the right one, which is what the per-family gates (verify-paths/verify-wire/…) are for.",
    "The layer vocabulary is the shared one from the harness; a document may still name a layer its checks did not actually exercise, because a layer classifies WHERE the checks ran.",
  ],
})

function loadDocs(dir: string): Array<{ file: string; doc: any }> {
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    return []
  }
  return names.map((f) => ({ file: f, doc: JSON.parse(readFileSync(resolve(dir, f), "utf8")) }))
}

const docs = loadDocs(RESULTS_DIR)
harness.check("the M64 results directory exists and holds evidence", docs.length > 0, RESULTS_DIR)

// 1. Identity + schema for every document of this milestone.
const foreign = docs.filter(({ doc }) => doc?.milestone !== "M64")
harness.check(
  "every document in validation/m64/results declares the M64 milestone",
  foreign.length === 0,
  foreign.map(({ file, doc }) => `${file} declares ${doc?.milestone ?? "<none>"}`).join("; "),
)
let firstInvalid: string[] = []
for (const { file, doc } of docs) {
  const errors = validateEvidence(doc, { milestone: "M64", issuePattern: ISSUE_PATTERN })
  if (errors.length) firstInvalid.push(`${file}: ${errors.join("; ")}`)
}
harness.check(
  `every M64 document is schema-valid (${docs.length} documents)`,
  firstInvalid.length === 0,
  firstInvalid.slice(0, 4).join(" | "),
)

// 2. The regression itself: an document must not be sitting in 's corpus.
//  's census asserts the same thing from its side; this asserts the fix
//  from 's, so removing either half fails the other lane's gate too.
const inM13 = loadDocs(M13_DIR).filter(({ doc }) => doc?.milestone === "M64" || (typeof doc?.issue === "string" && /^M64/.test(doc.issue)))
harness.check(
  "no M64 document is left in validation/m13/results",
  inM13.length === 0,
  inM13.map(({ file }) => file).join(", "),
)

// 3. Falsifiability, all as negative cases: the shapes the validator must refuse.
function rejects(name: string, doc: any, fragment: string): void {
  const errors = validateEvidence(doc, { milestone: "M64", issuePattern: ISSUE_PATTERN })
  harness.negative(name, errors.some((e) => e.includes(fragment)), errors.length ? `got: ${errors.join("; ")}` : "no errors returned")
}

const template = harness.document()
rejects("forged `verified` with a failing check is refused", { ...template, verifiedState: "verified", checks: [{ name: "x", pass: false }], summary: { total: 1, passed: 0, failed: 1 } }, "verified claim has failed>0")
rejects("`verified` with no negative case is refused", { ...template, verifiedState: "verified", negativeCases: 0, checks: [{ name: "x", pass: true }], summary: { total: 1, passed: 1, failed: 0 } }, "verified claim has zero negative cases")
rejects("another milestone's document is refused by name", { ...template, milestone: "M13" }, "this document declares M13")
rejects("an M13 issue number is refused on an M64 document", { ...template, issue: "M13.02" }, "issue must match M64")
rejects("an undeclared layer is refused", { ...template, layers: ["vibes"] }, "layers must be a non-empty array of valid layers")
rejects("a summary that disagrees with its checks is refused", { ...template, summary: { total: 99, passed: 0, failed: 99 } }, "summary.total")

// The grip is proved on a REAL document too: a tampered copy of the largest
// committed document (its last check is flipped to failing without its
// summary being touched) must be refused. This is the check that would have
// caught the misfiled family, and it fails on real bytes rather than on a
// document this gate built to be refused.
const realDoc = docs
  .filter(({ doc }) => doc?.code !== "H64X" && Array.isArray(doc?.checks) && doc.checks.length > 0)
  .sort((a, b) => b.doc.checks.length - a.doc.checks.length)[0]
if (!realDoc) {
  harness.check("a real M64 document exists to tamper with", false, `nothing in ${RESULTS_DIR}`)
} else {
  const tampered = JSON.parse(JSON.stringify(realDoc.doc))
  tampered.checks[tampered.checks.length - 1].pass = !tampered.checks[tampered.checks.length - 1].pass
  const errors = validateEvidence(tampered, { milestone: "M64", issuePattern: ISSUE_PATTERN })
  harness.negative(
    `a tampered copy of ${realDoc.file} (one check flipped, summary untouched) is refused`,
    errors.some((e) => e.includes("summary")),
    errors.length ? `got: ${errors.join("; ")}` : "no errors returned",
  )
  harness.check(
    `${realDoc.file} itself validates (the tamper, not the document, is what failed)`,
    validateEvidence(realDoc.doc, { milestone: "M64", issuePattern: ISSUE_PATTERN }).length === 0,
  )
}

harness.emit()
