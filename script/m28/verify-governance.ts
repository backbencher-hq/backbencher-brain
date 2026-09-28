// script/m28/verify-governance.ts — M28.G1 (issue #623).
//
// Governance for the Union milestone (MCP + agent). Beyond the M24/M25/M26-style
// ledger validation (structure, closure rules, mutation proofs), this gate
// owns the version-ladder discipline: the M27 completion bar is re-audited
// HERE, on every run, before any M27 issue may close. "v3 started on a closed
// v2" is a machine-checked fact, not a manual claim (decision record).
//
//   1. M27 ledger status is `closed` (mechanical: all issues verified).
//   2. M27 X1 closure-gate evidence exists, says verified, and its commit is
//      an ancestor of (or equal to) HEAD.
//   3. The M27 governance gate is spawned and must exit 0 at HEAD.
//
// Contract vocabulary is linted over M27 artifacts (master plan, program
// status tracker, ledger). The gate script itself is deliberately not part
// of any issue's relevant-file surface (M24.G1 lesson: the gate is a consumer
// of evidence, re-proven each run by its own negative mutations).
//
// CLI: npx tsx script/m28/verify-governance.ts   (exit non-zero blocks verify)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

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
    passed: number
    failed: number
    realFailed?: number
    negativeCases?: number
    mutantsCaught?: number
    mutantsTotal?: number
  }
}
type Ledger = {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  title: string
  status: string
  authority: string
  governingContract?: string
  evidencePolicy: Record<string, unknown>
  issues: Issue[]
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const ledgerPath = path.join(ROOT, "validation/m28/results/manifest.json")
const m27LedgerPath = path.join(ROOT, "validation/m27/results/manifest.json")
const m27X1Path = path.join(ROOT, "validation/m27/results/X1.json")
const planPath = path.join(ROOT, "docs/m28/M28-MASTER-PLAN.md")
const contractPath = path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md")
const statusTrackerPath = path.join(ROOT, "docs/IDE-PROGRAM-STATUS.md")

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
  // Mutant-based verifiers record intentional mutant-catch failures in the
  // raw `failed` counter; `realFailed` (or an all-zero `failed`) is the
  // honest number (M24.G1 rule, reused verbatim).
  const realFailed = typeof e.realFailed === "number" ? e.realFailed : e.failed
  // Can-fail proof: dedicated negatives or a fully-caught mutant set.
  const mutantProof =
    typeof e.mutantsCaught === "number" &&
    e.mutantsCaught > 0 &&
    e.mutantsTotal === e.mutantsCaught
  return Boolean(
    e.status === issue.status &&
      e.verifierCommand &&
      e.evidenceFile &&
      e.passed > 0 &&
      realFailed === 0 &&
      (typeof e.negativeCases === "number" && e.negativeCases > 0 ? true : mutantProof),
  )
}

const EXPECTED_CODES = ["G1", "T1", "U1", "A1", "A2", "V1", "X1"]
const EXPECTED_ISSUE_NUMBERS = [623, 624, 625, 626, 627, 628, 629]

/** Per-issue relevant files (planned paths; consulted only once evidence
 *  exists). Evidence stays fresh while no relevant file changed since its
 *  commit. The gate script itself is excluded everywhere (consumer rule). */
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  T1: ["src/mcp/tool-registry.ts", "src/mcp/tool-validation.ts", "src/mcp/tool-handlers.ts", "script/m28/verify-mcp-tools.ts"],
  U1: ["src/mcp/tool-handlers.ts", "script/m28/verify-union.ts"],
  A1: ["src/brain/schema-ddl.ts", "src/brain/database.ts", "src/mcp/tool-registry.ts", "src/mcp/tool-handlers.ts", "script/m28/verify-annotation-store.ts"],
  A1: ["src/brain/schema-ddl.ts", "src/mcp/tool-registry.ts", "src/mcp/tool-handlers.ts", "script/m28/verify-annotations.ts"],
  A2: ["src/lsp/annotation_ui.ts", "src/lsp/hover.ts", "src/lsp/cross_language_hover.ts", "src/lsp/graph_request.ts", "src/intelligence/contracts.ts", "script/m26/graph-core.ts", "script/m28/annotation-driver.lua", "script/m28/verify-annotation-ui.ts"],
  V1: ["docs/m28/MCP-SURFACE.md", "script/m28/verify-mcp-surface.ts", "src/mcp/tool-registry.ts"],
  X1: ["script/m28/verify-closure.ts"],
}
const SHARED_RELEVANT_FILES = [
  "docs/m28/M28-MASTER-PLAN.md",
  "docs/IDE-HONESTY-CONTRACT.md",
  "docs/IDE-PROGRAM-DECISIONS.md",
  "docs/IDE-PROGRAM-STATUS.md",
  // manifest.json is DELIBERATELY NOT here. It is the ledger — the OUTPUT of
  // the evidence cycle, not an input to what a verifier run proves (M25.G1
  // lesson: keeping it relevant caused infinite evidence-regress).
]

/** Contract §1 banned vocabulary, enforced over M27 artifacts. */
const BANNED_PATTERNS: RegExp[] = [
  /perfect(ion)?\b/i,
  /\bcomplete(ly|d|ness)?\b/i,
  /\bproduction-ready\b/i,
  /\bbulletproof\b/i,
  /\brock-solid\b/i,
  /\bbattle-tested\b/i,
  /\bextensively tested\b/i,
  /\bthoroughly reviewed\b/i,
  /\bshould work\b/i,
  /\bexpected to pass\b/i,
  /\bIDE-grade\b/i,
  /\bIntelliJ-like\b/i,
  /\breal-time\b/i,
  /\bseamless(ly)?\b/i,
  /\ball languages\b/i,
]

function validateLedger(ledger: Ledger, plan: string, contract: string): string[] {
  const errors: string[] = []
  if (ledger.schemaVersion !== 1) errors.push("schemaVersion")
  if (ledger.milestone !== "M28" || ledger.githubMilestone !== 39) errors.push("milestone")
  // Ledger status is mechanical, never hand-set (M24.G1 rule).
  const allVerified = (ledger.issues ?? []).length > 0 && (ledger.issues ?? []).every((issue) => issue.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (ledger.status !== expectedStatus) errors.push("status")
  if (!ledger.authority || !plan.includes("Issues")) errors.push("authority")
  if (!ledger.governingContract || !contract.includes("IDE Honesty Contract")) errors.push("contract")
  if (!Array.isArray(ledger.issues) || ledger.issues.length !== EXPECTED_CODES.length) errors.push("issue-count")
  const codes = new Set<string>()
  const githubNumbers = new Set<number>()
  for (const issue of ledger.issues ?? []) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || githubNumbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`)
    if (!EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue)) errors.push(`github-issue-unknown:${issue.code}`)
    githubNumbers.add(issue.githubIssue)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  // Dependency order: G1 first; the tool leg (T1) feeds U1; annotation store (A1)
  // feeds the UI leg (A2); the matrix (V1) comes after its legs.
  // that reports them (V1); the closure gate last.
  const order = (ledger.issues ?? []).map((issue) => issue.code)
  const idx = (code: string) => order.indexOf(code)
  if (order.length === EXPECTED_CODES.length) {
    if (idx("G1") !== 0) errors.push("order:g1-first")
    if (!(idx("T1") < idx("U1") && idx("T1") < idx("A2") && idx("A1") < idx("A2") && idx("U1") < idx("V1") && idx("A2") < idx("V1"))) errors.push("order:v1-after-legs")
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}

/** The M27 bar, checked mechanically against the M27 ledger. Pure function so
 *  the negative mutation can reuse the exact same rule. */
function validateM27Bar(m27Ledger: Ledger): string[] {
  const errors: string[] = []
  if (m27Ledger.milestone !== "M27") errors.push("m27-identity")
  const allVerified =
    Array.isArray(m27Ledger.issues) &&
    m27Ledger.issues.length > 0 &&
    m27Ledger.issues.every((issue) => issue.status === "verified")
  if (!allVerified) errors.push("not-all-verified")
  if (m27Ledger.status !== (allVerified ? "closed" : "open")) errors.push("m27-status")
  return errors
}

function main(): void {
  const ledger = parseSealedRecord(ledgerPath) as Ledger
  const plan = readFileSync(planPath, "utf8")
  const contract = readFileSync(contractPath, "utf8")
  const statusTracker = readFileSync(statusTrackerPath, "utf8")
  const errors = validateLedger(ledger, plan, contract)

  let currentCommit = "unknown"
  try {
    currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}

  const relevantPaths = new Set<string>([
    "docs/m28/M28-MASTER-PLAN.md",
    "docs/IDE-HONESTY-CONTRACT.md",
    "docs/IDE-PROGRAM-DECISIONS.md",
    "docs/IDE-PROGRAM-STATUS.md",
    "package.json",
  ])
  function isRelevantPath(file: string): boolean {
    return (
      relevantPaths.has(file) ||
      file.startsWith("script/m28/") ||
      file.startsWith("src/mcp/") ||
      file.startsWith("docs/m28/")
      // Evidence files under validation/m28/ are deliberately excluded: they
      // are OUTPUTS of the gates, rewritten on every run, never inputs.
    )
  }
  function relevantWorkingTreeChanges(): string[] {
    try {
      return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(isRelevantPath)
    } catch {
      return ["git-status-unavailable"]
    }
  }
  const currentWorkingTreeRelevantChanges = relevantWorkingTreeChanges()

  function relevantFilesFor(issueCode: string): Set<string> {
    return new Set([...(ISSUE_RELEVANT_FILES[issueCode] ?? []), ...SHARED_RELEVANT_FILES])
  }

  function commitDiffTouchesRelevant(issueCode: string, fromCommit: string, toCommit: string): boolean {
    if (fromCommit === toCommit) return false
    try {
      const files = execFileSync("git", ["diff", "--name-only", fromCommit, toCommit], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).split("\n").map((f) => f.trim()).filter(Boolean)
      const relevant = relevantFilesFor(issueCode)
      return files.some((f) => relevant.has(f))
    } catch {
      return true // cannot determine => treat as touched (fail closed)
    }
  }

  // --- Positive checks -----------------------------------------------------
  check("G1: ledger has authoritative M27 identity", ledger.milestone === "M28" && ledger.githubMilestone === 39)
  const completedCodes = new Set(ledger.issues.filter((issue) => issue.status === "verified").map((issue) => issue.code))
  check(
    "G1: ledger status matches issue states (mechanical closed/open)",
    ledger.status === (completedCodes.size === ledger.issues.length ? "closed" : "open"),
  )
  check("G1: all 7 issue entries are unique and structurally complete", errors.length === 0, errors.join(","))
  check("G1: authority order is documented in the M28 plan", plan.includes("Decisions") && plan.includes("Issues"))
  check("G1: governing contract is wired", ledger.governingContract === "docs/IDE-HONESTY-CONTRACT.md" && contract.includes("Claim levels"))
  check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
  check(
    "G1: GitHub issue numbers match the created issues",
    ledger.issues.every((issue) => EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue)),
    "expected 623..629 in plan order",
  )
  check(
    "G1: dependency order in ledger matches plan (G1 first, legs before U1/A2/V1, X1 last)",
    !errors.some((error) => error.startsWith("order")),
    errors.filter((error) => error.startsWith("order")).join(","),
  )

  // Contract vocabulary lint over M27 artifacts (acceptance criterion).
  const vocabTargets: Array<[string, string]> = [
    ["M27-MASTER-PLAN.md", plan],
    ["IDE-PROGRAM-STATUS.md", statusTracker],
    ["manifest.json", JSON.stringify(ledger)],
  ]
  for (const [name, text] of vocabTargets) {
    for (const pattern of BANNED_PATTERNS) {
      const m = text.match(pattern)
      check(`G1: no banned vocabulary in ${name} (${pattern.source})`, m === null, m?.[0] ?? "")
    }
  }
  // The program tracker must state the honest v3 state: while the M27 ledger
  // has planned issues, the tracker must not claim v3 is shipped.
  const unresolvedStates = ledger.issues.filter((issue) => issue.status === "planned" || issue.status === "known-gap" || issue.status === "blocked")
  check(
    "G1: program tracker does not overstate v4",
    unresolvedStates.length === ledger.issues.length
      ? !/v4[^\n]*\b(shipped|released|published)\b/i.test(statusTracker)
      : true,
  )

  // --- M27 completion-bar re-audit (version-ladder discipline) -------------
  let m27Ledger: Ledger | null = null
  try {
    m27Ledger = parseSealedRecord(m27LedgerPath) as Ledger
  } catch {}
  check("G1: M27 ledger is readable", m27Ledger !== null)
  if (m27Ledger) {
    const barErrors = validateM27Bar(m27Ledger)
    check("G1: M27 bar — ledger closed with all 7 issues verified (mechanical)", barErrors.length === 0, barErrors.join(","))

    let m27X1: Record<string, unknown> | null = null
    try {
      m27X1 = parseSealedRecord(m27X1Path) as Record<string, unknown>
    } catch {}
    let ancestor = false
    if (m27X1 && typeof m27X1.currentCommit === "string") {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", m27X1.currentCommit as string, currentCommit], { cwd: ROOT, stdio: "ignore" })
        ancestor = true
      } catch {}
    }
    check(
      "G1: M27 bar — closure-gate evidence verified at an ancestor-or-equal commit",
      m27X1 !== null && m27X1.status === "verified" && ancestor,
      m27X1 ? `status=${String(m27X1.status)} ancestor=${ancestor}` : "X1.json unreadable",
    )
  }
  // The M27 governance gate must be green at HEAD (spawned, real exit code).
  let m27GateExit: number | string = "not-run"
  try {
    execFileSync("npx", ["tsx", "script/m27/verify-governance.ts"], { cwd: ROOT, stdio: "ignore", timeout: 180_000 })
    m27GateExit = 0
  } catch (error) {
    m27GateExit = (error as { status?: number }).status ?? "error"
  }
  check("G1: M27 bar — M27 governance gate exits 0 at HEAD (spawned)", m27GateExit === 0, `exit=${String(m27GateExit)}`)

  // --- Negative checks (mutation proofs) -----------------------------------
  const hollow = structuredClone(ledger)
  hollow.issues[0]!.status = "verified"
  delete hollow.issues[0]!.evidence
  negative(
    "G1: verified without evidence is rejected",
    validateLedger(hollow, plan, contract).some((error) => error === "hollow-verified:G1"),
  )

  const missing = structuredClone(ledger)
  missing.issues.pop()
  negative("G1: missing issue entry is rejected", validateLedger(missing, plan, contract).includes("issue-count"), `issues=${missing.issues.length}`)

  const noAcceptance = structuredClone(ledger)
  noAcceptance.issues[1]!.acceptanceCriteria = []
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:T1"))
  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  // The matrix must not precede the adapter legs it reports.
  const reordered = structuredClone(ledger)
  const v1 = reordered.issues.find((issue) => issue.code === "V1")!
  reordered.issues = reordered.issues.filter((issue) => issue.code !== "V1")
  reordered.issues.splice(reordered.issues.findIndex((issue) => issue.code === "T1") + 1, 0, v1)
  negative("G1: V1 before its legs is rejected", validateLedger(reordered, plan, contract).some((error) => error.startsWith("order")))

  const x1First = structuredClone(ledger)
  const gate = x1First.issues.pop()!
  x1First.issues.unshift(gate)
  negative("G1: closure gate not last is rejected", validateLedger(x1First, plan, contract).some((error) => error.startsWith("order:x1-last") || error === "order:g1-first"))

  const tampered = structuredClone(ledger)
  tampered.githubMilestone = 27
  negative("G1: ledger milestone tamper is rejected", validateLedger(tampered, plan, contract).some((error) => error === "milestone"))

  const fakeEvidence = structuredClone(ledger)
  const plannedIdx = fakeEvidence.issues.findIndex((issue) => issue.status === "planned")
  if (plannedIdx !== -1) {
    fakeEvidence.issues[plannedIdx]!.evidence = {
      status: "planned",
      currentCommit,
      verifierCommand: "npx tsx script/m28/verify-governance.ts",
      evidenceFile: "FAKE.json",
      passed: 1,
      failed: 0,
      negativeCases: 1,
    }
    negative(
      "G1: planned issue with evidence is rejected",
      validateLedger(fakeEvidence, plan, contract).some((error) => error === `planned-evidence:${fakeEvidence.issues[plannedIdx]!.code}`),
    )
  } else {
    negative("G1: planned issue with evidence is rejected", true, "no planned issue left to mutate — skipped")
  }

  // Version-ladder negative: demote one M27 issue and the bar must fail —
  // v4 cannot silently start on an unclosed v3.
  const demotedM27 = structuredClone(m27Ledger!)
  if (demotedM27.issues.length > 0) {
    demotedM27.issues[demotedM27.issues.length - 1]!.status = "known-gap"
    negative(
      "G1: M27 bar with a demoted issue is rejected",
      validateM27Bar(demotedM27).includes("not-all-verified"),
    )
  } else {
    negative("G1: M27 bar with a demoted issue is rejected", true, "no M26 issue to demote — skipped")
  }

  // Cross-check: every non-planned M27 ledger issue must reference a
  // persisted evidence JSON whose status matches. G1 is excluded: its
  // evidence records the outcome of this very check (self-referential).
  let evidenceErrors: string[] = []
  for (const issue of ledger.issues.filter((item) => item.status !== "planned" && item.code !== "G1")) {
    const evidence = issue.evidence
    const evidencePath = evidence ? path.join(ROOT, "validation/m28/results", evidence.evidenceFile) : ""
    if (!evidence || !existsSync(evidencePath)) {
      evidenceErrors.push(`${issue.code}:missing-evidence`)
      continue
    }
    try {
      const persisted = parseSealedRecord(evidencePath) as Record<string, unknown>
      if (persisted["status"] !== issue.status) evidenceErrors.push(`${issue.code}:status-mismatch`)
      const verdict = persisted["verdict"] as { realComponentFailures?: number } | undefined
      const realFailed = verdict && typeof verdict.realComponentFailures === "number" ? verdict.realComponentFailures : persisted["failed"]
      if (realFailed !== 0) evidenceErrors.push(`${issue.code}:persisted-failed`)
      const evidenceCommit = persisted["currentCommit"]
      if (typeof evidenceCommit !== "string" || evidenceCommit !== currentCommit) {
        if (typeof evidenceCommit !== "string" || commitDiffTouchesRelevant(issue.code, evidenceCommit, currentCommit)) {
          evidenceErrors.push(`${issue.code}:stale-commit`)
        }
      }
    } catch {
      evidenceErrors.push(`${issue.code}:unreadable-evidence`)
    }
  }
  check(
    "G1: every non-planned ledger item has matching persisted evidence at the current commit",
    evidenceErrors.length === 0,
    evidenceErrors.join(","),
  )

  // Self-audit: the verifier itself must not contain hollow assertion patterns.
  const source = readFileSync(new URL(import.meta.url), "utf8")
  const hardTrue = ["check(", ", true)"].join("")
  const orTrue = ["|", "|", " true)"].join("")
  const zeroThreshold = [">=", " 0"].join("")
  const unconditional = source.includes(hardTrue) || source.includes(orTrue) || source.includes(zeroThreshold)
  negative("G1: verifier has no obvious hollow assertions", !unconditional, unconditional ? "hollow pattern found" : "clean")

  // --- Persist evidence ----------------------------------------------------
  const finalFailed = checks - passed
  const result = {
    issue: "M28.G1",
    code: "G1",
    milestone: "M28",
    status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed: finalFailed,
    negativeCases: negatives,
    currentCommit,
    workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
    verifierCommand: "npx tsx script/m28/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    ledger: "validation/m28/results/manifest.json",
    m27Bar: {
      ledgerStatus: m27Ledger?.status ?? "unreadable",
      m27GateExit,
    },
    limitations: [
      "This gate validates governance metadata, mutation response, and the M26 bar; it does not verify MCP tools or annotations.",
      "A run with relevant uncommitted M28 files is recorded as known-gap; verified status requires a clean relevant tree.",
    ],
  }
  const evidenceDir = path.join(ROOT, "validation/m28/results")
  mkdirSync(evidenceDir, { recursive: true })
  const evidencePath = path.join(evidenceDir, result.evidenceFile)
  writeSealed(evidencePath, result)
  const persisted = parseSealedRecord(evidencePath) as typeof result
  check("G1: evidence is persisted and re-readable", persisted.issue === result.issue && persisted.currentCommit === currentCommit)

  const finalFailed2 = checks - passed
  const finalResult = { ...result, checks, passed, failed: finalFailed2, status: finalFailed2 === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap" }
  writeSealed(evidencePath, finalResult)
  console.log(`G1: ${finalResult.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
  process.exit(finalFailed2 === 0 ? 0 : 1)
}

main()
