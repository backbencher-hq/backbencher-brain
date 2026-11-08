// script/m25/editor_evidence.ts — keep verified evidence when an editor cannot re-run.
// Author: Muhammad Ishaq Khan
//
// THE PROBLEM THIS SOLVES, MEASURED:
//
// Three legs in this lane need a real editor: E5 (VS Code suite), the fork runs
// (E6), and the install-docs host (D1-install). Each writes a sealed record, and
// each is re-run by a closure gate. When the editor fails to start — a loaded
// machine, a neighbour lane holding the display, a stale singleton socket — the
// run executes ZERO checks. Before this, that zero was written over the previous
// record as `known-gap`/`blocked`, which meant the closure gate then reported the
// leg as no longer standing: five closures went red in one M53 ladder for a
// reason that had nothing to do with the product, and the evidence that said the
// leg was fine had been deleted by the attempt that failed to re-measure it.
//
// A run that executed no check is not new evidence. It is a failed attempt to
// take a measurement. The verified record is left exactly as measured, pinned to
// the commit it was measured at, and the attempt is recorded truthfully in its own
// file — including how many attempts it took and the error that stopped it.
//
// THE TOOTH IS KEPT: when there is no verified record to keep (a first run, or a
// leg that has never passed), the caller falls through and writes the red record
// as before. This helper can only preserve an existing measurement, never create
// one.
import { existsSync, readFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

export interface RetentionInput {
  /** Directory holding the evidence records (validation/m25/results). */
  resultsDir: string
  /** The record file the closure will read, e.g. "E5.json". */
  evidenceFile: string
  /** Where the failed attempt is recorded, e.g. "E5-attempt.json". */
  attemptFile: string
  /** How many editor launches this attempt cost. */
  attempts: number
  /** What stopped the run. Recorded verbatim; never empty. */
  reason: string
  /** Extra fields merged into the attempt record (fork name, leg name, ...). */
  extra?: Record<string, unknown>
}

/** True when a verified record existed and was retained (caller should exit 0). */
export function retainVerifiedEvidence(input: RetentionInput): boolean {
  const evidencePath = path.join(input.resultsDir, input.evidenceFile)
  let existing: { status?: string; currentCommit?: string; passed?: number; checks?: unknown } | null = null
  try {
    existing = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : null
  } catch {
    existing = null
  }
  if (!existing || existing.status !== "verified") return false
  mkdirSync(input.resultsDir, { recursive: true })
  writeSealed(path.join(input.resultsDir, input.attemptFile), {
    code: input.attemptFile.replace(/\.json$/, ""),
    milestone: "M25",
    status: "no-measurement",
    attempts: input.attempts,
    reason: input.reason,
    retainedEvidence: {
      file: input.evidenceFile,
      status: existing.status,
      currentCommit: existing.currentCommit ?? null,
      passed: existing.passed ?? null,
    },
    ...(input.extra ?? {}),
    generatedAt: new Date().toISOString(),
  })
  console.log(
    `${input.evidenceFile}: no measurement this run (${input.reason.slice(0, 90)}; ${input.attempts} attempt(s)) — ` +
      `the verified record at ${String(existing.currentCommit).slice(0, 8)} is retained; attempt recorded in ${input.attemptFile}`,
  )
  return true
}
