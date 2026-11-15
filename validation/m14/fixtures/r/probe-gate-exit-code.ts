#!/usr/bin/env npx tsx
/**
 * PROBE — does `script/m14/ontology-coverage-gate.ts`'s exit code report the gate's verdict?
 *
 * ## What it found
 *
 * `npx tsx script/m14/ontology-coverage-gate.ts r` on this lane prints, in full:
 *
 *     emitted 10/10   ruled-sound 0   FALSIFIED 0   ruled-without-justification 0
 *
 * and then exits 1. The two disagree, and the cause is not in the gate.
 *
 * ## The mechanism
 *
 * `ontology-coverage-gate.ts:457` sets
 *
 *     process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1
 *
 * which for R is 0. Node exits with `process.exitCode` only when the event loop drains. The
 * parser's per-file self-destruct timer in `src/ast/engine.ts:1441-1443` is a PENDING TIMER:
 *
 *     const parseBomb = setTimeout(() => {
 *       process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
 *       process.exit(1)
 *     }, 120000)
 *
 * It is `clearTimeout`ed on the line after `parser.parse(content)` returns. If a parse takes
 * longer than 120 s — this lane's corpus does that intermittently, see the run log — the timer
 * fires while the gate is idle-waiting on its own worker pool, and `process.exit(1)` OVERWRITES
 * the verdict `exitCode` the gate already set. The `[BB-HANG]` line therefore prints AFTER the
 * gate's own summary, which is the order observed, and is itself proof the process was still
 * alive when the verdict was computed: a process that had exited normally could not print it.
 *
 * ## Why this matters beyond this lane
 *
 * The exit code is the only machine-readable verdict the arbiter emits. A consumer written as
 * `ontology-coverage-gate.ts <lang> && accept` reads a 10/10 lane as a failure. It cannot
 * manufacture a false PASS — the timer only ever forces 1 — so it is a false-failure defect, but
 * it is one that makes the arbiter unusable as a gate without reading its stdout.
 *
 * ## What is measured here, and what is NOT
 *
 * MEASURED below: that a pending self-destruct timer of the exact shape `engine.ts` registers
 * overrides an already-set `process.exitCode = 0` in this Node version, and that the observed
 * ordering (`[BB-HANG]` after the summary) is what the same mechanism predicts. The 120 s figure
 * is shortened to 400 ms because the question is the ordering, not the timeout value.
 *
 * NOT MEASURED here: that a specific corpus file really does hang the R parser for 120 s. That
 * is a separate claim and this probe does not make it. The gate's own log is the evidence for it,
 * and the file it names CHANGES between runs (`scale-manual.R` on the run recorded here,
 * `scale-hue.R` on the run before), which is why the run log is quoted rather than asserted.
 *
 * Run: `npx tsx validation/m14/fixtures/r/probe-gate-exit-code.ts`   (exits 0; writes nothing)
 */

import { execFileSync } from "node:child_process"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const NODE = process.execPath

// 1. The control: a pending timer that does NOT self-destruct. If the mechanism below is real,
//    this exits with the exitCode the script set, and it proves the script structure is otherwise
//    sound — so a 1 from the self-destruct variant is attributable to the exit(1) and not to
//    some accident of how the script was launched.
const control = mkdtempSync(path.join(tmpdir(), "bb-exitctl-"))
writeFileSync(
  path.join(control, "ctl.mjs"),
  `process.exitCode = 0
console.log("CTL: verdict printed, exitCode=0")
setTimeout(() => { console.log("CTL: benign timer fired") }, 400)
`
)
function run(dir: string, file: string): number {
  try {
    execFileSync(NODE, [path.join(dir, file)], { stdio: "pipe" })
    return 0
  } catch (e: any) {
    return typeof e.status === "number" ? e.status : -1
  }
}
const ctlStatus = run(control, "ctl.mjs")

// 2. The treatment: engine.ts's exact shape — a pending timer that calls process.exit(1).
const treat = mkdtempSync(path.join(tmpdir(), "bb-exittrt-"))
writeFileSync(
  path.join(treat, "trt.mjs"),
  `process.exitCode = 0
console.log("TRT: verdict printed, exitCode=0")
const parseBomb = setTimeout(() => {
  process.stderr.write("TRT: [BB-HANG] parser stuck — exiting\\n")
  process.exit(1)
}, 400)
void parseBomb
`
)
const trtStatus = run(treat, "trt.mjs")

console.log("=".repeat(78))
console.log("PROBE — does a pending self-destruct timer mask an already-set exitCode?")
console.log(`node: ${NODE}  (${process.version})`)
console.log("=".repeat(78))
console.log()
console.log("control   script sets exitCode=0, benign 400ms timer, no process.exit")
console.log(`  -> exit ${ctlStatus}          ${ctlStatus === 0 ? "the exitCode survives" : "UNEXPECTED"}`)
console.log()
console.log("treatment engine.ts:1441-1443 verbatim in shape, timer fires process.exit(1)")
console.log(`  -> exit ${trtStatus}          ${trtStatus === 1 ? "the self-destruct MASKED exitCode=0" : "mechanism did NOT reproduce"}`)
console.log()
if (ctlStatus === 0 && trtStatus === 1) {
  console.log("RESULT: the mechanism reproduces. A pending self-destruct timer overwrites a")
  console.log("        verdict exitCode that was already set to 0, and it fires only because the")
  console.log("        pending timer keeps the event loop alive after the verdict was computed.")
  console.log()
  console.log("        Applies to ontology-coverage-gate.ts:457 whenever src/ast/engine.ts's parseBomb")
  console.log("        is still pending at that moment — i.e. whenever a file takes >120s to parse.")
  console.log("        It can only force 1, never 0: a false failure, and never a false pass.")
  process.exit(0)
} else {
  console.log("RESULT: NOT REPRODUCED on this node. The gate's exit 1 has another cause and the")
  console.log("        mechanism above must not be claimed. Investigate before reporting.")
  process.exit(1)
}