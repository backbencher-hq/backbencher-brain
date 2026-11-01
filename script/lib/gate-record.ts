// script/lib/gate-record.ts — the shape a lane gate's evidence record takes.
//
// WHY THIS EXISTS. Six real gates (M24.L8 and L9, M26.H1, M28.A7/A8/A9) ran a
// full set of checks, printed PASS or FAILED to a terminal, and wrote NOTHING.
// Their verdict existed only for as long as the scrollback did, so a later
// reader had no way to know whether the property still held — which is what
// script/m61/gate_lint.ts G1 and G3 report ("runs checks but owns no lane record",
// "it produces no evidence"). Hand-writing six copies of the envelope would drift
// the moment one of them was edited, so the envelope is written once, here.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not decide whether a gate passed:
// the caller owns that. It does not invent a can-fail proof — `negatives` is
// passed by the gate and must name the legs it is counting, because a proof the
// envelope manufactures is exactly the claim M61 exists to refuse. And it uses
// writeSealed, so the record takes the declared lock and is sealed like every
// other lane record.
//
// ORDER MATTERS AT THE CALL SITE: call this AFTER the last check. A record
// written before a check is a record that can disagree with its own run
// (script/m61/gate_lint.ts G8).

import { execFileSync } from "node:child_process"
import path from "node:path"
import { writeSealed } from "./evidence.ts"

export type GateCheck = { name: string; ok: boolean; detail?: string }

export type GateRecordOptions = {
  /** Repository root — used only to stamp the commit the record was produced at. */
  root: string
  /** Absolute path of the record file. `evidenceFile` is derived from its basename. */
  resultsFile: string
  milestone: string
  code: string
  issue: string
  /** Repo-relative verifier path, e.g. "script/m24/verify-hover-docs.ts". */
  verifier: string
  checks: GateCheck[]
  /**
   * Declared negative controls: legs that FAIL if the property regresses. The
   * caller states the count and, in one line, WHICH legs those are — a bare
   * number would be an assertion nobody can check.
   */
  negatives?: { count: number; note: string }
  extra?: Record<string, unknown>
}

/** Write the sealed record and return what the caller needs to set its exit code. */
export function emitGateRecord(opts: GateRecordOptions): { failed: number; recordPath: string } {
  const passed = opts.checks.filter((c) => c.ok).length
  const failed = opts.checks.length - passed
  let commit = ""
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: opts.root, encoding: "utf8" }).trim()
  } catch {
    // A tree without git (an exported tarball) stamps an empty commit rather
    // than failing the gate: the verdict is the checks, not the provenance.
    commit = ""
  }
  const record: Record<string, unknown> = {
    issue: opts.issue,
    code: opts.code,
    milestone: opts.milestone,
    status: failed === 0 ? "verified" : "known-gap",
    checks: opts.checks.length,
    passed,
    failed,
    realFailed: failed,
    negativeCases: opts.negatives?.count ?? 0,
    mutantsCaught: 0,
    mutantsTotal: 0,
    currentCommit: commit,
    verifierCommand: `npx tsx ${opts.verifier}`,
    evidenceFile: path.basename(opts.resultsFile),
    generatedAt: new Date().toISOString(),
    checksList: opts.checks.map((c) => `${c.ok ? "ok" : "FAIL"}: ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`),
    ...(opts.negatives ? { negativeControl: opts.negatives.note } : {}),
    ...(opts.extra ?? {}),
  }
  writeSealed(opts.resultsFile, record)
  return { failed, recordPath: opts.resultsFile }
}
