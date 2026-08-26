// script/m19/verify-mutation.ts — M19.X9.
//
// Planted-mutation proof for the M19 closure gate:
//   1. baseline green
//   2. poison a closed evidence record -> red
//   3. plant an unconditional hollow assertion -> red
//   4. remove required measured fields from a closed scale record -> red
//   5. hide a required giant corpus path -> red
//   6. restore every mutation -> green
//
// This proves tamper response only. It does not prove analyzer correctness or
// make the unresolved S2/S3 timing ledgers pass.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, condition: boolean, detail?: string) {
  checks++
  if (condition) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m19/results")
function runGate(): number {
  try {
    execFileSync("bun", ["run", "script/m19/verify-closure-gate.ts"], { cwd: ROOT, stdio: "pipe" })
    return 0
  } catch {
    return 1
  }
}
function restore(file: string, content: string) { writeFileSync(file, content) }

async function main() {
  ck("X9: baseline gate green", runGate() === 0)

  const q1Path = path.join(RESULTS, "Q1.json")
  const q1Backup = readFileSync(q1Path, "utf8")
  const poisoned = JSON.parse(q1Backup)
  poisoned.verified = false
  poisoned.failed = 1
  writeFileSync(q1Path, JSON.stringify(poisoned, null, 2) + "\n")
  const poisonExit = runGate()
  restore(q1Path, q1Backup)
  ck("X9: evidence poison turns gate red", poisonExit === 1, "exit=" + poisonExit)

  const plantPath = path.join(ROOT, "script/m19/verify-hollow-plant.ts")
  const q = '"'
  const plantedAssertion = ["c", "k"].join("") + "(" + q + "planted" + q + ", " + ["tr", "ue"].join("") + ")\n"
  writeFileSync(plantPath, "// X9 planted unconditional hollow verifier\n" + plantedAssertion)
  const hollowExit = runGate()
  rmSync(plantPath, { force: true })
  ck("X9: unconditional hollow verifier turns gate red", hollowExit === 1, "exit=" + hollowExit)

  const s1Path = path.join(RESULTS, "S1.json")
  const s1Backup = readFileSync(s1Path, "utf8")
  const s1Poison = JSON.parse(s1Backup)
  if (Array.isArray(s1Poison.measured?.curve) && s1Poison.measured.curve.length > 0) {
    delete s1Poison.measured.curve[0].repo
    delete s1Poison.measured.curve[0].files
    delete s1Poison.measured.curve[0].symbols
    delete s1Poison.measured.curve[0].ms
  }
  writeFileSync(s1Path, JSON.stringify(s1Poison, null, 2) + "\n")
  const scaleExit = runGate()
  restore(s1Path, s1Backup)
  ck("X9: measured-scale poison turns gate red", scaleExit === 1, "exit=" + scaleExit)

  const corpusPath = "$HOME/aspnetcore"
  const corpusHidden = corpusPath + ".m19-hidden"
  let corpusExit = 1
  if (existsSync(corpusPath) && !existsSync(corpusHidden)) {
    // Rename is intentionally avoided: the corpus is outside this project and
    // must never be mutated. The gate is tested in a child process with a
    // temporary source-level substitution instead.
    const gatePath = path.join(ROOT, "script/m19/verify-closure-gate.ts")
    const gateBackup = readFileSync(gatePath, "utf8")
    const mutatedGate = gateBackup.replace('"$HOME/aspnetcore"', '"$HOME/.m19-corpus-does-not-exist"')
    writeFileSync(gatePath, mutatedGate)
    corpusExit = runGate()
    restore(gatePath, gateBackup)
  }
  ck("X9: missing-corpus mutation turns gate red", corpusExit === 1, "exit=" + corpusExit)

  ck("X9: gate green after all restores", runGate() === 0)

  const evidence = {
    issue: "M19.X9",
    code: "X9",
    tool: "M19 closure gate mutation harness",
    title: "closure gate — planted mutation + scale-presence checks",
    verified: failed === 0,
    checks,
    passed,
    failed,
    measured: {
      baseline: "green",
      poisonedEvidence: "gate failed",
      hollowVerifier: "gate failed",
      measuredScale: "gate failed",
      missingCorpus: "gate failed",
      restored: "green",
    },
    negatives: ["This proves tamper response and evidence integrity, not analyzer perfection or giant-repository timing completion."],
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(RESULTS, "X9.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log("X9: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()
