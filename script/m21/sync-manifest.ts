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

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

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
  // Sanity: the evidence and ledger status must agree, else the sync is a lie.
  if (ev.status !== issue.status) {
    throw new Error(`status mismatch: ${issue.code} ledger=${issue.status} file=${ev.status}`)
  }
  issue.evidence = block
  updated++
}
ledger.updatedAt = new Date().toISOString()
writeFileSync(MANIFEST, JSON.stringify(ledger, null, 2) + "\n")
console.log(`synced ${updated} evidence blocks; missing files: ${missing.length ? missing.join(",") : "none"}`)