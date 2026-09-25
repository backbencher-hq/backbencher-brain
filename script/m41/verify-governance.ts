// script/m41/verify-governance.ts — M41.G1.
//
// Governance for M41 (Website Truth, SEO & Design). Validates the ledger with
// the REAL GitHub issue numbers enforced exactly, checks the master plan for
// the ratified deploy-gate and truth-pipeline contracts, scans tracked files
// for key material, and proves the gate CAN FAIL via planted corrupt states.
//
// Run: npx tsx script/m41/verify-governance.ts
// Evidence: validation/m41/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m41/results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")
const PLAN_PATH = path.join(ROOT, "docs/m41/M41-MASTER-PLAN.md")
const CONTRACT_PATH = path.join(ROOT, "docs/M14-HONESTY-CONTRACT.md")
const EVIDENCE_PATH = path.join(RESULTS, "G1.json")

const EXPECTED_CODES = ["G1", "T1", "T2", "T3", "S1", "S2", "D1", "X1"]
// Real GitHub issue numbers (milestone 41). Enforced exactly.
const REAL_ISSUE_NUMBERS: Record<string, number> = {
  G1: 640,
  T1: 641,
  T2: 642,
  T3: 643,
  S1: 644,
  S2: 645,
  D1: 646,
  X1: 647,
}
const KEY_PATTERNS: Array<[string, RegExp]> = [
  ["openrouter", /sk-or-v1-[0-9a-f]{16,}/],
  ["nvidia", /nvapi-[A-Za-z0-9_-]{20,}/],
]
const BANNED_TERMS = [
  "perfect", "perfection", "production-ready", "bulletproof",
  "rock-solid", "battle-tested", "extensively tested", "thoroughly reviewed",
]

interface Issue {
  code: string
  githubIssue: number
  tool: string
  status: string
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  evidence?: {
    status: string
    currentCommit: string
    verifierCommand: string
    evidenceFile: string
    generatedAt: string
    passed: number
    failed: number
    negativeCases: number
  }
}
interface Ledger {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  status: string
  authority: string
  governingContract: string
  issueNumberPolicy?: { state: string }
  secretHygiene?: { keyStorage: string; guard: string }
  issues: Issue[]
}

let checks = 0
let passed = 0
let negatives = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

function negative(label: string, condition: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, condition, detail)
}

function isClosable(issue: Issue): boolean {
  if (issue.status === "planned") return false
  if (!issue.evidence) return false
  const e = issue.evidence
  return Boolean(
    e.status === issue.status &&
      e.currentCommit &&
      e.verifierCommand &&
      e.evidenceFile &&
      e.generatedAt &&
      e.passed > 0 &&
      e.failed === 0 &&
      e.negativeCases > 0,
  )
}

function validateLedger(ledger: Ledger, plan: string, contract: string): string[] {
  const errors: string[] = []
  if (ledger.schemaVersion !== 1) errors.push("schemaVersion")
  if (ledger.milestone !== "M41" || ledger.githubMilestone !== 41) errors.push("milestone")
  if (ledger.status !== "open") errors.push("status")
  if (!ledger.authority || !ledger.authority.includes("docs/m41/M41-MASTER-PLAN.md")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("M14")) errors.push("contract")
  if (!ledger.evidencePolicy) errors.push("evidence-policy")
  if (!ledger.secretHygiene || !plan.includes("Honesty notes")) errors.push("secret-hygiene")
  if (!Array.isArray(ledger.issues) || ledger.issues.length !== EXPECTED_CODES.length) errors.push("issue-count")
  const codes = new Set<string>()
  const githubNumbers = new Set<number>()
  for (const issue of ledger.issues ?? []) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || githubNumbers.has(issue.githubIssue)) errors.push(`github-issue-dup:${issue.code}`)
    githubNumbers.add(issue.githubIssue)
    if (issue.githubIssue !== REAL_ISSUE_NUMBERS[issue.code]) errors.push(`github-issue-exact:${issue.code}`)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  const order = (ledger.issues ?? []).map((i) => i.code)
  if (order[0] !== "G1") errors.push("order:g1-first")
  if (order[order.length - 1] !== "X1") errors.push("order:x1-last")
  return errors
}

function gitTrackedFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function gitCheckIgnored(relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", relPath], { cwd: ROOT })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Positive checks
// ---------------------------------------------------------------------------

console.log("M41.G1 governance verifier")

const ledger: Ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
const plan = readFileSync(PLAN_PATH, "utf8")
const contract = readFileSync(CONTRACT_PATH, "utf8")

check("G1: ledger has authoritative M41 identity", ledger.milestone === "M41" && ledger.githubMilestone === 41)
const errors = validateLedger(ledger, plan, contract)
check("G1: all 8 issue entries are unique, structurally complete, correctly ordered", errors.length === 0, errors.join(","))
check("G1: core truth rule is declared in the master plan", plan.includes("No claim on the site that is not generated") && plan.includes("No deploy unless every gate is green"))
check("G1: governing contract is wired (M14 honesty contract)", ledger.governingContract === "docs/M14-HONESTY-CONTRACT.md" && contract.includes("M14"))
check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
check("G1: known-gap and blocked states cannot be verified by wording", plan.includes("known-gap") && plan.includes("blocked") && plan.includes("never estimated"))
check("G1: real issue-number policy declared", ledger.issueNumberPolicy?.state === "real" && plan.includes("G1=#640") && plan.includes("X1=#647"))
check("G1: ledger numbers match the filed GitHub issues exactly", EXPECTED_CODES.every((c) => ledger.issues.find((i) => i.code === c)?.githubIssue === REAL_ISSUE_NUMBERS[c]))
check("G1: non-goals declared (no product code, no release work, no fake numbers)", plan.includes("Non-goals (explicit)") && plan.includes("No product code changes") && plan.includes("No fake numbers ever"))
check("G1: deploy-gate contract ratified in plan (CI + Vercel wait-for-checks)", plan.includes("Deploy-gate mechanics (ratified: CI + Vercel wait-for-checks)"))
check("G1: truth pipeline is the declared mechanism", plan.includes("generate-site-truth.ts") && plan.includes("truth.generated.ts"))
check("G1: truth-invariance constraint on design is declared", plan.includes("Truth invariance constraint") && plan.includes("T2/T3/S1"))
check("G1: X1 closes last in the plan", /X1 closes last|### X1/.test(plan))
check("G1: S2 onboarding requires owner confirmation (nothing impersonated)", plan.includes("owner confirms dashboards") || plan.includes("owner performs dashboard"))

const tracked = gitTrackedFiles()
check("G1: git repository is available for hygiene checks", tracked.length > 0)
check("G1: .env.local is gitignored", gitCheckIgnored(".env.local") || gitCheckIgnored("env.local"))
check("G1: secret-hygiene block present in ledger", Boolean(ledger.secretHygiene?.keyStorage && ledger.secretHygiene?.guard))

let leaked: string[] = []
for (const rel of tracked) {
  let content: string
  try {
    content = readFileSync(path.join(ROOT, rel), "utf8")
  } catch {
    continue
  }
  for (const [name, p] of KEY_PATTERNS) {
    if (p.test(content)) leaked.push(`${rel} (${name})`)
  }
}
check("G1: no raw provider key material in tracked files", leaked.length === 0, leaked.join(", "))

let bannedHits: string[] = []
for (const rel of ["docs/m41/M41-MASTER-PLAN.md", "validation/m41/results/manifest.json"]) {
  const content = readFileSync(path.join(ROOT, rel), "utf8").toLowerCase()
  for (const term of BANNED_TERMS) {
    if (content.includes(term)) bannedHits.push(`${rel}: ${term}`)
  }
}
check("G1: banned vocabulary absent from M41 artifacts", bannedHits.length === 0, bannedHits.join(", "))

// ---------------------------------------------------------------------------
// Ledger ↔ artifact agreement
// ---------------------------------------------------------------------------
//
// A verified ledger entry must MATCH the evidence file it names: same commit,
// same pass/fail counts, same negative-case count. Without this, a re-run can
// move the artifacts while the ledger keeps citing an older commit, and a
// "one-commit evidence batch" only looks uniform.
//
// Found here 2026-09-12: M41's T2 and T3 entries cited pre-re-pin commits and a
// passed-count of 49 while their files on disk said 50.
//
// generatedAt is deliberately NOT compared: G1 rewrites its own evidence in the
// very run that validates this ledger, so a timestamp comparison could never
// settle. Commit + counts are stable across a deterministic re-run at one HEAD.
//
// G1's OWN entry is excluded from the comparison for the same reason: this run
// rewrites G1.json, so requiring the ledger's G1 entry to match the artifact it
// is about to replace would be unsatisfiable. Its commit is still policed by the
// reachability check below, which applies to every entry including G1.

interface EvidenceFile {
  currentCommit?: string
  passed?: number
  failed?: number
  negativeCases?: number
}

function ledgerArtifactMismatches(target: Ledger): string[] {
  const out: string[] = []
  for (const issue of target.issues) {
    if (issue.status === "planned" || !issue.evidence) continue
    if (issue.code === "G1") continue // self-reference — see the note above
    const e = issue.evidence
    let file: EvidenceFile | null = null
    try {
      file = JSON.parse(readFileSync(path.join(RESULTS, e.evidenceFile), "utf8")) as EvidenceFile
    } catch {
      file = null
    }
    if (!file) {
      out.push(`${issue.code}:unreadable`)
      continue
    }
    if (file.currentCommit !== e.currentCommit) out.push(`${issue.code}:commit`)
    if (file.passed !== e.passed) out.push(`${issue.code}:passed`)
    if (file.failed !== e.failed) out.push(`${issue.code}:failed`)
    if (file.negativeCases !== e.negativeCases) out.push(`${issue.code}:negatives`)
  }
  return out
}

const artifactMismatches = ledgerArtifactMismatches(ledger)
check(
  "G1: every verified entry matches its evidence file (commit + counts)",
  artifactMismatches.length === 0,
  `${artifactMismatches.join(", ")} — after a batch, run npx tsx script/m41/sync-ledger.ts`,
)

// Every entry must cite a commit that actually exists in this history — a
// fabricated or unreachable SHA is not evidence of anything. This applies to
// G1's own entry too, which is why the comparison above can safely skip it.
function commitReachableInHistory(sha: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return false
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}

const unreachableCommits = ledger.issues
  .filter((i) => i.status !== "planned" && i.evidence)
  .filter((i) => !commitReachableInHistory(i.evidence!.currentCommit))
  .map((i) => `${i.code}:${i.evidence!.currentCommit.slice(0, 8)}`)
check("G1: every verified entry cites a commit that exists in this history", unreachableCommits.length === 0, unreachableCommits.join(", "))

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

// ---------------------------------------------------------------------------
// Negative checks — the audit must be able to FAIL
// ---------------------------------------------------------------------------

const hollow = structuredClone(ledger)
hollow.issues[1]!.status = "verified"
hollow.issues[1]!.evidence = { status: "verified", currentCommit: "x", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 0, failed: 0, negativeCases: 0 }
negative("G1: hollow verified issue is rejected", validateLedger(hollow, plan, contract).some((e) => e.startsWith("hollow-verified:T1")))

const noNegatives = structuredClone(ledger)
noNegatives.issues[1]!.status = "verified"
noNegatives.issues[1]!.evidence = { status: "verified", currentCommit: "x", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 3, failed: 0, negativeCases: 0 }
negative("G1: evidence without negative cases is not closable", validateLedger(noNegatives, plan, contract).some((e) => e.startsWith("hollow-verified:T1")))

const removed = structuredClone(ledger)
removed.issues = removed.issues.filter((i) => i.code !== "T1")
negative("G1: removing an issue is rejected", validateLedger(removed, plan, contract).includes("issue-count"))

const renumbered = structuredClone(ledger)
renumbered.issues[2]!.githubIssue = ledger.issues[0]!.githubIssue
negative("G1: duplicate issue number is rejected", validateLedger(renumbered, plan, contract).some((e) => e.startsWith("github-issue-dup:T2")))

const provisional = structuredClone(ledger)
provisional.issues[2]!.githubIssue = 834002
negative("G1: provisional placeholder number is rejected", validateLedger(provisional, plan, contract).some((e) => e.startsWith("github-issue-exact:T2")))

const wrongNumber = structuredClone(ledger)
wrongNumber.issues[2]!.githubIssue = 999999
negative("G1: unknown issue number is rejected", validateLedger(wrongNumber, plan, contract).some((e) => e.startsWith("github-issue-exact:T2")))

const leakPatternWorks = KEY_PATTERNS.some(([, p]) => p.test("sk-or-v1-" + "a".repeat(32))) && KEY_PATTERNS.some(([, p]) => p.test("nvapi-" + "X".repeat(24)))
negative("G1: key-leak patterns detect planted key shapes", leakPatternWorks)

// N (real ledger, real files): an entry citing a commit its evidence file does
// not carry must be rejected. T2 is verified in this ledger (asserted above), so
// the planted state is forced on a clone rather than depending on live status.
const staleCommitLedger = structuredClone(ledger)
const staleCommitIssue = staleCommitLedger.issues.find((i) => i.code === "T2")
if (staleCommitIssue?.evidence) staleCommitIssue.evidence.currentCommit = "0".repeat(40)
negative(
  "G1: entry citing a different evidence commit is rejected",
  Boolean(staleCommitIssue?.evidence) && ledgerArtifactMismatches(staleCommitLedger).includes("T2:commit"),
)

// N: drifted check counts must be rejected too (the 49-vs-50 case found here).
// The planted value is the FILE's count + 1, not the ledger's + 1: an increment
// of a stale entry can land back on the file's value and the mutant would
// survive by accident. Forcing it against the artifact guarantees the drift.
const staleCountsLedger = structuredClone(ledger)
const staleCountsIssue = staleCountsLedger.issues.find((i) => i.code === "T2")
const staleCountsFile = staleCountsIssue?.evidence
  ? (JSON.parse(readFileSync(path.join(RESULTS, staleCountsIssue.evidence.evidenceFile), "utf8")) as EvidenceFile)
  : null
if (staleCountsIssue?.evidence && staleCountsFile?.passed !== undefined) {
  staleCountsIssue.evidence.passed = staleCountsFile.passed + 1
}
negative(
  "G1: entry with drifted check counts is rejected",
  Boolean(staleCountsIssue?.evidence) && Boolean(staleCountsFile) && ledgerArtifactMismatches(staleCountsLedger).includes("T2:passed"),
)

// N: a fabricated or unreachable commit is not evidence. (Checked against the
// real repository history, so this probe cannot pass by accident.)
negative("G1: unreachable evidence commit is rejected", !commitReachableInHistory("0".repeat(40)) && !commitReachableInHistory("not-a-sha"))

const fabricated = structuredClone(ledger)
// Force the fabricated state explicitly: status planned + evidence attached.
// (Must not depend on T1's real ledger status, which progresses to verified.)
fabricated.issues[1]!.status = "planned"
fabricated.issues[1]!.evidence = { status: "verified", currentCommit: "deadbeef", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 1, failed: 0, negativeCases: 1 }
negative("G1: planned-with-evidence fabrication is rejected", validateLedger(fabricated, plan, contract).some((e) => e.startsWith("planned-evidence:T1")))

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

const evidence = {
  issue: "M41.G1",
  code: "G1",
  milestone: "M41",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  trackedFilesScanned: tracked.length,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m41/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Secret-hygiene scan covers tracked files only; untracked local files are outside the gate by design.",
    "Key patterns match OpenRouter and NVIDIA shapes; a new provider format must be added to KEY_PATTERNS.",
    "GitHub issue numbers are enforced exactly (milestone 41, issues 640-647); refiling requires updating REAL_ISSUE_NUMBERS and the ledger together.",
    "Deploy-gate enforcement (Vercel wait-for-checks) is contractually declared here but proven end-to-end only in X1.",
    "Ledger entries are compared with their evidence files by commit and check counts, not timestamps; after any verifier re-run the batch is stale until script/m41/sync-ledger.ts is re-run. Committing without re-running is the intended closure procedure.",
    "G1's own ledger entry is excluded from the artifact comparison (this run replaces G1.json); its commit is still required to exist in history like every other entry.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
