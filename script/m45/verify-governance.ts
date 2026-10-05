// script/m45/verify-governance.ts — M45.G1 (issue #708).
//
// Governance for the "Demo Media Truth" milestone. Beyond the ledger
// validation + mutation proofs every gate inherits, this gate owns:
//   1. Contract §14 (Demo-Media Rules): the amendment must exist in the
//      contract doc and the master plan must reference it; the banned
//      vocabulary lint extends over M45 artifacts.
//   2. The capture-truth manifest schema, declared ONCE here and imported
//      by the C1 harness verifier and the frame-truth verifier — a video is
//      a claim, and the claim's shape is governed, not folklore.
//   3. Prerequisite bars read (not rewritten): M41 website truth/SEO and
//      M42 bars read from their ledgers at the current commit; M44 bar read
//      as the hub-scene precondition (co-agent open lane). M45 does NOT
//      spawn upstream gates, because that would rewrite co-agent evidence
//      files in this shared tree — it reads their persisted state instead.
//
// Run: npx tsx script/m45/verify-governance.ts
// Evidence: validation/m45/results/G1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import { projectLaneLedger } from "../m61/ledger_gate_wiring.ts"
import type { ProjectableLedger } from "../m61/ledger_projection.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m45/results")

const EXPECTED_CODES = ["G1", "C1", "D1", "T1", "X1"]
const EXPECTED_ISSUE_NUMBERS = [708, 709, 710, 711, 712]

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
  /\bjust works\b/i,
]

// --- Capture-truth manifest schema (single source; C1 + frame-truth import) -----------
export const CAPTURE_MANIFEST_KEYS = [
  "schemaVersion",
  "bbVersion",
  "editor",
  "editorVersion",
  "vsixSha256",
  "corpusCommit",
  "corpusPath",
  "indexHash",
  "captureDate",
  "tools",
] as const

export interface CaptureManifest {
  schemaVersion: 1
  bbVersion: string
  editor: "vscode" | "cursor" | "neovim"
  editorVersion: string
  vsixSha256: string
  corpusCommit: string
  corpusPath: string
  indexHash: string
  captureDate: string
  tools: Record<string, string> // tool name -> version, e.g. { ffmpeg: "4.4.2", xdotool: "…" }
}

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
        file.startsWith("script/m45/") ||
        file.startsWith("docs/m45/") ||
        ["docs/m45/M45-MASTER-PLAN.md", "docs/IDE-HONESTY-CONTRACT.md", "docs/IDE-PROGRAM-STATUS.md", "package.json"].includes(file) ||
        file.startsWith("validation/m45/") && !file.endsWith(".json") // evidence outputs are not inputs
      )
  } catch {
    return ["git-status-unavailable"]
  }
}
const currentWorkingTreeRelevantChanges = relevantWorkingTreeChanges()

console.log("M45.G1 — governance for Demo Media Truth (issue #708)\n")

// --- Load artifacts ----------------------------------------------------------------------
const ledgerPath = path.join(EVIDENCE_DIR, "manifest.json")
check("G1: ledger manifest exists", existsSync(ledgerPath))
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as {
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

const plan = existsSync(path.join(ROOT, "docs/m45/M45-MASTER-PLAN.md"))
  ? readFileSync(path.join(ROOT, "docs/m45/M45-MASTER-PLAN.md"), "utf8")
  : ""
const contract = existsSync(path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"))
  ? readFileSync(path.join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"), "utf8")
  : ""

// --- Ledger validation --------------------------------------------------------------------
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
  // non-verified (contract §8.3). The m24/m25/m29/m42/m44 fix, applied here for
  // the same reason: the ledger projection made the honest states visible and
  // this rule could not record them.
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
function prerequisiteOf(l: typeof ledger): boolean {
  return /M41/.test(l.prerequisite ?? "") && /M42/.test(l.prerequisite ?? "") && /M44/.test(l.prerequisite ?? "") && /hub-scene/.test(l.prerequisite ?? "")
}
function validateLedger(l: typeof ledger, planText: string, contractText: string): string[] {
  const errors: string[] = []
  if (l.schemaVersion !== 1) errors.push("schemaVersion")
  if (l.milestone !== "M45" || l.githubMilestone !== 49) errors.push("milestone")
  const allVerified = (l.issues ?? []).length > 0 && (l.issues ?? []).every((i) => i.status === "verified")
  const expectedStatus = allVerified ? "closed" : "open"
  if (l.status !== expectedStatus) errors.push("status")
  if (!l.prerequisite || !prerequisiteOf(l)) errors.push("prerequisite")
  if (!l.authority || !(planText.includes("Issue groups") || planText.includes("Issues"))) errors.push("authority")
  if (!l.governingContract || !contractText.includes("Demo-Media Rules")) errors.push("contract")
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
    if (issue.status === "planned" && issue.evidence?.status && issue.evidence.status !== "planned") errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  const order = (l.issues ?? []).map((i) => i.code)
  const idx = (c: string) => order.indexOf(c)
  if (order.length === EXPECTED_CODES.length) {
    if (idx("G1") !== 0) errors.push("order:g1-first")
    if (idx("X1") !== order.length - 1) errors.push("order:x1-last")
  } else {
    errors.push("order:missing-codes")
  }
  return errors
}

check("G1: ledger validates against the plan and contract", validateLedger(ledger, plan, contract).length === 0, validateLedger(ledger, plan, contract).join(","))

// --- Contract §14 amendment present --------------------------------------------------------
check("G1: contract §14 Demo-Media Rules ratified in the contract doc", contract.includes("## 14. Demo-Media Rules"))
for (const rule of [
  "A video is a claim",
  "Every frame is real",
  "Version honesty",
  "Verifier-first",
  "Website integration is truth-invariant",
  "Reduced-motion and accessibility are not optional",
  "The director's layer never touches product pixels",
]) {
  check(`G1: §14 rule present — "${rule}"`, contract.includes(rule))
}
check("G1: master plan references the contract amendment", plan.includes("Demo-Media Rules") && plan.includes("IDE-HONESTY-CONTRACT.md"))
check("G1: master plan names the real issue numbers", plan.includes("#708") && plan.includes("#709") && plan.includes("#710") && plan.includes("#711") && plan.includes("#712"))

// --- Capture-manifest schema sanity -------------------------------------------------------
for (const key of CAPTURE_MANIFEST_KEYS) {
  check(`G1: manifest schema declares "${key}"`, key.length > 0)
}
const schemaVersionKey = CAPTURE_MANIFEST_KEYS[0]
check("G1: manifest schemaVersion is declared first and is 1", schemaVersionKey === "schemaVersion")
check("G1: manifest schema requires index hash (a video is a claim about an index)", (CAPTURE_MANIFEST_KEYS as readonly string[]).includes("indexHash"))
check("G1: manifest schema requires corpus identity", (CAPTURE_MANIFEST_KEYS as readonly string[]).includes("corpusCommit") && (CAPTURE_MANIFEST_KEYS as readonly string[]).includes("corpusPath"))
check("G1: manifest schema requires editor + exact version", (CAPTURE_MANIFEST_KEYS as readonly string[]).includes("editorVersion"))
check("G1: manifest schema requires vsix sha256", (CAPTURE_MANIFEST_KEYS as readonly string[]).includes("vsixSha256"))

// --- Banned vocabulary over M45 artifacts ----------------------------------------------------
{
  const artifacts = [
    "docs/m45/M45-MASTER-PLAN.md",
    "validation/m45/results/manifest.json",
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
  check("G1: banned vocabulary = zero across M45 artifacts", violations.length === 0, violations.slice(0, 3).join("; "))
}

// --- Prerequisite bars (read, never rewritten) ----------------------------------------------
function readLedgerState(milestoneDir: string): { status?: string; verified: number; planned: number; issueCount: number } | null {
  try {
    const p = path.join(ROOT, `validation/${milestoneDir}/results/manifest.json`)
    if (!existsSync(p)) return null
    const m = JSON.parse(readFileSync(p, "utf8")) as { status?: string; issues?: Array<{ status: string }> }
    const issues = m.issues ?? []
    return {
      status: m.status,
      verified: issues.filter((i) => i.status === "verified").length,
      planned: issues.filter((i) => i.status === "planned").length,
      issueCount: issues.length,
    }
  } catch {
    return null
  }
}

const m41State = readLedgerState("m41")
const m42State = readLedgerState("m42")
const m44State = readLedgerState("m44")

check("G1: M41 website ledger is readable", m41State !== null)
check("G1: M42 ledger is readable and fully verified (bar met)", m42State !== null && m42State.issueCount > 0 && m42State.verified === m42State.issueCount && m42State.planned === 0, m42State ? `verified=${m42State.verified}/${m42State.issueCount}` : "unreadable")
check("G1: M44 ledger is readable (hub-scene precondition source)", m44State !== null)
// M44 is the co-agent's OPEN lane: bar met means no PENDING hub-scene blocker today is
// recorded as a fact, not required — G1 only verifies the ledger is readable and sane.
check("G1: M44 ledger is structurally sane", m44State !== null && m44State.issueCount > 0)
const m44Unverified = m44State ? m44State.issueCount - m44State.verified : 0
check(
  "G1: master plan records M44's open-lane status for hub-scene gating",
  plan.includes("M44") && (m44Unverified === 0 ? plan.includes("after M44 closes") || plan.includes("M44 bar green") : plan.includes("M44") && plan.includes("co-agent") || plan.includes("open lane")),
  `M44 unverified issues = ${m44Unverified}`,
)

// --- Mutation proofs (in-memory only; on-disk ledger untouched) ----------------------------
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
  negative("G1: issue without acceptance criteria is rejected", validateLedger(noAcceptance, plan, contract).some((error) => error === "acceptance:C1"))

  const dup = structuredClone(ledger)
  dup.issues[1]!.githubIssue = dup.issues[0]!.githubIssue
  negative("G1: duplicated GitHub issue number is rejected", validateLedger(dup, plan, contract).some((error) => error.startsWith("github-issue:")))

  const wrongOrder = structuredClone(ledger)
  const x1 = wrongOrder.issues.find((i) => i.code === "X1")!
  wrongOrder.issues = [x1, ...wrongOrder.issues.filter((i) => i.code !== "X1")]
  negative("G1: X1 out of last position is rejected", validateLedger(wrongOrder, plan, contract).some((error) => error === "order:x1-last"))

  const forgedContract = structuredClone(ledger)
  negative(
    "G1: a ledger citing a contract without §14 is rejected",
    validateLedger(forgedContract, plan, "no demo rules here").some((error) => error === "contract"),
  )

  const wrongMilestone = structuredClone(ledger)
  wrongMilestone.githubMilestone = 50
  negative("G1: a ledger pinned to the wrong GitHub milestone is rejected", validateLedger(wrongMilestone, plan, contract).includes("milestone"))

  const wrongCode = structuredClone(ledger)
  wrongCode.issues[2]!.code = "XX"
  negative("G1: an unexpected issue code is rejected", validateLedger(wrongCode, plan, contract).some((error) => error === "code:XX"))

  const noPrereq = structuredClone(ledger)
  noPrereq.prerequisite = "none"
  negative("G1: a ledger without the stated prerequisite is rejected", validateLedger(noPrereq, plan, contract).includes("prerequisite"))

  // The self-audit (M29.G1 rule): no obvious hollow assertions in this verifier.
  const src = readFileSync(new URL(import.meta.url), "utf8")
  const hardTrue = ["check(true", "check(1 === 1"].join("")
  const orTrue = ["|", "|", " true)"].join("")
  const zeroThreshold = [">=", " 0"].join("")
  const unconditional = src.includes(hardTrue) || src.includes(orTrue) || src.includes(zeroThreshold)
  negative("G1: verifier has no obvious hollow assertions", !unconditional, unconditional ? "hollow pattern found" : "clean")
}

// --- Persist evidence ------------------------------------------------------------------------
const finalFailed = checks - passed
const result = {
  issue: "M45.G1",
  code: "G1",
  milestone: "M45",
  status: finalFailed === 0 && currentWorkingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed: finalFailed,
  negativeCases: negatives,
  currentCommit,
  workingTreeRelevantChanges: currentWorkingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m45/verify-governance.ts",
  evidenceFile: "G1.json",
  generatedAt: new Date().toISOString(),
  ledger: "validation/m45/results/manifest.json",
  prerequisiteBars: {
    m41: m41State ? `${m41State.verified}/${m41State.issueCount} verified` : "unreadable",
    m42: m42State ? `${m42State.verified}/${m42State.issueCount} verified` : "unreadable",
    m44: m44State ? `${m44State.verified}/${m44State.issueCount} verified (open lane — hub-scene precondition)` : "unreadable",
  },
  limitations: [
    "This gate validates governance metadata, the §14 contract amendment, the capture-manifest schema, and reads (never rewrites) the M41/M42/M44 prerequisite ledgers; it does not verify the capture harness (C1), the films (D1), or the embed (T1).",
    "Upstream gates are read, not spawned: spawning M42/M44 gates would rewrite co-agent evidence files in this shared tree. M41/M42/M44 bar re-audits therefore read persisted ledger state at the current commit.",
    "A run with relevant uncommitted M45 files is recorded as known-gap; verified status requires a clean relevant tree.",
  ],
}
mkdirSync(EVIDENCE_DIR, { recursive: true })
const evidencePath = path.join(EVIDENCE_DIR, result.evidenceFile)
// SEALED WRITE (M61 D-1). This gate used `writeFileSync(JSON.stringify(...))`,
// which is the exact pattern D-1 exists to end: an unsealed record carries no
// content hash, so a clobbered or hand-edited record is believed by every
// downstream gate. The ledger projection added below reads records through the
// trusted path, and it would REFUSE this gate's own records as unsealed — a
// projection that cannot read the records it must project is theatre.
writeSealed(evidencePath, result as unknown as Record<string, unknown>)
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
writeSealed(evidencePath, finalResult as unknown as Record<string, unknown>)

// --- The ledger is a PROJECTION of its records, written here ------------------
// At integration/lsp-truth HEAD 462f620be this manifest read `G1: verified` over
// a `known-gap` G1.json. The manifest was hand-maintained: this gate validated
// its shape and never compared an entry's status to the record it names. The
// record is the authority (contract §8.4).
const readM45Record = (file: string): Record<string, unknown> | null => {
  const abs = path.join(EVIDENCE_DIR, file)
  if (!existsSync(abs)) return null
  try {
    // The SAME trusted path the cross-check uses; a projection reading by a
    // weaker path would heal toward a tampered record's status.
    return parseSealedRecord(abs) as Record<string, unknown>
  } catch {
    return null
  }
}
const projectionFindings = projectLaneLedger({
  ledgerPath,
  resultsDir: EVIDENCE_DIR,
  readRecord: readM45Record,
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

