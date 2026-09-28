// script/m34/verify-governance.ts — M34.G1.
//
// Governance for M34 (Consumability Hardening). Validates the ledger with
// the REAL GitHub issue numbers enforced exactly, lints M34 docs for banned
// vocabulary, scans tracked files for key material, and proves the gate CAN
// FAIL via planted corrupt states.
//
// Run: npx tsx script/m34/verify-governance.ts
// Evidence: validation/m34/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m34/results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")
const PLAN_PATH = path.join(ROOT, "docs/m34/M34-MASTER-PLAN.md")
const CONTRACT_PATH = path.join(ROOT, "docs/M14-HONESTY-CONTRACT.md")
const EVIDENCE_PATH = path.join(RESULTS, "G1.json")

const EXPECTED_CODES = ["G1", "S1", "S2", "X1"]
// Real GitHub issue numbers (milestone 34). Enforced exactly.
const REAL_ISSUE_NUMBERS: Record<string, number> = {
  G1: 575,
  S1: 576,
  S2: 577,
  X1: 578,
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
  if (ledger.milestone !== "M34" || ledger.githubMilestone !== 34) errors.push("milestone")
  if (ledger.status !== "open") errors.push("status")
  if (!ledger.authority || !plan.includes("Authority order")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("M14")) errors.push("contract")
  if (!ledger.evidencePolicy || !plan.includes("Protocol (every issue)")) errors.push("evidence-policy")
  if (!ledger.secretHygiene || !plan.includes("honesty")) errors.push("secret-hygiene")
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

console.log("M34.G1 governance verifier")

const ledger: Ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
const plan = readFileSync(PLAN_PATH, "utf8")
const contract = readFileSync(CONTRACT_PATH, "utf8")

check("G1: ledger has authoritative M34 identity", ledger.milestone === "M34" && ledger.githubMilestone === 34)
const errors = validateLedger(ledger, plan, contract)
check("G1: all 4 issue entries are unique, structurally complete, correctly ordered", errors.length === 0, errors.join(","))
check("G1: authority order is documented in the master plan", plan.includes("Authority order") && plan.includes("Executable implementation"))
check("G1: governing contract is wired (M14 honesty contract)", ledger.governingContract === "docs/M14-HONESTY-CONTRACT.md" && contract.includes("Banned vocabulary"))
check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
check("G1: known-gap and blocked states cannot be verified by wording", plan.includes("known-gap") && plan.includes("blocked") && plan.includes("never silently skipped"))
check("G1: real issue-number policy declared", ledger.issueNumberPolicy?.state === "real" && plan.includes("GitHub issue numbers"))
check("G1: ledger numbers match the filed GitHub issues exactly", EXPECTED_CODES.every((c) => ledger.issues.find((i) => i.code === c)?.githubIssue === REAL_ISSUE_NUMBERS[c]))
check("G1: ownership boundary declared (no CI changes, no MCP surface)", plan.includes("Non-goals / ownership boundary") && plan.includes("No CI changes") && plan.includes("src/mcp/"))
check("G1: X1 closes last in the plan", /X1 closes last/.test(plan))
check("G1: completion bar has 3 items", [1, 2, 3].every((n) => (plan.split("## Completion bar")[1] ?? "").includes(`\n${n}. `)))
check("G1: install-smoke honesty (workspace vs installed) declared in plan", plan.includes("broken when installed"))

const tracked = gitTrackedFiles()
check("G1: git repository is available for hygiene checks", tracked.length > 0)
check("G1: .env.local is gitignored", gitCheckIgnored("env.local") || gitCheckIgnored(".env.local"))
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
for (const rel of ["docs/m34/M34-MASTER-PLAN.md", "validation/m34/results/manifest.json"]) {
  const content = readFileSync(path.join(ROOT, rel), "utf8").toLowerCase()
  for (const term of BANNED_TERMS) {
    if (content.includes(term)) bannedHits.push(`${rel}: ${term}`)
  }
}
check("G1: banned vocabulary absent from M34 artifacts", bannedHits.length === 0, bannedHits.join(", "))

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
negative("G1: hollow verified issue is rejected", validateLedger(hollow, plan, contract).some((e) => e.startsWith("hollow-verified:S1")))

const noNegatives = structuredClone(ledger)
noNegatives.issues[1]!.status = "verified"
noNegatives.issues[1]!.evidence = { status: "verified", currentCommit: "x", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 3, failed: 0, negativeCases: 0 }
negative("G1: evidence without negative cases is not closable", validateLedger(noNegatives, plan, contract).some((e) => e.startsWith("hollow-verified:S1")))

const removed = structuredClone(ledger)
removed.issues = removed.issues.filter((i) => i.code !== "S1")
negative("G1: removing an issue is rejected", validateLedger(removed, plan, contract).includes("issue-count"))

const renumbered = structuredClone(ledger)
renumbered.issues[2]!.githubIssue = ledger.issues[0]!.githubIssue
negative("G1: duplicate issue number is rejected", validateLedger(renumbered, plan, contract).some((e) => e.startsWith("github-issue-dup:S2")))

const provisional = structuredClone(ledger)
provisional.issues[2]!.githubIssue = 834002
negative("G1: provisional placeholder number is rejected", validateLedger(provisional, plan, contract).some((e) => e.startsWith("github-issue-exact:S2")))

const wrongNumber = structuredClone(ledger)
wrongNumber.issues[2]!.githubIssue = 999999
negative("G1: unknown issue number is rejected", validateLedger(wrongNumber, plan, contract).some((e) => e.startsWith("github-issue-exact:S2")))

const leakPatternWorks = KEY_PATTERNS.some(([, p]) => p.test("sk-or-v1-" + "a".repeat(32))) && KEY_PATTERNS.some(([, p]) => p.test("nvapi-" + "X".repeat(24)))
negative("G1: key-leak patterns detect planted key shapes", leakPatternWorks)

const fabricated = structuredClone(ledger)
// Force the fabricated state explicitly: status planned + evidence attached.
// (Must not depend on S1's real ledger status, which progresses to verified.)
fabricated.issues[1]!.status = "planned"
fabricated.issues[1]!.evidence = { status: "verified", currentCommit: "deadbeef", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 1, failed: 0, negativeCases: 1 }
negative("G1: planned-with-evidence fabrication is rejected", validateLedger(fabricated, plan, contract).some((e) => e.startsWith("planned-evidence:S1")))

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
  issue: "M34.G1",
  code: "G1",
  milestone: "M34",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  trackedFilesScanned: tracked.length,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m34/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Secret-hygiene scan covers tracked files only; untracked local files are outside the gate by design.",
    "Key patterns match OpenRouter and NVIDIA shapes; a new provider format must be added to KEY_PATTERNS.",
    "GitHub issue numbers are enforced exactly (milestone 34, issues 575–578); refiling requires updating REAL_ISSUE_NUMBERS and the ledger together.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
