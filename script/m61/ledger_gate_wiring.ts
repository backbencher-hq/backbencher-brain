// script/m61/ledger_gate_wiring.ts — the shared WIRING for a lane's ledger gate.
//
// A lane's governance gate has three jobs at the end of its run, and every lane
// that fixed the ledger drift had to write them the same way:
//
//   1. project its manifest from its records (through ./ledger_projection.ts),
//   2. state WHY a non-green run is non-green in its OWN record (contract §8.3),
//   3. project its OWN entry (G1) from this run's measured verdict and write it
//      last, so the ledger can never read `verified` while the run that produced
//      it is red.
//
// Three hand-copies of that wiring is two too many — the copies are exactly how
// the drift got in. This module owns the wiring; each lane gate supplies its own
// paths, its own record reader (it must read through the lane's own trusted
// path), and its own verdict.
//
// IMPORT-TIME PURITY: this module runs nothing at import. A gate calls
// `projectLaneLedger` explicitly.

import { existsSync } from "node:fs"
import path from "node:path"
import { laneStatusOf, projectLedger, type ProjectableLedger } from "./ledger_projection.ts"

export type LaneGateWiring = {
  /** Absolute path to the lane's manifest. */
  ledgerPath: string
  /** Absolute path to the lane's results dir. */
  resultsDir: string
  /** The lane's own trusted record reader — MUST be the same path the gate's
   *  validation uses. A projection that reads records by a weaker path than the
   *  validation is how a ledger gets healed toward a TAMPERED record's status
   *  (the m55 lesson). */
  readRecord: (file: string) => Record<string, unknown> | null
  /** The ledger as this run read it. */
  ledger: ProjectableLedger
  /** THIS run's G1 verdict. */
  g1Status: string
  /** THIS run's G1 record, for the fields the entry must carry. */
  g1Record: Record<string, unknown>
  /** Write the projected manifest. Injected so each lane writes it the way its
   *  own evidence layer requires (sealed, or legacy-sealed). */
  writeLedger: (ledger: unknown) => void
  /** Report a failed check (the lane's own `check`). */
  onFinding: (detail: string) => void
  /** Report a passed check. */
  onPass: (detail: string) => void
  /** Report what the projection healed, for the console. */
  onHealed?: (message: string) => void
  /** Read the ledger back from disk AFTER it was written. Required: the only
   *  way to know the write actually happened is to read it (see below). */
  readLedgerBack: () => ProjectableLedger | undefined
}

/**
 * Project the ledger, verify the projection from DISK, and fill the gate's own
 * entry from this run's verdict. Returns the findings the gate should surface.
 *
 * The verification is deliberately a RE-READ of the written artifact, not a
 * re-inspection of the in-memory object: the failure this exists to prevent is a
 * write that silently did not happen (m55's first projection attempt healed
 * nothing and still looked like it ran, because the read returned a RESULT
 * object rather than a record and every status came back `undefined`). Reading
 * back is the only way to know the ledger on disk says what was computed.
 */
export function projectLaneLedger(w: LaneGateWiring): string[] {
  const findings: string[] = []

  // --- 1. project from the records ------------------------------------------
  const projected = projectLedger(w.ledger, w.readRecord, { selfOwned: ["G1"] })
  const healed = [...projected.healed]
  // A hollow (non-verified entry with no reason) finding is NOT repairable by
  // projection — the projection copies the reason from the record, and if the
  // record has none there is nothing to copy. Those fail. A lane-status finding
  // is EXPECTED on the first run over a hand-maintained ledger: repairing it is
  // the entire point, so it is reported as a heal, never failed.
  for (const finding of projected.findings) {
    if (finding.includes("no recorded reason")) {
      w.onFinding(finding)
      findings.push(finding)
    } else if (finding.startsWith("lane status:")) {
      healed.push(`${finding} — repaired by this projection`)
    } else {
      w.onFinding(finding)
      findings.push(finding)
    }
  }

  w.writeLedger(projected.ledger)

  // --- 2. verify the projection from disk ------------------------------------
  const verify = w.readLedgerBack()
  const entries = verify?.issues ?? []
  const drifted = entries.filter((i) => {
    if (i.code === "G1") return false
    const rec = w.readRecord(String(i.evidence?.evidenceFile ?? `${i.code}.json`))
    return rec !== null && typeof rec.status === "string" && i.status !== rec.status
  })
  const unreadable = entries.filter((i) => {
    if (i.code === "G1") return false
    return w.readRecord(String(i.evidence?.evidenceFile ?? `${i.code}.json`)) === null
  })
  const postLabel = "the ledger on disk is the projection of its records (no entry claims a status its record contradicts)"
  if (drifted.length === 0) w.onPass(postLabel)
  else {
    w.onFinding(`${postLabel}: ${drifted.map((i) => `${i.code}: ledger=${i.status} record=${String(w.readRecord(String(i.evidence?.evidenceFile ?? `${i.code}.json`))?.status)}`).join(", ")}`)
    findings.push("post-projection drift")
  }
  // A record that could not be trusted keeps its entry AND raises a finding:
  // never assume green for a record nobody could verify (contract §8.3, silence
  // is guilt).
  if (unreadable.length === 0) w.onPass("every projected entry's record is trusted (no unverifiable record assumed green)")
  else {
    w.onFinding(`every projected entry's record is trusted: ${unreadable.map((i) => i.code).join(", ")}`)
    findings.push("untrusted record")
  }
  const derived = laneStatusOf(entries)
  if (verify?.status === derived) w.onPass("the lane status is mechanical (`closed` only when every entry is verified)")
  else {
    w.onFinding(`the lane status is mechanical: on disk=${String(verify?.status)} derived=${derived}`)
    findings.push("lane status not mechanical")
  }

  // --- 3. this gate's own entry, from THIS run's verdict, written LAST --------
  const reason = typeof w.g1Record.blockedReason === "string" ? w.g1Record.blockedReason : undefined
  const withG1 = {
    ...(verify ?? projected.ledger),
    issues: entries.map((i) =>
      i.code === "G1"
        ? {
            ...i,
            status: w.g1Status,
            evidence: {
              ...(i.evidence ?? {}),
              status: w.g1Status,
              currentCommit: w.g1Record.currentCommit,
              verifierCommand: w.g1Record.verifierCommand,
              evidenceFile: typeof w.g1Record.evidenceFile === "string" ? w.g1Record.evidenceFile : "G1.json",
              passed: typeof w.g1Record.passed === "number" ? w.g1Record.passed : (i.evidence?.passed as number | undefined),
              failed: typeof w.g1Record.failed === "number" ? w.g1Record.failed : (i.evidence?.failed as number | undefined),
              ...(typeof w.g1Record.negativeCases === "number" ? { negativeCases: w.g1Record.negativeCases } : {}),
              // The reason is READ from this run's record, never typed here, so
              // the ledger cannot state a reason the record does not carry.
              ...(reason !== undefined ? { blockedReason: reason } : {}),
            },
          }
        : i,
    ),
  }
  const laneStatus = laneStatusOf(withG1.issues)
  w.writeLedger({ ...withG1, status: laneStatus })
  if (healed.length > 0) w.onHealed?.(`ledger healed from records: ${healed.join(" | ")}`)
  w.onHealed?.(`ledger G1 entry projected from this run: ${w.g1Status} (lane ${laneStatus})`)
  return findings
}

/** Whether a results dir holds a readable manifest — the one place each lane's
 *  gate needs to know its own ledger path exists. */
export function ledgerExists(ledgerPath: string): boolean {
  return existsSync(path.dirname(ledgerPath)) && existsSync(ledgerPath)
}
