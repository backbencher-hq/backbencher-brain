// script/m61/ledger_projection.ts — the ONE owner of the ledger↔record rule.
//
// THE DEFECT THIS PINS (measured at integration/lsp-truth HEAD 462f620be):
//
//   A LANE LEDGER IS A PROJECTION OF ITS RECORDS. Where the projection is
//   hand-maintained, the two diverge and the ledger — the artifact a reader
//   consults first — is the one that is wrong. The census:
//
//     22 issues across 8 lanes carried `"status": "verified"` in
//     validation/mXX/results/manifest.json while the record the entry points at
//     read `known-gap`. Ten of them (m20.M2, m20.M3, m20.P1…P3, m20.S1…S3,
//     m20.D1…D3) had records whose OWN check list was all-passing and whose
//     only blemish was a dirty working tree at measure time — so the ledger was
//     not merely optimistic, it was asserting a green run over a record that
//     refused to make that claim. Six lanes' governance records (m24.G1,
//     m25.G1, m26.G1, m29.G1, m42.G1, m44.G1) said `verified` over their own
//     red records. Two lanes read `status: "closed"` while seven of their own
//     entries were `known-gap`.
//
//   Three governance gates had already healed themselves by projecting
//   (m27.G1, m28.G1, m55.G1) — each with its OWN hand-rolled copy of the rule.
//   Three copies of a rule that decides what a program claims about itself is
//   two copies too many: they drift, and a copy that reads records with bare
//   JSON.parse heals a ledger toward a TAMPERED record's status (the m55
//   comment at script/m55/verify-governance.ts:566-571 records exactly that
//   silent no-op).
//
// THE RULE, stated once here:
//
//   1. The RECORD is the authority (IDE Honesty Contract §8.4). An entry's
//      `status` is the record's `status`. Never the reverse — a gate may never
//      edit a record to match a ledger.
//   2. An entry is a DERIVATION, not a transcription: status, counts, evidence
//      file, verifier command, commit stamp and any blocked reason are all read
//      from the record. A field the ledger states that the record does not is
//      drift.
//   3. A record that cannot be trusted (missing, unparseable, seal-broken) is
//      NOT projected and NOT assumed green: the entry keeps what it has and the
//      finding is reported. Silence is guilt (§8.3).
//   4. `blocked` is a FIRST-CLASS outcome and it carries its reason. A record
//      that is `blocked` projects `blocked` + the record's own reason string;
//      an entry that is `blocked` with NO reason is a hollow claim and fails.
//   5. The lane status is MECHANICAL: `closed` iff every entry is `verified`,
//      anything else is `open`. It is never hand-set.
//   6. SELF-OWNED entries (the gate's own `G1`, and `X1` which the closure gate
//      writes) are projected by the run that MEASURED them, from that run's own
//      verdict — never inherited from the previous run's record, and never
//      exempt. The exemption is what made `G1: verified` survive over a
//      `known-gap` record: an exempt entry could only ever be written by hand.
//
//   Purity: no fs, no process, no clock. Every gate that projects imports these
//   functions and injects the record reader, so the ENFORCER and the AUDITOR
//   (script/m61/verify-orphan-gates.ts G5, and every lane's own governance
//   gate) share one rule and one set of negatives.

/** The status union every lane ledger uses. `unknown` is NOT a member: a status
 *  outside this union is a defect the validators report, never a value this
 *  module manufactures. */
export type LaneStatus = "planned" | "verified" | "known-gap" | "blocked"

export const LANE_STATUSES: readonly string[] = ["planned", "verified", "known-gap", "blocked"]

/** A ledger entry as this module needs to see it. Structural, not lane-specific:
 *  every lane's manifest shape fits, which is why one owner suffices. */
export type ProjectableEntry = {
  code: string
  status: string
  evidence?: Record<string, unknown> | undefined
  [k: string]: unknown
}

export type ProjectableLedger = {
  status?: string
  issues?: ProjectableEntry[]
  [k: string]: unknown
}

/** The can-fail counts a projection copies. Kept as a parameter so the caller
 *  owns its own derivation convention (m61 has a lint that derives these from a
 *  gate's check list; older lanes record them as scalars). This module never
 *  invents a count: absent stays absent. */
export type ProofCounts = { mutants?: number; negatives?: number }

/** The result of projecting one entry. `changed` is non-empty when the entry on
 *  disk stated something the record does not support — the finding a gate
 *  reports (and, in the enforcing gates, the reason the ledger was rewritten). */
export type Projection = {
  entry: ProjectableEntry
  changed: string[]
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The reason a record gives for being non-verified. Gates spell this several
 *  ways (`blockedReason` for an unavailable platform/editor, `reason` for an
 *  unavailable fork, `limitations` for a scoped claim); all three are read, and
 *  the first non-empty wins. An entry that projects to a non-verified status
 *  and carries none of these is a hollow claim — see `hollowBlocked`. */
export function reasonFromRecord(record: Record<string, unknown>): string | undefined {
  return (
    str(record.blockedReason) ??
    str(record.reason) ??
    (Array.isArray(record.limitations) ? record.limitations.find((l) => typeof l === "string" && l.length > 0) : undefined)
  )
}

/**
 * Project ONE entry from the record it points at.
 *
 * `record` is the trusted-read result, already verified by the caller's read
 * path — this function never touches the filesystem, so it cannot be tricked
 * into reading an unverified file itself. `null` means "no trustworthy record":
 * the entry is returned UNCHANGED and the caller reports it. That is rule 3 —
 * a missing record is a finding, not a licence to assume green.
 */
export function projectEntry(
  entry: ProjectableEntry,
  record: Record<string, unknown> | null,
  proofs: ProofCounts = {},
  evidenceFile: string,
): Projection {
  const changed: string[] = []
  if (record === null) {
    // No trustworthy record: report, do not assume, do not erase.
    changed.push(`record unreadable for ${evidenceFile}`)
    return { entry, changed }
  }
  const recordStatus = str(record.status)
  if (!recordStatus) {
    changed.push(`record ${evidenceFile} carries no status — cannot project`)
    return { entry, changed }
  }
  if (!LANE_STATUSES.includes(recordStatus)) {
    changed.push(`record ${evidenceFile} status=${JSON.stringify(recordStatus)} is outside ${LANE_STATUSES.join("/")}`)
    return { entry, changed }
  }

  const ev = entry.evidence ?? {}
  if (entry.status !== recordStatus) changed.push(`status: ledger=${entry.status} record=${recordStatus}`)
  if (ev.status !== recordStatus) changed.push(`evidence.status: ledger=${String(ev.status)} record=${recordStatus}`)

  const derived: Record<string, unknown> = { ...ev, status: recordStatus, evidenceFile }
  // Counts: copied from the record, never from the ledger. A count the record
  // does not carry is OMITTED from the derivation, so the two cannot disagree
  // about a number only one of them measured.
  for (const [key, recKey] of [
    ["passed", "passed"],
    ["failed", "failed"],
    ["realFailed", "realFailed"],
    ["negativeCases", "negativeCases"],
    ["mutantsCaught", "mutantsCaught"],
    ["mutantsTotal", "mutantsTotal"],
  ] as const) {
    const fromRecord = num(record[recKey])
    if (fromRecord === undefined) continue
    if ((ev as Record<string, unknown>)[key] !== fromRecord) {
      changed.push(`${key}: ledger=${JSON.stringify((ev as Record<string, unknown>)[key])} derived=${fromRecord}`)
    }
    derived[key] = fromRecord
  }
  // The verifier command is the record's: an entry naming a command the record
  // does not name is claiming a run that did not produce it.
  const cmd = str(record.verifierCommand)
  if (cmd !== undefined && ev.verifierCommand !== cmd) {
    changed.push(`verifierCommand: ledger=${JSON.stringify(ev.verifierCommand)} record=${cmd}`)
    derived.verifierCommand = cmd
  }
  const commit = str(record.currentCommit)
  if (commit !== undefined) derived.currentCommit = commit
  // §8.4: the reason travels with the status. A blocked/known-gap entry that
  // does not carry one is a claim with no stated ground.
  const reason = reasonFromRecord(record)
  if (reason !== undefined) derived.blockedReason = reason

  return { entry: { ...entry, status: recordStatus, evidence: derived }, changed }
}

/**
 * Rule 4's enforcement: an entry claiming a non-verified status must say WHY.
 * Returns the finding, or null when the entry is honest (verified entries carry
 * no reason requirement; `planned` carries none either).
 */
export function hollowBlocked(entry: ProjectableEntry): string | null {
  if (entry.status === "verified" || entry.status === "planned") return null
  const reason = str(entry.evidence?.blockedReason) ?? str(entry.evidence?.reason)
  if (reason !== undefined) return null
  return `${entry.code}: status=${entry.status} with no recorded reason (contract §8.3: blocked records the reason, never omits it)`
}

/**
 * The lane status, MECHANICALLY derived (rule 5). A hand-set `closed` over an
 * unverified entry is the defect this function exists to make impossible.
 */
export function laneStatusOf(issues: ProjectableEntry[]): LaneStatus | "open" | "closed" {
  return issues.length > 0 && issues.every((i) => i.status === "verified") ? "closed" : "open"
}

/** Codes whose entries are measured by their OWN runs and therefore projected
 *  from a verdict rather than from a record written by an earlier run. A caller
 *  names its own codes so the exemption stays narrow and visible at each call
 *  site — an entry nobody projects is an entry nobody checks. */
export function projectLedger(
  ledger: ProjectableLedger,
  readRecord: (evidenceFile: string) => Record<string, unknown> | null,
  options: { selfOwned?: string[]; proofs?: (code: string, record: Record<string, unknown>) => ProofCounts } = {},
): { ledger: ProjectableLedger; findings: string[]; healed: string[] } {
  const selfOwned = new Set(options.selfOwned ?? [])
  const findings: string[] = []
  const healed: string[] = []
  const issues = (ledger.issues ?? []).map((entry) => {
    if (selfOwned.has(entry.code)) return entry // measured by the run that writes it
    const evidenceFile = str(entry.evidence?.evidenceFile) ?? `${entry.code}.json`
    const record = readRecord(evidenceFile)
    const { entry: projected, changed } = projectEntry(entry, record, options.proofs?.(entry.code, record ?? {}), evidenceFile)
    if (changed.length > 0) healed.push(`${entry.code}: ${changed.join(", ")}`)
    return projected
  })
  for (const entry of issues) {
    const hollow = hollowBlocked(entry)
    if (hollow) findings.push(hollow)
  }
  const status = laneStatusOf(issues)
  if (ledger.status !== status) findings.push(`lane status: ledger=${String(ledger.status)} derived=${status} (mechanical)`)
  return { ledger: { ...ledger, issues, status }, findings, healed }
}

/**
 * THE AUDIT PREDICATE — what script/m61/verify-orphan-gates.ts G5 enforces and
 * what every lane's governance gate re-checks from disk. Drift is a DECIDABLE
 * case: the ledger names a status its record contradicts. Both values are named
 * so the finding is actionable without re-running anything.
 *
 * The two directions are NOT symmetric, and the asymmetry is the point:
 *   - `verified` over a non-verified record is a LIE (an unearned claim) and is
 *     reported as drift.
 *   - a non-verified ledger over a `verified` record is an UNDERCLAIM: stale
 *     bookkeeping, not a false claim. It is still reported — a ledger that says
 *     less than it has is also a ledger out of date — but it is labelled so a
 *     reader never mistakes it for the dangerous direction.
 */
export type DriftRow = {
  lane: string
  code: string
  ledgerStatus: string
  recordStatus: string
  direction: "overclaim" | "underclaim"
  file: string
}

export function classifyDrift(rows: Array<Omit<DriftRow, "direction">>): DriftRow[] {
  const out: DriftRow[] = []
  for (const r of rows) {
    if (!r.recordStatus) continue
    if (r.ledgerStatus === "verified" && r.recordStatus !== "verified") out.push({ ...r, direction: "overclaim" })
    else if (r.ledgerStatus !== "verified" && r.recordStatus === "verified" && r.ledgerStatus !== "planned") {
      out.push({ ...r, direction: "underclaim" })
    }
  }
  return out
}

/** The one-line form used in gate output. Both values, always. */
export function driftLine(d: DriftRow): string {
  return `${d.lane}.${d.code}: ledger=${d.ledgerStatus} record=${d.recordStatus} (${d.file}) [${d.direction}]`
}
