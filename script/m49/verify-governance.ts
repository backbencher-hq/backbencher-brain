// script/m49/verify-governance.ts — M49.G1: governance for the Review-Intake
// & Gate-Hardening milestone.
//
// Charter (established with the user 2026-09-08): reviewers keep finding real
// defects in analyzers declared "done" — because each new review brings a lens
// the standing gates do not cover. M49 formalizes the loop:
//
//   reviews/<lang>/  →  verify claims (code + live parse)  →  fix + oracle
//   mirror  →  fixture + mutant + spec decision  →  gates extended family-wide
//   →  onboarding board updated  →  m37/m14 inherit the hardened gates.
//
// Enforced here:
//   1. Ledger: R-codes present, statuses legal, verified statuses carry
//      conforming on-disk evidence — no fabricated verified.
//   2. Coverage: every reviews/<lang>/ folder is tracked by the onboarding
//      board AND by R1 (the intake gate exists and runs).
//   3. Registry wiring: every on-disk script/m49 verifier is registered in
//      this file's check list (a stray verifier is a failure).
//   4. Chain wiring: package.json "verify" runs M49 gates.
//   5. Auto-pass audit: no hardcoded-true check/negative calls and no
//      boolean-or-true escapes anywhere in M49 verifiers.
//
// Run: bun script/m49/verify-governance.ts
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const M49_DIR = path.join(ROOT, "script/m49")
const LEDGER_PATH = path.join(ROOT, "validation/m49/ledger.json")
const REVIEWS = path.join(ROOT, "reviews")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

const REQUIRED_CODES = ["G1", "R1", "R2", "X1"]
const ALLOWED_STATUS = ["pending", "verified", "known-gap", "blocked"]

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

function main() {
  // --- 1. Ledger -----------------------------------------------------------
  check("ledger exists", existsSync(LEDGER_PATH))
  if (!existsSync(LEDGER_PATH)) return finish()
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  const issues: Array<Record<string, unknown>> = ledger.issues ?? []
  const ids = issues.map((i) => String(i.id))
  for (const code of REQUIRED_CODES) {
    check(`ledger has ${code}`, ids.includes(code))
  }
  // M49.J3: wave-code entries (J1/K1/S1/… — the per-reviewer-wave ledger rows
  // that the intake protocol appends as waves close) are LEGAL alongside the
  // required G1/R1/R2/X1 scaffold codes. They must still satisfy the same
  // status/evidence checks below. Anything that is neither a required code nor
  // a known wave-code shape fails.
  const WAVE_CODE = /^[JKSCEPGVTRHD][0-9]+$/
  check("ledger has no extra codes", issues.every((i) => REQUIRED_CODES.includes(String(i.id)) || WAVE_CODE.test(String(i.id))),
    `extras: ${ids.filter((x) => !REQUIRED_CODES.includes(x) && !WAVE_CODE.test(x)).join(",")}`)
  for (const i of issues) {
    const status = String(i.status)
    check(`${i.id} status legal`, ALLOWED_STATUS.includes(status), status)
    if (status === "verified") {
      check(`${i.id} verified carries evidence`, typeof i.evidenceFile === "string" && existsSync(path.join(ROOT, String(i.evidenceFile))),
        `evidenceFile: ${i.evidenceFile ?? "missing"}`)
      check(`${i.id} verified at a commit`, typeof i.verifiedAtCommit === "string" && /^[0-9a-f]{7,40}$/.test(String(i.verifiedAtCommit)))
    }
  }

  // --- 2. Coverage ---------------------------------------------------------
  const langDirs = existsSync(REVIEWS)
    ? readdirSync(REVIEWS).filter((f) => f !== "onboarding.md" && !f.startsWith("."))
    : []
  const board = existsSync(path.join(REVIEWS, "onboarding.md"))
    ? readFileSync(path.join(REVIEWS, "onboarding.md"), "utf8") : ""
  for (const lang of langDirs) {
    check(`onboarding board tracks ${lang}`, board.includes(`reviews/${lang}`))
  }
  check("R1 intake gate exists on disk", existsSync(path.join(M49_DIR, "verify-r1-intake.ts")))
  check("R2 regex gate exists on disk", existsSync(path.join(M49_DIR, "verify-r2-regex.ts")))

  // --- 3. Verifier registry wiring ----------------------------------------
  const onDisk = readdirSync(M49_DIR).filter((f) => /^verify-.*\.ts$/.test(f)).sort()
  const governanceSrc = readFileSync(__filename, "utf8")
  const registered = ["verify-governance.ts", "verify-r1-intake.ts", "verify-r2-regex.ts", "verify-closure.ts", "verify-evidence-lineage.ts"]
  for (const f of onDisk) {
    check(`verifier ${f} is registered in governance`, registered.includes(f))
  }

  // --- 4. Chain wiring ------------------------------------------------------
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const verifyScript = String(pkg.scripts?.verify ?? "")
  check("package.json verify runs M49 governance", verifyScript.includes("script/m49/verify-governance.ts"))
  check("package.json verify runs M49 R1", verifyScript.includes("script/m49/verify-r1-intake.ts"))
  check("package.json verify runs M49 R2", verifyScript.includes("script/m49/verify-r2-regex.ts"))

  // --- 5. Auto-pass audit ----------------------------------------------------
  for (const f of onDisk) {
    const src = readFileSync(path.join(M49_DIR, f), "utf8")
    negative(`${f} free of auto-pass literals`, !/,\s*true\s*\)/.test(src) && !/\|\|\s*true/.test(src))
  }

  finish()
}

function finish() {
  console.log(`M49.G1: ${passed} passed, ${failed} failed, ${negatives} negative(s) exercised @ ${currentCommit().slice(0, 10)}`)
  if (failed > 0) {
    console.error(`governance FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

main()
