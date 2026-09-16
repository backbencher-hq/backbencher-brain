// script/m61/governance_core.ts — M61's pure governance cores (G1 + X1).
//
// Extracted from script/m61/verify-governance.ts so the closure gate (X1) can
// AUDIT with the same rules the governance gate ENFORCES, without importing a
// module whose top level runs a gate (an import that executed G1's checks and
// wrote its evidence would be the "gate inside a gate" defect this milestone
// exists to kill).
//
// Pure by construction — no fs, no process, no clock — so both gates' negatives
// can mutate and feed it doctored ledgers, and so the rules have exactly ONE
// owner: the milestone's declarations below.

/** The milestone's own gate set, in closure order. G1 is first (governance),
 *  V1…V6 in dependency order, X1 last (the program-closure audit). */
export const EXPECTED_CODES = ["G1", "V1", "V2", "V3", "V4", "V5", "V6", "X1"]
export const EXPECTED_ISSUE_NUMBERS = [848, 842, 843, 844, 845, 846, 847, 849]

/** The theme gates G1 re-executes on every run (deliverable 3). */
export const V_GATES: Array<[string, string]> = [
  ["V1", "script/m61/verify-sealing.ts"],
  ["V2", "script/m61/verify-lock.ts"],
  ["V3", "script/m61/verify-reproducibility.ts"],
  ["V4", "script/m61/verify-lint.ts"],
  ["V5", "script/m61/verify-claims.ts"],
  ["V6", "script/m61/verify-extinction.ts"],
]

/** Records that are a verified prerequisite because they are OTHER lanes' bars. */
export const PREREQUISITE_RECORDS: Array<[string, string]> = [
  ["M29 bar", "validation/m29/results/X1.json"],
  ["M44 bar", "validation/m44/results/X1.json"],
  ["M53 lane integration", "validation/m53/results/X1.json"],
  ["M53 lane ladder (R1)", "validation/m53/results/R1.json"],
]

/** The can-fail proof a record carries, as the lint derives it (the check-list
 *  convention is the single owner; the gate does not restate its own totals). */
export type ProofCounts = { mutants: number; negatives: number }

/** The evidence block a ledger entry must carry: nothing here is hand-typed —
 *  every field is READ from the record the entry points at. This is the
 *  milestone's answer to "a second place stating a count is a second place that
 *  can drift": the ledger's entries are a PROJECTION of the records. */
export function ledgerEntryFrom(
  record: {
    status?: unknown
    verifierCommand?: unknown
    evidenceFile?: unknown
    passed?: unknown
    failed?: unknown
    realFailed?: unknown
    currentCommit?: unknown
  },
  proofs: ProofCounts,
): NonNullable<LedgerIssue["evidence"]> {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  const commit = str(record.currentCommit)
  return {
    status: str(record.status),
    verifierCommand: str(record.verifierCommand),
    evidenceFile: str(record.evidenceFile),
    passed: num(record.passed),
    failed: num(record.failed),
    realFailed: typeof record.realFailed === "number" ? num(record.realFailed) : num(record.failed),
    mutantsCaught: proofs.mutants,
    mutantsTotal: proofs.mutants,
    // Absent (0) counts are omitted so an entry states only the proof it has:
    // a zero-valued field would read as "declared zero", not "not applicable".
    ...(proofs.negatives > 0 ? { negativeCases: proofs.negatives } : {}),
    // The commit the projected record was RUN at. This is what makes the drift
    // check decidable: a record re-run at a different commit has legitimately
    // moved, and the projection is stale rather than hand-typed.
    ...(/^[0-9a-f]{40}$/.test(commit) ? { recordCommit: commit } : {}),
  }
}

/** True when the entry's record was re-run at a different commit since the
 *  ledger projected it — the stale-projection case, which the gate HEALS and
 *  reports rather than a drift failure. An entry with NO recorded commit was
 *  projected by a gate version that did not yet stamp commits; that too is a
 *  stale projection (the oldest kind), and after healing it carries the stamp,
 *  so any LATER hand edit without a record move is decidable drift. */
export function projectionMoved(
  disk: Partial<NonNullable<LedgerIssue["evidence"]>> | undefined,
  derived: NonNullable<LedgerIssue["evidence"]>,
): boolean {
  const a = (disk as Record<string, unknown> | undefined)?.recordCommit
  const b = (derived as Record<string, unknown>).recordCommit
  if (typeof b !== "string") return false
  return typeof a !== "string" || a !== b
}

/** The field-by-field refusal used by G1's drift check (the entry on disk vs the
 *  derivation of the record it points at). Compares only the fields the
 *  derivation OWNS, so an entry may not carry counts from anywhere else. */
export function entryDrift(disk: Partial<NonNullable<LedgerIssue["evidence"]>> | undefined, derived: NonNullable<LedgerIssue["evidence"]>): string[] {
  // A stale projection is not a drift: the record ran again since, so the gate
  // heals the entry this run (and says so). Drift is the DECIDABLE case — the
  // record has not moved, yet the ledger states something else, which a human
  // typed or an old writer left behind.
  if (projectionMoved(disk, derived)) return []
  const owned = ["status", "verifierCommand", "evidenceFile", "passed", "failed", "realFailed", "mutantsCaught", "mutantsTotal", "negativeCases", "recordCommit"] as const
  const out: string[] = []
  const d = disk ?? {}
  for (const k of owned) {
    const a = (d as Record<string, unknown>)[k]
    const b = (derived as Record<string, unknown>)[k]
    if (a !== b) out.push(`${k}: disk=${JSON.stringify(a)} derived=${JSON.stringify(b)}`)
  }
  return out
}

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

/** D-7: the lane. The milestone's own scripts and results, the lane's shared
 *  libraries, its docs, and the chain manifest — nothing from another
 *  milestone's directory (M51/M52/M55/… are read-only), and nothing outside
 *  script/ + validation/ + docs/. */
export const LANE_ALLOWED: RegExp[] = [/^script\/m61\//, /^script\/lib\//, /^validation\//, /^docs\/m61\//, /^docs\/IDE-/, /^package\.json$/]

/** A declared path may be a shell command (`npx tsx script/…`) — normalize it. */
export function lanePathOf(p: string): string {
  return p.replace(/^(npx\s+tsx|bun\s+run|npx|node)\s+/, "").trim()
}

export function laneViolations(l: Partial<Ledger>): string[] {
  const out: string[] = []
  for (const i of l.issues ?? []) {
    const paths = [i.artifacts ?? [], i.evidence?.verifierCommand ? [i.evidence.verifierCommand] : [], i.evidence?.evidenceFile ? [`validation/m61/results/${i.evidence.evidenceFile}`] : []].flat()
    for (const raw of paths) {
      const p = lanePathOf(raw)
      if (!LANE_ALLOWED.some((re) => re.test(p))) out.push(`${i.code}: ${raw} escapes the lane (D-7: script/m61, script/lib, validation/, docs/m61, docs/IDE-*)`)
    }
  }
  return out
}

/** A non-planned issue is closable only when its evidence block is complete and
 *  proves BOTH a green run (passed > 0, failed 0) AND a can-fail proof — the
 *  declared mutant totals, or explicit negative cases. */
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

/** Entries that no SIBLING gate may judge the closure state of, because the
 *  gate that audits the ledger is the gate that measures them: G1's entry is
 *  measured by G1's own run, X1's by the closure gate's. Judging them from a
 *  sibling would be the self-referential trap this milestone exists to name —
 *  G1 cannot establish X1's freshness without running X1, and X1 runs last.
 *
 *  What the exemption does NOT skip: every structural rule (identity, tools,
 *  artifacts, acceptance/closure requirements, order, D-7, status consistency)
 *  still applies to the entry, and the ledger's `status` is still derived from
 *  every entry. The CLOSURE rule for these codes is enforced where the entry is
 *  written: the owning run substitutes its measured entry and validates the
 *  whole ledger with it (verify-governance.ts / verify-closure.ts), and a red
 *  run reports known-gap, which keeps the ledger `open` — nothing is closed by
 *  assertion. The caller names the codes it is exempting (`selfOwned`), so the
 *  narrowness of the exemption is visible at every call site. */
export const SELF_OWNED_CODES = ["G1", "X1"]

export function validateLedger(l: Partial<Ledger>, planText: string, expectedCodes: string[], expectedNumbers: number[], selfOwned: string[] = []): string[] {
  const errors: string[] = []
  if (l.schemaVersion !== 1) errors.push("schemaVersion")
  if (l.milestone !== "M61" || l.githubMilestone !== 61) errors.push("milestone")
  if (!l.authority || !planText.includes("Issues / Issue groups")) errors.push("authority")
  if (!l.governingContract || !/IDE-HONESTY-CONTRACT\.md/.test(l.governingContract)) errors.push("contract")
  if (!l.prerequisite || !/M29/.test(l.prerequisite) || !/M44/.test(l.prerequisite) || !/re-audit/i.test(l.prerequisite)) errors.push("prerequisite")
  if (!l.laneDiscipline || !/script\/m61/.test(l.laneDiscipline)) errors.push("lane-discipline")
  const issues = l.issues ?? []
  const allVerified = issues.length > 0 && issues.every((i) => i.status === "verified")
  if (l.status !== (allVerified ? "closed" : "open")) errors.push("status")
  if (issues.length !== expectedCodes.length) errors.push("issue-count")
  const codes = new Set<string>()
  const numbers = new Set<number>()
  for (const issue of issues) {
    if (!expectedCodes.includes(issue.code)) errors.push(`code:${issue.code}`)
    if (codes.has(issue.code)) errors.push(`duplicate-code:${issue.code}`)
    codes.add(issue.code)
    if (!Number.isInteger(issue.githubIssue) || !expectedNumbers.includes(issue.githubIssue) || numbers.has(issue.githubIssue)) errors.push(`github-issue:${issue.code}`)
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
  if (order.length === expectedCodes.length) {
    if (order[0] !== "G1") errors.push("order:g1-first")
    if (order[order.length - 1] !== "X1") errors.push("order:x1-last")
    for (let n = 1; n <= 6; n++) {
      const a = order.indexOf(`V${n}`)
      const b = order.indexOf(`V${n + 1}`)
      if (n < 6 && !(a >= 0 && b >= 0 && a < b)) errors.push(`order:v${n}-before-v${n + 1}`)
    }
  }
  errors.push(...laneViolations(l))
  return errors
}

// --- X1's audit rules (pure cores, mutated by X1's negatives) ----------------------

/** X1's Pass 5 rule: the spot-check pack names every issue and is not empty. */
export function packFindings(text: string, codes: string[]): string[] {
  const out: string[] = []
  if (text.trim().length === 0) out.push("the spot-check pack is empty")
  for (const c of codes) if (!new RegExp(`\\b${c}\\b`).test(text)) out.push(`the pack does not name issue ${c}`)
  return out
}

/** What X1 needs to judge the ladder record: the record, plus the two git
 *  facts the same rule uses in the lane closures (there is ONE freshness rule
 *  in this program — m55/verify-closure.ts C2). Injected so X1's negatives can
 *  feed it a doctored record without touching git. */
export type LadderDeps = {
  isAncestor: (commit: string) => boolean
  laneChanged: (commit: string) => string[]
}

/** X1's Pass 3 rule: the ladder is the lane's green machine record, it carries
 *  its own can-fail proof, and it is FRESH — the pin is an ancestor of HEAD and
 *  no lane source changed since it ran. A pin equal to HEAD is impossible (the
 *  evidence must itself be committed), so freshness is by RELEVANCE, not
 *  equality: exactly the rule every lane closure already applies. */
export function ladderFindings(
  rec: { status?: string; gates?: Array<{ ok?: boolean; name?: string }>; mutantsCaught?: number; currentCommit?: string } | undefined,
  deps: LadderDeps,
): string[] {
  const out: string[] = []
  if (!rec) return ["the ladder record is missing"]
  if (rec.status !== "verified") out.push(`the ladder is ${rec.status}, not verified`)
  const bad = (rec.gates ?? []).filter((g) => g.ok !== true)
  if (bad.length > 0) out.push(`${bad.length} ladder gate(s) not green: ${bad.map((g) => g.name).join(",")}`)
  if (!(typeof rec.mutantsCaught === "number" && rec.mutantsCaught > 0)) out.push("the ladder record carries no can-fail proof")
  const commit = String(rec.currentCommit ?? "")
  if (!/^[0-9a-f]{40}$/.test(commit)) out.push("the ladder record carries no commit pin")
  else if (!deps.isAncestor(commit)) out.push(`the ladder pin ${commit.slice(0, 8)} is not an ancestor of HEAD`)
  else {
    const changed = deps.laneChanged(commit)
    if (changed.length > 0) out.push(`${changed.length} lane file(s) changed since the ladder ran: ${changed.slice(0, 3).join(", ")}`)
  }
  return out
}

/** X1's Pass 4 rule: the inventory is GENERATED — a hand edit is a drift. */
export function inventoryFindings(onDisk: string | null, fresh: string): string[] {
  if (onDisk === null) return ["the known-gaps inventory does not exist — regenerate and commit it"]
  if (onDisk !== fresh) return ["the known-gaps inventory does not match a fresh generation — hand edit or stale evidence (regenerate and commit)"]
  return []
}
