// script/m42/verify-governance.ts — M42.G1 (issue #648).
//
// Governance for the interactive-hover milestone. Beyond the ledger
// validation + mutation proofs every IDE gate inherits, this gate owns:
//   1. The M29 completion bar, re-audited HERE on every run — v6 starts on a
//      closed v5, a machine-checked fact, not a manual claim.
//   2. Contract §12 (Hover Interaction Rules): the amendment must exist in
//      the contract doc and the master plan must reference it; the banned
//      vocabulary lint extends over M42 artifacts.
//   3. The declared interaction budgets (§12.7) recorded as constants the
//      later gates import — budgets are declared once, in governance.
//
// Run: npx tsx script/m42/verify-governance.ts
// Evidence: validation/m42/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"
import { projectLaneLedger } from "../m61/ledger_gate_wiring.ts"
import type { ProjectableLedger } from "../m61/ledger_projection.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m42/results")

// Declared interaction budgets (contract §12.7) — single source, imported by
// the H1/H2/H3/H5 gates. Declared in governance, not folklore.
export const INTERACTION_BUDGETS = {
  documentHighlightP95Ms: 25,
  enrichmentReadOverheadP95Ms: 5,
  hoverP95Ms: 50,
  hubOpenP95Ms: 300,
} as const

const EXPECTED_CODES = ["G1", "H1", "H2", "H3", "H4", "H5", "H6", "X1"]
const EXPECTED_ISSUE_NUMBERS = [648, 649, 650, 651, 652, 653, 654, 655]

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

let checks = 0
let passed = 0
let negatives = 0
const details: string[] = []
/** Every check's label and outcome, kept so the record can NAME what is red
 *  (§8.3: a non-green run states its reason). */
const checkLog: Array<[string, boolean]> = []
function check(label: string, condition: boolean, detail?: string): void {
  checks++
  checkLog.push([label, condition])
  if (condition) passed++
  else if (detail) details.push(`${label}: ${detail}`)
  console.log(`  ${condition ? "PASS" : "FAIL"}: ${label}${condition || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, caught: boolean, detail?: string): void {
  negatives++
  check(`${label} [negative]`, caught, detail)
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

const currentCommit = gitCommit()

function relevantWorkingTreeChanges(): string[] {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .filter((file) =>
        file.startsWith("script/m42/") ||
        file.startsWith("docs/m42/") ||
        ["docs/m42/M42-MASTER-PLAN.md", "docs/IDE-HONESTY-CONTRACT.md", "package.json"].includes(file) ||
        file.startsWith("src/lsp/") ||
        // Evidence files under validation/m42/ are OUTPUTS of the gates,
        // rewritten on every run — never inputs (M25.G1 lesson).
        false
      )
  } catch {
    return ["git-status-unavailable"]
  }
}
const currentWorkingTreeRelevantChanges = relevantWorkingTreeChanges()

console.log("M42.G1 — governance for the Interactive Hover (issue #648)\n")

// --- Load artifacts ------------------------------------------------------------------
const ledgerPath = path.join(EVIDENCE_DIR, "manifest.json")
check("G1: ledger manifest exists", existsSync(ledgerPath))
const ledger = parseSealedRecord(ledgerPath) as {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  title: string
  status: string
  authority: string
  governingContract: string
  issues: Array<{
    code: string
    githubIssue: number
    tool: string
    status: string
    scope: string
    acceptanceCriteria: string[]
    closureRequirements: string[]
    evidence?: { status?: string; verifierCommand?: string; evidenceFile?: string; passed?: number; failed?: number; realFailed?: number; negativeCases?: number; mutantsCaught?: number; mutantsTotal?: number }
  }>
}

const plan = existsSync(path.join(ROOT, "docs/m42/M42-MASTER-PLAN.md"))
  ? readFileSync(path.join(ROOT, "docs/m42/M42-MASTER-PLAN.md"), "utf8")
  : ""
const contract = existsSync(path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"))
  ? readFileSync(path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"), "utf8")
  : ""

// --- Ledger validation ----------------------------------------------------------------
interface Issue {
  code: string
  githubIssue: number
  status: string
  evidence?: { status?: string; verifierCommand?: string; evidenceFile?: string; passed?: number; failed?: number; realFailed?: number; negativeCases?: number; mutantsCaught?: number; mutantsTotal?: number }
}
function isClosable(issue: Issue): boolean {
  if (issue.status === "planned") return false
  if (!issue.evidence) return false
  const e = issue.evidence
  const realFailed = typeof e.realFailed === "number" ? e.realFailed : e.failed
  const mutantProof =
    typeof e.mutantsCaught === "number" && e.mutantsCaught > 0 && e.mutantsTotal === e.mutantsCaught
  // TWO BARS, TWO STATUSES. A `known-gap` entry exists BECAUSE the record
  // failed; demanding realFailed === 0 of one makes the honest state
  // structurally unrecordable, pushing a lane to lie (`verified` over a red
  // record) or to omit the reason. `verified` keeps the full bar (green run +
  // can-fail proof); `known-gap`/`blocked` must carry the REASON they are
  // non-verified (contract §8.3). The m24/m25/m29 fix, applied here for the same
  // reason: the ledger projection made the honest states visible and this rule
  // could not record them.
  if (issue.status !== "verified") {
    const reason = typeof e.blockedReason === "string" ? e.blockedReason.trim() : ""
    return Boolean(e.status === issue.status && e.verifierCommand && e.evidenceFile && (e.passed ?? 0) > 0 && reason.length > 0)
  }
  return Boolean(
    e.status === issue.status &&
      e.verifierCommand &&
      e.evidenceFile &&
      (e.passed ?? 0) > 0 &&
      realFailed === 0 &&
      (typeof e.negativeCases === "number" && e.negativeCases > 0 ? true : mutantProof),
  )
}
function validateLedger(l: typeof ledger, planText: string, contractText: string): string[] {
  const errors: string[] = []
  if (l.schemaVersion !== 1) errors.push("schemaVersion")
  if (l.milestone !== "M42" || l.githubMilestone !== 42) errors.push("milestone")
  const allVerified = (l.issues ?? []).length > 0 && (l.issues ?? []).every((i) => i.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (l.status !== expectedStatus) errors.push("status")
  if (!l.authority || !(planText.includes("Issue groups") || planText.includes("Issues"))) errors.push("authority")
  if (!l.governingContract || !contractText.includes("Hover Interaction Rules")) errors.push("contract")
  if (!Array.isArray(l.issues) || l.issues.length !== EXPECTED_CODES.length) errors.push("issue-count")
  const codes = new Set<string>()
  const numbers = new Set<number>()
  for (const issue of l.issues ?? []) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || numbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`)
    if (!EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue)) errors.push(`github-issue-unknown:${issue.code}`)
    numbers.add(issue.githubIssue)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  const order = (l.issues ?? []).map((i) => i.code)
  const idx = (c: string) => order.indexOf(c)
  if (order.length === EXPECTED_CODES.length) {
    if (idx("G1") !== 0) errors.push("order:g1-first")
    if (!(idx("H1") < idx("H2"))) errors.push("order:h1-before-h2")
    if (!(idx("H2") < idx("H3"))) errors.push("order:h2-before-h3")
    if (!(idx("H5") < idx("H6"))) errors.push("order:h5-before-h6")
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}

check("G1: ledger validates against the plan and contract", validateLedger(ledger, plan, contract).length === 0, validateLedger(ledger, plan, contract).join(","))
check("G1: all 8 issue entries are unique and structurally sound", (() => {
  const errs = validateLedger(ledger, plan, contract).filter((e) => !e.startsWith("status"))
  return errs.length === 0
})(), validateLedger(ledger, plan, contract).join(","))

// --- Evidence-at-current-commit --------------------------------------------------------
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  H1: ["src/lsp/document_highlight.ts", "src/lsp/server.ts", "script/m42/h1-fixture.ts", "script/m42/verify-highlight.ts", "script/m25/feature-assertions.ts"],
  H2: ["src/lsp/hover.ts", "src/lsp/rich_hover.ts", "src/lsp/navigation.ts", "script/m42/h2-fixture.ts", "script/m42/verify-rich-hover.ts", "script/m25/feature-assertions.ts", "script/m25/verify-harness-core.ts", "script/m25/e5-inner.js", "ide/vscode/src/hover-commands.ts", "ide/vscode/src/extension.ts"],
  H3: ["src/lsp/enrichment.ts", "src/lsp/rich_hover.ts", "src/intelligence/contracts.ts", "src/intelligence/graph/graph-engine.ts", "script/m26/graph-core.ts", "script/m26/verify-evidence-badges.ts", "script/m42/h2-fixture.ts", "script/m42/verify-enrichment-surface.ts", "script/m25/feature-assertions.ts", "script/m25/verify-harness-core.ts"],
  H4: ["src/lsp/hover.ts", "src/lsp/rich_hover.ts", "src/lsp/impact.ts", "src/lsp/impact_request.ts", "src/lsp/server.ts", "script/m26/graph-core.ts", "script/m26/verify-impact-mode.ts", "script/m42/h2-fixture.ts", "script/m42/verify-hover-actions.ts", "ide/vscode/src/hover-commands.ts", "ide/vscode/src/impact-panel.ts", "ide/vscode/src/graph-panel.ts", "ide/vscode/src/extension.ts", "ide/vscode/package.json", "ide/vscode/README.md", "script/m25/feature-assertions.ts", "script/m25/verify-harness-core.ts", "script/m25/e5-inner.js"],
  H5: ["script/m26/graph-core.ts", "script/m26/webview-harness.ts", "script/m26/verify-webview-harness.ts", "script/m26/verify-graph-transport.ts", "src/lsp/graph_request.ts", "docs/m42/HUB.md", "docs/m26/GRAPH-TRANSPORT.md", "script/m42/verify-hub.ts", "ide/vscode/src/hub-panel.ts", "ide/vscode/src/hover-commands.ts", "ide/vscode/esbuild-extension.mjs", "script/m25/feature-assertions.ts", "script/m25/verify-harness-core.ts", "script/m25/e5-inner.js"],
  H6: ["src/lsp/hub_protocol.ts", "ide/vscode/src/hub-navigation-core.ts", "ide/vscode/src/hub-navigation.ts", "ide/vscode/src/hub-panel.ts", "ide/vscode/esbuild-extension.mjs", "script/m26/graph-core.ts", "docs/m42/HUB-PROTOCOL.md", "script/m42/verify-hub-navigation.ts", "script/m25/e5-inner.js"],
  X1: ["script/m42/verify-closure.ts"],
}
const SHARED_RELEVANT_FILES = [
  "docs/m42/M42-MASTER-PLAN.md",
  "docs/IDE-HONESTY-CONTRACT.md",
  "docs/IDE-PROGRAM-DECISIONS.md",
  "docs/IDE-PROGRAM-STATUS.md",
]

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

const evidenceErrors: string[] = []
// Cross-check: every non-planned M42 ledger issue must reference a persisted
// evidence JSON whose status matches. G1 is excluded: its evidence records
// the outcome of this very check (self-referential) — the same rule M29's
// governance gate established for the same reason.
for (const issue of ledger.issues) {
  if (issue.status === "planned" || issue.code === "G1") continue
  const evidenceFile = issue.evidence?.evidenceFile
  if (!evidenceFile) {
    evidenceErrors.push(`${issue.code}:no-evidence-file`)
    continue
  }
  const p = path.join(EVIDENCE_DIR, evidenceFile)
  if (!existsSync(p)) {
    evidenceErrors.push(`${issue.code}:missing-evidence`)
    continue
  }
  try {
    const persisted = parseSealedRecord(p) as Record<string, unknown>
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

// --- Contract §12 amendment present -----------------------------------------------------
check("G1: contract §12 Hover Interaction Rules ratified in the contract doc", contract.includes("## 12. Hover Interaction Rules"))
for (const rule of ["Nothing unclickable", "Stale is visible everywhere", "Enrichment is labeled as enrichment", "complement stance holds", "ONE renderer core", "wake-up path", "interaction budgets"]) {
  check(`G1: §12 rule present — "${rule}"`, contract.includes(rule))
}
check("G1: master plan references the contract amendment", plan.includes("Hover Interaction Rules") && plan.includes("IDE-HONESTY-CONTRACT.md"))

// --- Declared budgets: single source ----------------------------------------------------
check("G1: interaction budgets declared as exported constants", typeof INTERACTION_BUDGETS.documentHighlightP95Ms === "number" && INTERACTION_BUDGETS.documentHighlightP95Ms === 25 && INTERACTION_BUDGETS.hubOpenP95Ms === 300)
check("G1: contract §12.7 numbers equal the declared constants", contract.includes("25 ms") && contract.includes("5 ms") && contract.includes("300 ms"))

// --- Banned vocabulary over M42 artifacts -----------------------------------------------
{
  // The gate script itself is deliberately NOT linted (the M29.G1 rule): the
  // definitions of the banned patterns would match themselves. The hollow-
  // assertion self-audit below covers the gate's own honesty instead.
  const artifacts = [
    "docs/m42/M42-MASTER-PLAN.md",
    "validation/m42/results/manifest.json",
  ]
  let violations: string[] = []
  for (const rel of artifacts) {
    const p = path.join(ROOT, rel)
    if (!existsSync(p)) continue
    const src = readFileSync(p, "utf8")
    for (const rx of BANNED_PATTERNS) {
      const m = rx.exec(src)
      if (m) violations.push(`${rel}: /${rx.source}/ matched "${m[0]}"`)
    }
  }
  check("G1: banned vocabulary = zero across M42 artifacts", violations.length === 0, violations.slice(0, 3).join("; "))
}

// --- The M29 completion bar (spawned — v6 starts on a closed v5) -------------------------
console.log("\nG1: M29 bar — spawning the M29 governance gate at this HEAD…")
let m29GateExit = -1
try {
  execFileSync("npx", ["tsx", "script/m29/verify-governance.ts"], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "inherit"] })
  m29GateExit = 0
} catch (e) {
  m29GateExit = (e as { status?: number }).status ?? -1
}
check("G1: M29 bar — M29 governance gate exits 0 at HEAD (spawned)", m29GateExit === 0, `exit=${m29GateExit}`)

// --- Mutation proofs (in-memory only; on-disk ledger untouched) --------------------------
console.log("\nG1: mutation proofs — the gate CAN fail")
{
  const hollow = structuredClone(ledger) as typeof ledger
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
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:H1"))
  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  const wrongOrder = structuredClone(ledger)
  const x1 = wrongOrder.issues.find((i) => i.code === "X1")!
  wrongOrder.issues = [x1, ...wrongOrder.issues.filter((i) => i.code !== "X1")]
  negative("G1: X1 out of last position is rejected", validateLedger(wrongOrder, plan, contract).some((error) => error === "order:x1-last"))

  const forgedContract = structuredClone(ledger)
  negative(
    "G1: a ledger citing a contract without §12 is rejected",
    validateLedger(forgedContract, plan, "no amendment here").some((error) => error === "contract"),
  )

  // The M29 bar cannot be faked by this gate: it spawns the real M29 gate and
  // checks the exit code. Mutating this gate's source to hardcode a pass is
  // the exact hollow-assertion pattern the self-audit below bans.
  const src = readFileSync(new URL(import.meta.url), "utf8")
  const hardTrue = ["check(true", "check(1 === 1"].join("")
  const orTrue = ["|", "|", " true)"].join("")
  const zeroThreshold = [">=", " 0"].join("")
  const unconditional = src.includes(hardTrue) || src.includes(orTrue) || src.includes(zeroThreshold)
  negative("G1: verifier has no obvious hollow assertions", !unconditional, unconditional ? "hollow pattern found" : "clean")
}

// --- Persist evidence --------------------------------------------------------------------
const finalFailed = checks - passed
const result = {
  issue: "M42.G1",
  code: "G1",
  milestone: "M42",
  status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed: finalFailed,
  negativeCases: negatives,
  currentCommit,
  workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m42/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  ledger: "validation/m42/results/manifest.json",
  interactionBudgets: INTERACTION_BUDGETS,
  m29Bar: { gateExit: m29GateExit },
  limitations: [
    "This gate validates governance metadata, mutation response, and the M29 bar; it does not verify the hover features themselves (H1–H6 own those).",
    "A run with relevant uncommitted M42 files is recorded as known-gap; verified status requires a clean relevant tree.",
  ],
}
mkdirSync(EVIDENCE_DIR, { recursive: true })
const evidencePath = path.join(EVIDENCE_DIR, result.evidenceFile)
writeSealed(evidencePath, result)
const persisted = parseSealedRecord(evidencePath) as typeof result
check("G1: evidence is persisted and re-readable", persisted.issue === result.issue && persisted.currentCommit === currentCommit)

// Counters re-captured AFTER the last check (the M24-inherited undercount bug).
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

// --- The ledger is a PROJECTION of its records, written here ------------------
// At integration/lsp-truth HEAD 462f620be this manifest read `G1: verified` over
// a `known-gap` G1.json. The manifest was hand-maintained: this gate validated
// its shape and never compared an entry's status to the record it names. The
// record is the authority (contract §8.4).
const readM42Record = (file: string): Record<string, unknown> | null => {
  const abs = path.join(EVIDENCE_DIR, file)
  if (!existsSync(abs)) return null
  try {
    // The SAME trusted path the cross-check above uses; a projection reading by
    // a weaker path would heal toward a tampered record's status.
    return parseSealedRecord(abs) as Record<string, unknown>
  } catch {
    return null
  }
}
const projectionFindings = projectLaneLedger({
  ledgerPath,
  resultsDir: EVIDENCE_DIR,
  readRecord: readM42Record,
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
  onFinding: (detail) => check("G1: the projected ledger agrees with its records", false, detail),
  onPass: (detail) => check(detail, true),
  onHealed: (message) => console.log(`  ${message}`),
})

// The ledger is RE-VALIDATED from DISK, after the projection. Validating the
// in-memory snapshot taken at the top of this gate validates a ledger the
// projection has since rewritten, so the verdict described a state that no
// longer existed: four honest `verified` entries read `hollow-verified` because
// the snapshot predated the projection that restored their mutant counts. A
// validator that judges a stale copy is not auditing the artifact.
{
  const readBack = parseSealedRecord(ledgerPath) as typeof ledger
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

console.log(`\n${finalRecord.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
process.exit(finalFailed3 === 0 ? 0 : 1)

