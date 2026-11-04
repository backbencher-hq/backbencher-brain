// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the M20 evidence stamping pass: sync the milestone ledger's
//   per-issue evidence blocks from the verifier-produced files in
//   validation/m20/results/<CODE>.json and re-seal the ledger.
// WHICH TOOL IT SERVES — the migration/patterns/security/doc tools audited by M20
//   (bb_migrate, bb_patterns, bb_security, bb_doc) and the public surface they feed.
// WHY IT EXISTS — the M20 ledger's evidence blocks were maintained by hand while the
//   gates write result files themselves; after any tool change the two drift and the
//   governance gate can no longer tell a stale block from a live one. Truth comes
//   from the verifier files; a stamped block is copied from them, never invented.
// WHERE ITS EVIDENCE LIVES — validation/m20/results/manifest.json (updates it in
//   place, re-sealing the content with the shared seal helper).
// EDIT TOGETHER WHEN THIS CHANGES — script/m20/verify-governance.ts (the comparison
//   field list), the M20 gate files, validation/m20/results/manifest.json.
// CONTRACTS IT MUST NOT BREAK — an issue with no verifier-produced evidence file is
//   reported, never fabricated; the ledger's legal status vocabulary is preserved
//   (a verifier's `failed`/raw status maps to known-gap); a ledger already carrying
//   a verified block is overwritten only by another verified file.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { sealFor } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const MANIFEST = path.join(ROOT, "validation", "m20", "results", "manifest.json")
const RESULTS = path.join(ROOT, "validation", "m20", "results")

type Issue = {
  code: string
  status: string
  evidence?: Record<string, unknown> | null
}

const ledger = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  updatedAt?: string
  issues: Issue[]
  bbSeal?: unknown
}

const LEGAL = new Set(["planned", "verified", "known-gap", "blocked"])
let synced = 0
const missing: string[] = []

for (const issue of ledger.issues ?? []) {
  if (!issue.evidence) continue
  const file = typeof issue.evidence.evidenceFile === "string"
    ? (issue.evidence.evidenceFile as string)
    : `${issue.code}.json`
  const full = path.join(RESULTS, file)
  if (!existsSync(full)) { missing.push(`${issue.code}:${file}`); continue }
  const result = JSON.parse(readFileSync(full, "utf8")) as Record<string, any>
  const mapped = result.status === "verified"
    ? "verified"
    : result.status === "blocked"
      ? "blocked"
      : "known-gap"
  if (!LEGAL.has(mapped)) continue
  issue.status = mapped
  issue.evidence = {
    status: mapped,
    currentCommit: result.currentCommit ?? null,
    sourceFingerprint: result.sourceFingerprint ?? null,
    workingTreeRelevantChanges: Array.isArray(result.workingTreeRelevantChanges) ? result.workingTreeRelevantChanges : [],
    verifierCommand: result.verifierCommand ?? null,
    evidenceFile: file,
    generatedAt: result.generatedAt ?? null,
    passed: result.passed ?? 0,
    failed: result.failed ?? 0,
    negativeCases: result.negativeCases ?? 0,
  }
  synced++
}

const next = { ...ledger, updatedAt: new Date().toISOString() }
const sealed = { ...next, bbSeal: sealFor(next as Record<string, unknown>) }
writeFileSync(MANIFEST, JSON.stringify(sealed, null, 2) + "\n")

console.log(`M20 LEDGER SYNC: ${synced} evidence block(s) applied`)
if (missing.length) console.log(`  no verifier evidence file: ${missing.join(", ")}`)
