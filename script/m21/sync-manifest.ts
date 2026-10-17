// script/m21/sync-manifest.ts — M21.C1 support.
//
// Rebuilds the manifest's per-issue `evidence` blocks from the current on-disk
// evidence files (validation/m21/results/<EVIDENCE_FILE>). This is the honest
// sync step: after verifiers regenerate their evidence at a given HEAD, the
// ledger must reflect exactly what the on-disk files claim. It does NOT touch
// the fixed issue metadata (code, githubIssue, tool, status, scope,
// acceptanceCriteria, closureRequirements) — only `evidence`.
//
// `workingTreeRelevantChanges` is set to [] because the governance `closable()`
// contract requires a clean working tree for a closable (verified) entry; a
// dirty tree is a pre-commit state and the committed manifest must reflect the
// clean post-commit state.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

import { writeSealed } from "../lib/evidence.ts"
import { reasonFromRecord } from "../m61/ledger_projection.ts"
import { reRecordRegisterRow } from "../m61/seal_register.ts"

const ROOT = path.resolve(process.cwd())
const MANIFEST = path.join(ROOT, "validation/m21/results/manifest.json")

const ledger = JSON.parse(readFileSync(MANIFEST, "utf8"))

// Self-referential verifiers (C1 governance, X3 closure) rewrite their own
// ledger entry at the end of their run; syncing them here from a prior / failed
// on-disk file would clobber the status the gate will itself produce. They are
// synced by running their verifier, not by this script.
const SELF_UPDATE = new Set(["C1", "X3"])

let updated = 0
let missing = []
for (const issue of ledger.issues as any[]) {
  const evFile = issue.evidence?.evidenceFile
  if (SELF_UPDATE.has(issue.code)) continue // self-updating verifier
  if (!evFile) continue // planned/blocked entries carry no evidence
  const p = path.join(ROOT, "validation/m21/results", evFile)
  if (!existsSync(p)) {
    missing.push(issue.code)
    continue
  }
  const ev = JSON.parse(readFileSync(p, "utf8"))
  const block: Record<string, unknown> = {
    status: ev.status,
    currentCommit: ev.currentCommit,
    workingTreeRelevantChanges: [],
    verifierCommand: ev.verifierCommand,
    evidenceFile: ev.evidenceFile,
    generatedAt: ev.generatedAt,
    passed: ev.passed,
    failed: ev.failed,
    negativeCases: ev.negativeCases,
  }
  // §8.3: the reason travels with a non-verified status. This block used to
  // copy only the counts, so every sync silently STRIPPED the reason the
  // projection had derived — measured 2026-10-17: three m21 entries read
  // `known-gap with no recorded reason` immediately after this helper ran.
  // The reason is read through the ONE owner of that rule, so the sync and the
  // projection cannot spell it differently.
  const reason = reasonFromRecord(ev as Record<string, unknown>)
  if (reason !== undefined) block.blockedReason = reason
  // Sanity: the evidence and ledger status must agree, else the sync is a lie.
  if (ev.status !== issue.status) {
    throw new Error(`status mismatch: ${issue.code} ledger=${issue.status} file=${ev.status}`)
  }
  issue.evidence = block
  updated++
}
ledger.updatedAt = new Date().toISOString()
// M61 D-1 (the seal law): the manifest is a RECORD and is written through the
// ONE write path. This helper stamped RAW JSON, so every projection left the
// previous run's envelope sitting over new bytes — the stale seal M61.A1's A2
// measured on this file (2026-10-17, sealed 2026-10-08 while rewritten since).
writeSealed(MANIFEST, ledger)
// A registered ledger that was just resealed must MOVE ITS REGISTER ROW, or
// M61.A1's A4 fails on the digest this write just changed.
{
  const moved = reRecordRegisterRow(ROOT, MANIFEST, "m21 ledger re-synced from its evidence files by script/m21/sync-manifest.ts, which writes through writeSealed: content and seal moved together; verdicts unchanged")
  if (moved.ok) console.log(`register: ${moved.path} row moved ${moved.oldDigest.slice(0, 8)} -> ${moved.newDigest.slice(0, 8)}`)
}
console.log(`synced ${updated} evidence blocks; missing files: ${missing.length ? missing.join(",") : "none"}`)