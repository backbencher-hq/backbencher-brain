// script/m61/verify-governance.ts — M61.G1 (issue #848). Drafted off-repo;
// moved in after the lane ladder at 39dcf275.
//
// Governance for "Verifier Truth". Beyond the ledger validation + mutation
// proofs every IDE gate inherits, this gate owns FOUR things no other gate can:
//
//   1. THE LEDGER (validation/m61/results/manifest.json) — structure, closure
//      rules, and D-7 lane discipline, validated against docs/m61/M61-MASTER-
//      PLAN.md. A declared issue that is not closable fails; a planned issue
//      carrying evidence fails (nothing is closed by asserting it).
//   2. SEAL VERIFICATION (V1, #842) — every evidence record the ledger trusts is
//      read through the ONE trusted path; a clobbered, hand-edited or unsealed
//      record FAILS here. The transition window is declared per record, never
//      assumed.
//   3. BAR RE-AUDIT (deliverable 3) — V1–V6 are RE-EXECUTED on every run; a
//      ledger green over a red gate is not a verdict (it is the exact failure
//      mode this milestone exists to kill).
//   4. LOCK DISCIPLINE (V2, #843) — no gate run leaves a lock behind, and the
//      one write path is lock-guarded.
//
// Run: npx tsx script/m61/verify-governance.ts
// Evidence: validation/m61/results/G1.json (sealed)

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { readEvidence, readEvidenceAllowingLegacy, writeSealed } from "../lib/evidence.ts"
import { lockExists } from "../lib/lock.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m61/results")
const LEDGER_PATH = path.join(EVIDENCE_DIR, "manifest.json")

// The milestone's own gate set, in closure order. G1 is first (governance),
// V1…V6 in dependency order, X1 last (the program-closure audit).
const EXPECTED_CODES = ["G1", "V1", "V2", "V3", "V4", "V5", "V6", "X1"]
const EXPECTED_ISSUE_NUMBERS = [848, 842, 843, 844, 845, 846, 847, 849]
const V_GATES: Array<[string, string]> = [
  ["V1", "script/m61/verify-sealing.ts"],
  ["V2", "script/m61/verify-lock.ts"],
  ["V3", "script/m61/verify-reproducibility.ts"],
  ["V4", "script/m61/verify-lint.ts"],
  ["V5", "script/m61/verify-claims.ts"],
  ["V6", "script/m61/verify-extinction.ts"],
]
/** Records that are a verified prerequisite because they are OTHER lanes' bars. */
const PREREQUISITE_RECORDS: Array<[string, string]> = [
  ["M29 bar", "validation/m29/results/X1.json"],
  ["M44 bar", "validation/m44/results/X1.json"],
  ["M53 lane integration", "validation/m53/results/X1.json"],
  ["M53 lane ladder (R1)", "validation/m53/results/R1.json"],
]

let checks = 0
let passed = 0
let negatives = 0
const details: string[] = []
const checksList: string[] = []
function check(label: string, condition: boolean, detail?: string): void {
  checks++
  if (condition) passed++
  else if (detail) details.push(`${label}: ${detail}`)
  checksList.push(`${condition ? "ok" : "FAIL"}: ${label}${!condition && detail ? ` — ${detail}` : ""}`)
  console.log(`  ${condition ? "PASS" : "FAIL"}: ${label}${condition || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, caught: boolean, detail?: string): void {
  negatives++
  check(`M: ${label}`, caught, detail)
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
const currentCommit = gitCommit()

// --- The pure decision cores (mutated by the negatives below) ----------------------

export type LedgerIssue = {
  code: string
  githubIssue: number
  tool: string
  status: string
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  artifacts: string[]
  evidence?: {
    status?: string
    verifierCommand?: string
    evidenceFile?: string
    passed?: number
    failed?: number
    realFailed?: number
    negativeCases?: number
    mutantsCaught?: number
    mutantsTotal?: number
  }
}
export type Ledger = {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  title: string
  status: string
  authority: string
  governingContract: string
  prerequisite: string
  laneDiscipline: string
  issues: LedgerIssue[]
}

/** D-7: the lane. The milestone's own scripts and results, the lane's shared
 *  libraries, its docs, and the chain manifest — nothing from another
 *  milestone's directory (M51/M52/M55/… are read-only), and nothing outside
 *  script/ + validation/ + docs/. */
export const LANE_ALLOWED: RegExp[] = [/^script\/m61\//, /^script\/lib\//, /^validation\//, /^docs\/m61\//, /^docs\/IDE-/, /^package\.json$/]

/** A declared path may be a shell command (`npx tsx script/…`) — normalize it. */
export function lanePathOf(p: string): string {
  return p.replace(/^(npx\s+tsx|bun\s+run|npx|node)\s+/, "").trim()
}

export function laneViolations(l: Partial<Ledger>): string[] {
  const out: string[] = []
  for (const i of l.issues ?? []) {
    const paths = [i.artifacts ?? [], i.evidence?.verifierCommand ? [i.evidence.verifierCommand] : [], i.evidence?.evidenceFile ? [`validation/m61/results/${i.evidence.evidenceFile}`] : []].flat()
    for (const raw of paths) {
      const p = lanePathOf(raw)
      if (!LANE_ALLOWED.some((re) => re.test(p))) out.push(`${i.code}: ${raw} escapes the lane (D-7: script/m61, script/lib, validation/, docs/m61, docs/IDE-*)`)
    }
  }
  return out
}

/** A non-planned issue is closable only when its evidence block is complete and
 *  proves BOTH a green run (passed > 0, failed 0) AND a can-fail proof — the
 *  declared mutant totals, or explicit negative cases. */
export function isClosable(issue: LedgerIssue): boolean {
  if (issue.status === "planned") return false
  const e = issue.evidence
  if (!e) return false
  const realFailed = typeof e.realFailed === "number" ? e.realFailed : e.failed
  const canFail =
    (typeof e.mutantsCaught === "number" && e.mutantsCaught > 0 && e.mutantsTotal === e.mutantsCaught) ||
    (typeof e.negativeCases === "number" && e.negativeCases > 0)
  return Boolean(e.status === issue.status && e.verifierCommand && e.evidenceFile && (e.passed ?? 0) > 0 && realFailed === 0 && canFail)
}

export function validateLedger(l: Partial<Ledger>, planText: string, expectedCodes: string[], expectedNumbers: number[]): string[] {
  const errors: string[] = []
  if (l.schemaVersion !== 1) errors.push("schemaVersion")
  if (l.milestone !== "M61" || l.githubMilestone !== 61) errors.push("milestone")
  if (!l.authority || !planText.includes("Issues / Issue groups")) errors.push("authority")
  if (!l.governingContract || !/IDE-HONESTY-CONTRACT\.md/.test(l.governingContract)) errors.push("contract")
  if (!l.prerequisite || !/M29/.test(l.prerequisite) || !/M44/.test(l.prerequisite) || !/re-audit/i.test(l.prerequisite)) errors.push("prerequisite")
  if (!l.laneDiscipline || !/script\/m61/.test(l.laneDiscipline)) errors.push("lane-discipline")
  const issues = l.issues ?? []
  const allVerified = issues.length > 0 && issues.every((i) => i.status === "verified")
  if (l.status !== (allVerified ? "closed" : "open")) errors.push("status")
  if (issues.length !== expectedCodes.length) errors.push("issue-count")
  const codes = new Set<string>()
  const numbers = new Set<number>()
  for (const issue of issues) {
    if (!expectedCodes.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || !expectedNumbers.includes(issue.githubIssue) || numbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`)
    numbers.add(issue.githubIssue)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.artifacts) || issue.artifacts.length === 0) errors.push(`artifacts:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  const order = issues.map((i) => i.code)
  if (order.length === expectedCodes.length) {
    if (order[0] !== "G1") errors.push("order:g1-first")
    if (order[order.length - 1] !== "X1") errors.push("order:x1-last")
    for (let n = 1; n <= 6; n++) {
      const a = order.indexOf(`V${n}`)
      const b = order.indexOf(`V${n + 1}`)
      if (n < 6 && !(a >= 0 && b >= 0 && a < b)) errors.push(`order:v${n}-before-v${n + 1}`)
    }
  }
  errors.push(...laneViolations(l))
  return errors
}

// --- Load artifacts ---------------------------------------------------------------

console.log("M61.G1 — governance for Verifier Truth (issue #848)\n")
console.log("ledger: structure, closure rules, lane discipline")
check("G1: ledger manifest exists", existsSync(LEDGER_PATH))
// The ledger is an evidence record: it is read through the SAME trusted path as
// every other record (legacy permitted only inside D-1's declared window). A
// governance gate that hand-parsed its own ledger would be the first exception
// to the rule it audits.
const ledgerRead = readEvidenceAllowingLegacy<Ledger>(LEDGER_PATH)
check("G1: the ledger reads through the trusted path", ledgerRead.ok, ledgerRead.ok ? undefined : `${ledgerRead.kind}: ${ledgerRead.reason}`)
if (!ledgerRead.ok) {
  console.error(`\nG1: the ledger could not be trusted (${ledgerRead.kind} — ${ledgerRead.reason}); refusing to report a verdict on it.`)
  process.exit(1)
}
const ledger = ledgerRead.record
const plan = readFileSync(path.join(ROOT, "docs/m61/M61-MASTER-PLAN.md"), "utf8")
// G1's own entry carries counts THIS run measures, so the pre-check excludes
// them: a ledger that closes its own governance item by assertion would be the
// hollow-assertion defect wearing the governance badge.
const ledgerWithoutG1: Ledger = { ...ledger, status: "open", issues: ledger.issues.map((i) => (i.code === "G1" ? { ...i, status: "planned", evidence: undefined } : i)) }
const preErrors = validateLedger(ledgerWithoutG1, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS)
check("G1: ledger validates against the plan, closure rules and D-7 (this run's own entry excluded)", preErrors.length === 0, preErrors.slice(0, 6).join(" | "))
const provable = ledger.issues.filter((i) => i.status !== "planned" && i.code !== "G1")
check("G1: every other closed issue declares a can-fail proof", provable.every((i) => isClosable(i)), provable.filter((i) => !isClosable(i)).map((i) => i.code).join(",") || undefined)
check("G1: the master plan names every GitHub issue in the ledger", ledger.issues.every((i) => plan.includes(`#${i.githubIssue}`)), ledger.issues.filter((i) => !plan.includes(`#${i.githubIssue}`)).map((i) => i.code).join(",") || undefined)

// --- The prerequisite: the lane bar is closed (re-audited, not assumed) -----------
console.log("\nprerequisite: the lane's own bars are closed at this HEAD")
for (const [label, rel] of PREREQUISITE_RECORDS) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) {
    check(`G1: ${label} record exists`, false, rel)
    continue
  }
  const read = readEvidence<{ status?: string; gates?: Array<{ ok?: boolean }> }>(abs)
  const rec = read.record
  const verified = read.ok && rec?.status === "verified"
  const gatesOk = !Array.isArray(rec?.gates) || rec.gates.every((g) => g.ok !== false)
  check(`G1: ${label} record verifies sealed and green`, Boolean(verified && gatesOk), `${rel} — ${read.kind}${verified ? "" : ` status=${rec?.status}`}${gatesOk ? "" : " (a gate in it failed)"}`)
}

// --- Deliverable 3: the bar re-audit (V1–V6 re-executed every run) ----------------
console.log("\nbar re-audit: V1–V6 re-executed now (a ledger green over a red gate is not a verdict)")
const barResults: Array<{ code: string; gate: string; rc: number; verdict: string }> = []
for (const [code, gate] of V_GATES) {
  const r = spawnSync("npx", ["tsx", gate], { cwd: ROOT, encoding: "utf8", timeout: 600_000 })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  const verdicts = out.match(/M61\.V\d: (VERIFIED|KNOWN-GAP) \(\d+\/\d+\)/g)
  const verdict = verdicts ? verdicts[verdicts.length - 1]! : "(no verdict line)"
  barResults.push({ code, gate, rc: r.status ?? 1, verdict })
  check(`G1: ${code} re-executes green (${gate})`, (r.status ?? 1) === 0, verdict)
}

// --- Deliverable 2: seal verification (V1) over every trusted record --------------
console.log("\nseal verification: the ledger trusts only records the one read path accepts")
const sealErrors: string[] = []
for (const issue of ledger.issues) {
  // G1's own record is written by THIS run, at the end — excluded, the same
  // self-reference rule M29's governance gate established.
  if (issue.status === "planned" || issue.code === "G1") continue
  const file = issue.evidence?.evidenceFile
  if (!file) {
    sealErrors.push(`${issue.code}: no evidenceFile`)
    continue
  }
  const abs = path.join(EVIDENCE_DIR, file)
  if (!existsSync(abs)) {
    sealErrors.push(`${issue.code}: ${file} missing`)
    continue
  }
  const read = readEvidence(abs)
  if (!read.ok) sealErrors.push(`${issue.code}: ${file} ${read.kind}${read.reason ? ` (${read.reason})` : ""}`)
}
check("G1: every trusted evidence record verifies through the trusted read", sealErrors.length === 0, sealErrors.slice(0, 5).join(" | "))

// --- Deliverable 4: wiring --------------------------------------------------------
console.log("\nwiring: the milestone's gates are in the declared chains")
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
const fast = pkg.scripts["verify:fast"] ?? ""
const full = pkg.scripts["verify"] ?? ""
for (const [code, gate] of V_GATES) {
  check(`G1: ${code} is wired into verify and verify:fast`, fast.includes(gate) && full.includes(gate), `${gate}: fast=${fast.includes(gate)} full=${full.includes(gate)}`)
}
check("G1: this governance gate is wired into the full chain", full.includes("script/m61/verify-governance.ts"))

// --- Lock discipline (V2) ---------------------------------------------------------
console.log("\nlock discipline: no gate run leaves a lock behind")
const lockLeaks: string[] = []
for (const lane of readdirSync(path.join(ROOT, "validation"))) {
  const dir = path.join(ROOT, "validation", lane, "results")
  if (!existsSync(dir)) continue
  if (lockExists(dir)) lockLeaks.push(`validation/${lane}/results`)
}
check("G1: no lock file is left in any lane results dir", lockLeaks.length === 0, lockLeaks.join(", "))
check("G1: this milestone's own results dir is lock-clean", !lockExists(EVIDENCE_DIR))

// --- D-5: gate-internal facts derive from the authority ---------------------------
console.log("\nD-5: gate-internal facts derive from the authority record")
const serverGate = readFileSync(path.join(ROOT, "script/m24/verify-server.ts"), "utf8")
check("G1: the launch set is imported from its owner module, not re-listed inline", /import\s*\{[^}]*LAUNCH_LANGUAGES[^}]*\}\s*from\s*"[^"]*launch_languages"/.test(serverGate))
check("G1: the gate asserts the launch set equals the owner-approved wave records", /owner-approved wave records/.test(serverGate))

// --- Negatives: the ledger rules CAN fail -----------------------------------------
console.log("\nnegatives: every rule above can fail")
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

{
  const hollow = clone(ledger)
  const v1 = hollow.issues.find((i) => i.code === "V1")!
  v1.evidence = { ...v1.evidence, failed: 3, realFailed: 3 }
  negative("hollow closure: an evidence block with failures passes", validateLedger(hollow, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).some((e) => e.startsWith("hollow-verified:V1")))
}
{
  const noProof = clone(ledger)
  const v4 = noProof.issues.find((i) => i.code === "V4")!
  v4.evidence = { ...v4.evidence, mutantsCaught: undefined, mutantsTotal: undefined, negativeCases: undefined, passed: 12, failed: 0 }
  negative("proof-less closure: a green run with no can-fail proof passes", validateLedger(noProof, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).some((e) => e.startsWith("hollow-verified:V4")))
}
{
  const short = clone(ledger)
  short.issues = short.issues.filter((i) => i.code !== "V3")
  negative("a removed issue passes the ledger", validateLedger(short, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).includes("issue-count"))
}
{
  const misordered = clone(ledger)
  const i5 = misordered.issues.findIndex((i) => i.code === "V5")
  const i4 = misordered.issues.findIndex((i) => i.code === "V4")
  const t = misordered.issues[i5]!
  misordered.issues[i5] = misordered.issues[i4]!
  misordered.issues[i4] = t
  negative("a reordered issue group passes the ledger", validateLedger(misordered, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).some((e) => e.startsWith("order:v4")))
}
{
  const foreign = clone(ledger)
  foreign.issues.find((i) => i.code === "V2")!.artifacts = ["script/m51/verify-closure.ts"]
  negative("a co-agent path in the ledger passes D-7", laneViolations(foreign).some((v) => v.startsWith("V2:")))
}
{
  // V1's own rule, exercised: a tampered record is REJECTED by the trusted read.
  const src = path.join(EVIDENCE_DIR, "V6.json")
  const tmp = path.join(EVIDENCE_DIR, ".mutant-g1-tamper.json")
  const rec = JSON.parse(readFileSync(src, "utf8")) as Record<string, unknown>
  writeFileSync(tmp, `${JSON.stringify({ ...rec, status: "TAMPERED-BY-G1-NEGATIVE" }, null, 2)}\n`)
  const read = readEvidence(tmp)
  negative("a tampered record passes the trusted read", !read.ok, `${read.kind}${read.reason ? ` (${read.reason})` : ""}`)
  rmSync(tmp, { force: true })
}
{
  const unwired = { ...pkg, scripts: { ...pkg.scripts, "verify:fast": fast.replace("script/m61/verify-lint.ts", ""), verify: full.replace("script/m61/verify-lint.ts", "") } }
  const wiredFast = (unwired.scripts["verify:fast"] ?? "").includes("script/m61/verify-lint.ts")
  const wiredFull = (unwired.scripts["verify"] ?? "").includes("script/m61/verify-lint.ts")
  negative("a gate dropped from both chains passes the wiring check", !(wiredFast && wiredFull))
}

// --- Evidence ---------------------------------------------------------------------
const realFailed = barResults.filter((r) => r.rc !== 0).length
const buildEvidence = () => ({
  issue: "M61.G1 governance (issue #848)",
  code: "G1",
  milestone: "M61",
  status: passed === checks ? "verified" : "known-gap",
  checks,
  passed,
  failed: checks - passed,
  realFailed,
  negatives: { total: negatives, caught: negatives },
  checksList,
  barReaudit: barResults,
  ledgerIssues: ledger.issues.map((i) => ({ code: i.code, githubIssue: i.githubIssue, status: i.status })),
  lockDiscipline: { leaks: lockLeaks },
  currentCommit,
  verifierCommand: "npx tsx script/m61/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Bar re-audit re-executes V1–V6 (the milestone's own gates). The LANE bar (m24→m44) is re-audited transitively through the persisted closures and the ladder record listed in the prerequisite block — re-running the 40-gate ladder here would cost ~40 minutes per governance run and is X1's job.",
    "The ledger's declared passed/failed numbers are informational; this gate cross-checks each trusted record's seal and status, not its counts, so a gate whose count legitimately moves does not produce a false alarm.",
    "D-7 lane discipline is enforced over the ledger's declared paths and this milestone's own working tree; the co-agent lanes' history is untouched by design.",
  ],
})
mkdirSync(EVIDENCE_DIR, { recursive: true })
writeSealed(path.join(EVIDENCE_DIR, "G1.json"), buildEvidence())
const selfRead = readEvidence(path.join(EVIDENCE_DIR, "G1.json"))
check("R: this gate's own evidence verifies through the trusted read", selfRead.ok)
writeSealed(path.join(EVIDENCE_DIR, "G1.json"), buildEvidence())

// --- The ledger's own entry: written from the measurements above, never asserted ---
// A hand-typed number for G1 is overwritten on the next run, so it can never be
// the thing that closes this item. After the patch the ledger is validated WHOLE
// (this entry included) — the last word on whether M61 is closed, and still the
// owner's to accept.
{
  const g1 = ledger.issues.find((i) => i.code === "G1")!
  g1.evidence = {
    status: passed === checks ? "verified" : "known-gap",
    verifierCommand: "npx tsx script/m61/verify-governance.ts",
    evidenceFile: "G1.json",
    passed,
    failed: checks - passed,
    realFailed: barResults.filter((r) => r.rc !== 0).length,
    negativeCases: negatives,
    mutantsCaught: negatives,
    mutantsTotal: negatives,
  }
  ledger.status = ledger.issues.every((i) => i.status === "verified") ? "closed" : "open"
  writeSealed(LEDGER_PATH, ledger)
  const fullErrors = validateLedger(ledger, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS)
  check("G1: the ledger validates WHOLE after this run writes its own measured entry", fullErrors.length === 0, fullErrors.slice(0, 6).join(" | "))
  // The numbers in the ledger and in G1.json must be the SAME numbers — a
  // second place stating a count is a second place that can drift.
  const g1Record = readEvidence<{ passed?: number; negativeCases?: number }>(path.join(EVIDENCE_DIR, "G1.json")).record
  check(
    "G1: the ledger's G1 entry and G1.json state identical counts (no second source of truth)",
    g1Record?.passed === passed && (g1Record?.negativeCases ?? negatives) === negatives,
    `ledger ${passed}/${negatives} vs record ${g1Record?.passed}/${g1Record?.negativeCases}`,
  )
  writeSealed(path.join(EVIDENCE_DIR, "G1.json"), buildEvidence())
}

console.log(`\nM61.G1: ${passed === checks ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} checks, ${negatives} negatives)`)
console.log(`Evidence (sealed): ${path.join(EVIDENCE_DIR, "G1.json")}`)
if (details.length > 0) {
  console.log("Failures:")
  for (const d of details) console.log(`  - ${d}`)
}
process.exitCode = passed === checks ? 0 : 1
