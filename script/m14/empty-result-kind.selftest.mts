/**
 * CONTROL for `script/m14/empty-result-kind.ts` — imports the SHIPPED module, never a copy.
 *
 * ## What this control is for
 *
 * `incoming-gate.ts` reported "the population is INCOMPLETE" over three files in clean-stdlib that
 * are **0 bytes**. The direction of that error matters more than its size: it trains a reader to
 * ignore the disclosure, so that when the disclosure is TRUE — a timed-out file that silently
 * deflated the population — nothing looks different. This control pins both directions.
 *
 * ## The arms, and what each would fail on
 *
 *   A  0-byte file                       -> contentless   (a defect if read as a hole)
 *   B  whitespace-only file              -> contentless   (a file of `\n\n` has nothing to extract)
 *   C  file WITH content                 -> hole          (a defect if read as contentless: this is
 *                                                          the direction that HIDES a real gap)
 *   D  a path that does not exist        -> hole          (unreadable is NOT proven-empty; defaulting
 *                                                          this to contentless is how a disclosure
 *                                                          silently shrinks to nothing)
 *   E  REGRESSION PIN: the three real clean-stdlib files that produced the false claim
 *   F  two-directional: no arm may satisfy both kinds — asserted per arm, not once
 *
 * Arm E is the one that matters most in practice: it is the exact case, from the real corpus, that
 * the first version of this code got wrong.
 *
 * Run: `npx tsx script/m14/empty-result-kind.selftest.mts`
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyEmptyResult, classifyEmptyResults } from "./empty-result-kind"

let pass = 0
const failures: string[] = []

function expect(label: string, got: string, want: string) {
  if (got === want) { pass++; return }
  failures.push(`${label}: expected ${want}, got ${got}`)
}

const dir = mkdtempSync(join(tmpdir(), "empty-result-kind-"))
try {
  const zeroByte = join(dir, "zero.dcl")
  writeFileSync(zeroByte, "")

  const whitespace = join(dir, "whitespace.dcl")
  writeFileSync(whitespace, "\n\n   \t\n")

  const withContent = join(dir, "content.dcl")
  writeFileSync(withContent, "definition module Foo\n")

  const missing = join(dir, "does-not-exist.dcl")

  // ── A / B / C / D: both directions, asserted per arm
  expect("A 0-byte file", classifyEmptyResult(zeroByte).kind, "contentless")
  expect("B whitespace-only file", classifyEmptyResult(whitespace).kind, "contentless")
  expect("C file with content", classifyEmptyResult(withContent).kind, "hole")
  expect("D nonexistent path", classifyEmptyResult(missing).kind, "hole")

  // ── F: no arm may satisfy both kinds. A single `kind` string cannot, but the assertion is written
  // out because the failure mode it guards is a future return type that carries both.
  for (const [label, p] of [["A", zeroByte], ["C", withContent]] as const) {
    const k = classifyEmptyResult(p).kind
    if (k === "contentless" || k === "hole") pass++
    else failures.push(`F arm ${label}: kind is neither contentless nor hole (${k})`)
  }

  // ── E: THE REGRESSION PIN. The three files that produced the false "INCOMPLETE" claim. If this
  // arm ever fails, either the files changed on disk or the classifier inverted — and a classifier
  // that reads a 0-byte file as a hole reproduces the exact defect this module exists to stop.
  const PINNED = [
    "$HOME/fixtures/repositories/clean-stdlib/_library.dcl",
    "$HOME/fixtures/repositories/clean-stdlib/_startup.dcl",
    "$HOME/fixtures/repositories/clean-stdlib/_system.dcl",
  ]
  const absent = PINNED.filter((p) => !existsSync(p))
  if (absent.length) {
    // A pin whose files are gone is REPORTED, not skipped: a regression pin that silently stops
    // testing is the failure it exists to prevent.
    console.log(`NOTE arm E: ${absent.length} pinned file(s) absent from this machine — pin UNTESTED, not passed:`)
    for (const p of absent) console.log(`  ${p}`)
  } else {
    for (const p of PINNED) expect(`E ${p.split("/").pop()}`, classifyEmptyResult(p).kind, "contentless")
  }

  // ── G: THE BULK HELPER AGREES WITH THE SINGLE-FILE ONE. Two entry points that can disagree is the
  // same hazard as two copies, one level down.
  const bulk = classifyEmptyResults([zeroByte, withContent, missing])
  expect("G bulk[0]", bulk[0].kind, "contentless")
  expect("G bulk[1]", bulk[1].kind, "hole")
  expect("G bulk[2]", bulk[2].kind, "hole")
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`empty-result-kind self-test: ${pass} pass / ${failures.length} fail`)
for (const f of failures) console.log(`  FAIL ${f}`)
if (failures.length) process.exit(1)
console.log("PASS (every clause carries an arm that would fail if the clause were dropped)")
