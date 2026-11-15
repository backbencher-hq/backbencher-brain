/**
 * NIM ANALYZER-HYGIENE CHECK — a SOURCE-level instrument, run as an A/B.
 *
 * ## Why this file exists
 *
 * `script/m14/verify-analyzer-hygiene.ts` detects four dead-code classes in
 * analyzer source: no-op ternaries, duplicate if/else bodies, write-only flags,
 * and fresh-node identity comparisons. Its `GATED_ANALYZERS` map (line 30) is a
 * hardcoded list of **25** languages; `src/ast/` holds **48** analyzers and `nim`
 * is not among the 25, so `--lang nim` prints `unknown language: nim` and the
 * committed `validation/m14/results/M14.0.F7.json` carries **no
 * `analyzer-hygiene-nim` row at all** — verified by regenerating it and finding
 * 0 occurrences of the string `nim`. Adding the lane to that map is shared
 * machinery (§8), so this lane measures itself with the gate's own EXPORTED
 * detectors and no edit to the gate.
 *
 * ## Why it is an A/B and not a single assertion
 *
 * A source-level check that only asserts "0 findings" cannot fail for the right
 * reason: if the detectors stopped matching anything, the assertion would pass
 * and mean nothing. So this file proves the instrument still bites by re-introducing
 * the exact defect into a COPY of the analyzer and requiring the detector to fire
 * on the copy. Findings on HEAD must be 0; findings on the reverted copy must be
 * ≥1. Either half alone is a green that means nothing; the pair is a check.
 *
 * ## What it is NOT
 *
 * It is not an oracle and it makes no claim about emitted edges — the fixture
 * lane (`run-fixtures.ts`) and the parse-tree oracle
 * (`script/m14/nim-truth-oracle.ts`) do that. It reads analyzer TEXT, which is
 * why it is a hygiene instrument and not a parse instrument, and why nothing here
 * is regex over Nim source: the regex ban in the workstream is about matching
 * language constructs, and this file matches TypeScript in TypeScript's own
 * harness, re-using that harness's detectors unchanged.
 *
 * Writes no evidence. Run: npx tsx validation/m14/fixtures/nim/verify-analyzer-hygiene-nim.ts
 * Exit 0 iff HEAD is clean AND the reverted copy is caught.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import {
  findNoopTernaries,
  findDuplicateIfElse,
  findWriteOnlyFlags,
  findNodeIdentityComparisons,
  findBareNodeIdentityComparisons,
} from "../../../../script/m14/verify-analyzer-hygiene"

const ANALYZER = path.resolve((import.meta as any).dirname ?? ".", "../../../../src/ast/real-nim-analyzer.ts")
const src = readFileSync(ANALYZER, "utf8")

// The five detectors the shared gate runs, in its own order. Counted here rather
// than imported as a list because the gate does not export one; if the gate grows
// or loses a detector this file says so instead of quietly covering less.
const DETECTORS = [
  ["noop-ternary", findNoopTernaries],
  ["duplicate-if-else", findDuplicateIfElse],
  ["write-only-flag", findWriteOnlyFlags],
  ["node-identity-comparison", findNodeIdentityComparisons],
  ["bare-node-identity-comparison", findBareNodeIdentityComparisons],
] as const

function run(label: string, text: string): { kind: string; line: number; note: string; snippet: string }[] {
  const out: any[] = []
  for (const [, fn] of DETECTORS) (fn as any)(text, "nim", out)
  console.log(`${label.padEnd(34)} ${out.length} finding(s)`)
  for (const f of out) console.log(`    ${f.kind} @ line ${f.line}: ${f.note}\n      ${String(f.snippet).trim()}`)
  return out
}

console.log(`analyzer   : src/ast/real-nim-analyzer.ts`)
console.log(`sha256     : ${createHash("sha256").update(src).digest("hex").slice(0, 16)}`)
console.log(`size       : ${src.length} B, ${src.split("\n").length} lines`)
console.log(`detectors  : ${DETECTORS.length} — ${DETECTORS.map(d => d[0]).join(", ")}`)
console.log("")

const problems: string[] = []

// ── ARM 1 — HEAD must be clean.
const head = run("HEAD", src)
if (head.length > 0) {
  problems.push(`HEAD carries ${head.length} hygiene finding(s): ${head.map(f => `${f.kind}@${f.line}`).join(", ")}`)
}

// ── ARM 2 — the reverted copy must be CAUGHT, or arm 1 is vacuous.
//
// The revert is the pre-fix line verbatim: `if (!c || c === symDecl) continue`.
// `symDecl` is still in scope at that point in the analyzer, so the reverted text
// is source the analyzer could actually have contained — this is a state the
// pre-fix analyzer could produce, not a shape invented for the test. (The same
// requirement that made fsharp's first draft of FS-D7 survive: a revert that
// clears the owner as well as the edge is not a reachable state.)
const PRE_FIX = "if (!c || c === symDecl) continue"
const POST_FIX = "if (!c || i === 0) continue"
const occurrences = src.split(POST_FIX).length - 1
if (occurrences !== 1) {
  problems.push(`the post-fix guard ${JSON.stringify(POST_FIX)} occurs ${occurrences}x in the analyzer; expected exactly 1, so the revert below would be a no-op and arm 2 vacuous`)
} else {
  const reverted = src.replace(POST_FIX, PRE_FIX)
  const arm2 = run(`REVERTED COPY (${POST_FIX} -> ${PRE_FIX})`, reverted)
  if (arm2.length < 1) {
    problems.push("the reverted copy was NOT caught — the detector does not fire on this defect class, so arm 1 is a green that means nothing")
  } else if (!arm2.some(f => f.kind === "bare-node-identity-comparison")) {
    problems.push(`the reverted copy was caught, but not by bare-node-identity-comparison (got ${arm2.map(f => f.kind).join(",")}) — the detector that must bite is not the one that bit`)
  }
}

console.log("")
if (problems.length === 0) {
  console.log(`nim analyzer hygiene: 0 findings on HEAD, and the reverted copy is CAUGHT by bare-node-identity-comparison.`)
  console.log(`the instrument discriminates; the green is not vacuous.`)
  process.exit(0)
}
for (const p of problems) console.log(`PROBLEM: ${p}`)
console.log(`nim analyzer hygiene: ${problems.length} problem(s)`)
process.exit(1)
