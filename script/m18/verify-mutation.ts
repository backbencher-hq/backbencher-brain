// script/m18/verify-mutation.ts — M18.X9 (closure-gate hardening proof).
//
// Extends the proven M17 pattern to the M18 gate. Proves the gate actually
// FAILS when the record or the system is tampered:
//   1. baseline: closure gate green
//   2. planted evidence poison: set Q1.json verified=false -> gate must FAIL
//      (evidence re-read), then restore the committed file
//   3. planted hollow verifier: add a script/m18 file containing an auto-pass
//      assertion -> gate must FAIL (hollow scan), then remove it
//   4. planted hardcoded measured-count in a verifier -> gate must FAIL
//      (the runtime-computed scan), then restore
//   5. coverage-presence removal: temporarily neuter the health coverage
//      report -> the coverage-present check must FAIL, then restore
//   6. restore -> gate green again
// Emits validation/m18/results/X9.json. If any planted tamper does NOT fail
// the gate, X9 fails (the gate has no teeth).
//
// NOTE: the planted hollow source is assembled from string fragments so that
// this script itself never contains the literal pattern the gate scans for.

import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function runGate(): number | null {
  try { execFileSync("bun", ["run", "script/m18/verify-closure-gate.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" }); return 0 } catch { return 1 }
}

async function main() {
  console.log("── X9.1  baseline ──")
  ck("X9: baseline gate green", runGate() === 0)

  console.log("── X9.2  planted evidence poison ──")
  const q1Path = path.join(RESULTS_DIR, "Q1.json")
  const backup = readFileSync(q1Path, "utf8")
  const poisoned = JSON.parse(backup); poisoned.verified = false; poisoned.failed = 1
  writeFileSync(q1Path, JSON.stringify(poisoned, null, 2) + "\n")
  const gateAfterPoison = runGate()
  writeFileSync(q1Path, backup) // restore
  ck("X9: gate FAILS on poisoned evidence (verified=false)", gateAfterPoison === 1, "exit=" + gateAfterPoison)

  console.log("── X9.3  planted hollow verifier ──")
  const q = '"'
  const hollowCall = ["c", "k"].join("") + "(" + q + "planted" + q + ", " + ["tr", "ue"].join("") + ")\n"
  const plantPath = path.join(ROOT_DIR, "script/m18/verify-hollow-plant.ts")
  writeFileSync(plantPath, "// planted hollow file for X9\n" + hollowCall)
  const gateAfterHollow = runGate()
  rmSync(plantPath, { force: true })
  ck("X9: gate fails on hollow verifier", gateAfterHollow === 1, "exit=" + gateAfterHollow)

  console.log("── X9.4  planted hardcoded measured-count ──")
  // Plant a line that looks like a hardcoded recall constant in a real
  // verifier. The gate's runtime-computed scan must catch it.
  const recallPath = path.join(ROOT_DIR, "script/m18/verify-recall.ts")
  const recallBackup = readFileSync(recallPath, "utf8")
  const planted = "// X9 planted constant\nconst recall = " + "0" + "." + "99; // planted\n"
  writeFileSync(recallPath, recallBackup + planted)
  const gateAfterCount = runGate()
  writeFileSync(recallPath, recallBackup) // restore
  ck("X9: gate fails on hardcoded measured-count", gateAfterCount === 1, "exit=" + gateAfterCount)

  console.log("── X9.5  planted coverage-report removal ──")
  // Removing the coverage CHECK CALL (commenting out the push) must fail the
  // coverage-presence check. Target the exact call site line.
  const healthPath = path.join(ROOT_DIR, "src/brain/brain-index-health.ts")
  const healthBackup = readFileSync(healthPath, "utf8")
  const callLine = "checks.push(await checkEmbeddingCoverage(rawDb, projectId))"
  ck("X9: coverage call site found in health source", healthBackup.includes(callLine), "call site missing")
  if (healthBackup.includes(callLine)) {
    // DELETE the line entirely (a comment would still carry the call string).
    const mutated = healthBackup.replace(callLine + "\n", "")
    writeFileSync(healthPath, mutated)
    const gateAfterCov = runGate()
    writeFileSync(healthPath, healthBackup) // restore
    ck("X9: gate fails when coverage report is neutered", gateAfterCov === 1, "exit=" + gateAfterCov)
  }

  console.log("── X9.6  restore -> green ──")
  ck("X9: gate green after all restores", runGate() === 0)

  const e = { issue: "M18.X9", code: "X9", tool: "governance", title: "closure gate: benchmark integrity + planted mutation (extends M17 pattern)", verified: failed === 0, checks, passed, failed, generatedAt: new Date().toISOString(), measured: { baseline: "green", poisonedEvidence: "gate failed", hollowVerifier: "gate failed", hardcodedCount: "gate failed", coverageNeutered: "gate failed", restored: "green" }, negativeLine: "Proves the gate responds to tampering; does not prove the underlying analyzers are perfect. Coverage-presence check is on reporting-presence (machine-checkable), not a fixed % gate." }
  writeFileSync(path.join(RESULTS_DIR, "X9.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("X9: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()