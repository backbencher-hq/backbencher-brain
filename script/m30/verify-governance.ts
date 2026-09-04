// script/m30/verify-governance.ts — M30.G1.
//
// Governance is checked before any onboarding/feature work. This verifier
// validates the M30 ledger without pretending planned issues are verified,
// mutates in-memory copies of the ledger to prove closure rules fail, and
// enforces secret hygiene: M30 introduces provider API keys into the
// developer workflow, so key material must never appear in tracked files
// and the key store must stay gitignored.
//
// Self-contained for the M30 scope: it reads only M30 artifacts plus the
// governing M14 honesty contract. It does not import or gate on other
// milestones' code (M14/M21/M24 are separate co-agent tracks).
//
// CLI: bun run script/m30/verify-governance.ts   (exit non-zero blocks verify)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

type Issue = {
  code: string
  githubIssue: number
  tool: string
  status: "planned" | "verified" | "known-gap" | "blocked"
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  evidence?: {
    status: Issue["status"]
    currentCommit: string
    verifierCommand: string
    evidenceFile: string
    generatedAt: string
    passed: number
    failed: number
    negativeCases: number
  }
}
type Ledger = {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  title: string
  status: string
  authority: string
  governingContract: string
  evidencePolicy: Record<string, unknown>
  secretHygiene?: Record<string, unknown>
  issues: Issue[]
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const ledgerPath = path.join(ROOT, "validation/m30/results/manifest.json")
const planPath = path.join(ROOT, "docs/m30/M30-MASTER-PLAN.md")
const contractPath = path.join(ROOT, "docs/M14-HONESTY-CONTRACT.md")
const evidenceDir = path.join(ROOT, "validation/m30/results")

const EXPECTED_CODES = ["G1", "S1", "S2", "S3", "Q1", "H1", "X1"]
const EXPECTED_ISSUE_NUMBERS: Record<string, number> = {
  G1: 548,
  S1: 549,
  S2: 550,
  S3: 551,
  Q1: 552,
  H1: 553,
  X1: 554,
}
// Raw provider key patterns: OpenRouter and NVIDIA NIM. Any occurrence in a
// tracked file is a gate failure. (Pattern, not specific values — new keys of
// the same shape are caught too.)
const KEY_PATTERNS: Array<[string, RegExp]> = [
  ["openrouter", /sk-or-v1-[0-9a-f]{16,}/],
  ["nvidia", /nvapi-[A-Za-z0-9_-]{20,}/],
]
// M14 §1 banned vocabulary — M30 artifacts inherit the honesty contract.
const BANNED_TERMS = [
  "perfect", "perfection", "production-ready", "bulletproof",
  "rock-solid", "battle-tested", "extensively tested", "thoroughly reviewed",
]

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
  if (ledger.milestone !== "M30" || ledger.githubMilestone !== 30) errors.push("milestone")
  if (ledger.status !== "open") errors.push("status")
  if (!ledger.authority || !plan.includes("Authority order")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("M14")) errors.push("contract")
  if (!ledger.evidencePolicy || !plan.includes("Protocol (every issue)")) errors.push("evidence-policy")
  if (!ledger.secretHygiene || !plan.includes("Live-key test protocol")) errors.push("secret-hygiene")
  if (!Array.isArray(ledger.issues) || ledger.issues.length !== EXPECTED_CODES.length) errors.push("issue-count")
  const codes = new Set<string>()
  const githubNumbers = new Set<number>()
  for (const issue of ledger.issues ?? []) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    const expectedIssue = EXPECTED_ISSUE_NUMBERS[issue.code]
    if (expectedIssue && issue.githubIssue !== expectedIssue) errors.push(`github-issue:${issue.code}`)
    if (!Number.isInteger(issue.githubIssue) || githubNumbers.has(issue.githubIssue)) errors.push(`github-issue-dup:${issue.code}`)
    githubNumbers.add(issue.githubIssue)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  // Dependency order: G1 first, X1 (closure gate) last.
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

function currentCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

// --- Load artifacts --------------------------------------------------------
const ledger: Ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
const plan = readFileSync(planPath, "utf8")
const contract = existsSync(contractPath) ? readFileSync(contractPath, "utf8") : ""

console.log("M30.G1 governance verifier")
console.log(`  ledger:    ${path.relative(ROOT, ledgerPath)}`)
console.log(`  plan:      ${path.relative(ROOT, planPath)}`)
console.log(`  commit:    ${currentCommit()}`)

// --- Positive checks -------------------------------------------------------
check("G1: ledger has authoritative M30 identity", ledger.milestone === "M30" && ledger.githubMilestone === 30)
const errors = validateLedger(ledger, plan, contract)
check("G1: all 7 issue entries are unique, structurally complete, correctly numbered", errors.length === 0, errors.join(","))
check("G1: authority order is documented in the master plan", plan.includes("Authority order") && plan.includes("Executable implementation"))
check("G1: governing contract is wired (M14 honesty contract)", ledger.governingContract === "docs/M14-HONESTY-CONTRACT.md" && contract.includes("Banned vocabulary"))
check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
check("G1: closure standard requires current evidence", plan.includes("currentCommit") || plan.includes("current commit"))
check("G1: known-gap and blocked states cannot be verified by wording", plan.includes("known-gap") && plan.includes("blocked") && plan.includes("never silently skipped"))
check("G1: live-key protocol is declared", plan.includes("BB_M30_LIVE_KEYS=1") && plan.includes("key fingerprint"))
check("G1: ownership boundary declared (no MCP tool surface changes)", plan.includes("Non-goals / ownership boundary") && plan.includes("src/mcp/"))
check("G1: dependency order in ledger (G1 first, X1 last)", !errors.some((e) => e.startsWith("order:")), errors.filter((e) => e.startsWith("order:")).join(","))

// --- Secret hygiene (positive) --------------------------------------------
const tracked = gitTrackedFiles()
check("G1: git repository is available for hygiene checks", tracked.length > 0)
check("G1: .env.local is gitignored", gitCheckIgnored("env.local") || gitCheckIgnored(".env.local"))
check("G1: .gitignore declares .env*.local", existsSync(path.join(ROOT, ".gitignore")) && readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes(".env*.local"))
check("G1: secret-hygiene block present in ledger", Boolean(ledger.secretHygiene?.keyStorage && ledger.secretHygiene?.guard))

let leaked: string[] = []
for (const rel of tracked) {
  const full = path.join(ROOT, rel)
  let content: string
  try {
    content = readFileSync(full, "utf8")
  } catch {
    continue // binary or unreadable — skip
  }
  for (const [name, pattern] of KEY_PATTERNS) {
    if (pattern.test(content)) leaked.push(`${rel} (${name})`)
  }
}
check("G1: no raw provider key material in any tracked file", leaked.length === 0, leaked.join(", "))

// Banned vocabulary in M30 artifacts (docs + evidence only; code may quote the
// contract itself, so we lint the master plan and ledger).
const m30Texts = [plan, JSON.stringify(ledger)]
const bannedHits: string[] = []
for (const term of BANNED_TERMS) {
  for (const text of m30Texts) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) bannedHits.push(term)
  }
}
check("G1: no banned vocabulary in M30 artifacts", bannedHits.length === 0, [...new Set(bannedHits)].join(", "))

// --- Negative checks (mutation proofs) ------------------------------------
// A verified issue without evidence must be rejected.
const hollow = structuredClone(ledger)
hollow.issues[1]!.status = "verified"
delete hollow.issues[1]!.evidence
negative("G1: verified without evidence is rejected", validateLedger(hollow, plan, contract).some((e) => e.startsWith("hollow-verified:S1")))

// A known-gap without evidence is equally unsubstantiated.
const hollowGap = structuredClone(ledger)
hollowGap.issues[2]!.status = "known-gap"
delete hollowGap.issues[2]!.evidence
negative("G1: known-gap without evidence is rejected", validateLedger(hollowGap, plan, contract).some((e) => e.startsWith("hollow-known-gap:S2")))

// Planned issues must not carry evidence. The status is pinned explicitly
// because ledger progress (S3 now verified) must not break this negative.
const fabricated = structuredClone(ledger)
fabricated.issues[3]!.status = "planned"
fabricated.issues[3]!.evidence = {
  status: "planned",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m30/verify-s3.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 0,
  negativeCases: 3,
}
negative("G1: planned issue with evidence is rejected", validateLedger(fabricated, plan, contract).some((e) => e.startsWith("planned-evidence:S3")))

// Evidence with real failures cannot close.
const failing = structuredClone(ledger)
failing.issues[3]!.status = "verified"
failing.issues[3]!.evidence = {
  status: "verified",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m30/verify-s3.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 2,
  negativeCases: 3,
}
negative("G1: evidence with failures is not closable", validateLedger(failing, plan, contract).some((e) => e.startsWith("hollow-verified:S3")))

// Evidence without negative cases cannot close.
const noNegatives = structuredClone(ledger)
noNegatives.issues[3]!.status = "verified"
noNegatives.issues[3]!.evidence = {
  status: "verified",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m30/verify-s3.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 0,
  negativeCases: 0,
}
negative("G1: evidence without negative cases is not closable", validateLedger(noNegatives, plan, contract).some((e) => e.startsWith("hollow-verified:S3")))

// Removing an issue must be rejected.
const removed = structuredClone(ledger)
removed.issues = removed.issues.filter((i) => i.code !== "Q1")
negative("G1: removing an issue is rejected", validateLedger(removed, plan, contract).includes("issue-count"))

// Renumbering an issue must be rejected (ledger must mirror GitHub).
const renumbered = structuredClone(ledger)
renumbered.issues[4]!.githubIssue = 999
negative("G1: renumbered GitHub issue is rejected", validateLedger(renumbered, plan, contract).some((e) => e.startsWith("github-issue:Q1")))

// A planted key leak in a tracked file must be caught by the pattern.
const leakPatternWorks = KEY_PATTERNS.some(([, p]) => p.test("sk-or-v1-" + "a".repeat(32))) && KEY_PATTERNS.some(([, p]) => p.test("nvapi-" + "X".repeat(24)))
negative("G1: key-leak patterns detect planted key shapes", leakPatternWorks)

// --- Verdict + evidence ---------------------------------------------------
const ok = passed === checks
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("VERDICT: FAIL — governance gate blocks verify")
  process.exit(1)
}
console.log("VERDICT: PASS")

const evidence = {
  status: "verified",
  milestone: "M30",
  issue: "G1",
  currentCommit: currentCommit(),
  verifierCommand: "bun run script/m30/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  trackedFilesScanned: tracked.length,
  keyPatternsChecked: KEY_PATTERNS.map(([name]) => name),
  limitations: [
    "Secret-hygiene scan covers tracked files only; untracked local files are outside the gate by design (.env.local is gitignored).",
    "Key patterns match OpenRouter (sk-or-v1-…) and NVIDIA (nvapi-…) shapes; a provider with a different key format must be added to KEY_PATTERNS.",
    "Banned-vocabulary lint covers M30 docs and the ledger, not arbitrary source comments.",
  ],
}
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(path.join(evidenceDir, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, path.join(evidenceDir, "G1.json"))}`)
