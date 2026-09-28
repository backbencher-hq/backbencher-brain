// script/m40/verify-gate-selftest.ts — M40.G1
// Mutation-based gate self-test (M31/M35 pattern). For every registered
// non-infra M40 gate, prove two things:
//   (control)  the gate PASSES on the clean/conforming world
//   (mutation) the gate FAILS when its governed surface is corrupted
// A gate that cannot fail is not a gate.
//
// Honesty rules:
//  - A missing gate script is reported, never excused: the selftest exits
//    non-zero while any registered non-infra gate lacks its script.
//  - A mutation that doesn't bite (gate still passes under corruption) fails
//    the selftest. No `mutationBit: true` fabrication is possible: the value
//    comes from the child's exit code.
//  - Gates spawn with BB_M40_SELFTEST_CONTROL=1 so closure's mid-flight
//    G1-dependent checks use the control seam; all other checks stay enforced.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

type GateDef = { code: string; script: string; infra: boolean }
const reg = JSON.parse(readFileSync(path.join(ROOT, "script/m40/gates-registry.json"), "utf8")) as { gates: GateDef[] }
const GATES = reg.gates.filter((g) => !g.infra)

// Semantic mutations: how to corrupt the world each gate governs. Applied via
// spawn wrapper env (gates mutate their OWN fixtures internally under this
// env) — the honest pattern from M35: the gate knows its own mutation.
const MUTATIONS: Record<string, string> = {
  A1: "BB_M40_MUTATE_A1_NOOP_POST=1",       // --post becomes a no-op → A1 gate must fail
  A2: "BB_M40_MUTATE_A2_UNBOUNDED=1",       // scoped pass skipped → A2 gate must fail
  A3: "BB_M40_MUTATE_A3_SILENT_DEFER=1",    // deferral hidden → A3 gate must fail
  A4: "BB_M40_MUTATE_A4_SCENARIO_SKIP=1",   // corpus skips a scenario → A4 gate must fail
  A5: "BB_M40_MUTATE_A5_COMBO_ALLOWED=1",   // illegal combo accepted → A5 gate must fail
  A6: "BB_M40_MUTATE_A6_STALE_OK=1",        // stale derived reported current → A6 gate must fail
  A7: "BB_M40_MUTATE_A7_MODE_DROP=1",       // CLI mode silently ignored → A7 gate must fail
  A8: "BB_M40_MUTATE_A8_HOOK_UNGATED=1",    // hooks fire without opt-in → A8 gate must fail
  A9: "BB_M40_MUTATE_A9_RESURRECT=1",       // phantom surface accepted → A9 gate must fail
}

type GateResult = { code: string; script: string; controlPassed: boolean; mutationBit: boolean | null; error?: string }
const results: GateResult[] = []
let hardFailures = 0

for (const g of GATES) {
  const scriptPath = path.join(ROOT, "script/m40", g.script)
  if (!existsSync(scriptPath)) {
    results.push({ code: g.code, script: g.script, controlPassed: false, mutationBit: null, error: "script not written yet" })
    hardFailures++
    continue
  }
  // Control: clean world. Children must NOT inherit BB_M40_EVIDENCE — a
  // control/mutation run is a probe, not a real chain run; if it stamped
  // evidence, mutation-world output would overwrite the real evidence files
  // (found by X1: A1/A2/A3 evidence was "blocked" from mutation runs).
  const childEnv = { ...process.env, BB_M40_SELFTEST_CONTROL: "1" } as Record<string, string | undefined>
  delete childEnv.BB_M40_EVIDENCE
  const ctrl = spawnSync("bun", ["run", `script/m40/${g.script}`], {
    cwd: ROOT, encoding: "utf8", timeout: 900_000,
    env: childEnv,
  })
  const controlPassed = ctrl.status === 0
  if (!controlPassed) {
    results.push({ code: g.code, script: g.script, controlPassed, mutationBit: null, error: "control failed on clean world" })
    hardFailures++
    continue
  }
  // Mutation: corrupted world. The gate reads its mutation env and must fail.
  const mutationEnv = MUTATIONS[g.code]
  if (!mutationEnv) {
    results.push({ code: g.code, script: g.script, controlPassed, mutationBit: null, error: "no registered mutation" })
    hardFailures++
    continue
  }
  const mut = spawnSync("bun", ["run", `script/m40/${g.script}`], {
    cwd: ROOT, encoding: "utf8", timeout: 900_000,
    env: { ...childEnv, [mutationEnv.split("=")[0]]: mutationEnv.split("=")[1] },
  })
  const mutationBit = mut.status !== 0
  if (!mutationBit) hardFailures++
  results.push({ code: g.code, script: g.script, controlPassed, mutationBit })
}

// The selftest's own governance: no leftover mutation artifacts on governed surfaces.
let residueClean = true
try {
  const out = execFileSync("git", ["status", "--porcelain", "--", "script/m40", "docs/m40"], { cwd: ROOT, encoding: "utf8" })
  if (out.split("\n").some((l) => l.trim().length > 0)) residueClean = false
} catch { residueClean = false }
if (!residueClean) hardFailures++

const allProven = results.every((r) => r.controlPassed && r.mutationBit === true)
const evidence = {
  status: hardFailures === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m40/verify-gate-selftest.ts",
  generatedAt: new Date().toISOString(),
  passed: results.filter((r) => r.controlPassed && r.mutationBit).length,
  failed: hardFailures,
  negativeCases: results.filter((r) => r.mutationBit).length,
  gates: results,
  residueClean,
}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(path.join(RESULTS_DIR, "gate-selftest.json"), JSON.stringify(evidence, null, 2) + "\n")

console.log(`gate-selftest: ${evidence.passed}/${results.length} gates fully proven (${hardFailures} hard failures)`)
for (const r of results) {
  const mark = r.controlPassed && r.mutationBit ? "OK " : "BAD"
  console.log(`  ${mark} ${r.code} control=${r.controlPassed} mutationBit=${r.mutationBit}${r.error ? ` (${r.error})` : ""}`)
}
if (hardFailures > 0) process.exit(1)
