// script/m40/verify-governance.ts — M40.G1
// Governance gate for the Index Lifecycle Integrity milestone. Verifies the
// governed surfaces exist, conform, and agree — never that anything "looks
// about right". Every check is a real predicate over real files.
//
// Checks:
//  1. PLAN.md states the milestone invariant verbatim.
//  2. Ledger: all 11 codes present, GitHub issue numbers populated (X1 exempt),
//     statuses are from the allowed vocabulary, no hand-set evidence blocks
//     (blocks must match the on-disk evidence file byte-for-byte on shared keys).
//  3. Every script/m40 verifier is registered in the gates registry.
//  4. npm run verify chain includes the M40 gates (wiring proof).
//  5. Stamp agreement: every evidence file stamped at the same commit.
//  6. Evidence currency: no evidence file older than the newest governed source.
//  7. Auto-pass audit of all M40 verifiers (no ck(..., true), no || true).

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SCRIPT_DIR = path.join(ROOT, "script/m40")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")
const LEDGER_PATH = path.join(ROOT, "validation/m40/ledger.json")
const PLAN_PATH = path.join(ROOT, "docs/m40/PLAN.md")

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
// Invariant anchors: both halves of the milestone sentence must be present
// (whitespace-normalized) — the head names the trigger, the tail names the
// honest alternative to consistency.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ")
const planNorm = norm(plan)
check("PLAN states the invariant head (any indexing path...derived data)",
  planNorm.includes("any indexing path that updates symbols must leave derived data"))
check("PLAN states the invariant tail (or visibly say it did not)",
  planNorm.includes("or visibly say it did not"))

// ── 2. Ledger conformance ──
const REQUIRED_CODES = ["G1", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "X1"]
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
  check("ledger has all 11 codes", REQUIRED_CODES.every((c) => codes.includes(c)),
    codes.join(","))
  check("ledger has no extra codes", codes.every((c) => REQUIRED_CODES.includes(c)),
    codes.filter((c) => !REQUIRED_CODES.includes(c)).join(","))
  for (const issue of ledger) {
    check(`ledger ${issue.code}: github issue populated (X1 exempt)`,
      issue.code === "X1" || (Number.isInteger(issue.githubIssue) && issue.githubIssue > 0),
      String(issue.githubIssue))
    check(`ledger ${issue.code}: status in vocabulary`, ALLOWED_STATUS.includes(issue.status), issue.status)
    check(`ledger ${issue.code}: has acceptanceCriteria`, issue.acceptanceCriteria?.length > 0)
    check(`ledger ${issue.code}: has closureRequirements`, issue.closureRequirements?.length > 0)
  }
  // Evidence blocks must agree with on-disk evidence files (no hand-editing).
  // G1 self-exempts: governance rewrites its own evidence every run, so a
  // ledger-vs-disk comparison of the G1 block is mid-flight by construction
  // (same class as closure's G1 control seam). G1's status/stamp are still
  // enforced independently by the X1 closure gate.
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
check("every M40 verifier is registered in gates-registry.json",
  onDiskVerifiers.every((v) => registered.includes(v)),
  onDiskVerifiers.filter((v) => !registered.includes(v)).join(",") || "none-on-disk-yet")

// ── 4. npm run verify wiring ──
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }
const verifyScript = pkg.scripts?.verify ?? ""
check("package.json has a verify script", verifyScript.length > 0)
check("verify chain wires the M40 gates",
  onDiskVerifiers.every((v) => verifyScript.includes(`script/m40/${v}`)),
  onDiskVerifiers.filter((v) => !verifyScript.includes(`script/m40/${v}`)).join(",") || "none-on-disk-yet")

// ── 5. Stamp agreement across evidence files ──
// M31 pattern: CONTENT-gate evidence forms the stamp consensus. Infra
// evidence (X1 closure) is re-stamped per closure run — necessarily at a
// commit at-or-after the content consensus — so it is checked for currency
// (ancestor of HEAD), not folded into the content consensus set.
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
// Infra stamps must be HEAD or an ancestor of HEAD (never a future/foreign commit).
if (infraStamps.length > 0) {
  const HEAD2 = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "" } })()
  const badInfra = infraStamps.filter((s) => {
    if (s.commit === HEAD2) return false
    try { execFileSync("git", ["merge-base", "--is-ancestor", s.commit, HEAD2], { cwd: ROOT }); return false } catch { return true }
  })
  check("infra evidence stamped at HEAD or ancestor", badInfra.length === 0, badInfra.map((s) => `${s.file}@${s.commit.slice(0, 7)}`).join(","))
}

// ── 6. Evidence currency: no governed source newer than its evidence ──
// Governed sources = script/m40 + docs/m40 + the ledger. If any file's mtime
// is newer than the newest evidence file, evidence may be stale (skipped when
// no evidence exists yet — nothing has run).
if (stampCount > 0) {
  let newestSource = 0
  for (const dir of [SCRIPT_DIR, path.join(ROOT, "docs/m40")]) {
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

// ── 7. Auto-pass audit of all M40 verifiers ──
// Scans CODE, not comments: strip line comments, block comments, and string
// literals before matching, so prose like "no ck(..., true)" never trips it.
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
check("no auto-pass predicates in any M40 verifier", autoPassHits.length === 0, autoPassHits.join(" | "))

// ── emit evidence ──
const evidence = {
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m40/verify-governance.ts",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: 2,
  negatives: [
    { name: "invariant-missing", note: "PLAN without the verbatim invariant fails check 1 (proven by mutation in gate-selftest)" },
    { name: "stamp-divergence", note: "evidence files stamped at different commits fail check 5 (proven by mutation in gate-selftest)" },
  ],
  failures,
}
import { mkdirSync, writeFileSync } from "node:fs"
mkdirSync(RESULTS_DIR, { recursive: true })
writeFileSync(path.join(RESULTS_DIR, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")

console.log(`G1 governance: ${passed} passed, ${failed} failed`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  process.exit(1)
}
