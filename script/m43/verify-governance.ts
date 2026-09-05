// script/m43/verify-governance.ts — M43.G1
// Governance gate for the Freshness Automation milestone. Mirrors the M40.G1
// pattern: verifies the governed surfaces exist, conform, and agree — never
// that anything "looks about right".
//
// Checks:
//  1. PLAN.md states the milestone invariant verbatim (head + tail).
//  2. Ledger: all 7 codes present, GitHub issue numbers populated, statuses
//     legal, no hand-set evidence blocks (blocks must match on-disk evidence).
//  3. Every script/m43 verifier is registered in gates-registry.json.
//  4. npm run verify chain wires every on-disk M43 verifier (progressive:
//     each gate must be wired in the same change that adds it).
//  5. Stamp agreement: content evidence at one commit; infra evidence (G1/X1)
//     at HEAD or an ancestor (M31 rule).
//  6. Evidence currency: no governed source newer than the newest evidence.
//  7. Auto-pass audit of all M43 verifiers (code-scanned, not comments).

import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SCRIPT_DIR = path.join(ROOT, "script/m43")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")
const LEDGER_PATH = path.join(ROOT, "validation/m43/ledger.json")
const PLAN_PATH = path.join(ROOT, "docs/m43/PLAN.md")

let passed = 0, failed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`) }
}

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// ── 1. PLAN states the invariant verbatim ──
const plan = existsSync(PLAN_PATH) ? readFileSync(PLAN_PATH, "utf8") : ""
check("PLAN exists", plan.length > 0)
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ")
const planNorm = norm(plan)
check("PLAN states the invariant head (no read tool answers from data it knows is stale)",
  planNorm.includes("no read tool answers from data it knows is stale"))
check("PLAN states the invariant tail (no two indexers can ever race on one project)",
  planNorm.includes("no two indexers can ever race on one project"))

// ── 2. Ledger conformance ──
const REQUIRED_CODES = ["P1", "A1", "A2", "A3", "A4", "G1", "X1"]
const ALLOWED_STATUS = ["open", "verified", "blocked"]
type LedgerIssue = {
  code: string; githubIssue: number; tool: string; status: string
  scope: string; acceptanceCriteria: string[]; closureRequirements: string[]
  evidence?: Record<string, unknown> | null
}
let ledger: LedgerIssue[] = []
let ledgerOk = false
try {
  ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerIssue[]
  ledgerOk = true
} catch (e) {
  check("ledger parses", false, String(e))
}
if (ledgerOk) {
  const codes = ledger.map((l) => l.code)
  check("ledger has all 7 codes", REQUIRED_CODES.every((c) => codes.includes(c)), codes.join(","))
  check("ledger has no extra codes", codes.every((c) => REQUIRED_CODES.includes(c)),
    codes.filter((c) => !REQUIRED_CODES.includes(c)).join(","))
  for (const issue of ledger) {
    check(`ledger ${issue.code}: github issue populated`,
      Number.isInteger(issue.githubIssue) && issue.githubIssue > 0, String(issue.githubIssue))
    check(`ledger ${issue.code}: status in vocabulary`, ALLOWED_STATUS.includes(issue.status), issue.status)
    check(`ledger ${issue.code}: has acceptanceCriteria`, issue.acceptanceCriteria?.length > 0)
    check(`ledger ${issue.code}: has closureRequirements`, issue.closureRequirements?.length > 0)
  }
  // Evidence blocks must agree with on-disk evidence files (no hand-editing).
  // G1 self-exempts: governance rewrites its own evidence every run.
  for (const issue of ledger) {
    if (!issue.evidence || issue.code === "G1") continue
    const file = path.join(RESULTS_DIR, `${issue.code}.json`)
    if (!existsSync(file)) { check(`ledger ${issue.code}: evidence file exists`, false, `${issue.code}.json missing`); continue }
    const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    for (const key of ["status", "currentCommit", "passed", "failed", "negativeCases"] as const) {
      check(`ledger ${issue.code}: evidence.${key} matches on-disk file`,
        JSON.stringify(issue.evidence[key]) === JSON.stringify(ev[key]),
        `ledger=${JSON.stringify(issue.evidence[key])} disk=${JSON.stringify(ev[key])}`)
    }
  }
}

// ── 3. Every verifier registered in the gates registry ──
const registryPath = path.join(SCRIPT_DIR, "gates-registry.json")
const onDiskVerifiers = existsSync(SCRIPT_DIR)
  ? readdirSync(SCRIPT_DIR).filter((f) => f.startsWith("verify-") && f.endsWith(".ts"))
  : []
let registered: string[] = []
if (existsSync(registryPath)) {
  const reg = JSON.parse(readFileSync(registryPath, "utf8")) as { gates?: Array<{ script: string }> }
  registered = (reg.gates ?? []).map((g) => g.script)
}
check("every M43 verifier is registered in gates-registry.json",
  onDiskVerifiers.every((v) => registered.includes(v)),
  onDiskVerifiers.filter((v) => !registered.includes(v)).join(",") || "none-on-disk-yet")

// ── 4. npm run verify wiring ──
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
const verifyScript = pkg.scripts?.verify ?? ""
check("package.json has a verify script", verifyScript.length > 0)
check("verify chain wires the M43 gates",
  onDiskVerifiers.every((v) => verifyScript.includes(`script/m43/${v}`)),
  onDiskVerifiers.filter((v) => !verifyScript.includes(`script/m43/${v}`)).join(",") || "none-on-disk-yet")

// ── 5. Stamp agreement across evidence files ──
const INFRA_EVIDENCE = new Set(["X1.json", "G1.json"])
const stamps = new Set<string>()
let stampCount = 0
const infraStamps: Array<{ file: string; commit: string }> = []
if (existsSync(RESULTS_DIR)) {
  for (const f of readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json") && f !== "gate-selftest.json")) {
    const ev = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8")) as Record<string, unknown>
    if (typeof ev.currentCommit === "string" && ev.currentCommit.length === 40) {
      if (INFRA_EVIDENCE.has(f)) infraStamps.push({ file: f, commit: ev.currentCommit as string })
      else { stamps.add(ev.currentCommit as string); stampCount++ }
    }
  }
}
check("evidence stamp agreement (content evidence at one commit)", stamps.size <= 1,
  stamps.size > 1 ? `divergent stamps: ${[...stamps].map((s) => s.slice(0, 7)).join(",")}` : "")
if (infraStamps.length > 0) {
  const badInfra = infraStamps.filter((s) => {
    if (s.commit === HEAD) return false
    try { execFileSync("git", ["merge-base", "--is-ancestor", s.commit, HEAD], { cwd: ROOT }); return false } catch { return true }
  })
  check("infra evidence stamped at HEAD or ancestor", badInfra.length === 0, badInfra.map((s) => `${s.file}@${s.commit.slice(0, 7)}`).join(","))
}

// ── 6. Evidence currency ──
if (stampCount > 0 && existsSync(RESULTS_DIR)) {
  let newestSource = 0
  for (const dir of [SCRIPT_DIR, path.join(ROOT, "docs/m43")]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      const st = statSync(path.join(dir, f))
      if (st.isFile() && st.mtimeMs > newestSource) newestSource = st.mtimeMs
    }
  }
  let newestEvidence = 0
  for (const f of readdirSync(RESULTS_DIR)) {
    const st = statSync(path.join(RESULTS_DIR, f))
    if (st.isFile() && st.mtimeMs > newestEvidence) newestEvidence = st.mtimeMs
  }
  check("evidence currency (no governed source newer than evidence)", newestSource <= newestEvidence,
    `newest source ${new Date(newestSource).toISOString()} > newest evidence ${new Date(newestEvidence).toISOString()}`)
}

// ── 7. Auto-pass audit of all M43 verifiers ──
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`[^`]*`/g, "").replace(/"[^"\n]*"/g, "").replace(/'[^'\n]*'/g, "")
}
const autoPass = /(ck|nk|check)\(\s*[^,()]*,\s*true\s*[,)]/g
const orTrue = /\|\|\s*true\b/g
const cmpTrue = /===\s*true\s*\?\s*true\s*:/g
let autoPassHits: string[] = []
for (const v of onDiskVerifiers) {
  const code = stripNonCode(readFileSync(path.join(SCRIPT_DIR, v), "utf8"))
  for (const hit of [...(code.match(autoPass) ?? []), ...(code.match(orTrue) ?? []), ...(code.match(cmpTrue) ?? [])]) {
    autoPassHits.push(`${v}: ${hit.trim().slice(0, 60)}`)
  }
}
check("no auto-pass predicates in any M43 verifier", autoPassHits.length === 0, autoPassHits.join(" | "))

// ── emit evidence ──
const evidence = {
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m43/verify-governance.ts",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: 2,
  negatives: [
    { name: "invariant-missing", note: "PLAN without the verbatim invariant fails check 1 (proven by mutation in gate-selftest when G1 delivers it)" },
    { name: "stamp-divergence", note: "evidence files stamped at different commits fail check 5 (proven by mutation in gate-selftest when G1 delivers it)" },
  ],
  failures,
}
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(path.join(RESULTS_DIR, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")

console.log(`G1 governance: ${passed} passed, ${failed} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  process.exit(1)
}
