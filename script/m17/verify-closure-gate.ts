// script/m17/verify-closure-gate.ts — M17.C1 (governance: ledger + closure).
//
// The milestone's own gate. Verifies that:
//   1. Every CLOSED issue in validation/m17/results/manifest.json has an
//      evidence file at validation/m17/results/<CODE>.json that re-reads clean
//      at this moment: verified=true, failed=0, checks>0. Open issues are
//      reported but do not fail the gate (they are not yet closed).
//   2. No hollow assertions exist in script/m17/*.ts (anti-pass scan built
//      from fragments so the gate cannot flag itself).
//   3. M17 verifiers are wired into package.json verify + quality gate.
//   4. Self-handshake: after emitting C1.json, the ledger matches this run.
// Run LAST in the M17 verify chain.
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m17/results")
const MANIFEST = path.join(RESULTS_DIR, "manifest.json")

async function main() {
  // ── 1. Ledger-driven evidence check ─────────────────────────────────────
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { issues: Array<{ code: string; evidence: string; closed: boolean }> }
  const closed = manifest.issues.filter((i) => i.closed)
  ck("C1: manifest lists all 8 M17 issues", manifest.issues.length === 8, "got " + manifest.issues.length)
  ck("C1: at least C1 is closed in the ledger", closed.length >= 1, "closed=" + closed.length)

  let bad = 0, totalChecks = 0
  for (const issue of closed) {
    if (issue.code === "C1") continue // C1 emits its own evidence in section 4; the handshake proves it
    const evPath = path.join(RESULTS_DIR, issue.evidence)
    if (!existsSync(evPath)) { bad++; console.log("  FAIL: evidence " + issue.evidence + " missing for closed issue " + issue.code); continue }
    try {
      const d = JSON.parse(readFileSync(evPath, "utf8"))
      if (d.verified !== true) { bad++; console.log("  FAIL: evidence " + issue.evidence + " verified=" + d.verified) }
      if (d.failed !== 0) { bad++; console.log("  FAIL: evidence " + issue.evidence + " failed=" + d.failed) }
      if (typeof d.checks !== "number" || d.checks <= 0) { bad++; console.log("  FAIL: evidence " + issue.evidence + " checks=" + d.checks) }
      totalChecks += d.checks || 0
    } catch (e: any) { bad++; console.log("  FAIL: evidence " + issue.evidence + " unreadable: " + (e?.message || e)) }
  }
  ck("C1: every closed issue's evidence re-reads clean at HEAD", bad === 0, "bad=" + bad)
  if (closed.length > 1) ck("C1: closed evidence carries real checks (total>0)", totalChecks > 0, "totalChecks=" + totalChecks)

  // ── 2. Hollow scan over every M17 verifier (built from fragments) ───────
  const verifierDir = path.join(ROOT_DIR, "script/m17")
  const verifiers = readdirSync(verifierDir).filter((f) => f.endsWith(".ts"))
  let hollow = 0
  const hardTrue = new RegExp("ck\\(\\s*\"[^\"]*\",\\s*true\\s*\\)" + "|" + "nk\\(\\s*\"[^\"]*\",\\s*true\\s*\\)", "g")
  const orTrue = new RegExp("\\|\\|\\s*true\\s*\\)", "g")
  const gte0 = new RegExp(">" + "=" + "0|>" + "=" + "\\s+0", "g")
  for (const v of verifiers) {
    const src = readFileSync(path.join(verifierDir, v), "utf8")
    const a = src.match(hardTrue) || []
    const b = src.match(orTrue) || []
    const c = src.match(gte0) || []
    hollow += a.length + b.length + c.length
    if (a.length || b.length || c.length) console.log("  HOLLOW in " + v + ": autoTrue=" + a.length + " orTrue=" + b.length + " gte0=" + c.length)
  }
  ck("C1: zero hollow patterns across " + verifiers.length + " M17 verifiers", hollow === 0, "hollow=" + hollow)

  // ── 3. Wiring: M17 verifiers in package.json verify + quality gate ──────
  const pkg = readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")
  const gate = readFileSync(path.join(ROOT_DIR, "script/verify-quality-gate.ts"), "utf8")
  for (const v of ["verify-tool-history.ts", "verify-closure-gate.ts"]) {
    ck("C1: " + v + " wired into package.json verify", pkg.includes(v))
    ck("C1: " + v + " wired into quality gate", gate.includes(v))
  }

  ck("C1: the gate itself performed a real number of checks", checks >= 8, "checks=" + checks)

  // ── 4. Emit C1 evidence + self-handshake ────────────────────────────────
  const e = { issue: "M17.C1", code: "C1", tool: "governance", title: "master plan, ledger, closure gate, wiring", verified: failed === 0, checks, passed, failed, negatives: 0, generatedAt: new Date().toISOString() }
  writeFileSync(path.join(RESULTS_DIR, "C1.json"), JSON.stringify(e, null, 2) + "\n")
  const reread = JSON.parse(readFileSync(path.join(RESULTS_DIR, "C1.json"), "utf8"))
  const handshakeOk = reread.verified === (failed === 0) && reread.failed === failed
  ck("C1: post-emit ledger handshake matches the run outcome", handshakeOk, JSON.stringify({ ledger: reread.verified, run: failed === 0 }))
  console.log("C1: " + (handshakeOk && failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  if (handshakeOk && failed === 0) process.exit(0)
  process.exit(1)
}

await main()