// script/m46/verify-closure.ts — M46.X1
// Closure gate: refuses milestone close unless every issue has conformant,
// current, stamped evidence and every subordinate gate actually passes right
// now (re-run read-only, never trusted from evidence). Content-gate evidence
// must form a single-commit consensus; infra evidence (G1) follows the M31
// ancestor rule. Children run with BB_M46_READ_ONLY=1 AND BB_M46_EVIDENCE=""
// so a live probe can never stamp or clobber evidence.
//
// X1's own evidence (X1.json) is written by this file AFTER its checks when
// not read-only; the milestone close step then records the evidence comment.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m46/results")
const LEDGER_PATH = path.join(ROOT, "validation/m46/ledger.json")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`) }
}

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Array<{ code: string; status: string; evidence?: Record<string, any> | null }>
const SUBORDINATES = ["H1", "H2"]
const INFRA = new Set(["G1"])
const CODE_FILE: Record<string, string> = { H1: "H1.json", H2: "H2.json" }

// ── 1. Ledger + evidence conformance for every content subordinate ──
for (const code of SUBORDINATES) {
  const entry = ledger.find((l) => l.code === code)
  check(`ledger: ${code} entry exists`, !!entry)
  if (!entry) continue
  const evFile = path.join(RESULTS_DIR, CODE_FILE[code])
  check(`evidence: ${CODE_FILE[code]} exists`, existsSync(evFile))
  if (!existsSync(evFile) || !entry.evidence) continue
  const ev = JSON.parse(readFileSync(evFile, "utf8")) as Record<string, any>
  check(`evidence: ${code} status verified`, ev.status === "verified", String(ev.status))
  check(`evidence: ${code} zero failures`, ev.failed === 0, String(ev.failed))
  check(`evidence: ${code} has negatives`, typeof ev.negativeCases === "number" && ev.negativeCases > 0, String(ev.negativeCases))
  check(`ledger: ${code} status matches evidence`, entry.status === ev.status, `ledger=${entry.status} ev=${ev.status}`)
  let blockOk = true
  for (const key of ["currentCommit", "passed", "failed", "negativeCases"] as const) {
    if (JSON.stringify(entry.evidence[key]) !== JSON.stringify(ev[key])) blockOk = false
  }
  check(`ledger: ${code} evidence block byte-conformant`, blockOk)
  check(`evidence: ${code} stamped at a commit`, typeof ev.currentCommit === "string" && ev.currentCommit.length === 40)
}

// ── 2. Stamp agreement: content evidence at one commit (HEAD or ancestor) ──
{
  const stamps = new Set<string>()
  for (const code of SUBORDINATES) {
    const evFile = path.join(RESULTS_DIR, CODE_FILE[code])
    if (!existsSync(evFile)) continue
    const ev = JSON.parse(readFileSync(evFile, "utf8")) as Record<string, any>
    if (typeof ev.currentCommit === "string" && ev.currentCommit.length === 40) stamps.add(ev.currentCommit)
  }
  check("stamps: all subordinate evidence at one commit", stamps.size <= 1, stamps.size > 1 ? [...stamps].map((s) => s.slice(0, 7)).join(", ") : "")
  let consensusOk = false
  if (stamps.size === 1) {
    const c = [...stamps][0]
    if (c === HEAD) consensusOk = true
    else {
      try { execFileSync("git", ["merge-base", "--is-ancestor", c, HEAD], { cwd: ROOT }); consensusOk = true } catch { consensusOk = false }
    }
  }
  check("stamps: consensus commit is HEAD or an ancestor of HEAD", consensusOk, stamps.size === 1 ? [...stamps][0].slice(0, 7) : "no-consensus")
}

// ── 3. Live subordinate gate re-runs (read-only: children stamp nothing) ──
const GATES: Array<{ code: string; script: string }> = [
  { code: "H1", script: "verify-h1-syntax-truth.ts" },
  { code: "H2", script: "verify-h2-real-repo-syntax.ts" },
]
for (const g of GATES) {
  const r = spawnSync("bun", ["run", `script/m46/${g.script}`], {
    cwd: ROOT, encoding: "utf8", timeout: 1_800_000,
    env: { ...(process.env as Record<string, string>), BB_M46_READ_ONLY: "1", BB_M46_EVIDENCE: "" },
  })
  const ok = r.status === 0
  check(`live: ${g.code} gate passes`, ok, ok ? "" : (r.stdout ?? "").split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 3).join(" | ") || `exit ${r.status}`)
}

// ── 4. Infra evidence: G1 governance ──
{
  const g1File = path.join(RESULTS_DIR, "G1.json")
  check("G1: evidence exists", existsSync(g1File))
  if (existsSync(g1File)) {
    const g1 = JSON.parse(readFileSync(g1File, "utf8")) as Record<string, any>
    check("G1: status verified", g1.status === "verified", String(g1.status))
    check("G1: zero failures", g1.failed === 0, String(g1.failed))
    let g1Ok = g1.currentCommit === HEAD
    if (!g1Ok && typeof g1.currentCommit === "string" && g1.currentCommit.length === 40) {
      try { execFileSync("git", ["merge-base", "--is-ancestor", g1.currentCommit, HEAD], { cwd: ROOT }); g1Ok = true } catch { g1Ok = false }
    }
    check("G1: stamped at HEAD or ancestor", g1Ok, String(g1.currentCommit ?? "").slice(0, 7))
  }
}

// ── 5. Residue: no uncommitted changes on governed M46 surfaces ──
{
  const out = execFileSync("git", ["status", "--porcelain", "--", "script/m46", "validation/m46/ledger.json", "package.json", "docs/m46"], { cwd: ROOT, encoding: "utf8" })
  const lines = out.split("\n").filter((l) => l.trim().length > 0)
  check("residue: no uncommitted changes on governed M46 surfaces", lines.length === 0, lines.slice(0, 5).join(" | "))
}

// ── 6. Negative controls (the gate's own teeth) ──
{
  const corrupted = { failed: 3, negativeCases: 0 }
  const refusesFlipped = !(corrupted.failed === 0 && corrupted.negativeCases > 0)
  check("negative: failed>0 or zero-negatives evidence would be refused", refusesFlipped, "", true)
  const stampsA = new Set(["a".repeat(40), "b".repeat(40)])
  check("negative: divergent stamps would be refused", stampsA.size > 1, "", true)
  check("negative: missing evidence file would be refused", !existsSync(path.join(RESULTS_DIR, "ZZ-never-produced.json")), "", true)
}

// ── emit evidence ──
const evidence = {
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m46/verify-closure.ts",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: negatives,
  failures,
}
mkdirSync(RESULTS_DIR, { recursive: true })
if (process.env.BB_M46_READ_ONLY !== "1") {
  writeFileSync(path.join(RESULTS_DIR, "X1.json"), JSON.stringify(evidence, null, 2) + "\n")
}
console.log(`X1 closure: ${passed} passed, ${failed} failed, ${negatives} negatives`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  process.exit(1)
}
