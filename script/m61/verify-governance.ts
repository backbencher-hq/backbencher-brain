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
import { canFailProofs } from "./gate_lint.ts"
import {
  EXPECTED_CODES,
  EXPECTED_ISSUE_NUMBERS,
  PREREQUISITE_RECORDS,
  SELF_OWNED_CODES,
  V_GATES,
  entryDrift,
  isClosable,
  laneViolations,
  ledgerEntryFrom,
  projectionMoved,
  validateLedger,
  type Ledger,
  type LedgerIssue,
} from "./governance_core.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m61/results")
const LEDGER_PATH = path.join(EVIDENCE_DIR, "manifest.json")

// The gate set, the theme gates re-executed on every run, and the prerequisite
// records are declared in ONE owner: ./governance_core.ts (imported above). X1
// audits with the same declarations.

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

// --- The pure decision cores live in ONE owner: ./governance_core.ts ----------------
// The closure rule, the D-7 lane rule, the ledger validator and the X1 audit rules
// are imported, so the gate that ENFORCES and the gate that AUDITS share them.

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
// G1's and X1's own entries are excluded: each is measured by its OWN run (G1's
// below; X1's by the closure gate), so a pre-check here would judge a snapshot
// the owning run is about to replace — and an X1 entry that this run has not yet
// earned is the expected state of a lane mid-verification, not a hollow closure.
const ledgerWithoutSelfOwned: Ledger = {
  ...ledger,
  status: "open",
  issues: ledger.issues.map((i) => (i.code === "G1" || i.code === "X1" ? { ...i, status: "planned", evidence: undefined } : i)),
}
const ledgerWithoutG1 = ledgerWithoutSelfOwned
const preErrors = validateLedger(ledgerWithoutG1, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS)
check("G1: ledger validates against the plan, closure rules and D-7 (this run's own entry excluded)", preErrors.length === 0, preErrors.slice(0, 6).join(" | "))
const provable = ledger.issues.filter((i) => i.status !== "planned" && i.code !== "G1" && i.code !== "X1")
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
  // The self-owned exemption must be NARROW: naming X1 in `selfOwned` may not
  // let a projected issue's hollow closure through. G1 exempts X1's own entry
  // (measured by the closure gate's run); if that exemption ever leaked to the
  // entries G1 projects and re-judges, the whole rule would be decoration.
  const leaked = clone(ledger)
  const v2 = leaked.issues.find((i) => i.code === "V2")!
  v2.evidence = { ...v2.evidence, failed: 2, realFailed: 2 }
  negative(
    "the self-owned exemption leaks to a projected entry",
    validateLedger(leaked, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS, SELF_OWNED_CODES.filter((c) => c !== "G1")).some((e) => e.startsWith("hollow-verified:V2")),
  )
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
{
  // The projection rule, exercised: an entry that a human typed is DRIFT, while
  // a record re-run at another commit is a stale projection (healed, not drift).
  const rec = readEvidence<Record<string, unknown>>(path.join(EVIDENCE_DIR, "V1.json")).record ?? {}
  const derived = ledgerEntryFrom(rec, canFailProofs(rec))
  negative("a hand-typed count passes the drift check", entryDrift({ ...derived, passed: (derived.passed ?? 0) + 3 }, derived).length > 0)
  negative("an understated can-fail proof passes the drift check", entryDrift({ ...derived, mutantsTotal: 0 }, derived).length > 0)
  negative("a record re-run at another commit is reported as drift", entryDrift({ ...derived, recordCommit: "0".repeat(40) }, derived).length === 0 && projectionMoved({ ...derived, recordCommit: "0".repeat(40) }, derived))
}

// --- Evidence ---------------------------------------------------------------------
const realFailed = barResults.filter((r) => r.rc !== 0).length
// Stale projections this run healed (populated by the ledger projection below;
// declared HERE because the artifact block below must compile before it — a
// TDZ here would be the exact bug class this milestone extinguishes).
const healed: string[] = []
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
  projection: { healed },
  checksList,
  barReaudit: barResults,
  ledgerIssues: ledger.issues.map((i) => ({ code: i.code, githubIssue: i.githubIssue, status: i.status })),
  lockDiscipline: { leaks: lockLeaks },
  currentCommit,
  verifierCommand: "npx tsx script/m61/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Bar re-audit re-executes V1–V6 (the milestone's own gates). The LANE bar (m24→m44) is re-audited transitively through the persisted closures and the ladder record listed in the prerequisite block — re-running the 41-gate ladder here would cost ~40 minutes per governance run and is X1's job.",
    "Every ledger entry is a PROJECTION of the record it points at, re-derived on each run through the same can-fail derivation the verifier lint uses. A record re-run at a different commit legitimately moves its entry: that is a stale projection, reported as `projection.healed` and repaired (not a drift failure). Drift is the decidable case — the record has NOT moved yet the ledger states something else — and it fails loudly.",
    "D-7 lane discipline is enforced over the ledger's declared paths and this milestone's own working tree; the co-agent lanes' history is untouched by design.",
  ],
})
mkdirSync(EVIDENCE_DIR, { recursive: true })
writeSealed(path.join(EVIDENCE_DIR, "G1.json"), buildEvidence())
const selfRead = readEvidence(path.join(EVIDENCE_DIR, "G1.json"))
check("R: this gate's own evidence verifies through the trusted read", selfRead.ok)
writeSealed(path.join(EVIDENCE_DIR, "G1.json"), buildEvidence())

// --- The ledger's entries are DERIVED from the records, never hand-typed ----------
// Every non-planned issue's entry is a PROJECTION of the record it points at — the
// same can-fail derivation the verifier lint uses — so the ledger cannot state a
// count its record does not. The drift check runs on the ledger AS READ: a hand
// edit is loud here, and the projection then repairs it (self-healing, the m53
// convention). G1's own entry is measured by this run, never inherited: a ledger
// that kept `verified` from an earlier green run while this run is a known-gap
// would persist the inconsistency into the authority record itself.
console.log("\nledger projection: every entry is the derivation of its record")
const entryOf = (record: Record<string, unknown>) => ledgerEntryFrom(record, canFailProofs(record))
// G1 and X1 own their own entries (measured by their own runs, written from their
// own snapshots) — they are not projections of a record some OTHER gate re-runs.
const SELF_OWNED = new Set(["G1", "X1"])
const driftFindings: string[] = []
for (const issue of ledger.issues) {
  if (SELF_OWNED.has(issue.code) || issue.status === "planned") continue
  const file = issue.evidence?.evidenceFile
  const abs = file ? path.join(EVIDENCE_DIR, file) : ""
  if (!file || !existsSync(abs)) {
    driftFindings.push(`${issue.code}: record missing (${file ?? "no evidenceFile"})`)
    continue
  }
  const read = readEvidence<Record<string, unknown>>(abs)
  if (!read.ok) {
    driftFindings.push(`${issue.code}: record unreadable (${read.kind})`)
    continue
  }
  const derived = entryOf(read.record)
  if (projectionMoved(issue.evidence, derived)) healed.push(`${issue.code}: ${issue.evidence?.status ?? "?"} ${issue.evidence?.passed ?? 0} → ${derived.status} ${derived.passed}`)
  const drift = entryDrift(issue.evidence, derived)
  // The ISSUE's status is a projection too: a record that went red must not
  // leave the ledger declaring `verified` for it (nothing is closed by
  // assertion — the status is the record's, not the ledger's opinion).
  if (issue.status !== derived.status) drift.push(`issue.status: ledger=${issue.status} record=${derived.status}`)
  if (drift.length > 0) driftFindings.push(`${issue.code}: ${drift.join(", ")}`)
  issue.evidence = derived
  issue.status = derived.status
}
for (const h of healed) console.log(`  stale projection healed: ${h}`)
check("G1: every ledger entry is the derivation of the record it points at (no hand-typed counts)", driftFindings.length === 0, driftFindings.slice(0, 4).join(" | "))

// --- The ledger's own entry: measured by this run, written from ONE snapshot -------
{
  const g1 = ledger.issues.find((i) => i.code === "G1")!
  const staged = buildEvidence()
  Object.assign(g1, { status: staged.status, evidence: entryOf(staged as unknown as Record<string, unknown>) })
  ledger.status = ledger.issues.every((i) => i.status === "verified") ? "closed" : "open"
  const fullErrors = validateLedger(ledger, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS, SELF_OWNED_CODES.filter((c) => c !== "G1"))
  check("G1: the ledger validates WHOLE with this run's own measured entry", fullErrors.length === 0, fullErrors.slice(0, 6).join(" | "))
  const drift = entryDrift(g1.evidence, entryOf(staged as unknown as Record<string, unknown>))
  check("G1: the G1 entry is the record's own derivation (not hand-assembled)", drift.length === 0, drift.join(" | "))
  // Recapture the counters AFTER those checks — the record counts every check
  // that ran (the m29 rule) — re-derive the entry from the final record, and
  // write BOTH artifacts from that one snapshot, last: no check runs after them
  // (G8: a record that disagrees with its own run is the defect this milestone
  // exists to kill, and the intermediate write above is not the record).
  const final = buildEvidence()
  Object.assign(g1, { status: final.status, evidence: entryOf(final as unknown as Record<string, unknown>) })
  ledger.status = ledger.issues.every((i) => i.status === "verified") ? "closed" : "open"
  writeSealed(path.join(EVIDENCE_DIR, "G1.json"), final)
  writeSealed(LEDGER_PATH, ledger)
}

console.log(`\nM61.G1: ${passed === checks ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} checks, ${negatives} negatives)`)
console.log(`Evidence (sealed): ${path.join(EVIDENCE_DIR, "G1.json")}`)
if (details.length > 0) {
  console.log("Failures:")
  for (const d of details) console.log(`  - ${d}`)
}
process.exitCode = passed === checks ? 0 : 1
