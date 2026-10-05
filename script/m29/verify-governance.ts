// script/m29/verify-governance.ts — M29.G1 (issue #535).
//
// Governance for the Precision Waves milestone. Beyond the M24–M28-style
// ledger validation (structure, closure rules, mutation proofs), this gate
// owns the version-ladder discipline: the M28 completion bar is re-audited
// HERE, on every run, before any M29 issue may close. "v5 started on a closed
// v4" is a machine-checked fact, not a manual claim (decision record).
//
//   1. M28 ledger status is `closed` (mechanical: all issues verified).
//   2. M28 X1 closure-gate evidence exists, says verified, and its commit is
//      an ancestor of (or equal to) HEAD.
//   3. The M28 governance gate is spawned and must exit 0 at HEAD.
//
// Contract vocabulary is linted over M29 artifacts (master plan, program
// status tracker, ledger). The gate script itself is deliberately not part
// of any issue's relevant-file surface (M24.G1 lesson: the gate is a consumer
// of evidence, re-proven each run by its own negative mutations).
//
// CLI: npx tsx script/m29/verify-governance.ts   (exit non-zero blocks verify)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"
import { projectLaneLedger } from "../m61/ledger_gate_wiring.ts"
import type { ProjectableLedger } from "../m61/ledger_projection.ts"

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
    /** §8.3: a non-verified entry records WHY. Required for known-gap/blocked. */
    blockedReason?: string
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
const ledgerPath = path.join(ROOT, "validation/m29/results/manifest.json")
const m28LedgerPath = path.join(ROOT, "validation/m28/results/manifest.json")
const m28X1Path = path.join(ROOT, "validation/m28/results/X1.json")
const planPath = path.join(ROOT, "docs/m29/M29-MASTER-PLAN.md")
const contractPath = path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md")
const statusTrackerPath = path.join(ROOT, "docs/IDE-PROGRAM-STATUS.md")

let checks = 0
let passed = 0
let negatives = 0
/** Every check's label and outcome, kept so the record can NAME what is red
 *  (§8.3: a non-green run states its reason). */
const checkLog: Array<[string, boolean]> = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  checkLog.push([label, condition])
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
  // TWO BARS, TWO STATUSES. A `known-gap` entry exists BECAUSE the record
  // failed; demanding realFailed === 0 of one makes the honest state
  // structurally unrecordable, pushing a lane to lie (`verified` over a red
  // record) or to omit the reason. `verified` keeps the full bar (green run +
  // can-fail proof); `known-gap`/`blocked` must carry the REASON they are
  // non-verified (contract §8.3). The m24/m25 fix, applied here for the same
  // reason: the ledger projection made the honest states visible and this rule
  // could not record them.
  if (issue.status !== "verified") {
    const reason = typeof e.blockedReason === "string" ? e.blockedReason.trim() : ""
    return Boolean(e.status === issue.status && e.verifierCommand && e.evidenceFile && e.passed > 0 && reason.length > 0)
  }
  return Boolean(
    e.status === issue.status &&
      e.verifierCommand &&
      e.evidenceFile &&
      e.passed > 0 &&
      realFailed === 0 &&
      (typeof e.negativeCases === "number" && e.negativeCases > 0 ? true : mutantProof),
  )
}

const EXPECTED_CODES = ["G1", "R1", "R2", "R3", "R4", "R5", "V1", "D1", "X1"]
const EXPECTED_ISSUE_NUMBERS = [535, 536, 537, 538, 539, 540, 541, 542, 543]

/** Per-issue relevant files (planned paths; consulted only once evidence
 *  exists). Extended as each issue's real surface lands (M28.G1 protocol:
 *  the map is updated in the same commit as the work). Evidence stays fresh
 *  while no relevant file changed since its commit. The gate script itself
 *  is excluded everywhere (consumer rule). */
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  R1: ["script/m29/wave-protocol.ts", "script/m29/generate-wave-doc.ts", "script/m29/verify-wave-protocol.ts", "docs/m29/WAVE-PROTOCOL.md", "script/m29/wave-fixtures/java/main.java"],
  R2: ["script/m29/wave-execute.ts", "script/m29/verify-wave-execution.ts", "script/m29/wave-editor-driver.lua", "validation/m29/results/wave-1-approval.json", "src/lsp/launch_languages.ts"],
  R3: ["script/m29/giant-repo-budget.ts", "script/m29/generate-giant-corpus.ts", "script/m29/giant-editor-driver.lua", "script/m29/verify-giant-repo.ts", "src/lsp/hover.ts", "src/lsp/cross_language_hover.ts", "src/brain/schema-ddl.ts", "src/brain/brain.sql.ts"],
  R4: ["script/m29/generate-precision-ledger.ts", "script/m29/verify-precision-ledger.ts", "docs/m29/PRECISION-LEDGER.md", "validation/m29/results/PRECISION-LEDGER.json", "ide/vscode/README.md"],
  R5: ["script/m29/verify-precision-improvements.ts", "script/m29/r5-tier-fixture.ts", "script/m29/generate-precision-ledger.ts", "script/m29/verify-precision-ledger.ts", "src/lsp/hover.ts", "docs/m29/PRECISION-LEDGER.md"],
  V1: ["script/m29/wave-protocol.ts", "script/m29/generate-precision-ledger.ts", "script/m29/verify-wave-harness.ts"],
  D1: ["docs/m29/PRECISION-LEDGER.md", "docs/m29/WAVE-PROTOCOL.md", "script/m29/verify-m29-docs.ts"],
  X1: ["script/m29/verify-closure.ts"],
}
const SHARED_RELEVANT_FILES = [
  "docs/m29/M29-MASTER-PLAN.md",
  "docs/IDE-HONESTY-CONTRACT.md",
  "docs/IDE-PROGRAM-DECISIONS.md",
  "docs/IDE-PROGRAM-STATUS.md",
  // manifest.json is DELIBERATELY NOT here. It is the ledger — the OUTPUT of
  // the evidence cycle, not an input to what a verifier run proves (M25.G1
  // lesson: keeping it relevant caused infinite evidence-regress).
]

/** Contract §1 banned vocabulary, enforced over M29 artifacts. */
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
  if (ledger.milestone !== "M29" || ledger.githubMilestone !== 29) errors.push("milestone")
  // Ledger status is mechanical, never hand-set (M24.G1 rule).
  const allVerified = (ledger.issues ?? []).length > 0 && (ledger.issues ?? []).every((issue) => issue.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (ledger.status !== expectedStatus) errors.push("status")
  if (!ledger.authority || !(plan.includes("Issues") || plan.includes("Issue groups"))) errors.push("authority")
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
  // Dependency order: G1 first; the wave protocol (R1) precedes its execution
  // (R2); the ledger (R4) precedes the improvements it drives (R5); the
  // closure gate last.
  const order = (ledger.issues ?? []).map((issue) => issue.code)
  const idx = (code: string) => order.indexOf(code)
  if (order.length === EXPECTED_CODES.length) {
    if (idx("G1") !== 0) errors.push("order:g1-first")
    if (!(idx("R1") < idx("R2"))) errors.push("order:r1-before-r2")
    if (!(idx("R4") < idx("R5"))) errors.push("order:r4-before-r5")
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}

/** The M28 bar, checked mechanically against the M28 ledger. Pure function so
 *  the negative mutation can reuse the exact same rule. */
function validateM28Bar(m28Ledger: Ledger): string[] {
  const errors: string[] = []
  if (m28Ledger.milestone !== "M28") errors.push("m28-identity")
  const allVerified =
    Array.isArray(m28Ledger.issues) &&
    m28Ledger.issues.length > 0 &&
    m28Ledger.issues.every((issue) => issue.status === "verified")
  if (!allVerified) errors.push("not-all-verified")
  if (m28Ledger.status !== (allVerified ? "closed" : "open")) errors.push("m28-status")
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
    "docs/m29/M29-MASTER-PLAN.md",
    "docs/IDE-HONESTY-CONTRACT.md",
    "docs/IDE-PROGRAM-DECISIONS.md",
    "docs/IDE-PROGRAM-STATUS.md",
    "package.json",
  ])
  function isRelevantPath(file: string): boolean {
    return (
      relevantPaths.has(file) ||
      file.startsWith("script/m29/") ||
      file.startsWith("docs/m29/") ||
      // Wave onboarding touches the IDE surface directly (new-language
      // fixtures, matrix updates); flag src/ changes as relevant so wave
      // evidence cannot go stale silently.
      file.startsWith("src/lsp/") ||
      file.startsWith("src/ast/")
      // Evidence files under validation/m29/ are deliberately excluded: they
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
  check("G1: ledger has authoritative M29 identity", ledger.milestone === "M29" && ledger.githubMilestone === 29)
  const completedCodes = new Set(ledger.issues.filter((issue) => issue.status === "verified").map((issue) => issue.code))
  check(
    "G1: ledger status matches issue states (mechanical closed/open)",
    ledger.status === (completedCodes.size === ledger.issues.length ? "closed" : "open"),
  )
  check("G1: all 9 issue entries are unique and structurally complete", errors.length === 0, errors.join(","))
  check("G1: authority order is documented in the M29 plan", plan.includes("Decisions") || plan.includes("Issue groups"))
  check("G1: governing contract is wired", ledger.governingContract === "docs/IDE-HONESTY-CONTRACT.md" && contract.includes("Claim levels"))
  check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
  check(
    "G1: GitHub issue numbers match the created issues",
    ledger.issues.every((issue) => EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue)),
    "expected 535..543 in plan order",
  )
  check(
    "G1: dependency order in ledger matches plan (G1 first, R1 before R2, R4 before R5, X1 last)",
    !errors.some((error) => error.startsWith("order")),
    errors.filter((error) => error.startsWith("order")).join(","),
  )

  // Contract vocabulary lint over M29 artifacts (acceptance criterion).
  const vocabTargets: Array<[string, string]> = [
    ["M29-MASTER-PLAN.md", plan],
    ["IDE-PROGRAM-STATUS.md", statusTracker],
    ["manifest.json", JSON.stringify(ledger)],
  ]
  for (const [name, text] of vocabTargets) {
    for (const pattern of BANNED_PATTERNS) {
      const m = text.match(pattern)
      check(`G1: no banned vocabulary in ${name} (${pattern.source})`, m === null, m?.[0] ?? "")
    }
  }
  // The program tracker must state the honest v5 state: while the M29 ledger
  // has planned issues, the tracker must not claim v5 is shipped.
  const unresolvedStates = ledger.issues.filter((issue) => issue.status === "planned" || issue.status === "known-gap" || issue.status === "blocked")
  check(
    "G1: program tracker does not overstate v5",
    unresolvedStates.length === ledger.issues.length
      ? !/v5[^\n]*\b(shipped|released|published)\b/i.test(statusTracker)
      : true,
  )

  // --- M28 completion-bar re-audit (version-ladder discipline) -------------
  let m28Ledger: Ledger | null = null
  try {
    m28Ledger = parseSealedRecord(m28LedgerPath) as Ledger
  } catch {}
  check("G1: M28 ledger is readable", m28Ledger !== null)
  if (m28Ledger) {
    const barErrors = validateM28Bar(m28Ledger)
    check("G1: M28 bar — ledger closed with all 7 issues verified (mechanical)", barErrors.length === 0, barErrors.join(","))

    let m28X1: Record<string, unknown> | null = null
    try {
      m28X1 = parseSealedRecord(m28X1Path) as Record<string, unknown>
    } catch {}
    let ancestor = false
    if (m28X1 && typeof m28X1.currentCommit === "string") {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", m28X1.currentCommit as string, currentCommit], { cwd: ROOT, stdio: "ignore" })
        ancestor = true
      } catch {}
    }
    check(
      "G1: M28 bar — closure-gate evidence verified at an ancestor-or-equal commit",
      m28X1 !== null && m28X1.status === "verified" && ancestor,
      m28X1 ? `status=${String(m28X1.status)} ancestor=${ancestor}` : "X1.json unreadable",
    )
  }
  // The M28 governance gate must be green at HEAD (spawned, real exit code).
  let m28GateExit: number | string = "not-run"
  try {
    execFileSync("npx", ["tsx", "script/m28/verify-governance.ts"], { cwd: ROOT, stdio: "ignore", timeout: 180_000 })
    m28GateExit = 0
  } catch (error) {
    m28GateExit = (error as { status?: number }).status ?? "error"
  }
  check("G1: M28 bar — M28 governance gate exits 0 at HEAD (spawned)", m28GateExit === 0, `exit=${String(m28GateExit)}`)

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
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:R1"))
  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  // Execution before protocol is rejected (the wave runs the checklist; the
  // checklist must exist first).
  const swapped = structuredClone(ledger)
  const r1 = swapped.issues.find((issue) => issue.code === "R1")!
  const r2 = swapped.issues.find((issue) => issue.code === "R2")!
  const r1Idx = swapped.issues.indexOf(r1)
  const r2Idx = swapped.issues.indexOf(r2)
  swapped.issues[r1Idx] = r2
  swapped.issues[r2Idx] = r1
  negative("G1: R2 before R1 is rejected", validateLedger(swapped, plan, contract).some((error) => error.startsWith("order:r1-before-r2")))

  const x1First = structuredClone(ledger)
  const gate = x1First.issues.pop()!
  x1First.issues.unshift(gate)
  negative("G1: closure gate not last is rejected", validateLedger(x1First, plan, contract).some((error) => error.startsWith("order:x1-last") || error === "order:g1-first"))

  const tampered = structuredClone(ledger)
  tampered.githubMilestone = 28
  negative("G1: ledger milestone tamper is rejected", validateLedger(tampered, plan, contract).some((error) => error === "milestone"))

  const fakeEvidence = structuredClone(ledger)
  const plannedIdx = fakeEvidence.issues.findIndex((issue) => issue.status === "planned")
  if (plannedIdx !== -1) {
    fakeEvidence.issues[plannedIdx]!.evidence = {
      status: "planned",
      currentCommit,
      verifierCommand: "npx tsx script/m29/verify-governance.ts",
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

  // Version-ladder negative: demote one M28 issue and the bar must fail —
  // v5 cannot silently start on an unclosed v4.
  const demotedM28 = structuredClone(m28Ledger!)
  if (demotedM28.issues.length > 0) {
    demotedM28.issues[demotedM28.issues.length - 1]!.status = "known-gap"
    negative(
      "G1: M28 bar with a demoted issue is rejected",
      validateM28Bar(demotedM28).includes("not-all-verified"),
    )
  } else {
    negative("G1: M28 bar with a demoted issue is rejected", true, "no M28 issue to demote — skipped")
  }

  // Cross-check: every non-planned M29 ledger issue must reference a
  // persisted evidence JSON whose status matches. G1 is excluded: its
  // evidence records the outcome of this very check (self-referential).
  let evidenceErrors: string[] = []
  for (const issue of ledger.issues.filter((item) => item.status !== "planned" && item.code !== "G1")) {
    const evidence = issue.evidence
    const evidencePath = evidence ? path.join(ROOT, "validation/m29/results", evidence.evidenceFile) : ""
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
    issue: "M29.G1",
    code: "G1",
    milestone: "M29",
    status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed: finalFailed,
    negativeCases: negatives,
    currentCommit,
    workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
    verifierCommand: "npx tsx script/m29/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    ledger: "validation/m29/results/manifest.json",
    m28Bar: {
      ledgerStatus: m28Ledger?.status ?? "unreadable",
      m28GateExit,
    },
    limitations: [
      "This gate validates governance metadata, mutation response, and the M28 bar; it does not verify the wave protocol, giant-repo budgets, or the precision ledger.",
      "A run with relevant uncommitted M29 files is recorded as known-gap; verified status requires a clean relevant tree.",
    ],
  }
  const evidenceDir = path.join(ROOT, "validation/m29/results")
  mkdirSync(evidenceDir, { recursive: true })
  const evidencePath = path.join(evidenceDir, result.evidenceFile)
  writeSealed(evidencePath, result)
  const persisted = parseSealedRecord(evidencePath) as typeof result
  check("G1: evidence is persisted and re-readable", persisted.issue === result.issue && persisted.currentCommit === currentCommit)

  // Counters are re-captured AFTER the last check so the persisted record
  // counts every check that actually ran (the M24-inherited undercount bug,
  // found in the M28 extreme review and fixed in all five gates).
  const finalFailed2 = checks - passed
  // §8.3: a non-green run records WHY, in the record itself. The ledger's G1
  // entry is projected from THIS field.
  const failingChecks = checkLog.filter(([, ok]) => !ok).map(([label]) => label)
  const statusReason =
    finalFailed2 === 0 && currentWorkingTreeRelevantChanges.length === 0
      ? undefined
      : [
          failingChecks.length > 0 ? `${failingChecks.length} check(s) failed: ${failingChecks.slice(0, 4).join("; ")}${failingChecks.length > 4 ? " …" : ""}` : "no check failed",
          currentWorkingTreeRelevantChanges.length > 0 ? `relevant uncommitted files at measure time: ${currentWorkingTreeRelevantChanges.slice(0, 6).join(", ")}` : "the relevant tree was clean at measure time",
        ].join(" — ")
  const finalResult = {
    ...result,
    checks,
    passed,
    failed: finalFailed2,
    status: finalFailed2 === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
    ...(statusReason !== undefined ? { blockedReason: statusReason } : {}),
  }
  writeSealed(evidencePath, finalResult)

  // --- The ledger is a PROJECTION of its records, written here ---------------
  // At integration/lsp-truth HEAD 462f620be this manifest read `G1: verified`
  // over a `known-gap` G1.json. The manifest was hand-maintained: this gate
  // validated its shape and never compared an entry's status to the record it
  // names. The record is the authority (contract §8.4).
  const readM29Record = (file: string): Record<string, unknown> | null => {
    const abs = path.join(ROOT, "validation/m29/results", file)
    if (!existsSync(abs)) return null
    try {
      // The SAME trusted path the cross-check above uses; a projection reading
      // by a weaker path would heal toward a tampered record's status.
      return parseSealedRecord(abs) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const projectionFindings = projectLaneLedger({
    ledgerPath,
    resultsDir: path.join(ROOT, "validation/m29/results"),
    readRecord: readM29Record,
    readLedgerBack: () => {
      try {
        return parseSealedRecord(ledgerPath) as unknown as ProjectableLedger
      } catch {
        return undefined
      }
    },
    ledger: ledger as unknown as ProjectableLedger,
    g1Status: finalResult.status,
    g1Record: finalResult as unknown as Record<string, unknown>,
    writeLedger: (l) => writeSealed(ledgerPath, l as Record<string, unknown>),
    onFinding: (detail) => check(`G1: the projected ledger agrees with its records`, false, detail),
    onPass: (detail) => check(detail, true),
    onHealed: (message) => console.log(`      ${message}`),
  })

  // The ledger is RE-VALIDATED from DISK, after the projection. Validating the
// in-memory snapshot taken at the top of this gate validates a ledger the
// projection has since rewritten, so the verdict described a state that no
// longer existed - a validator that judges a stale copy is not auditing the
// artifact. (Found live on m42: four honest `verified` entries read
// `hollow-verified` from the pre-projection snapshot.)
{
  const readBack = parseSealedRecord(ledgerPath) as unknown as typeof ledger
  const postErrors = validateLedger(readBack, plan, contract)
  check(
    "G1: the ledger VALIDATES WHOLE as it now stands on disk (post-projection, not the pre-projection snapshot)",
    postErrors.length === 0,
    postErrors.join(","),
  )
  check(
    "G1: every non-planned entry is closable on the projected ledger (no honest entry reads hollow)",
    (readBack.issues ?? []).filter((i) => i.status !== "planned").every((i) => isClosable(i as unknown as Issue)),
    (readBack.issues ?? []).filter((i) => i.status !== "planned" && !isClosable(i as unknown as Issue)).map((i) => `${i.code}=${i.status}`).join(","),
  )
}
// The record is written LAST, from the counters that now include the
  // projection's own checks, and with this run's G1 verdict stamped into it so
  // the ledger's G1 entry (written by the projection above) states the same
  // verdict the record states. Nothing checks anything after this point
  // (M61 G8: a check after a gate's last evidence write means the record can
  // disagree with its own run).
  const finalFailed3 = checks - passed
  const finalFailedChecks = checkLog.filter(([, ok]) => !ok).map(([label]) => label)
  const finalReason =
    finalFailed3 === 0 && currentWorkingTreeRelevantChanges.length === 0
      ? undefined
      : [
          finalFailedChecks.length > 0
            ? `${finalFailedChecks.length} check(s) failed: ${finalFailedChecks.slice(0, 4).join("; ")}${finalFailedChecks.length > 4 ? " ..." : ""}`
            : "no check failed",
          currentWorkingTreeRelevantChanges.length > 0
            ? `relevant uncommitted files at measure time: ${currentWorkingTreeRelevantChanges.slice(0, 6).join(", ")}`
            : "the relevant tree was clean at measure time",
          projectionFindings.length > 0 ? `${projectionFindings.length} ledger-projection finding(s)` : "",
        ]
          .filter(Boolean)
          .join(" - ")
  const finalRecord = {
    ...finalResult,
    checks,
    passed,
    failed: finalFailed3,
    status: finalFailed3 === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
    ...(finalReason !== undefined ? { blockedReason: finalReason } : {}),
  }
  writeSealed(evidencePath, finalRecord as unknown as Record<string, unknown>)

  console.log(`${finalRecord.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
  process.exit(finalFailed3 === 0 ? 0 : 1)

}

main()
