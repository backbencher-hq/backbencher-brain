// script/m62/governance_core.ts — M62's pure governance cores (G1 + X1).
//
// Split out of the gate scripts so the closure audit can judge the ledger with
// the SAME rules the governance gate enforces, without importing a module whose
// top level runs a gate (the M61 lesson: a gate inside a gate is a defect).
//
// Pure by construction — no fs, no process, no clock — so both gates' negatives
// can feed it doctored ledgers and prove the rules fail. Adapted from M61's core
// (the lane's governance contract is one pattern; this milestone's declarations
// are the only thing that differs).

import type { CallSiteAddress } from "../src/intelligence/contracts.ts"

/** M62's own gate set, in closure order. G1 first, X1 last. */
export const EXPECTED_CODES = ["G1", "A1", "A2", "A3", "X1"]
export const EXPECTED_ISSUE_NUMBERS = [874, 875, 876, 877, 878]

/** The commands G1 re-executes on every run (the bar re-audit). */
export const GATE_COMMANDS: Array<[string, string]> = [
  ["A1", "npx tsx script/m62/verify-address.ts"],
  ["A2", "npx tsx script/m62/verify-consumers.ts"],
  ["A3", "npx tsx script/m62/verify-arrival.ts"],
  ["D1", "npx tsx script/m62/verify-docs.ts"],
]

/** Records that are a verified prerequisite because they are the lane's bars. */
export const PREREQUISITE_RECORDS: Array<[string, string]> = [
  ["M55 bar (the vector of most IDE surfaces)", "validation/m55/results/X1.json"],
  ["M61 bar (verifier machinery)", "validation/m61/results/X1.json"],
]

/** Every command that must be wired into the chains (D-6: an unwired gate rots). */
export const WIRED_COMMANDS = [...GATE_COMMANDS.map(([, c]) => c), "npx tsx script/m62/verify-governance.ts", "npx tsx script/m62/verify-closure.ts"]

export type LedgerIssue = {
  code: string
  githubIssue: number
  tool: string
  status: string
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  artifacts: string[]
  evidence?: {
    status?: string
    verifierCommand?: string
    evidenceFile?: string
    passed?: number
    failed?: number
    realFailed?: number
    negativeCases?: number
    mutantsCaught?: number
    mutantsTotal?: number
    recordCommit?: string
    /** The seal timestamp of the record this entry was projected from. It is
     *  what makes a stale projection DECIDABLE: a record re-run since (new
     *  seal) explains different values; the SAME seal with different values
     *  cannot be explained by a re-run — that is drift, and it fails. */
    recordSealedAt?: string
  }
}

export type Ledger = {
  schemaVersion: number
  milestone: string
  githubMilestone: number
  title: string
  status: string
  authority: string
  governingContract: string
  prerequisite: string
  laneDiscipline: string
  issues: LedgerIssue[]
}

/** The evidence block a ledger entry must carry — every field READ from the
 *  record it points at, never hand-typed (M61 D-5's projection rule: a second
 *  place stating a count is a second place that can drift). */
export function ledgerEntryFrom(
  record: {
    status?: unknown
    verifierCommand?: unknown
    evidenceFile?: unknown
    passed?: unknown
    failed?: unknown
    realFailed?: unknown
    negativeCases?: unknown
    mutantsCaught?: unknown
    mutantsTotal?: unknown
    currentCommit?: unknown
  },
  proofs: { mutants: number; negatives: number },
): NonNullable<LedgerIssue["evidence"]> {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  const commit = str(record.currentCommit)
  const seal = (record as { bbSeal?: { sealedAt?: unknown } }).bbSeal
  const sealedAt = seal && typeof seal.sealedAt === "string" ? seal.sealedAt : ""
  const mutantsCaught = Math.max(num(record.mutantsCaught), proofs.mutants)
  const mutantsTotal = Math.max(num(record.mutantsTotal), proofs.mutants)
  return {
    status: str(record.status),
    verifierCommand: str(record.verifierCommand),
    evidenceFile: str(record.evidenceFile),
    passed: num(record.passed),
    failed: num(record.failed),
    realFailed: typeof record.realFailed === "number" ? num(record.realFailed) : num(record.failed),
    ...(mutantsTotal > 0 ? { mutantsCaught, mutantsTotal } : {}),
    ...(proofs.negatives > 0 ? { negativeCases: proofs.negatives } : {}),
    ...(/^[0-9a-f]{40}$/.test(commit) ? { recordCommit: commit } : {}),
    ...(sealedAt.length > 0 ? { recordSealedAt: sealedAt } : {}),
  }
}

/** True when the entry points at a record re-run at a different commit since
 *  the ledger projected it — a stale projection, HEALED by the gate (reported,
 *  never a drift failure). */
export function projectionMoved(disk: Partial<NonNullable<LedgerIssue["evidence"]>> | undefined, derived: NonNullable<LedgerIssue["evidence"]>): boolean {
  const a = (disk as Record<string, unknown> | undefined)?.recordCommit
  const b = (derived as Record<string, unknown>).recordCommit
  const sealA = (disk as Record<string, unknown> | undefined)?.recordSealedAt
  const sealB = (derived as Record<string, unknown>).recordSealedAt
  if (typeof b !== "string") return false
  if (typeof sealB === "string" && sealA !== sealB) return true // the record was RE-SEALED since (a new run) — stale projection
  return typeof a !== "string" || a !== b
}

/** The field-by-field refusal: the entry on disk vs the derivation of the
 *  record it points at. Only the derivation's OWN fields are compared. */
export function entryDrift(disk: Partial<NonNullable<LedgerIssue["evidence"]>> | undefined, derived: NonNullable<LedgerIssue["evidence"]>): string[] {
  if (projectionMoved(disk, derived)) return []
  const owned = ["status", "verifierCommand", "evidenceFile", "passed", "failed", "realFailed", "mutantsCaught", "mutantsTotal", "negativeCases", "recordCommit", "recordSealedAt"] as const
  const out: string[] = []
  const d = disk ?? {}
  for (const k of owned) {
    const a = (d as Record<string, unknown>)[k]
    const b = (derived as Record<string, unknown>)[k]
    if (a !== b) out.push(`${k}: disk=${JSON.stringify(a)} derived=${JSON.stringify(b)}`)
  }
  return out
}

/** M62 D-7: the lane. The milestone's own scripts and results, the lane's docs,
 *  and the IDE-lane source files this milestone owns — nothing from another
 *  milestone's directory, nothing outside script/ + validation/ + docs/ + the
 *  declared source paths. */
export const LANE_ALLOWED: RegExp[] = [
  /^script\/m62\//,
  /^script\/lib\//,
  /^script\/m26\//,
  /^script\/verify-tool-docs\.ts$/,
  /^validation\//,
  /^docs\/m62\//,
  /^docs\/IDE-/,
  /^docs\/tools\//,
  /^src\/lsp\//,
  /^src\/intelligence\//,
  /^src\/mcp\/tool-handlers\.ts$/,
  /^package\.json$/,
]

export function lanePathOf(p: string): string {
  return p.replace(/^(npx\s+tsx|bun\s+run|npx|node)\s+/, "").trim()
}

export function laneViolations(l: Partial<Ledger>): string[] {
  const out: string[] = []
  for (const i of l.issues ?? []) {
    const paths = [i.artifacts ?? [], i.evidence?.verifierCommand ? [i.evidence.verifierCommand] : [], i.evidence?.evidenceFile ? [`validation/m62/results/${i.evidence.evidenceFile}`] : []].flat()
    for (const raw of paths) {
      const p = lanePathOf(raw)
      if (!LANE_ALLOWED.some((re) => re.test(p))) out.push(`${i.code}: ${raw} escapes the lane (D-7)`)
    }
  }
  return out
}

/** A non-planned issue is closable only when its evidence proves BOTH a green
 *  run (passed > 0, realFailed 0) AND a can-fail proof (declared mutants with
 *  none missed, or explicit negative cases). */
export function isClosable(issue: LedgerIssue): boolean {
  if (issue.status === "planned") return false
  const e = issue.evidence
  if (!e) return false
  const realFailed = typeof e.realFailed === "number" ? e.realFailed : e.failed
  const canFail =
    (typeof e.mutantsCaught === "number" && e.mutantsCaught > 0 && e.mutantsTotal === e.mutantsCaught) ||
    (typeof e.negativeCases === "number" && e.negativeCases > 0)
  return Boolean(e.status === issue.status && e.verifierCommand && e.evidenceFile && (e.passed ?? 0) > 0 && realFailed === 0 && canFail)
}

/** Entries no SIBLING gate may judge: G1 is measured by G1's run and X1 by the
 *  closure run, and X1 runs last — judging them from a sibling is the
 *  self-referential trap (M61's declared exemption, reused verbatim). What the
 *  exemption does NOT skip: every structural rule still applies, the closure
 *  rule is enforced where the entry is written (the owning run substitutes its
 *  measured entry and validates the whole ledger), and a red run keeps the
 *  ledger `open`. */
export const SELF_OWNED_CODES = ["G1", "X1"]

export function validateLedger(l: Partial<Ledger>, planText: string, selfOwned: string[] = []): string[] {
  const errors: string[] = []
  if (l.schemaVersion !== 1) errors.push("schemaVersion")
  if (l.milestone !== "M62" || l.githubMilestone !== 62) errors.push("milestone")
  if (!l.authority || !planText.includes("Issues / Issue groups")) errors.push("authority")
  if (!l.governingContract || !/IDE-HONESTY-CONTRACT\.md/.test(l.governingContract)) errors.push("contract")
  if (!l.prerequisite || !/M55/.test(l.prerequisite) || !/M61/.test(l.prerequisite) || !/re-audit/i.test(l.prerequisite)) errors.push("prerequisite")
  if (!l.laneDiscipline || !/script\/m62/.test(l.laneDiscipline)) errors.push("lane-discipline")
  const issues = l.issues ?? []
  const allVerified = issues.length > 0 && issues.every((i) => i.status === "verified")
  if (l.status !== (allVerified ? "closed" : "open")) errors.push("status")
  if (issues.length !== EXPECTED_CODES.length) errors.push("issue-count")
  const codes = new Set<string>()
  const numbers = new Set<number>()
  for (const issue of issues) {
    if (!EXPECTED_CODES.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || !EXPECTED_ISSUE_NUMBERS.includes(issue.githubIssue) || numbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`)
    numbers.add(issue.githubIssue)
    if (!issue.tool || !issue.scope) errors.push(`identity:${issue.code}`)
    if (!Array.isArray(issue.artifacts) || issue.artifacts.length === 0) errors.push(`artifacts:${issue.code}`)
    if (!Array.isArray(issue.acceptanceCriteria) || issue.acceptanceCriteria.length < 2) errors.push(`acceptance:${issue.code}`)
    if (!Array.isArray(issue.closureRequirements) || issue.closureRequirements.length < 2) errors.push(`closure:${issue.code}`)
    if (issue.status !== "planned" && !selfOwned.includes(issue.code) && !isClosable(issue)) errors.push(`hollow-${issue.status}:${issue.code}`)
    if (issue.status === "planned" && issue.evidence) errors.push(`planned-evidence:${issue.code}`)
    if (!["planned", "verified", "known-gap", "blocked"].includes(issue.status)) errors.push(`state:${issue.code}`)
  }
  const order = issues.map((i) => i.code)
  if (order.length === EXPECTED_CODES.length) {
    if (order[0] !== "G1") errors.push("order:g1-first")
    if (order[order.length - 1] !== "X1") errors.push("order:x1-last")
    for (let n = 0; n < EXPECTED_CODES.length - 1; n++) {
      const a = order.indexOf(EXPECTED_CODES[n]!)
      const b = order.indexOf(EXPECTED_CODES[n + 1]!)
      if (!(a >= 0 && b >= 0 && a < b)) errors.push(`order:${EXPECTED_CODES[n]}-before-${EXPECTED_CODES[n + 1]}`)
    }
  }
  errors.push(...laneViolations(l))
  return errors
}

/** The chain-wiring rule (D-6): every M62 gate command appears in BOTH chains,
 *  machine-read from package.json — a gate wired nowhere rots silently. */
export function chainFindings(verify: string, fast: string, commands: string[] = WIRED_COMMANDS): string[] {
  const out: string[] = []
  for (const cmd of commands) {
    if (!verify.includes(cmd)) out.push(`not in npm run verify: ${cmd}`)
    if (!fast.includes(cmd)) out.push(`not in verify:fast: ${cmd}`)
  }
  return out
}

// --- X1's audit rules (pure, mutated by X1's negatives) -------------------------------

/** X1's pack rule: the spot-check pack names every issue and is not empty. */
export function packFindings(text: string, codes: string[]): string[] {
  const out: string[] = []
  if (text.trim().length === 0) out.push("the spot-check pack is empty")
  for (const c of codes) if (!new RegExp(`\\b${c}\\b`).test(text)) out.push(`the pack does not name issue ${c}`)
  return out
}

/** The generated-artifact rule: a hand edit is a drift. */
export function generatedFindings(onDisk: string | null, fresh: string): string[] {
  if (onDisk === null) return ["the generated artifact does not exist — regenerate and commit it"]
  if (onDisk !== fresh) return ["the generated artifact does not match a fresh generation — hand edit or stale evidence"]
  return []
}

/** X1's freshness rule: a lane record must be verified, carry a can-fail proof,
 *  and be FRESH by RELEVANCE (its pin is an ancestor of HEAD and no lane source
 *  changed since) — exactly the rule every lane closure applies. */
export type FreshnessDeps = {
  isAncestor: (commit: string) => boolean
  laneChanged: (commit: string) => string[]
}

export function laneBarFindings(
  rec: { status?: string; checks?: number; passed?: number; mutantsCaught?: number; currentCommit?: string } | undefined,
  deps: FreshnessDeps,
): string[] {
  const out: string[] = []
  if (!rec) return ["the lane record is missing"]
  if (rec.status !== "verified") out.push(`the record is ${rec.status}, not verified`)
  if (!(typeof rec.passed === "number" && rec.passed > 0)) out.push("the record carries no passed checks")
  if (!(typeof rec.mutantsCaught === "number" && rec.mutantsCaught > 0)) out.push("the record carries no can-fail proof")
  const commit = String(rec.currentCommit ?? "")
  if (!/^[0-9a-f]{40}$/.test(commit)) out.push("the record carries no commit pin")
  else if (!deps.isAncestor(commit)) out.push(`the pin ${commit.slice(0, 8)} is not an ancestor of HEAD`)
  else {
    const changed = deps.laneChanged(commit)
    if (changed.length > 0) out.push(`${changed.length} lane file(s) changed since it ran: ${changed.slice(0, 3).join(", ")}`)
  }
  return out
}

/** The address-invariant audit X1 runs over every consumer payload it reads: a
 *  position the owner did not derive must never appear (the milestone's whole
 *  claim, re-checked at closure on the final tree). */
export function addressInvariants(addresses: CallSiteAddress[]): string[] {
  const out: string[] = []
  for (const a of addresses) {
    if (a.kind === "call-site") {
      if (!(typeof a.line === "number" && Number.isInteger(a.line) && a.line > 0)) out.push(`a call-site address carries line ${String(a.line)}`)
      if (typeof (a as { note?: unknown }).note !== "undefined") out.push("a call-site address carries a note (it is not a substitute)")
    } else if (a.kind === "declaration") {
      if (!(typeof a.line === "number" && a.line > 0)) out.push("a declaration address carries no usable line")
      if (typeof a.note !== "string" || a.note.length === 0) out.push("a declaration address carries no note (an unlabeled substitute)")
    } else if (a.kind === "unknown") {
      if (a.line !== null) out.push(`an unknown address carries line ${String(a.line)}`)
      if (typeof a.note !== "string" || a.note.length === 0) out.push("an unknown address carries no reason")
    } else {
      out.push(`an address carries an undeclared kind ${JSON.stringify((a as { kind?: unknown }).kind)}`)
    }
  }
  return out
}
