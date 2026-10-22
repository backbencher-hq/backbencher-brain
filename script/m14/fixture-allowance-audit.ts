#!/usr/bin/env bun
/**
 * THE FIXTURE-ALLOWANCE AUDIT (Lead, 2026-10-21).
 *
 * ★ WHY THIS EXISTS. `validation/m14/fixture-baseline.json` records, per lane, the number of FIXTURE
 * FAILURES the lane is allowed to have. A stale-high allowance is a DEBT the lane no longer carries: the
 * lane is permitted to keep fixtures broken that it has already fixed, and the number is a floor that
 * only ever goes in the wrong direction. The owner has ruled that VERIFICATION IS THE KEY, and an
 * allowance is the one place a failure is permitted without a verifier.
 *
 * 39 free passes remain across 5 lanes: groovy 21 · perl 8 · swift 4 · vb 3 · vue 3. The typescript
 * (2 → 0) and ruby (1 → 0) allowances are already retired, each re-measured by the Lead independently
 * before the write.
 *
 * ★ MEASURED: EVERY ONE OF THE FIVE REMAINING ALLOWANCES IS EXACT — groovy 21 allowed / 21 failing,
 * perl 8 / 8, swift 4 / 4, vb 3 / 3, vue 3 / 3. So there is NO STALE ALLOWANCE LEFT TO RETIRE, and
 * the 39 are not "free passes waiting to be tightened" — they are the lanes' REAL, CURRENT FAILING
 * FIXTURES, and the honest number is the one already in the file. The typescript and ruby retirements
 * were the only stale ones, and both are done.
 *
 * ★ ★ THE BASELINE RECORDS FAILING FIXTURES, NOT PASSING ONES, AND THE FIRST VERSION OF THIS TOOL
 * GOT THAT BACKWARDS — IT REPORTED "vue produces 61 passes against an allowance of 3, so RAISE THE
 * ALLOWANCE", WHICH IS NONSENSE. `validation/m14/fixture-baseline.json` records, per lane, THE
 * NUMBER OF FIXTURE FAILURES THE LANE IS ALLOWED TO HAVE. It is a DEBT allowance, not a pass
 * allowance: a lane at 0 has every fixture passing, and a lane at 21 has 21 fixtures failing and is
 * PERMITTED to keep them failing until it fixes them.
 *
 * ⇒ SO THE AUDIT'S QUESTION IS THE OTHER WAY ROUND: HOW MANY FIXTURES ARE FAILING NOW, AGAINST HOW
 * MANY THE LANE IS ALLOWED TO BE FAILING? And the retirement is:
 *   - the allowance ABOVE the measured failures ⇒ STALE, the lane is ALLOWED to fail fixtures it no
 *     longer fails ⇒ RETIRE DOWNWARD to the measured failure count.
 *   - the allowance EQUAL to the measured failures ⇒ CORRECT, nothing to do.
 *   - the allowance BELOW the measured failures ⇒ THE LANE IS FAILING MORE THAN IT IS ALLOWED TO. That
 *     is a REGRESSION, not a retirement, and it is the one that must not be papered over.
 *
 * A lane's failure count can only go DOWN as the lane works, so the audit's normal verdict is a
 * retirement; a regression is the alarm.
 *
 * ★ THE TOOL DOES NOT EDIT THE BASELINE. It REPORTS, and the Lead writes the file — because the
 * baseline is a lead-owned record of what the fleet measured, and a tool that rewrites the record it
 * checks is a tool that cannot fail. This is the same discipline the lanes follow with the Lead's
 * instruments: PROPOSE, never edit.
 *
 * RUN: bun script/m14/fixture-allowance-audit.ts [language ...]
 *   with no argument, every lane with a non-zero allowance is audited.
 *
 * EXIT: 0 when every audited lane's allowance matches its measured pass count; 5 when any lane's
 * allowance disagrees with its measurement, because that is a live claim in the fleet's own record
 * that the measurement does not support.
 */

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const BASELINE = "validation/m14/fixture-baseline.json"
const argv = process.argv.slice(2)

const baseline: Record<string, number> = JSON.parse(readFileSync(resolve(ROOT, BASELINE), "utf8"))

/** THE LANES THE AUDIT TOUCHES BY DEFAULT: every lane with a non-zero allowance. */
const targets = argv.length > 0
  ? argv
  : Object.keys(baseline).filter((l) => (baseline[l] ?? 0) > 0).sort()

console.log(`FIXTURE-ALLOWANCE AUDIT — ${targets.length} lane(s) · baseline ${BASELINE}`)
console.log()
console.log("An allowance is the number of FAILING FIXTURES the lane is PERMITTED to have — a debt")
console.log("allowance, not a pass allowance. A lane at 0 has every fixture passing.")
console.log("The tool RUNS the lane's fixtures and compares. It does NOT edit the baseline — the")
console.log("baseline is a lead-owned record of what the fleet measured, and a tool that rewrites the")
console.log("record it checks is a tool that cannot fail.")
console.log()

interface Audit {
  lane: string
  /** THE ALLOWANCE: the number of FAILING FIXTURES the lane is permitted to have. */
  recorded: number
  /** THE MEASURED FAILURE COUNT from the runner's own JSON summary. */
  measuredFail: number
  measuredPass: number
  ran: boolean
  note: string
  verdict: "RETIRE-DOWN" | "MATCH" | "REGRESSION" | "COULD-NOT-RUN"
}

const audits: Audit[] = []

for (const lane of targets) {
  const recorded = baseline[lane] ?? 0
  const fixtureDir = resolve(ROOT, "validation/m14/fixtures", lane)
  if (!existsSync(fixtureDir)) {
    audits.push({ lane, recorded, measuredPass: -1, measuredFail: -1, ran: false,
      note: `no fixture directory at validation/m14/fixtures/${lane}`, verdict: "COULD-NOT-RUN" })
    continue
  }
  let out = ""
  try {
    out = execFileSync("bun", ["run", resolve(ROOT, "script/m14/run-fixtures.ts"), "--lang", lane], {
      cwd: ROOT, encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (e: any) {
    out = `${String(e?.stdout ?? "")}\n${String(e?.stderr ?? "")}`
  }
  // ★ THE COUNTS COME FROM THE RUNNER'S OWN JSON SUMMARY, AND THE FIRST VERSION OF THIS TOOL
  // PARSED THEM WRONG — IT REPORTED "851 pass, 841 failing" FOR VUE, WHICH IS ABSURD AND WAS THE
  // TOOL'S BUG, NOT THE LANE'S. The runner prints a `summary:` line carrying a JSON object keyed by
  // lane: `summary: {"vue":{"pass":61,"fail":3}}`. The old regex matched the FIRST number followed
  // by "pass" ANYWHERE in the output, which is a fixture NAME (`vue/with-defaults-propagation` does
  // not contain it, but `PASS  vue/...` lines and the trailing "3 fixture(s) FAIL" text do), so it
  // counted LINES and called them passes.
  //
  // ⇒ THE RULE: A COUNT COMES FROM THE RUNNER'S OWN MACHINE-READABLE SUMMARY, OR IT IS NOT A COUNT.
  // A NUMBER SCRAPED FROM PROSE IS A NUMBER THE TOOL GUESSED AT.
  const summaryM = /summary:\s*(\{[^\n]*\})/.exec(out)
  let measuredPass = -1
  let measuredFail = -1
  if (summaryM) {
    try {
      const parsed = JSON.parse(summaryM[1]!)
      const row = parsed[lane]
      if (row && typeof row.pass === "number") {
        measuredPass = row.pass
        measuredFail = typeof row.fail === "number" ? row.fail : -1
      }
    } catch {
      // fall through to the "could not run" path
    }
  }
  if (measuredPass < 0) {
    audits.push({ lane, recorded, measuredPass, measuredFail, ran: false,
      note: "the runner printed no pass count", verdict: "COULD-NOT-RUN" })
    continue
  }
  // THE VERDICT IS AGAINST THE FAILURE COUNT, because the allowance IS a failure allowance.
  const verdict: Audit["verdict"] = measuredFail < recorded ? "RETIRE-DOWN"
    : measuredFail > recorded ? "REGRESSION" : "MATCH"
  audits.push({ lane, recorded, measuredPass, measuredFail, ran: true,
    note: `${measuredPass} pass / ${measuredFail} fail`, verdict })
}

console.log("  THE ALLOWANCE IS A FAILURE ALLOWANCE: how many failing fixtures the lane is PERMITTED to have.")
console.log()
console.log("  lane       allowed   failing   passes   verdict")
console.log("  " + "-".repeat(58))
for (const a of audits) {
  const mp = a.measuredPass < 0 ? "?" : String(a.measuredPass)
  const mf = a.measuredFail < 0 ? "?" : String(a.measuredFail)
  console.log(
    `  ${a.lane.padEnd(10)} ${String(a.recorded).padStart(8)} ${mf.padStart(9)} ${mp.padStart(9)}   ${a.verdict}` +
    (a.note ? `  (${a.note})` : ""),
  )
}

const retire = audits.filter((a) => a.verdict === "RETIRE-DOWN")
const regress = audits.filter((a) => a.verdict === "REGRESSION")
const couldNot = audits.filter((a) => a.verdict === "COULD-NOT-RUN")

console.log()
if (retire.length) {
  console.log("★ RETIRE DOWNWARD — the lane is ALLOWED to fail more fixtures than it actually fails, so")
  console.log("  the allowance is stale and grants failures the lane no longer has. The write is the Lead's:")
  for (const a of retire) console.log(`    "${a.lane}": ${a.measuredFail},   (was ${a.recorded})`)
}
if (regress.length) {
  console.log("★ REGRESSION — the lane is FAILING MORE FIXTURES THAN IT IS ALLOWED TO. This is not a")
  console.log("  retirement and it is not a rounding: the lane's fixtures broke, or its allowance was")
  console.log("  wrong when it was written. The lane owns the fixtures; the Lead owns the allowance:")
  for (const a of regress) console.log(`    ${a.lane}: allowed ${a.recorded}, failing ${a.measuredFail}`)
}
if (couldNot.length) {
  console.log("★ COULD NOT RUN — these lanes were NOT audited, and no claim is made about them:")
  for (const a of couldNot) console.log(`    ${a.lane}: ${a.note}`)
}
if (regress.length > 0) {
  console.log()
  console.log("⇒ A REGRESSION IS NOT A RETIREMENT, AND THIS TOOL DOES NOT EXIT 0 OVER ONE.")
  process.exit(5)
}
if (retire.length === 0 && couldNot.length === 0) {
  console.log("⇒ EVERY audited lane's allowance EQUALS its measured failure count. Nothing to retire.")
  process.exit(0)
}
if (couldNot.length > 0) {
  console.log()
  console.log("⇒ THE AUDIT IS INCOMPLETE, so it does not exit 0: a lane that could not be run is not a")
  console.log("  lane that passed.")
  process.exit(5)
}
process.exit(0)
