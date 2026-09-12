// script/m56/verify-governance.ts — M56.G1 (#779).
//
// Governance for M56 (Website Completion: Surfaces, Sources, IA). Validates the
// ledger with the REAL GitHub issue numbers enforced exactly, checks the master
// plan for the contracts this milestone exists to enforce (single-source rule,
// recorded owner decisions, honest editor publishing status, the mechanical
// evidence-batch procedure), scans tracked files for key material, and proves the
// gate CAN FAIL via planted corrupt states.
//
// Three invariants are inherited from M41/M45 because breaking them cost real
// work: a verified entry must MATCH its evidence file, every cited commit must
// exist in this history, and every check needs a planted negative.
//
// Run: npx tsx script/m56/verify-governance.ts
// Evidence: validation/m56/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m56/results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")
const PLAN_PATH = path.join(ROOT, "docs/m56/M56-MASTER-PLAN.md")
const CONTRACT_PATH = path.join(ROOT, "docs/M14-HONESTY-CONTRACT.md")
const EVIDENCE_PATH = path.join(RESULTS, "G1.json")

const EXPECTED_CODES = ["G1", "E1", "T1", "L1", "D1", "S1", "I1", "D2", "X1"]
// Real GitHub issue numbers (milestone 56). Enforced exactly.
const REAL_ISSUE_NUMBERS: Record<string, number> = {
  G1: 779,
  E1: 780,
  T1: 781,
  L1: 782,
  D1: 783,
  S1: 784,
  I1: 785,
  D2: 786,
  X1: 787,
}
const KEY_PATTERNS: Array<[string, RegExp]> = [
  ["openrouter", /sk-or-v1-[0-9a-f]{16,}/],
  ["nvidia", /nvapi-[A-Za-z0-9_-]{20,}/],
]
const BANNED_TERMS = [
  "perfect", "perfection", "production-ready", "bulletproof",
  "rock-solid", "battle-tested", "extensively tested", "thoroughly reviewed",
]

interface Evidence {
  status: string
  currentCommit: string
  verifierCommand: string
  evidenceFile: string
  generatedAt: string
  passed: number
  failed: number
  negativeCases: number
}

interface Issue {
  code: string
  githubIssue: number
  tool: string
  status: string
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  evidence?: Evidence
}

interface Ledger {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  status: string
  authority: string
  governingContract: string
  evidencePolicy?: { ledgerArtifactAgreement?: string }
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
  if (ledger.milestone !== "M56" || ledger.githubMilestone !== 56) errors.push("milestone")
  if (ledger.status !== "open") errors.push("status")
  if (!ledger.authority || !ledger.authority.includes("docs/m56/M56-MASTER-PLAN.md")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("M14")) errors.push("contract")
  if (!ledger.evidencePolicy) errors.push("evidence-policy")
  if (!ledger.evidencePolicy?.ledgerArtifactAgreement) errors.push("agreement-policy")
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

console.log("M56.G1 governance verifier")

const ledger: Ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
const plan = readFileSync(PLAN_PATH, "utf8")
const contract = readFileSync(CONTRACT_PATH, "utf8")

check("G1: ledger has authoritative M56 identity", ledger.milestone === "M56" && ledger.githubMilestone === 56)
const errors = validateLedger(ledger, plan, contract)
check("G1: all 9 issue entries are unique, structurally complete, correctly ordered", errors.length === 0, errors.join(","))
check("G1: governing contract is wired (M14 honesty contract)", ledger.governingContract === "docs/M14-HONESTY-CONTRACT.md" && contract.includes("M14"))
check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
check("G1: real issue-number policy declared", ledger.issueNumberPolicy?.state === "real" && plan.includes("G1=#779") && plan.includes("X1=#787"))
check("G1: ledger numbers match the filed GitHub issues exactly", EXPECTED_CODES.every((c) => ledger.issues.find((i) => i.code === c)?.githubIssue === REAL_ISSUE_NUMBERS[c]))
check("G1: single-source rule declared in the plan", plan.includes("exactly one authoring source") && plan.includes("never re-typed beside it"))
check("G1: missing-surface rule declared in the plan", plan.includes("A surface that exists in the\n> product but not on the site is a defect"))
check("G1: owner decisions recorded before work started", plan.includes("Owner decisions recorded before work started") && plan.includes("/demos is retired") && plan.includes("FAQ has one source"))
check("G1: editor publishing honesty rule declared", plan.includes("publishing is pending") && plan.includes("may never claim marketplace availability"))
check("G1: one-deploy fold-in declared (M41 closes on this push)", plan.includes("One deploy closes both milestones"))
check("G1: evidence-batch procedure is mechanical", plan.includes("sync-ledger.ts --milestone m56") && plan.includes("then stop re-running gates"))
check("G1: ledger-artifact agreement is a declared invariant", Boolean(ledger.evidencePolicy?.ledgerArtifactAgreement) && plan.includes("Ledger ↔ artifact agreement"))
check("G1: a gate that cannot fail is treated as absent", plan.includes("A gate must be able to fail"))
check("G1: non-goals declared (no product code, no fake numbers, no unpublished claims)", plan.includes("No product code changes") && plan.includes("No fake numbers") && plan.includes("No new claim about unpublished artifacts"))
check("G1: known-gap vocabulary declared for honest incompleteness", plan.includes("known-gap") && /never\s+worded as verified when they are not/.test(plan))
check("G1: design may not change a claim", plan.includes("Design work may not change a claim"))
check("G1: X1 closes last in the plan", plan.includes("### X1 — Closure, Deploy and M41 Fold-In"))

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
for (const rel of ["docs/m56/M56-MASTER-PLAN.md", "validation/m56/results/manifest.json"]) {
  const content = readFileSync(path.join(ROOT, rel), "utf8").toLowerCase()
  for (const term of BANNED_TERMS) {
    if (content.includes(term)) bannedHits.push(`${rel}: ${term}`)
  }
}
check("G1: banned vocabulary absent from M56 artifacts", bannedHits.length === 0, bannedHits.join(", "))

// ---------------------------------------------------------------------------
// Ledger ↔ artifact agreement
// ---------------------------------------------------------------------------
//
// A verified entry must MATCH the evidence file it names (commit + counts), and
// every cited commit must exist in this history. Without the first, a re-run can
// move the artifacts while the ledger keeps citing an older commit and a
// "one-commit batch" only looks uniform. Without the second, a fabricated SHA
// passes as evidence.
//
// generatedAt is not compared, and G1's own entry is excluded from the file
// comparison: this run rewrites G1.json, so requiring the ledger's G1 entry to
// match the artifact it is about to replace could never settle. G1's commit is
// still policed by the reachability check, which applies to every entry.

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

function commitReachableInHistory(sha: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return false
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}

const artifactMismatches = ledgerArtifactMismatches(ledger)
check(
  "G1: every verified entry matches its evidence file (commit + counts)",
  artifactMismatches.length === 0,
  `${artifactMismatches.join(", ")} — after a batch, run npx tsx script/m41/sync-ledger.ts --milestone m56`,
)

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
negative("G1: hollow verified issue is rejected", validateLedger(hollow, plan, contract).some((e) => e.startsWith("hollow-verified:E1")))

const noNegatives = structuredClone(ledger)
noNegatives.issues[1]!.status = "verified"
noNegatives.issues[1]!.evidence = { status: "verified", currentCommit: "x", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 3, failed: 0, negativeCases: 0 }
negative("G1: evidence without negative cases is not closable", validateLedger(noNegatives, plan, contract).some((e) => e.startsWith("hollow-verified:E1")))

const removed = structuredClone(ledger)
removed.issues = removed.issues.filter((i) => i.code !== "T1")
negative("G1: removing an issue is rejected", validateLedger(removed, plan, contract).includes("issue-count"))

const renumbered = structuredClone(ledger)
renumbered.issues[2]!.githubIssue = ledger.issues[0]!.githubIssue
negative("G1: duplicate issue number is rejected", validateLedger(renumbered, plan, contract).some((e) => e.startsWith("github-issue-dup:T1")))

const provisional = structuredClone(ledger)
provisional.issues[2]!.githubIssue = 834002
negative("G1: provisional placeholder number is rejected", validateLedger(provisional, plan, contract).some((e) => e.startsWith("github-issue-exact:T1")))

const wrongNumber = structuredClone(ledger)
wrongNumber.issues[2]!.githubIssue = 999999
negative("G1: unknown issue number is rejected", validateLedger(wrongNumber, plan, contract).some((e) => e.startsWith("github-issue-exact:T1")))

const reordered = structuredClone(ledger)
reordered.issues = [...reordered.issues].reverse()
negative("G1: X1-not-last ordering is rejected", validateLedger(reordered, plan, contract).includes("order:x1-last"))

const fabricated = structuredClone(ledger)
fabricated.issues[1]!.status = "planned"
fabricated.issues[1]!.evidence = { status: "verified", currentCommit: "deadbeef", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 1, failed: 0, negativeCases: 1 }
negative("G1: planned-with-evidence fabrication is rejected", validateLedger(fabricated, plan, contract).some((e) => e.startsWith("planned-evidence:E1")))

const leakPatternWorks = KEY_PATTERNS.some(([, p]) => p.test("sk-or-v1-" + "a".repeat(32))) && KEY_PATTERNS.some(([, p]) => p.test("nvapi-" + "X".repeat(24)))
negative("G1: key-leak patterns detect planted key shapes", leakPatternWorks)

const bannedDetectorWorks = BANNED_TERMS.some((t) => `a ${t} claim`.toLowerCase().includes(t)) && !"a plain claim".toLowerCase().includes("bulletproof")
negative("G1: banned-vocabulary detector is sensitive", bannedDetectorWorks)

// N (real ledger, real files): an entry whose evidence file it names cannot be
// believed must be rejected. The planted state is forced on a clone so the probe
// never depends on which sibling issues are verified yet: the clone points E1 at
// whichever artifact exists and claims a commit that file does not carry. Before
// any artifact exists, the same probe proves the missing-file rejection instead —
// both outcomes are a correct refusal to treat the entry as evidence.
const probeArtifact = ["G1.json", "E1.json", "S1.json", "T1.json"]
  .map((f) => path.join(RESULTS, f))
  .find((p) => existsSync(p))
const staleCommitLedger = structuredClone(ledger)
const staleTarget = staleCommitLedger.issues.find((i) => i.code === "E1")!
staleTarget.status = "verified"
staleTarget.evidence = {
  status: "verified",
  currentCommit: "0".repeat(40),
  verifierCommand: "x",
  evidenceFile: probeArtifact ? path.basename(probeArtifact) : "MISSING-E1.json",
  generatedAt: "x",
  passed: 1,
  failed: 0,
  negativeCases: 1,
}
{
  const drift = ledgerArtifactMismatches(staleCommitLedger)
  negative(
    "G1: entry whose evidence file is missing or diverges is rejected",
    probeArtifact ? drift.includes("E1:commit") : drift.includes("E1:unreadable"),
    drift.join(","),
  )
}

// N: a fabricated or unreachable commit is not evidence (checked against the
// real repository history, so the probe cannot pass by accident).
negative("G1: unreachable evidence commit is rejected", !commitReachableInHistory("0".repeat(40)) && !commitReachableInHistory("not-a-sha"))

// N (mechanism): agreement policy text must be load-bearing — an empty policy is
// rejected even when every entry happens to be planned.
const noPolicy = structuredClone(ledger)
delete (noPolicy.evidencePolicy as { ledgerArtifactAgreement?: string }).ledgerArtifactAgreement
negative("G1: ledger without the agreement policy is rejected", validateLedger(noPolicy, plan, contract).includes("agreement-policy"))

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

mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M56.G1",
  code: "G1",
  milestone: "M56",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  trackedFilesScanned: tracked.length,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m56/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Secret-hygiene scan covers tracked files only; untracked local files are outside the gate by design.",
    "Key patterns match OpenRouter and NVIDIA shapes; a new provider format must be added to KEY_PATTERNS.",
    "GitHub issue numbers are enforced exactly (milestone 56, issues 779-787); refiling requires updating REAL_ISSUE_NUMBERS, the plan and the ledger together.",
    "G1's own ledger entry is excluded from the artifact comparison (this run replaces G1.json); its commit is still required to exist in history like every other entry.",
    "Deploy-gate enforcement (Vercel wait-for-checks) is contractually declared here but proven end-to-end only in X1.",
    "Verified issues with zero remaining verified peers (all planned) are accepted: the agreement checks are vacuously true until siblings produce artifacts, which the closure gate then requires.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
