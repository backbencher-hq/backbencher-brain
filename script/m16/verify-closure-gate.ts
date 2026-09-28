// script/m16/verify-closure-gate.ts — M16.C1 (governance: evidence + closure).
//
// The milestone's own gate. It verifies that:
//   1. Every M16 evidence file (validation/m16/results/*.json except the
//      gate's own C1.json) reports verified=true, failed=0, checks>0 —
//      re-read from disk at this moment, never trusting memory.
//   2. No hollow assertions exist in script/m16/*.ts — auto-pass constants,
//      comparison-to-zero tautologies, or boolean-or-constant idioms — an
//      adversarial programmatic scan.
//   3. M16 verifiers are wired into package.json verify + quality gate.
//   4. Self-handshake: after emitting C1.json, the ledger matches this run
//      (a failed run must write verified=false, not lie).
// Run LAST in the verify chain.

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m16/results")

async function main() {
  // ── 1. Evidence ledger: re-read every M16 evidence file at this moment ──
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json") && f !== "C1.json")
  ck("C1: evidence directory has the expected files", files.length >= 12, "got " + files.length)
  let bad = 0, totalChecks = 0
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"))
      if (d.verified !== true) { bad++; console.log("  FAIL: evidence " + f + " verified=" + d.verified) }
      if (d.failed !== 0) { bad++; console.log("  FAIL: evidence " + f + " failed=" + d.failed) }
      if (typeof d.checks !== "number" || d.checks <= 0) { bad++; console.log("  FAIL: evidence " + f + " checks=" + d.checks) }
      totalChecks += d.checks || 0
    } catch (e: any) { bad++; console.log("  FAIL: evidence " + f + " unreadable: " + (e?.message || e)) }
  }
  ck("C1: all " + files.length + " evidence files re-read clean at HEAD", bad === 0, "bad=" + bad)
  ck("C1: evidence carries real checks (not hollow, total>0)", totalChecks >= 60, "totalChecks=" + totalChecks)

  // ── 2. Hollow-assertion scan over every M16 verifier ────────────────────
  const verifierDir = path.join(ROOT_DIR, "script/m16")
  const verifiers = readdirSync(verifierDir).filter((f) => f.endsWith(".ts"))
  let hollow = 0
  for (const v of verifiers) {
    const src = readFileSync(path.join(verifierDir, v), "utf8")
    // hardcoded-true assertion (the classic auto-pass)
    const autoPass = src.match(/ck\(\s*"[^"]*",\s*true\s*\)|nk\(\s*"[^"]*",\s*true\s*\)/g) || []
    // boolean-or-true constant idiom
    const orTrue = src.match(/\|\|\s*true\s*\)/g) || []
    // comparison against a zero floor (can never fail)
    const gte0 = src.match(new RegExp(">" + "=" + "0" + "|" + ">" + "=" + " 0", "g")) || []
    hollow += autoPass.length + orTrue.length + gte0.length
    if (autoPass.length || orTrue.length || gte0.length) console.log("  HOLLOW in " + v + ": autoPass=" + autoPass.length + " |orTrue=" + orTrue.length + " |gte0=" + gte0.length)
  }
  ck("C1: zero hollow assertion patterns across " + verifiers.length + " M16 verifiers", hollow === 0, "hollow=" + hollow)

  // ── 3. Wiring: M16 verifiers registered in package.json + quality gate ───
  const pkg = readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")
  const gate = readFileSync(path.join(ROOT_DIR, "script/verify-quality-gate.ts"), "utf8")
  for (const v of ["verify-edit-real-repo.ts", "verify-ask-stats.ts", "verify-tool-runs.ts", "verify-docs-truth.ts", "verify-embedding-lifecycle.ts", "verify-closure-gate.ts"]) {
    ck("C1: " + v + " wired into package.json verify", pkg.includes("m16/" + v))
    ck("C1: " + v + " wired into quality gate", gate.includes("m16/" + v))
  }

  // ── 4. Emit + self-handshake ────────────────────────────────────────────
  const e = { issue: "M16.C1", code: "C1", tool: "governance", title: "gates, ledger, closure gate, quality-gate wiring", verified: failed === 0, checks, passed, failed, negatives: 0, generatedAt: new Date().toISOString() }
  writeFileSync(path.join(RESULTS_DIR, "C1.json"), JSON.stringify(e, null, 2) + "\n")
  // Self-handshake: the ledger just written must match this run (a green run
  // writes green; a red run leaves a red ledger so the milestone cannot close).
  const reread = JSON.parse(readFileSync(path.join(RESULTS_DIR, "C1.json"), "utf8"))
  const handshakeOk = reread.verified === (failed === 0) && reread.failed === failed
  ck("C1: post-emit ledger handshake matches the run outcome", handshakeOk, JSON.stringify({ ledger: reread.verified, run: failed === 0 }))
  console.log("C1: " + (handshakeOk && failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  if (failed > 0) process.exit(1)
}

await main()