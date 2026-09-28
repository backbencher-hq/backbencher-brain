// script/m32/verify-governance.ts — M32.G1.
//
// Governance is checked before any feature work. This verifier validates the
// M32 ledger without pretending planned issues are verified, mutates
// in-memory copies of the ledger to prove closure rules fail, and enforces
// secret hygiene: M32 adds commands that DISPLAY embedding config, so the
// gate must prove those surfaces can never emit full key material.
//
// Self-contained for the M32 scope: it reads only M32 artifacts plus the
// governing M14 honesty contract. It does not import or gate on other
// milestones' code (M14/M21/M24/M31 are separate co-agent tracks).
//
// CLI: npx tsx script/m32/verify-governance.ts   (exit non-zero blocks verify)

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
  issueNumberPolicy?: { state: string; note: string }
  issues: Issue[]
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const ledgerPath = path.join(ROOT, "validation/m32/results/manifest.json")
const planPath = path.join(ROOT, "docs/m32/M32-MASTER-PLAN.md")
const contractPath = path.join(ROOT, "docs/M14-HONESTY-CONTRACT.md")
const evidenceDir = path.join(ROOT, "validation/m32/results")

const EXPECTED_CODES = ["G1", "SM1", "S1", "S2", "S3", "H1", "X1"]
// Real GitHub issue numbers (milestone 32). Enforced exactly — a provisional
// or unknown number is a gate failure, so the ledger cannot drift from GitHub.
const REAL_ISSUE_NUMBERS: Record<string, number> = {
  G1: 561,
  SM1: 562,
  S1: 563,
  S2: 564,
  S3: 565,
  H1: 566,
  X1: 567,
}
// Raw provider key patterns (OpenRouter and NVIDIA NIM). Any occurrence in a
// tracked file is a gate failure. (Pattern, not specific values — new keys of
// the same shape are caught too.)
const KEY_PATTERNS: Array<[string, RegExp]> = [
  ["openrouter", /sk-or-v1-[0-9a-f]{16,}/],
  ["nvidia", /nvapi-[A-Za-z0-9_-]{20,}/],
]
// M14 §1 banned vocabulary — M32 artifacts inherit the honesty contract.
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
  if (ledger.milestone !== "M32" || ledger.githubMilestone !== 32) errors.push("milestone")
  if (ledger.status !== "open") errors.push("status")
  if (!ledger.authority || !plan.includes("Authority order")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("M14")) errors.push("contract")
  if (!ledger.evidencePolicy || !plan.includes("Protocol (every issue)")) errors.push("evidence-policy")
  if (!ledger.secretHygiene || !plan.includes("fingerprint")) errors.push("secret-hygiene")
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

console.log("M32.G1 governance verifier")
console.log(`  ledger:    ${path.relative(ROOT, ledgerPath)}`)
console.log(`  plan:      ${path.relative(ROOT, planPath)}`)
console.log(`  commit:    ${currentCommit()}`)

// --- Positive checks -------------------------------------------------------
check("G1: ledger has authoritative M32 identity", ledger.milestone === "M32" && ledger.githubMilestone === 32)
const errors = validateLedger(ledger, plan, contract)
check("G1: all 7 issue entries are unique, structurally complete, correctly ordered", errors.length === 0, errors.join(","))
check("G1: authority order is documented in the master plan", plan.includes("Authority order") && plan.includes("Executable implementation"))
check("G1: governing contract is wired (M14 honesty contract)", ledger.governingContract === "docs/M14-HONESTY-CONTRACT.md" && contract.includes("Banned vocabulary"))
check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
check("G1: closure standard requires current evidence", plan.includes("currentCommit") || plan.includes("current commit"))
check("G1: known-gap and blocked states cannot be verified by wording", plan.includes("known-gap") && plan.includes("blocked") && plan.includes("never silently skipped"))
check("G1: secret-hygiene display rule declared (fingerprint, never full key)", plan.includes("fingerprint (last 4 chars only)") && plan.includes("never prints the key"))
check("G1: ownership boundary declared (no MCP tool surface changes)", plan.includes("Non-goals / ownership boundary") && plan.includes("src/mcp/"))
check("G1: dependency order in ledger (G1 first, X1 last)", !errors.some((e) => e.startsWith("order:")), errors.filter((e) => e.startsWith("order:")).join(","))
check("G1: real issue-number policy declared", ledger.issueNumberPolicy?.state === "real" && plan.includes("GitHub issue numbers"))
check("G1: ledger numbers match the filed GitHub issues exactly", EXPECTED_CODES.every((c) => ledger.issues.find((i) => i.code === c)?.githubIssue === REAL_ISSUE_NUMBERS[c]))

// --- Secret hygiene (positive) --------------------------------------------
const tracked = gitTrackedFiles()
check("G1: git repository is available for hygiene checks", tracked.length > 0)
check("G1: .env.local is gitignored", gitCheckIgnored("env.local") || gitCheckIgnored(".env.local"))
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

// Banned vocabulary in M32 artifacts (docs + evidence only; code may quote the
// contract itself, so we lint the master plan and ledger).
const m32Texts = [plan, JSON.stringify(ledger)]
const bannedHits: string[] = []
for (const term of BANNED_TERMS) {
  for (const text of m32Texts) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) bannedHits.push(term)
  }
}
check("G1: no banned vocabulary in M32 artifacts", bannedHits.length === 0, [...new Set(bannedHits)].join(", "))

// --- Negative checks (mutation proofs) ------------------------------------
// A verified issue without evidence must be rejected.
const hollow = structuredClone(ledger)
hollow.issues[2]!.status = "verified"
delete hollow.issues[2]!.evidence
negative("G1: verified without evidence is rejected", validateLedger(hollow, plan, contract).some((e) => e.startsWith("hollow-verified:S1")))

// A known-gap without evidence is equally unsubstantiated.
const hollowGap = structuredClone(ledger)
hollowGap.issues[3]!.status = "known-gap"
delete hollowGap.issues[3]!.evidence
negative("G1: known-gap without evidence is rejected", validateLedger(hollowGap, plan, contract).some((e) => e.startsWith("hollow-known-gap:S2")))

// Planned issues must not carry evidence. Status pinned explicitly so ledger
// progress cannot break this negative.
const fabricated = structuredClone(ledger)
fabricated.issues[3]!.status = "planned"
fabricated.issues[3]!.evidence = {
  status: "planned",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m32/verify-s2.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 0,
  negativeCases: 3,
}
negative("G1: planned issue with evidence is rejected", validateLedger(fabricated, plan, contract).some((e) => e.startsWith("planned-evidence:S2")))

// Evidence with real failures cannot close.
const failing = structuredClone(ledger)
failing.issues[3]!.status = "verified"
failing.issues[3]!.evidence = {
  status: "verified",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m32/verify-s2.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 2,
  negativeCases: 3,
}
negative("G1: evidence with failures is not closable", validateLedger(failing, plan, contract).some((e) => e.startsWith("hollow-verified:S2")))

// Evidence without negative cases cannot close.
const noNegatives = structuredClone(ledger)
noNegatives.issues[3]!.status = "verified"
noNegatives.issues[3]!.evidence = {
  status: "verified",
  currentCommit: "deadbeef",
  verifierCommand: "npx tsx script/m32/verify-s2.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  passed: 10,
  failed: 0,
  negativeCases: 0,
}
negative("G1: evidence without negative cases is not closable", validateLedger(noNegatives, plan, contract).some((e) => e.startsWith("hollow-verified:S2")))

// Removing an issue must be rejected.
const removed = structuredClone(ledger)
removed.issues = removed.issues.filter((i) => i.code !== "S1")
negative("G1: removing an issue is rejected", validateLedger(removed, plan, contract).includes("issue-count"))

// Duplicate issue numbers must be rejected (uniqueness is enforced even
// though exact values are now also enforced).
const renumbered = structuredClone(ledger)
renumbered.issues[4]!.githubIssue = ledger.issues[0]!.githubIssue
negative("G1: duplicate issue number is rejected", validateLedger(renumbered, plan, contract).some((e) => e.startsWith("github-issue-dup:S3")))

// A provisional placeholder number must be rejected now that real issues exist.
const provisional = structuredClone(ledger)
provisional.issues[2]!.githubIssue = 832003
negative("G1: provisional placeholder number is rejected", validateLedger(provisional, plan, contract).some((e) => e.startsWith("github-issue-exact:S1")))

// An unknown real-looking number must be rejected too.
const wrongNumber = structuredClone(ledger)
wrongNumber.issues[2]!.githubIssue = 999999
negative("G1: unknown issue number is rejected", validateLedger(wrongNumber, plan, contract).some((e) => e.startsWith("github-issue-exact:S1")))

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
  milestone: "M32",
  issue: "G1",
  currentCommit: currentCommit(),
  verifierCommand: "npx tsx script/m32/verify-governance.ts",
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
    "Banned-vocabulary lint covers M32 docs and the ledger, not arbitrary source comments.",
    "GitHub issue numbers are enforced exactly (milestone 32, issues 561–567); refiling on GitHub requires updating REAL_ISSUE_NUMBERS and the ledger together.",
  ],
}
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(path.join(evidenceDir, "G1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, path.join(evidenceDir, "G1.json"))}`)
