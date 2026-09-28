// script/m36/verify-ci-repair.ts — M36.S1.
//
// CI repair proof. Root cause (GitHub Actions run 33339778229 and every
// recent run): the setup-node cache step fails with "Dependencies lock file
// is not found" because package-lock.json was never committed; the workflow
// also runs `npm test`, but the package had no test script — a second latent
// defect that would have failed CI even with the lockfile present.
//
// This verifier proves, locally and hermetically:
//   A. the lockfile exists, parses, and is IN SYNC with package.json
//      (npm ci --dry-run exit 0);
//   B. mutant: a stale lockfile (dep added to package.json only) FAILS
//      npm ci — the exact guard that protects CI from drift;
//   C. mutant: a missing lockfile FAILS npm ci — the exact defect that
//      made every CI run red;
//   D. the repaired Test step: package.json has a test script, and it
//      passes (hermetic core verifiers, fresh HOME);
//   E. workflow sanity: the Test step still invokes `npm test` and ci.yml
//      has no uncommitted changes (repairs happen in package.json, not by
//      editing the workflow).
//
// The GREEN RUN on GitHub itself is recorded in the closing issue comment
// (time-variant URL, not machine evidence) — see docs/m36/M36-MASTER-PLAN.md.
//
// Run: npx tsx script/m36/verify-ci-repair.ts
// Evidence: validation/m36/results/S1.json (machine-emitted)

import { spawnSync, execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, copyFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m36/results")
const EVIDENCE_PATH = path.join(RESULTS, "S1.json")
const CI_YML = path.join(ROOT, ".github/workflows/ci.yml")

let checks = 0
let passed = 0
let failed = 0
const mutants: { name: string; caught: boolean }[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("M36.S1 CI-repair verifier")

// ---------------------------------------------------------------------------
// A. Lockfile present, valid, in sync with package.json
// ---------------------------------------------------------------------------

const lockPath = path.join(ROOT, "package-lock.json")
check("S1: package-lock.json exists in the repo", existsSync(lockPath))
let lockOk = false
let lockVersion = ""
try {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"))
  lockVersion = String(lock.lockfileVersion ?? "?")
  const pkgName = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).name
  lockOk = lock.name === pkgName && typeof lock.packages === "object"
} catch (e) {
  check("S1: lockfile parses", false, String(e))
}
check("S1: lockfile parses and carries the project identity", lockOk, `lockfileVersion=${lockVersion}`)

const ciSync = spawnSync("npm", ["ci", "--dry-run", "--no-audit", "--no-fund"], {
  cwd: ROOT, encoding: "utf8", timeout: 300000,
})
check("S1: npm ci --dry-run is green (lockfile in sync with package.json)", ciSync.status === 0, (ciSync.stderr ?? "").split("\n").filter((l) => l.includes("npm error")).slice(0, 2).join(" | "))

// ---------------------------------------------------------------------------
// B+C. Mutants in an isolated sandbox: the guards CI relies on must fire
// ---------------------------------------------------------------------------

const sandbox = mkdtempSync(path.join(os.tmpdir(), "m36-s1-"))
try {
  // B. Stale lockfile: dep added to package.json without updating the lock.
  //    Must be a REAL registry package — a fake name makes npm ci die with
  //    E404 (network) instead of the genuine EUSAGE sync error, which would
  //    let a network-broken runner "pass" the mutant for the wrong reason.
  const staleDir = path.join(sandbox, "stale")
  mkdirSync(staleDir)
  copyFileSync(path.join(ROOT, "package.json"), path.join(staleDir, "package.json"))
  copyFileSync(lockPath, path.join(staleDir, "package-lock.json"))
  const pkg = JSON.parse(readFileSync(path.join(staleDir, "package.json"), "utf8"))
  pkg.dependencies["left-pad"] = "1.3.0"
  writeFileSync(path.join(staleDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
  const stale = spawnSync("npm", ["ci", "--dry-run", "--no-audit", "--no-fund"], {
    cwd: staleDir, encoding: "utf8", timeout: 120000,
  })
  const staleErr = `${stale.stderr}${stale.stdout}`
  const staleCaught = stale.status !== 0 && /code EUSAGE/.test(staleErr) && /in sync/.test(staleErr)
  mutants.push({ name: "stale lockfile survives npm ci", caught: staleCaught })
  check("S1: mutant — stale lockfile is rejected by npm ci with the EUSAGE sync error", staleCaught, `exit=${stale.status} code=${/code (E\w+)/.exec(staleErr)?.[1] ?? "none"}`)

  // C. Missing lockfile: the original CI defect.
  const bareDir = path.join(sandbox, "bare")
  mkdirSync(bareDir)
  copyFileSync(path.join(ROOT, "package.json"), path.join(bareDir, "package.json"))
  const bare = spawnSync("npm", ["ci", "--dry-run", "--no-audit", "--no-fund"], {
    cwd: bareDir, encoding: "utf8", timeout: 120000,
  })
  const bareCaught = bare.status !== 0
  mutants.push({ name: "missing lockfile passes the cache step", caught: bareCaught })
  check("S1: mutant — missing lockfile is rejected by npm ci", bareCaught, `exit=${bare.status}`)
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// D. The repaired Test step: test script exists and passes hermetically
// ---------------------------------------------------------------------------

const pkgScripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {}
const testScript = String(pkgScripts["test"] ?? "")
check("S1: package.json defines the test script (was missing entirely)", testScript.includes("verify-engine") && testScript.includes("verify-schema") && testScript.includes("verify-tool-registry") && testScript.includes("verify-public-surface"), testScript.slice(0, 120))

const fh = mkdtempSync(path.join(os.tmpdir(), "m36-s1-home-"))
try {
  const t0 = Date.now()
  const testRun = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8", timeout: 600000, env: { ...process.env, HOME: fh } })
  const dur = Math.round((Date.now() - t0) / 1000)
  const out = `${testRun.stdout}${testRun.stderr}`
  check("S1: npm test is green under a fresh HOME (hermetic, runner-like)", testRun.status === 0, out.split("\n").filter((l) => /FAIL/i.test(l)).slice(0, 2).join(" | "))
  check("S1: npm test completes in CI-plausible time", dur < 240, `${dur}s`)
} finally {
  rmSync(fh, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// E. Workflow sanity: Test step unchanged in shape; ci.yml not hand-edited
// ---------------------------------------------------------------------------

check("S1: .github/workflows/ci.yml exists", existsSync(CI_YML))
const ci = existsSync(CI_YML) ? readFileSync(CI_YML, "utf8") : ""
check("S1: workflow Test step invokes npm test (repair satisfied it, not bypassed it)", /run:\s*npm test/.test(ci))
let ciClean = false
try {
  execFileSync("git", ["diff", "--exit-code", "--", ".github/workflows/ci.yml"], { cwd: ROOT, stdio: "ignore" })
  ciClean = true
} catch {}
check("S1: ci.yml carries no uncommitted changes at S1 time", ciClean)

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0 && mutants.every((m) => m.caught)
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
console.log(`  mutants: ${mutants.length}, survived: ${mutants.filter((m) => !m.caught).length}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const result = {
  issue: "M36.S1",
  code: "S1",
  milestone: "M36",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m36/verify-ci-repair.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "npm ci --dry-run proves lockfile/package.json sync without writing node_modules; the full install path is exercised in CI by the workflow's own npm ci step.",
    "The green GitHub Actions run is recorded by URL in the closing issue comment; it is time-variant and therefore not part of machine evidence.",
    "npm test runs the four hermetic core verifiers; the full verify chain (including machine-specific legs) is intentionally NOT the Test step (see verify:fast, M36.S2).",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
