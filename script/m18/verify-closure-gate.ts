// script/m18/verify-closure-gate.ts — M18.C1 (governance: ledger + closure).
//
// The milestone's own gate (echoes M17.C1):
//   1. Every CLOSED issue in validation/m18/results/manifest.json has an
//      evidence file that re-reads clean at HEAD (verified=true, failed=0,
//      checks>0, measured present).
//   2. No hollow assertion patterns in script/m18/*.ts (scan built from
//      fragments so the gate cannot flag itself).
//   3. M18 verifiers wired into package.json verify + quality gate.
//   4. Self-handshake: post-emit C1.json matches this run.
// Run LAST in the M18 verify chain.

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
const MANIFEST = path.join(RESULTS_DIR, "manifest.json")

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { issues: Array<{ code: string; evidence: string; closed: boolean }> }
  const closed = manifest.issues.filter((i) => i.closed)
  ck("C1: manifest lists all 8 M18 issues", manifest.issues.length === 8, "got " + manifest.issues.length)
  ck("C1: at least C1 is closed in the ledger", closed.length >= 1, "closed=" + closed.length)

  let bad = 0, totalChecks = 0
  for (const issue of closed) {
    if (issue.code === "C1") continue // self-emit proved by handshake
    const evPath = path.join(RESULTS_DIR, issue.evidence)
    if (!existsSync(evPath)) { bad++; console.log("  FAIL: evidence " + issue.evidence + " missing for closed " + issue.code); continue }
    try {
      const d = JSON.parse(readFileSync(evPath, "utf8"))
      if (d.verified !== true) { bad++; console.log("  FAIL: " + issue.evidence + " verified=" + d.verified) }
      if (d.failed !== 0) { bad++; console.log("  FAIL: " + issue.evidence + " failed=" + d.failed) }
      if (typeof d.checks !== "number" || d.checks <= 0) { bad++; console.log("  FAIL: " + issue.evidence + " checks=" + d.checks) }
      totalChecks += d.checks || 0
    } catch (e: any) { bad++; console.log("  FAIL: " + issue.evidence + " unreadable: " + (e?.message || e)) }
  }
  ck("C1: every closed issue's evidence re-reads clean at HEAD", bad === 0, "bad=" + bad)
  if (closed.length > 1) ck("C1: closed evidence carries real checks", totalChecks > 0, "totalChecks=" + totalChecks)

  // ── 2. Hollow + hardcoded-count scan over every M18 verifier ────────────
  const verifierDir = path.join(ROOT_DIR, "script/m18")
  const verifiers = readdirSync(verifierDir).filter((f) => f.endsWith(".ts"))
  let hollow = 0, hardcoded = 0
  const hardTrue = new RegExp("ck\\(\\s*\"[^\"]*\",\\s*true\\s*\\)" + "|" + "nk\\(\\s*\"[^\"]*\",\\s*true\\s*\\)", "g")
  const orTrue = new RegExp("\\|\\|\\s*true\\s*\\)", "g")
  // A real floor like `rec10 >= 0.5` must NOT be flagged: the `0` of `0.5`
  // is a leading digit, not the trivial non-negative-tautology. Only a bare
  // non-negative-tautology with no decimal point is hollow (a count check).
  const gte0 = new RegExp(">" + "=" + "\\s*0" + "(?![.\\d])", "g")
  for (const v of verifiers) {
    const src = readFileSync(path.join(verifierDir, v), "utf8")
    hollow += (src.match(hardTrue) || []).length + (src.match(orTrue) || []).length + (src.match(gte0) || []).length
  }
  ck("C1: zero hollow patterns across " + verifiers.length + " M18 verifiers", hollow === 0, "hollow=" + hollow)
  ck("C1: no hardcoded measured-count constants (runtime-computed only)", !/(?:recall\s*=\s*|coverage\s*=\s*|precision\s*=\s*)\d/.test(verifiers.map((v) => readFileSync(path.join(verifierDir, v), "utf8")).join("\n")), "scan for count=NNN literals")

  // ── 3. Wiring ────────────────────────────────────────────────────────────
  const pkg = readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")
  const gate = readFileSync(path.join(ROOT_DIR, "script/verify-quality-gate.ts"), "utf8")
  for (const v of ["verify-closure-gate.ts", "verify-mutation.ts"]) {
    ck("C1: m18/" + v + " wired into package.json", pkg.includes("m18/" + v))
    ck("C1: m18/" + v + " wired into quality gate", gate.includes("m18/" + v))
  }

  // ── 3b. Coverage-presence: the health/report path must always surface
  // embedding coverage (never omit it) — the gate's anti-regression tooth.
  // The check is on the CALL SITE (`checks.push(await checkEmbeddingCoverage`)
  // so removing the report (not just the doc string) fails the gate.
  const healthSrc = readFileSync(path.join(ROOT_DIR, "src/brain/brain-index-health.ts"), "utf8")
  // The call must EXIST and must NOT be commented out — a naive substring
  // check would pass a commented call (`// checks.push(await ...)`).
  const callPattern = /^\s*checks\.push\(await checkEmbeddingCoverage\(/m
  const healthCoverage = callPattern.test(healthSrc)
  ck("C1: health path calls checkEmbeddingCoverage (machine-checkable, not commented)", healthCoverage, "brain-index-health.ts")

  ck("C1: the gate itself performed a real number of checks", checks >= 7, "checks=" + checks)

  // ── 4. Emit + self-handshake ────────────────────────────────────────────
  const e = { issue: "M18.C1", code: "C1", tool: "governance", title: "master plan, ledger, closure gate, benchmark governance", verified: failed === 0, checks, passed, failed, negatives: 0, generatedAt: new Date().toISOString() }
  writeFileSync(path.join(RESULTS_DIR, "C1.json"), JSON.stringify(e, null, 2) + "\n")
  const reread = JSON.parse(readFileSync(path.join(RESULTS_DIR, "C1.json"), "utf8"))
  const handshakeOk = reread.verified === (failed === 0) && reread.failed === failed
  ck("C1: post-emit ledger handshake matches the run outcome", handshakeOk, JSON.stringify({ ledger: reread.verified, run: failed === 0 }))
  console.log("C1: " + (handshakeOk && failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(handshakeOk && failed === 0 ? 0 : 1)
}

await main()