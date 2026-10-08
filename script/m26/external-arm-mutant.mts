#!/usr/bin/env tsx
// script/m26/external-arm-mutant.mts — RED proofs for verify-external-arm-plan.ts.
//
// A gate that has only ever run green is not evidence. Each mutant below plants a
// REAL defect in the UNRESOLVED arm of src/intelligence/graph/graph-engine.ts,
// re-runs the comparison gate, and requires the gate to NOTICE. The source is
// always restored, including on a thrown error.
//
// The mutants are chosen to be the two ways this change could have been wrong
// while still looking plausible:
//
//   M1 predicate  — the arm's row SET changes (drop a conjunct). A gate that only
//                    counted rows, or compared row counts, would miss a swap.
//   M2 plan       — the arm returns the same rows on a DIFFERENT plan. This one
//                    must NOT be caught: the whole point of the change is that
//                    the plan changed. A gate that failed here would forbid the
//                    fix it exists to permit.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = process.cwd()
const TARGET = path.join(ROOT, "src", "intelligence", "graph", "graph-engine.ts")
const GATE = path.join(ROOT, "script", "m26", "verify-external-arm-plan.ts")

let failures = 0
const log = (ok: boolean, name: string, detail: string): void => {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

function runGate(): { passed: boolean; output: string } {
  const res = spawnSync("npx", ["tsx", GATE], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${process.env.HOME}/.local/node/bin:${process.env.PATH ?? ""}` },
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`
  return { passed: /EXTERNAL ARM PLAN: PASS/.test(output), output }
}

const original = readFileSync(TARGET, "utf8")

// The anchor is the arm's own final conjunct. Both mutants need it to exist; if it
// is absent the mutant NEVER RUNS, and a harness that silently skips an unrunnable
// mutant reports nothing at all — so that is reported as a failure.
const ANCHOR = '"AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL"'

const mutants: Array<{ id: string; name: string; to: string; expectGateToFail: boolean }> = [
  {
    // M1 first dropped `target_external IS NOT NULL` and the gate passed. That was
    // a NO-OP MUTANT, not a surviving one: measured on the owner's index, the
    // relationship table has exactly two populated quadrants —
    //   sym=SET  ext=SET   42,561
    //   sym=NULL ext=SET   17,610
    // — and no `sym=NULL, ext=NULL` rows at all, so removing the conjunct removes
    // nothing. A mutant that plants no defect is worse than no mutant: it looks
    // like evidence and carries none. This one inverts the arm's defining
    // predicate, which moves it from 17,610 rows to 42,561.
    id: "predicate",
    name: "M1: the arm's defining predicate is inverted (target_symbol_id IS NOT NULL)",
    to: '"AND r.target_symbol_id IS NOT NULL AND r.target_external IS NOT NULL"',
    expectGateToFail: true,
  },
  {
    id: "plan",
    name: "M2: the arm keeps every row but the pin is removed (same rows, old plan)",
    to: '"AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL"',
    expectGateToFail: false,
  },
]

console.log(`\nEXTERNAL ARM MUTANTS — each plants a real defect and requires the gate to notice\n`)

for (const m of mutants) {
  if (!original.includes(ANCHOR)) {
    log(false, `${m.id}: anchor present`, `*** ${ANCHOR} is absent — this mutant would never run ***`)
    break
  }
  let mutated = original.replace(ANCHOR, m.to)
  if (m.id === "plan") {
    // remove the pin: same predicate, same rows, different plan
    mutated = mutated.replace(
      '"FROM brain_relationship r" + externalArmIndexClause(raw) + " " +',
      '"FROM brain_relationship r " +',
    )
    if (mutated === original) {
      log(false, `${m.id}: mutant applied`, "*** the pin expression is absent — this mutant would never run ***")
      continue
    }
  }
  writeFileSync(TARGET, mutated)
  let result: { passed: boolean; output: string }
  try {
    result = runGate()
  } catch (e) {
    log(false, `${m.id}: gate ran`, `gate threw: ${String((e as Error).message).slice(0, 80)}`)
    continue
  } finally {
    writeFileSync(TARGET, original)
  }
  if (m.expectGateToFail) {
    const noticed = !result.passed
    log(
      noticed,
      `${m.id}: the gate CATCHES a changed row set`,
      noticed ? "gate failed as it must" : `*** the gate passed with a mutated row set *** ${result.output.split("\n").slice(-2).join(" ")}`,
    )
  } else {
    log(
      result.passed,
      `${m.id}: the gate does NOT object to a plan-only change (same rows)`,
      result.passed
        ? "gate passed, as it must — the point of the change is the plan"
        : `*** the gate rejects a plan-only change, which would forbid the fix *** ${result.output.split("\n").slice(-3).join(" ")}`,
    )
  }
}

// Control: the restored source must pass, or "caught" means nothing.
writeFileSync(TARGET, original)
const control = runGate()
log(
  control.passed,
  "control: the restored source PASSES the gate",
  control.passed ? "gate green on the real code" : `*** gate fails on unmodified source *** ${control.output.split("\n").slice(-3).join(" ")}`,
)

writeFileSync(TARGET, original)
console.log(`\nEXTERNAL ARM MUTANTS: ${failures === 0 ? "PASS" : `FAILED (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)