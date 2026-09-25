// script/m41/sync-ledger.ts — evidence-batch helper (mechanical, derived).
//
// Copies each verified issue's evidence-file facts (commit, pass/fail counts,
// negative cases, generation time) into the ledger's nested evidence block.
// Nothing here is authored by hand: the numbers come from the artifacts, and
// G1 then rejects a ledger that disagrees with them.
//
// Only keys the ledger ENTRY already declares are written — the file's values
// replace the entry's values, and the entry's shape is left alone. That keeps
// milestone-specific fields (mutantsCaught, realFailed, checks) intact instead
// of flattening every milestone into one schema.
//
// Usage:
//   npx tsx script/m41/sync-ledger.ts                 # M41 (default)
//   npx tsx script/m41/sync-ledger.ts --milestone m45 # any milestone with a ledger
//   npx tsx script/m41/sync-ledger.ts --check         # report drift, write nothing
//
// The batch procedure it completes:
//   1. run every M41 verifier at ONE HEAD (no commits in between)
//   2. npx tsx script/m41/sync-ledger.ts
//   3. npx tsx script/m41/verify-governance.ts  → green
//   4. commit the evidence + ledger, then STOP re-running gates
// Step 4 matters: re-running a single verifier afterwards moves that artifact
// past the ledger and G1 goes red again — which is the honest signal that the
// batch is no longer a batch (the M45 closure lesson).
//
// Run: npx tsx script/m41/sync-ledger.ts

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const args = process.argv.slice(2)
const MILESTONE = args.includes("--milestone") ? (args[args.indexOf("--milestone") + 1] ?? "m41") : "m41"
const CHECK_ONLY = args.includes("--check")
const RESULTS = path.join(ROOT, "validation", MILESTONE, "results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")

// Facts a verifier writes that a ledger entry may record. Value-only: a key
// absent from the ledger entry is left absent (G1 validates the entry's shape).
const SYNCED_KEYS = ["currentCommit", "generatedAt", "passed", "failed", "realFailed", "negativeCases", "checks", "mutantsCaught", "mutantsTotal"] as const

// Synced for information, but NOT part of the agreement contract — the gate
// compares commit + counts only, because it rewrites its own artifact in the
// run that validates the ledger. Keeping the drift report on the same contract
// means `--check` and the gate can never disagree about what "in sync" means.
const NON_CONTRACT_KEYS = new Set<string>(["generatedAt"])

type EvidenceFile = Record<string, unknown>

interface Issue {
  code: string
  status: string
  evidence?: Record<string, unknown> & { evidenceFile?: string }
}

interface Ledger {
  updatedAt: string
  issues: Issue[]
}

const ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Ledger
const changed: string[] = []
const skipped: string[] = []
const unverified: string[] = []

for (const issue of ledger.issues) {
  if (issue.status === "planned" || !issue.evidence) {
    skipped.push(`${issue.code}(planned)`)
    continue
  }
  const evidenceFile = issue.evidence.evidenceFile
  const file = path.join(RESULTS, String(evidenceFile))
  if (!evidenceFile || !existsSync(file)) {
    skipped.push(`${issue.code}(no ${evidenceFile})`)
    continue
  }
  const e = JSON.parse(readFileSync(file, "utf8")) as EvidenceFile
  // A ledger may not call an issue verified while its artifact says otherwise.
  const fileStatus = e.verdict ?? e.status
  if (fileStatus !== undefined && fileStatus !== "verified" && fileStatus !== "PASS") {
    unverified.push(`${issue.code}:${String(fileStatus)}`)
    continue
  }
  const next: Record<string, unknown> = { ...issue.evidence }
  const contractBefore: Record<string, unknown> = {}
  const contractAfter: Record<string, unknown> = {}
  for (const key of SYNCED_KEYS) {
    if (issue.evidence[key] === undefined || e[key] === undefined) continue
    next[key] = e[key]
    if (!NON_CONTRACT_KEYS.has(key)) {
      contractBefore[key] = issue.evidence[key]
      contractAfter[key] = e[key]
    }
  }
  if (JSON.stringify(contractAfter) !== JSON.stringify(contractBefore)) changed.push(issue.code)
  issue.evidence = next
}

if (changed.length > 0 && !CHECK_ONLY) {
  ledger.updatedAt = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, JSON.stringify(ledger, null, 2) + "\n")
}

let head = "unknown"
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

console.log(`${MILESTONE.toUpperCase()} ledger sync (derived from evidence files)${CHECK_ONLY ? " [check only]" : ""}`)
for (const code of changed) console.log(`  ${CHECK_ONLY ? "drift" : "updated"}: ${code}`)
for (const code of skipped) console.log(`  skipped: ${code}`)
for (const code of unverified) console.log(`  REFUSED (artifact is not verified): ${code}`)
if (changed.length === 0) console.log("  already in sync")
console.log(`  HEAD: ${head}`)
