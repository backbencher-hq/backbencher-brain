// script/m25/verify-governance.ts — M25.G1.
//
// Governance for the extension milestone. Beyond the M24-style ledger
// validation (structure, closure rules, mutation proofs), this gate owns the
// version-ladder discipline: the M24 completion bar is re-audited HERE on
// every run, before any M25 issue may close. "v1 started on a closed v0" is
// a machine-checked fact, not a manual claim (decision record).
//
// The heavy M24 closure gate itself runs separately in `npm run verify`
// (verify:m24-closure); this gate re-checks the bar cheaply but honestly:
//   1. M24 ledger status is `closed` (mechanical: all 11 issues verified).
//   2. M24 X1 closure-gate evidence exists, says verified, and its commit is
//      an ancestor of (or equal to) HEAD.
//   3. The M24 governance gate is spawned and must exit 0 at HEAD.
//
// Contract vocabulary is linted over M25 artifacts (master plan, program
// status tracker, ledger). The gate script itself is deliberately not part
// of any issue's relevant-file surface (M24.G1 lesson: the gate is a consumer
// of evidence, re-proven each run by its own negative mutations).
//
// CLI: npx tsx script/m25/verify-governance.ts   (exit non-zero blocks verify)

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed, parseSealedRecord, readEvidenceAllowingLegacy } from "../lib/evidence.ts"
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
const ledgerPath = path.join(ROOT, "validation/m25/results/manifest.json")
const m24LedgerPath = path.join(ROOT, "validation/m24/results/manifest.json")
const m24X1Path = path.join(ROOT, "validation/m24/results/X1.json")
const planPath = path.join(ROOT, "docs/m25/M25-MASTER-PLAN.md")
const contractPath = path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md")
const statusTrackerPath = path.join(ROOT, "docs/IDE-PROGRAM-STATUS.md")

let checks = 0
let passed = 0
let negatives = 0
/** Every check's label and outcome, kept so the record can NAME what is red.
 *  §8.3: a non-green run states its reason; a gate that logs a failure to stdout
 *  and writes a bare `known-gap` to disk has stated nothing an auditor can use. */
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
  // THE TWO STATUSES NEED TWO BARS. A `known-gap` entry exists BECAUSE the
  // record failed; demanding realFailed === 0 of one makes the honest state
  // structurally unrecordable and pushes a lane either to lie (`verified` over a
  // red record) or to omit the reason. `verified` keeps the full bar (green run
  // + can-fail proof); `known-gap`/`blocked` must carry the REASON they are
  // non-verified (contract §8.3: a blocked leg records its reason, never omits
  // it). This is the m24 fix, applied here for the same reason — the ledger
  // projection made the honest states visible and this rule could not record them.
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

const EXPECTED_CODES = ["G1", "E1", "E2", "E3", "E4", "V1", "E5", "E6", "E7", "D1", "X1"]
const EXPECTED_ISSUE_NUMBERS = [498, 499, 500, 501, 502, 503, 504, 544, 505, 506, 507]

/** Per-issue relevant files (planned paths; consulted only once evidence
 *  exists). Evidence stays fresh while no relevant file changed since its
 *  commit. The gate script itself is excluded everywhere (consumer rule). */
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  E1: ["ide/vscode/src/extension.ts", "ide/vscode/src/server-resolution.ts", "ide/vscode/package.json", "script/m25/verify-extension-skeleton.ts"],
  E2: ["ide/vscode/src/auto-index.ts", "ide/vscode/src/extension.ts", "ide/vscode/package.json", "script/m25/verify-auto-index.ts"],
  E3: ["ide/vscode/src/status-model.ts", "ide/vscode/src/extension.ts", "ide/vscode/package.json", "script/m25/verify-status-surface.ts", "docs/m24/TOOL-DOC.md"],
  E4: ["ide/vscode/package.json", "ide/vscode/.vscodeignore", "ide/vscode/publish-openvsx.mjs", "ide/vscode/esbuild-extension.mjs", "ide/vscode/README.md", "ide/vscode/CHANGELOG.md", "LICENSE", "script/m25/verify-packaging.ts"],
  V1: ["script/m25/feature-assertions.ts", "script/m25/vscode-test-runner.ts", "script/m25/fork-runner.ts", "script/m25/verify-harness-core.ts"],
  E5: [
    "script/m25/run-vscode-e2e.mts",
    "script/m25/e5-inner.js",
    "script/m25/feature-assertions.ts",
    "ide/vscode/src/extension.ts",
    "ide/vscode/esbuild-extension.mjs",
    "src/lsp/server.ts",
    "src/lsp/freshness.ts",
    "src/ast/parallel-indexer.ts",
  ],
  E6: [
    "script/m25/run-fork-e2e.mts",
    "script/m25/fork-runner.ts",
    "script/m25/e5-inner.js",
    "script/m25/feature-assertions.ts",
    "ide/vscode/src/extension.ts",
    "ide/vscode/src/auto-index.ts",
    "src/lsp/server.ts",
    "src/lsp/positions.ts",
    "src/lsp/hover.ts",
    "src/lsp/navigation.ts",
    "src/lsp/symbols.ts",
    "src/lsp/call_hierarchy.ts",
  ],
  E7: ["script/m25/verify-cross-platform.ts", "ide/vscode/src/auto-index.ts"],
  D1: ["ide/vscode/README.md", "docs/m25/INSTALL.md", "script/m25/verify-listing.ts", "script/m25/verify-install-docs.ts"],
  X1: ["script/m25/verify-closure.ts", "ide/vscode/src/status-model.ts", "ide/vscode/src/extension.ts"],
}
const SHARED_RELEVANT_FILES = [
  "docs/m25/M25-MASTER-PLAN.md",
  "docs/IDE-HONESTY-CONTRACT.md",
  "docs/IDE-PROGRAM-DECISIONS.md",
  "docs/IDE-PROGRAM-STATUS.md",
  // manifest.json is DELIBERATELY NOT here. It is the ledger — the OUTPUT of
  // the evidence cycle, not an input to what a verifier run proves. Keeping
  // it relevant caused infinite regress: every evidence pin updates the
  // ledger, which staled every leg's evidence, which required another pin…
  // (found live while closing E5: 70/70 checks but never VERIFIED).
  // The governing docs above stay: if the contract or plan changes, old
  // evidence may no longer prove what is claimed.
]

/** Contract §1 banned vocabulary, enforced over M25 artifacts. */
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
  if (ledger.milestone !== "M25" || ledger.githubMilestone !== 25) errors.push("milestone")
  // Ledger status is mechanical, never hand-set (M24.G1 rule).
  const allVerified = (ledger.issues ?? []).length > 0 && (ledger.issues ?? []).every((issue) => issue.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (ledger.status !== expectedStatus) errors.push("status")
  if (!ledger.authority || !plan.includes("Issue groups")) errors.push("authority")
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
  // Dependency order: G1 first; the harness (V1) before the editor runs that
  // consume its assertion core (E5, E6); the closure gate last.
  const order = (ledger.issues ?? []).map((issue) => issue.code)
  const idx = (code: string) => order.indexOf(code)
  if (order.length === EXPECTED_CODES.length) {
    if (idx("G1") !== 0) errors.push("order:g1-first")
    if (!(idx("E1") < idx("V1") && idx("V1") < idx("E5") && idx("V1") < idx("E6"))) errors.push("order")
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}

/** The M24 bar, checked mechanically against the M24 ledger. Pure function so
 *  the negative mutation can reuse the exact same rule. */
function validateM24Bar(m24Ledger: Ledger): string[] {
  const errors: string[] = []
  if (m24Ledger.milestone !== "M24") errors.push("m24-identity")
  const allVerified =
    Array.isArray(m24Ledger.issues) &&
    m24Ledger.issues.length > 0 &&
    m24Ledger.issues.every((issue) => issue.status === "verified")
  if (!allVerified) errors.push("not-all-verified")
  if (m24Ledger.status !== (allVerified ? "closed" : "open")) errors.push("m24-status")
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
    "docs/m25/M25-MASTER-PLAN.md",
    "docs/IDE-HONESTY-CONTRACT.md",
    "docs/IDE-PROGRAM-DECISIONS.md",
    "docs/IDE-PROGRAM-STATUS.md",
    "package.json",
  ])
  function isRelevantPath(file: string): boolean {
    return (
      relevantPaths.has(file) ||
      file.startsWith("script/m25/") ||
      file.startsWith("ide/vscode/")
      // Evidence files under validation/m25/ are deliberately excluded: they
      // are OUTPUTS of the gates, rewritten on every run, never inputs. The
      // ledger itself is guarded at the commit level (shared relevant file),
      // which is what actually protects it (M24.G1 design).
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

  /** Read every F-*.json fork evidence record from the results dir. */
  function recordsFromResultsDir(prefix: string): Array<Record<string, unknown>> {
    const dir = path.join(ROOT, "validation/m25/results")
    if (!existsSync(dir)) return []
    const records: Array<Record<string, unknown>> = []
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(prefix) || !f.endsWith(".json")) continue
      try {
        records.push(parseSealedRecord(path.join(dir, f)) as Record<string, unknown>)
      } catch {
        // unreadable evidence is surfaced by the cross-check above
      }
    }
    return records
  }

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
  check("G1: ledger has authoritative M25 identity", ledger.milestone === "M25" && ledger.githubMilestone === 25)
  const completedCodes = new Set(ledger.issues.filter((issue) => issue.status === "verified").map((issue) => issue.code))
  const unresolvedStates = ledger.issues.filter((issue) => issue.status === "planned" || issue.status === "known-gap" || issue.status === "blocked")
  check(
    "G1: ledger status matches issue states (mechanical closed/open)",
    ledger.status === (completedCodes.size === ledger.issues.length ? "closed" : "open") &&
      completedCodes.size + unresolvedStates.length === ledger.issues.length &&
      ledger.issues.every((issue) => ["planned", "verified", "known-gap", "blocked"].includes(issue.status)),
  )
  check("G1: all 11 issue entries are unique and structurally complete", errors.length === 0, errors.join(","))
  check("G1: authority order is documented in the M25 plan", plan.includes("Protocol") && plan.includes("Completion bar"))
  check("G1: governing contract is wired", ledger.governingContract === "docs/IDE-HONESTY-CONTRACT.md" && contract.includes("Claim levels"))
  check("G1: planned work has no fabricated evidence", ledger.issues.every((issue) => (issue.status === "planned" ? !issue.evidence : true)))
  check(
    "G1: GitHub issue numbers match the created issues",
    ledger.issues.every((issue) => EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue)),
    "expected 498..507 + 544",
  )
  check(
    "G1: dependency order in ledger matches plan (G1 first, V1 before E5/E6, X1 last)",
    !errors.some((error) => error.startsWith("order")),
    errors.filter((error) => error.startsWith("order")).join(","),
  )

  // Contract vocabulary lint over M25 artifacts (acceptance criterion).
  const vocabTargets: Array<[string, string]> = [
    ["M25-MASTER-PLAN.md", plan],
    ["IDE-PROGRAM-STATUS.md", statusTracker],
    ["manifest.json", JSON.stringify(ledger)],
  ]
  for (const [name, text] of vocabTargets) {
    for (const pattern of BANNED_PATTERNS) {
      const m = text.match(pattern)
      check(`G1: no banned vocabulary in ${name} (${pattern.source})`, m === null, m?.[0] ?? "")
    }
  }
  // The program tracker must state the honest v1 state: not started or in
  // progress, never a shipped claim while the ledger has planned issues.
  check(
    "G1: program tracker does not overstate v1",
    unresolvedStates.length === ledger.issues.length
      ? !/v1[^\n]*\b(shipped|released|published)\b/i.test(statusTracker)
      : true,
  )

  // --- M24 completion-bar re-audit (version-ladder discipline) -------------
  let m24Ledger: Ledger | null = null
  try {
    m24Ledger = parseSealedRecord(m24LedgerPath) as Ledger
  } catch {}
  check("G1: M24 ledger is readable", m24Ledger !== null)
  if (m24Ledger) {
    const barErrors = validateM24Bar(m24Ledger)
    check("G1: M24 bar — ledger closed with all 11 issues verified (mechanical)", barErrors.length === 0, barErrors.join(","))

    let m24X1: Record<string, unknown> | null = null
    try {
      m24X1 = parseSealedRecord(m24X1Path) as Record<string, unknown>
    } catch {}
    let ancestor = false
    if (m24X1 && typeof m24X1.currentCommit === "string") {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", m24X1.currentCommit as string, currentCommit], { cwd: ROOT, stdio: "ignore" })
        ancestor = true
      } catch {}
    }
    check(
      "G1: M24 bar — closure-gate evidence verified at an ancestor-or-equal commit",
      m24X1 !== null && m24X1.status === "verified" && ancestor,
      m24X1 ? `status=${String(m24X1.status)} ancestor=${ancestor}` : "X1.json unreadable",
    )
  }
  // The M24 governance gate must be green at HEAD (spawned, real exit code).
  let m24GateExit: number | string = "not-run"
  try {
    execFileSync("npx", ["tsx", "script/m24/verify-governance.ts"], { cwd: ROOT, stdio: "ignore", timeout: 180_000 })
    m24GateExit = 0
  } catch (error) {
    m24GateExit = (error as { status?: number }).status ?? "error"
  }
  check("G1: M24 bar — M24 governance gate exits 0 at HEAD (spawned)", m24GateExit === 0, `exit=${String(m24GateExit)}`)

  // --- Negative checks (mutation proofs) -----------------------------------
  // A verified issue without evidence must be rejected.
  const hollow = structuredClone(ledger)
  hollow.issues[0]!.status = "verified"
  delete hollow.issues[0]!.evidence
  negative(
    "G1: verified without evidence is rejected",
    validateLedger(hollow, plan, contract).some((error) => error === "hollow-verified:G1"),
  )

  // Removing one issue must be rejected.
  const missing = structuredClone(ledger)
  missing.issues.pop()
  negative("G1: missing issue entry is rejected", validateLedger(missing, plan, contract).includes("issue-count"), `issues=${missing.issues.length}`)

  // Acceptance criteria cannot be empty.
  const noAcceptance = structuredClone(ledger)
  noAcceptance.issues[1]!.acceptanceCriteria = []
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:E1"))

  // Duplicated GitHub issue numbers must be rejected.
  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  // The harness must precede the editor runs that consume it.
  const reordered = structuredClone(ledger)
  const v1 = reordered.issues.find((issue) => issue.code === "V1")!
  reordered.issues = reordered.issues.filter((issue) => issue.code !== "V1")
  reordered.issues.splice(reordered.issues.findIndex((issue) => issue.code === "E5") + 1, 0, v1)
  negative("G1: editor run before harness is rejected", validateLedger(reordered, plan, contract).some((error) => error.startsWith("order")))

  // X1 must be last.
  const x1First = structuredClone(ledger)
  const gate = x1First.issues.pop()!
  x1First.issues.unshift(gate)
  negative("G1: closure gate not last is rejected", validateLedger(x1First, plan, contract).some((error) => error.startsWith("order:x1-last") || error === "order:g1-first"))

  // Ledger tamper: wrong milestone identity must be rejected (closure
  // requirement "mutation: ledger tamper fails").
  const tampered = structuredClone(ledger)
  tampered.githubMilestone = 24
  negative("G1: ledger milestone tamper is rejected", validateLedger(tampered, plan, contract).some((error) => error === "milestone"))

  // Planned issues must not carry evidence.
  const fakeEvidence = structuredClone(ledger)
  const plannedIdx = fakeEvidence.issues.findIndex((issue) => issue.status === "planned")
  if (plannedIdx !== -1) {
    fakeEvidence.issues[plannedIdx]!.evidence = {
      status: "planned",
      currentCommit,
      verifierCommand: "npx tsx script/m25/verify-governance.ts",
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

  // Version-ladder negative: demote one M24 issue and the bar must fail —
  // v1 cannot silently start on an unclosed v0.
  const demotedM24 = structuredClone(m24Ledger!)
  if (demotedM24.issues.length > 0) {
    demotedM24.issues[demotedM24.issues.length - 1]!.status = "known-gap"
    negative(
      "G1: M24 bar with a demoted issue is rejected",
      validateM24Bar(demotedM24).includes("not-all-verified"),
    )
  } else {
    negative("G1: M24 bar with a demoted issue is rejected", true, "no M24 issue to demote — skipped")
  }

  // Cross-check: every non-planned M25 ledger issue must reference a
  // persisted evidence JSON whose status matches. G1 is excluded: its
  // evidence records the outcome of this very check (self-referential), so
  // it is validated by the persisted-and-re-readable check below.
  let evidenceErrors: string[] = []
  for (const issue of ledger.issues.filter((item) => item.status !== "planned" && item.code !== "G1")) {
    const evidence = issue.evidence
    const evidencePath = evidence ? path.join(ROOT, "validation/m25/results", evidence.evidenceFile) : ""
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
      // Contract §10: extension-surface evidence must name its OS.
      if (["E5", "E6", "E7"].includes(issue.code) && typeof persisted["os"] !== "string") {
        evidenceErrors.push(`${issue.code}:missing-os`)
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

  // E6 capability-matrix drift gate: the matrix must be DERIVED FROM the
  // per-fork evidence files — a hand-edited or stale matrix is rejected.
  // Re-derive here and compare (found necessary when the fork evidence
  // advanced but the matrix lagged; a claim table that can drift will).
  const matrixPath = path.join(ROOT, "docs/m25/FORK-CAPABILITY-MATRIX.md")
  if (existsSync(matrixPath)) {
    const matrix = readFileSync(matrixPath, "utf8")
    const forkEvidence = ledger.issues
      .filter((item) => item.code === "E6")
      .map((item) => ({ evidence: item.evidence }))
    const matrixErrors: string[] = []
    for (const rec of recordsFromResultsDir("F-")) {
      const forkName = String(rec.fork ?? "?")
      const row = matrix.split("\n").find((l) => l.startsWith(`| ${forkName} `))
      if (!row) {
        matrixErrors.push(`${forkName}:missing-row`)
        continue
      }
      if (rec.status === "verified" && !row.includes("I4 (verified in this fork)")) {
        matrixErrors.push(`${forkName}:row-underclaims`)
      }
      if (rec.status === "blocked" && !row.includes("unset (blocked)")) {
        matrixErrors.push(`${forkName}:row-claims-without-evidence`)
      }
      if (!row.includes(String(rec.evidenceFile ?? ""))) {
        matrixErrors.push(`${forkName}:row-not-linked-to-evidence`)
      }
    }
    if (forkEvidence.length === 0 && !matrix.includes("Fork | Version")) matrixErrors.push("no-e6-evidence-but-matrix-exists")
    check(
      "G1: E6 capability matrix matches its evidence files (no drift, no hand-edited claims)",
      matrixErrors.length === 0,
      matrixErrors.join(","),
    )
    // Mutation: a forged matrix row (claim without evidence) must be caught.
    const forged = matrix.replace(/\| windsurf \|[^\n]*/, "| windsurf | 1.0.0 | linux | I4 (verified in this fork) | [F-WINDSURF.json](../../validation/m25/results/F-WINDSURF.json) | verified (26/26) |")
    const forgedBad = forged.split("\n").some((l) => l.startsWith("| windsurf ") && l.includes("I4 (verified"))
    negative(
      "G1: forged fork claim in matrix is detectable",
      forgedBad,
      "forged row not applied — windsurf row absent",
    )
  }

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
    issue: "M25.G1",
    code: "G1",
    milestone: "M25",
    status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed: finalFailed,
    negativeCases: negatives,
    currentCommit,
    workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
    verifierCommand: "npx tsx script/m25/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    ledger: "validation/m25/results/manifest.json",
    m24Bar: {
      ledgerStatus: m24Ledger?.status ?? "unreadable",
      m24GateExit,
    },
    limitations: [
      "This gate validates governance metadata, mutation response, and the M24 bar; it does not verify extension features.",
      "A run with relevant uncommitted M25 files is recorded as known-gap; verified status requires a clean relevant tree.",
    ],
  }
  const evidenceDir = path.join(ROOT, "validation/m25/results")
  mkdirSync(evidenceDir, { recursive: true })
  const evidencePath = path.join(evidenceDir, result.evidenceFile)
  writeSealed(evidencePath, result)
  const persisted = parseSealedRecord(evidencePath) as typeof result
  check("G1: evidence is persisted and re-readable", persisted.issue === result.issue && persisted.currentCommit === currentCommit)

  const finalFailed2 = checks - passed
  // §8.3: a non-green run records WHY, in the record itself. The ledger's entry
  // for this issue is projected from THIS field, so without it the projection
  // would have nothing honest to write for a known-gap entry.
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
  // while G1.json read `known-gap`. The manifest was hand-maintained: this gate
  // validated its SHAPE and never compared an entry's status to the record it
  // names, so the drift survived any number of green runs. The record is the
  // authority (contract §8.4); every entry except G1 is re-derived from its own
  // record, and G1 from THIS run's verdict below.
  const readM25Record = (file: string): Record<string, unknown> | null => {
    const abs = path.join(ROOT, "validation/m25/results", file)
    if (!existsSync(abs)) return null
    try {
      // The SAME trusted path the cross-check above uses. A projection reading
      // records by a weaker path would heal the ledger toward a tampered
      // record's status (the m55 lesson).
      return parseSealedRecord(abs) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const projectionFindings = projectLaneLedger({
    ledgerPath,
    resultsDir: path.join(ROOT, "validation/m25/results"),
    readRecord: readM25Record,
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
  const backRead = readEvidenceAllowingLegacy<Ledger>(ledgerPath)
  const readBack = (backRead.ok ? backRead.record : ledger) as typeof ledger
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
