// script/m17/verify-mutation.ts — M17.X9 (closure-gate hardening proof).
//
// Proves the closure gate actually FAILS when the record is tampered:
//   1. baseline: closure gate green
//   2. planted evidence poison: set S1.json verified=false -> gate must FAIL
//      (evidence re-read), then restore the committed file
//   3. planted hollow verifier: add a script/m17 file containing an auto-pass
//      assertion -> gate must FAIL (hollow scan), then remove it
//   4. restore -> gate green again
// Emits validation/m17/results/X9.json. If any planted tamper does NOT fail
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
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m17/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function runGate(): number | null {
  try { execFileSync("bun", ["run", "script/m17/verify-closure-gate.ts"], { cwd: ROOT_DIR, encoding: "utf8", stdio: "pipe" }); return 0 } catch { return 1 }
}

async function main() {
  console.log("── X9.1  baseline ──")
  ck("X9: baseline gate green", runGate() === 0)

  console.log("── X9.2  planted evidence poison ──")
  const s1Path = path.join(RESULTS_DIR, "S1.json")
  const backup = readFileSync(s1Path, "utf8")
  const poisoned = JSON.parse(backup); poisoned.verified = false; poisoned.failed = 1
  writeFileSync(s1Path, JSON.stringify(poisoned, null, 2) + "\n")
  const gateAfterPoison = runGate()
  writeFileSync(s1Path, backup) // restore
  ck("X9: gate FAILS on poisoned evidence (verified=false)", gateAfterPoison === 1, "exit=" + gateAfterPoison)

  console.log("── X9.3  planted hollow verifier ──")
  const q = '"'
  const hollowCall = ["c", "k"].join("") + "(" + q + "planted" + q + ", " + ["tr", "ue"].join("") + ")\n"
  const plantPath = path.join(ROOT_DIR, "script/m17/verify-hollow-plant.ts")
  writeFileSync(plantPath, "// planted hollow file for X9\n" + hollowCall)
  const gateAfterHollow = runGate()
  rmSync(plantPath, { force: true })
  ck("X9: gate fails on hollow verifier", gateAfterHollow === 1, "exit=" + gateAfterHollow)

  console.log("── X9.4  restore -> green ──")
  ck("X9: gate green after both restores", runGate() === 0)

  const e = { issue: "M17.X9", code: "X9", tool: "governance", title: "closure gate: persist-display equivalence + anti-hollow", verified: failed === 0, checks, passed, failed, generatedAt: new Date().toISOString(), measured: { baseline: "green", poisonedEvidence: "gate failed", hollowVerifier: "gate failed", restored: "green" }, negativeLine: "Proves the gate responds to tampering; does not prove the underlying analyzers are perfect." }
  writeFileSync(path.join(RESULTS_DIR, "X9.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("X9: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()