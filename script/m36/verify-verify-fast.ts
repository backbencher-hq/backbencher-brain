// script/m36/verify-verify-fast.ts — M36.S2.
//
// CI enforcement gate. Proves that the runner-certified verification
// discipline is actually WIRED for enforcement:
//   A. package.json defines `verify:fast` containing exactly the certified
//      set — and nothing else (a removed gate or a smuggled-in gate that can
//      never run on a runner both fail). The set has two tiers, each with a
//      stated certification basis:
//        - 21 fresh-HOME-certified gates (M30×6, M32×6, M33×6, M34×3).
//        - 3 runner-proven additions: M29 R1/R4 (observed green on
//          ubuntu-latest in CI run 34774391788) and M56 governance
//          (HOME-independent: it reads plan/ledger/git metadata only, and is
//          green in a runner-faithful checkout with no website deps).
//      A leg that needs website deps, a built site, a display, the packaged
//      VSIX, or ffmpeg is NOT eligible, however green it is on a dev box —
//      those live in the verify-site job or the local `npm run verify` chain.
//   B. .github/workflows/ci.yml has a `verify` job that runs verify:fast
//      on ubuntu-latest with npm ci and EXPLICITLY installs groff + man-db
//      (absent from runner images; silently skipping the man-page gate is
//      forbidden). Mutant: job pointed at full `npm run verify` (contains
//      machine-specific legs, can never pass on a runner) must be caught.
//   C. The pre-existing `build` job is byte-structure intact: exactly the
//      3-node matrix with checkout → setup-node(cache) → npm ci → typecheck
//      → build → `npm test` (the S1 repair), in that order. Mutant: a step
//      removed/reordered must be caught.
//   D. Spot-proof that listed gates are real executors: the two cheapest
//      gates run green right now (the full 21-gate chain is proven green in
//      the S2 closing evidence and enforced live by CI itself; re-running
//      ~13 minutes of gates inside this verifier would duplicate CI).
//
// Run: npx tsx script/m36/verify-verify-fast.ts
// Evidence: validation/m36/results/S2.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m36/results")
const EVIDENCE_PATH = path.join(RESULTS, "S2.json")

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

// The runner-certified gate set. Tier 1 (21 gates) is the exact list
// fresh-HOME-certified in the M36.S2 certification runs; tier 2 (the last 3)
// is the runner-proven additions documented in the header. Keep in sync with
// package.json — that equality is check A.
const CERTIFIED_GATES = [
  "script/m30/verify-governance.ts",
  "script/m30/verify-setup.ts",
  "script/m30/verify-first-run-hook.ts",
  "script/m30/verify-key-validation.ts",
  "script/m30/verify-rate-limit.ts",
  "script/m30/verify-honesty-docs.ts",
  "script/m32/verify-governance.ts",
  "script/m32/verify-smoke.ts",
  "script/m32/verify-setup-show.ts",
  "script/m32/verify-doctor.ts",
  "script/m32/verify-doctor-fix.ts",
  "script/m32/verify-honesty-docs.ts",
  "script/m33/verify-governance.ts",
  "script/m33/verify-version.ts",
  "script/m33/verify-unknown-command.ts",
  "script/m33/verify-man-page.ts",
  "script/m33/verify-help-parity.ts",
  "script/m33/verify-honesty-docs.ts",
  "script/m34/verify-governance.ts",
  "script/m34/verify-install-smoke.ts",
  "script/m34/verify-script-gate.ts",
  // Tier 2 — runner-proven additions (basis stated in the header). Each is
  // HOME-independent and free of website/display/VSIX/ffmpeg prerequisites.
  "script/m29/verify-wave-protocol.ts",
  "script/m29/verify-precision-ledger.ts",
  "script/m56/verify-governance.ts",
  // Tier 3 — the bb_security suite (2026-09-30). These six ran on a clean
  // checkout with no HOME state: every fixture is built in mkdtemp and every
  // index is written under the system tmpdir, so nothing depends on a
  // pre-existing index, a corpus, a display, or a built dist/. The two legs
  // that WOULD need something absent are gated rather than failed — X5's
  // real-repository scan records `skipped` when no corpus is on the box, and
  // the CLI parity leg in m20/verify-security-history.ts skips when dist/ is
  // unbuilt.
  //
  // They belong in verify:fast rather than in a separate path-filtered job
  // specifically because of WHERE the evidence comes from. Every taint row is
  // written by src/ast/parallel-indexer.ts and matched by src/ast/
  // taint-analyzer.ts, so a change to either can silently change what
  // bb_security reports. A job filtered to security/ files would not run when
  // the indexer changes — which is precisely when it must.
  //
  // Measured wall-clock on the reference box: regressions 76s, verify-security
  // 27s, S1 21s, S2 34s, S3 35s, X1-X8 165s = ~6 min total.
  "script/m15/verify-security-regressions.ts",
  "script/m15/verify-security-precision.ts",
  "script/verify-security.ts",
  "script/m20/verify-security-flow-boundary.ts",
  "script/m20/verify-security-adversarial.ts",
  "script/m20/verify-security-history.ts",
  "script/m15/verify-security-deep.ts",
]

// ── KNOWN DRIFT, NOT REPAIRED HERE (2026-09-30) ────────────────────────────
//
// Check A below compares this list against `verify:fast`. That comparison was
// ALREADY failing before the security gates were added, and this gate does not
// itself run in CI (it is in the local-only `verify` chain), so the drift went
// unnoticed. Measured at HEAD, before any change here:
//
//   verify:fast listed 30 · certified 24
//   in verify:fast but NOT certified:  m42/verify-governance,
//     m44/verify-governance, m45/verify-governance, m45/verify-capture-harness,
//     m45/verify-d1, m45/verify-site-embed, m63/verify-cl1-wiring
//   certified but NOT in verify:fast:  m56/verify-governance
//
// Two distinct problems, and neither is repaired by editing this list:
//
//  1. Seven lanes added gates to `verify:fast` without adding them here. The
//     list cannot certify what it does not know about.
//  2. `m45/verify-d1` and `m45/verify-site-embed` are in `verify:fast` but the
//     CI job comment states site-dependent gates belong to the separate
//     `verify-site` job. Both FAIL without a built site.
//
// Running the seven on the reference box (2026-09-30): six exit non-zero. So
// `verify:fast` — the chain the CI `verify` job runs — is RED on that box, for
// reasons that predate this work and belong to the lanes that added them.
//
// This comment is the record. The fix is per-lane: each owning lane certifies
// or removes its own gate, and the two site-dependent ones move to
// `verify-site`. Adding security's six here does not make that worse, and
// deliberately does not paper over it.

function extractVerifyFast(pkgText: string): string[] {
  try {
    const s = JSON.parse(pkgText).scripts?.["verify:fast"] ?? ""
    return [...s.matchAll(/(script\/[a-z0-9/-]+\.ts)/g)].map((m) => m[1])
  } catch {
    return []
  }
}

// Extract a job's full block: from its `  <job>:` header line to the next
// 2-space-indented key (or EOF). A regex alternation on indented lines breaks
// on blank lines inside the job (the block silently truncates at the first
// empty line) — line-based splitting is robust.
function jobBlock(yamlText: string, job: string): string {
  const lines = yamlText.split("\n")
  const start = lines.findIndex((l) => l === `  ${job}:`)
  if (start === -1) return ""
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

console.log("M36.S2 verify-fast wiring gate")

// ---------------------------------------------------------------------------
// A. verify:fast contains exactly the certified set
// ---------------------------------------------------------------------------

const pkgText = readFileSync(path.join(ROOT, "package.json"), "utf8")
const listed = extractVerifyFast(pkgText)
check("A: verify:fast exists in package.json", listed.length > 0)
check("A: verify:fast lists exactly the certified gates", listed.length === CERTIFIED_GATES.length && CERTIFIED_GATES.every((g) => listed.includes(g)), `listed=${listed.length}`)
check("A: every certified gate file exists in the repo", CERTIFIED_GATES.every((g) => existsSync(path.join(ROOT, g))))
check("A: verify:fast uses tsx (CI runners have no bun)", (JSON.parse(pkgText).scripts?.["verify:fast"] ?? "").startsWith("npx tsx "))

// ---------------------------------------------------------------------------
// B. The CI verify job
// ---------------------------------------------------------------------------

const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")
const verifyBlock = jobBlock(ci, "verify")
check("B: ci.yml defines a verify job", verifyBlock.length > 0)
check("B: verify job runs on ubuntu-latest", verifyBlock.includes("runs-on: ubuntu-latest"))
check("B: verify job runs verify:fast (the certified subset)", verifyBlock.includes("npm run verify:fast"))
check("B: verify job does NOT run the full machine-specific verify chain", !/run:\s*npm run verify\s*$/.test(verifyBlock))
check("B: verify job explicitly installs groff", /apt-get[^\n]*install[^\n]*groff/.test(verifyBlock))
check("B: verify job explicitly installs man-db", /apt-get[^\n]*install[^\n]*man-db/.test(verifyBlock))
check("B: verify job installs deps with npm ci", verifyBlock.includes("npm ci"))
check("B: verify job has a timeout", /timeout-minutes:\s*\d+/.test(verifyBlock))

// ---------------------------------------------------------------------------
// C. The build job is byte-structure intact (co-agent surface untouched)
// ---------------------------------------------------------------------------

const buildBlock = jobBlock(ci, "build")
const buildRuns = [...buildBlock.matchAll(/run:\s*(.+)/g)].map((m) => m[1].trim())
check("C: build job has the 4 run steps + 2 action steps", buildRuns.length === 4 && buildBlock.includes("actions/checkout@v4") && buildBlock.includes("actions/setup-node@v4"), buildRuns.join(" | "))
check("C: build job steps in exact order", buildRuns[0] === "npm ci" && buildRuns[1] === "npx tsc --noEmit" && buildRuns[2] === "npm run build" && buildRuns[3] === "npm test")
check("C: build job keeps the 3-node matrix", buildBlock.includes("node-version: [18, 20, 22]"))
check("C: build job keeps setup-node npm cache", buildBlock.includes('cache: "npm"'))

// ---------------------------------------------------------------------------
// Mutants — each wiring defect must be caught
// ---------------------------------------------------------------------------

function mutant(label: string, plant: () => boolean): void {
  let caught = false
  try {
    caught = plant()
  } catch {
    caught = false
  }
  mutants.push({ name: label, caught })
  check(`mutant [${label}] caught`, caught, caught ? "" : "survived")
}

// M1: a gate silently dropped from verify:fast.
mutant("gate removed from verify:fast goes undetected", () => {
  const fewer = extractVerifyFast(JSON.stringify({ scripts: { "verify:fast": "npx tsx " + CERTIFIED_GATES.slice(1).join(" && npx tsx ") } }))
  return fewer.length !== CERTIFIED_GATES.length // the gate's own A-check detects it
})
// M2: the job pointed at the full chain instead of the certified subset.
mutant("verify job pointed at full machine-specific chain goes undetected", () => {
  const fake = verifyBlock.replace("npm run verify:fast", "npm run verify")
  return /run:\s*npm run verify\s*$/.test(fake) // the gate's own B-check detects it
})
// M3: groff install dropped (man-page gate would die or be skipped).
mutant("groff install removed from verify job goes undetected", () => {
  const fake = verifyBlock.replace(/      - name: Install man-page tooling[^\n]*\n        run: sudo apt-get update && sudo apt-get install -y groff man-db\n/, "")
  return !/apt-get[^\n]*install[^\n]*groff/.test(fake) // the gate's own B-check detects it
})
// M4: build job drift (a step removed).
mutant("build job step removal goes undetected", () => {
  const fake = buildBlock.replace("      - name: Typecheck\n        run: npx tsc --noEmit\n", "")
  const runs = [...fake.matchAll(/run:\s*(.+)/g)].map((m) => m[1].trim())
  return runs.length !== 4 // the gate's own C-check detects it
})
// M5 (positive control): the real wiring passes the same predicates.
mutant("real wiring rejected (false positive)", () => {
  const realOk = extractVerifyFast(pkgText).length === CERTIFIED_GATES.length
    && /apt-get[^\n]*install[^\n]*groff/.test(verifyBlock)
    && buildRuns.length === 4
  return realOk
})

// ---------------------------------------------------------------------------
// D. Spot-proof: two cheapest listed gates run green right now
// ---------------------------------------------------------------------------

for (const gate of ["script/m33/verify-version.ts", "script/m34/verify-script-gate.ts"]) {
  const r = spawnSync("npx", ["tsx", gate], { cwd: ROOT, encoding: "utf8", timeout: 300000 })
  const out = `${r.stdout}${r.stderr}`
  check(`D: spot-run ${path.basename(gate)} is green`, r.status === 0 && out.includes("VERDICT: PASS"), out.split("\n").find((l) => l.includes("FAIL")) ?? `exit=${r.status}`)
  // Self-recording gates rewrote their evidence file at this HEAD; restore
  // the committed pin so the closed milestones' one-shared-commit invariant
  // stays intact.
  try {
    execFileSync("git", ["checkout", "--", `validation/${gate.includes("m33") ? "m33" : "m34"}/results/`], { cwd: ROOT, stdio: "ignore" })
  } catch {}
}

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
  issue: "M36.S2",
  code: "S2",
  milestone: "M36",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m36/verify-verify-fast.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The verify:fast chain was proven green locally (in two halves at one commit, recorded in the closing issue); this verifier proves the WIRING and spot-runs the two cheapest gates — re-running ~13 minutes of gates here would duplicate what CI now enforces on every push.",
    "Tier-2 certification is per-gate and stated in the header; it is runner-observed (M29 R1/R4: CI run 34774391788 on ubuntu-latest) or runner-faithful-local (M56 governance: HOME-independent metadata gate). It is not a fresh-HOME run, and the check does not claim one.",
    "Legs that a runner cannot satisfy (website deps, built site, display, packaged VSIX, ffmpeg) are excluded by contract and live in the verify-site job or the local full chain; the A-check rejects them here even if they are green on a developer machine.",
    "Runner certification (fresh-HOME) was empirical at S2 build time; a future runner-image change that breaks a gate will surface as a red CI verify job, not a silent pass.",
    "The build job check asserts byte-structure (steps, order, matrix, cache), not raw bytes; any real edit to the build job changes one of the asserted facts.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
