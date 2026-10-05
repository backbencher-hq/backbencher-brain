// script/m44/verify-governance.ts — M44.G1 (issue #687).
//
// Governance for the "Understandable Hub" milestone (IDE v7). Beyond the
// ledger validation + mutation proofs every IDE gate inherits, this gate owns:
//   1. The M29 + M42 completion bars, re-audited HERE on every run — v7
//      starts on closed v5/v6, a machine-checked fact, not a manual claim.
//      The M42 bar is spawned directly; M42's own gate re-audits M29 on
//      every run, so the whole chain M24→M42 is re-audited transitively.
//   2. Contract §13 (Understanding Rules): the amendment must exist in the
//      contract doc and the master plan must reference it; the banned
//      vocabulary lint extends over M44 artifacts.
//
// Run: npx tsx script/m44/verify-governance.ts
// Evidence: validation/m44/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"
import { projectLaneLedger } from "../m61/ledger_gate_wiring.ts"
import type { ProjectableLedger } from "../m61/ledger_projection.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m44/results")

const EXPECTED_CODES = ["G1", "U1", "U2", "U3", "U4", "U5", "U6", "X1"]
const EXPECTED_ISSUE_NUMBERS = [687, 688, 689, 690, 691, 692, 693, 694]

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
        file.startsWith("script/m44/") ||
        file.startsWith("docs/m44/") ||
        ["docs/m44/M44-MASTER-PLAN.md", "docs/IDE-HONESTY-CONTRACT.md", "docs/IDE-PROGRAM-STATUS.md", "package.json"].includes(file) ||
        false
      )
  } catch {
    return ["git-status-unavailable"]
  }
}
const currentWorkingTreeRelevantChanges = relevantWorkingTreeChanges()

console.log("M44.G1 — governance for the Understandable Hub (issue #687)\n")

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
  prerequisite: string
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

const plan = existsSync(path.join(ROOT, "docs/m44/M44-MASTER-PLAN.md"))
  ? readFileSync(path.join(ROOT, "docs/m44/M44-MASTER-PLAN.md"), "utf8")
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
  // non-verified (contract §8.3). The m24/m25/m29/m42 fix, applied here for the
  // same reason: the ledger projection made the honest states visible and this
  // rule could not record them.
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
  if (l.milestone !== "M44" || l.githubMilestone !== 47) errors.push("milestone")
  const allVerified = (l.issues ?? []).length > 0 && (l.issues ?? []).every((i) => i.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (l.status !== expectedStatus) errors.push("status")
  if (!l.authority || !planText.includes("Issue groups")) errors.push("authority")
  if (!l.governingContract || !contractText.includes("Understanding Rules")) errors.push("contract")
  if (!l.prerequisite || !prerequisiteOf(l)) errors.push("prerequisite")
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
    for (let n = 1; n < order.length - 2; n++) {
      if (!(idx(`U${n}`) < idx(`U${n + 1}`))) errors.push(`order:u${n}-before-u${n + 1}`)
    }
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}
// Prerequisite must name the M29 + M42 bars (the predecessor ladder).
function prerequisiteOf(l: typeof ledger): boolean {
  return /M29/.test(l.prerequisite ?? "") && /M42/.test(l.prerequisite ?? "") && /re-audited|re-audit/i.test(l.prerequisite ?? "")
}

check("G1: ledger validates against the plan and contract", validateLedger(ledger, plan, contract).length === 0, validateLedger(ledger, plan, contract).join(","))
check("G1: all 8 issue entries are unique and structurally sound", (() => {
  const errs = validateLedger(ledger, plan, contract).filter((e) => !e.startsWith("status"))
  return errs.length === 0
})(), validateLedger(ledger, plan, contract).join(","))

// --- Evidence-at-current-commit --------------------------------------------------------
const ISSUE_RELEVANT_FILES: Record<string, string[]> = {
  G1: ["script/m44/verify-governance.ts", "docs/IDE-HONESTY-CONTRACT.md", "validation/m44/results/manifest.json"],
  U1: ["src/lsp/graph_request.ts", "src/lsp/graph_usages.ts", "script/m44/verify-usages-groups.ts", "src/lsp/server.ts"],
  U2: ["script/m26/graph-core.ts", "script/m26/webview-harness.ts", "script/m44/verify-usages-groups.ts", "ide/vscode/src/hub-panel.ts"],
  U3: ["script/m26/graph-core.ts", "script/m26/webview-harness.ts", "script/m44/verify-hub-tree.ts"],
  U4: ["script/m26/graph-core.ts", "script/m44/verify-legend.ts", "docs/m44/HUB-LEGEND.md", "ide/vscode/src/hub-panel.ts"],
  U5: ["src/lsp/impact.ts", "src/lsp/impact_request.ts", "src/lsp/hover.ts", "script/m44/verify-impact-resolution.ts"],
  U6: ["ide/vscode/src/hover-commands.ts", "ide/vscode/src/usage-fallback.ts", "script/m44/verify-usages-fallback.ts", "src/lsp/rich_hover.ts", "src/lsp/hover.ts"],
  X1: ["script/m44/verify-closure.ts"],
}
const SHARED_RELEVANT_FILES = [
  "docs/m44/M44-MASTER-PLAN.md",
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
// G1's evidence records the outcome of this very check (self-referential),
// so it is excluded — the same rule M29's governance gate established.
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

// --- Contract §13 amendment present -----------------------------------------------------
check("G1: contract §13 Understanding Rules ratified in the contract doc", contract.includes("## 13. Understanding Rules"))
for (const rule of [
  "One row per symbol",
  "Multiplicity is declared",
  "Interactive is visibly interactive",
  "Counts equal what is rendered",
  "Noise is labeled, not hidden",
  "Dead ends are defects",
  "ONE renderer core",
]) {
  check(`G1: §13 rule present — "${rule}"`, contract.includes(rule))
}
check("G1: master plan references the contract amendment", plan.includes("Understanding Rules") && plan.includes("IDE-HONESTY-CONTRACT.md"))
check("G1: master plan is committed under docs/m44 and names the issue groups", plan.includes("Issue groups") && plan.includes("#687"))

// --- Banned vocabulary over M44 artifacts -----------------------------------------------
{
  // The gate script itself is deliberately NOT linted (the M29.G1 rule): the
  // definitions of the banned patterns would match themselves.
  const artifacts = [
    "docs/m44/M44-MASTER-PLAN.md",
    "validation/m44/results/manifest.json",
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
  check("G1: banned vocabulary = zero across M44 artifacts", violations.length === 0, violations.slice(0, 3).join("; "))
}

// --- The M42 completion bar (spawned — v7 starts on a closed v6) -------------------------
console.log("\nG1: M42 bar — spawning the M42 governance gate at this HEAD (M29 is re-audited transitively by M42.G1)…")
let m42GateExit = -1
try {
  execFileSync("npx", ["tsx", "script/m42/verify-governance.ts"], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "inherit"] })
  m42GateExit = 0
} catch (e) {
  m42GateExit = (e as { status?: number }).status ?? -1
}
check("G1: M42 bar — M42 governance gate exits 0 at HEAD (spawned)", m42GateExit === 0, `exit=${m42GateExit}`)

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
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:U1"))
  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  const wrongOrder = structuredClone(ledger)
  const x1 = wrongOrder.issues.find((i) => i.code === "X1")!
  wrongOrder.issues = [x1, ...wrongOrder.issues.filter((i) => i.code !== "X1")]
  negative("G1: X1 out of last position is rejected", validateLedger(wrongOrder, plan, contract).some((error) => error === "order:x1-last"))

  const forgedContract = structuredClone(ledger)
  negative(
    "G1: a ledger citing a contract without §13 is rejected",
    validateLedger(forgedContract, plan, "no amendment here").some((error) => error === "contract"),
  )

  const wrongMilestone = structuredClone(ledger)
  wrongMilestone.githubMilestone = 46
  negative("G1: a ledger pinned to the wrong GitHub milestone is rejected", validateLedger(wrongMilestone, plan, contract).includes("milestone"))

  const noPrereq = structuredClone(ledger)
  noPrereq.prerequisite = "none"
  negative("G1: a ledger without the M29+M42 prerequisite is rejected", validateLedger(noPrereq, plan, contract).includes("prerequisite"))

  // The M42 bar cannot be faked by this gate: it spawns the real M42 gate and
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
  issue: "M44.G1",
  code: "G1",
  milestone: "M44",
  status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed: finalFailed,
  negativeCases: negatives,
  currentCommit,
  workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m44/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  ledger: "validation/m44/results/manifest.json",
  m42Bar: { gateExit: m42GateExit },
  limitations: [
    "This gate validates governance metadata, mutation response, and the M42 bar (M29 re-audited transitively); it does not verify the hub features themselves (U1–U6 own those).",
    "A run with relevant uncommitted M44 files is recorded as known-gap; verified status requires a clean relevant tree.",
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
const readM44Record = (file: string): Record<string, unknown> | null => {
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
  readRecord: readM44Record,
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

console.log(`\n${finalRecord.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
process.exit(finalFailed3 === 0 ? 0 : 1)

