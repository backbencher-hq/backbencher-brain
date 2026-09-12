// script/m41/sync-ledger.ts — M41 evidence-batch helper (mechanical, derived).
//
// Copies each verified issue's evidence-file facts (commit, pass/fail counts,
// negative cases, generation time) into the ledger's nested evidence block.
// Nothing here is authored by hand: the numbers come from the artifacts, and
// verify-governance.ts (G1) then rejects a ledger that disagrees with them.
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
const RESULTS = path.join(ROOT, "validation/m41/results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")

interface EvidenceFile {
  currentCommit?: string
  generatedAt?: string
  passed?: number
  failed?: number
  negativeCases?: number
}

interface Issue {
  code: string
  status: string
  evidence?: {
    status: string
    currentCommit: string
    verifierCommand: string
    evidenceFile: string
    generatedAt: string
    passed: number
    failed: number
    negativeCases: number
  }
}

interface Ledger {
  updatedAt: string
  issues: Issue[]
}

const ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Ledger
const changed: string[] = []
const skipped: string[] = []

for (const issue of ledger.issues) {
  if (issue.status === "planned" || !issue.evidence) {
    skipped.push(`${issue.code}(planned)`)
    continue
  }
  const file = path.join(RESULTS, issue.evidence.evidenceFile)
  if (!existsSync(file)) {
    skipped.push(`${issue.code}(no ${issue.evidence.evidenceFile})`)
    continue
  }
  const e = JSON.parse(readFileSync(file, "utf8")) as EvidenceFile
  if (e.currentCommit === undefined || e.passed === undefined || e.failed === undefined || e.negativeCases === undefined || e.generatedAt === undefined) {
    skipped.push(`${issue.code}(incomplete evidence)`)
    continue
  }
  const next = {
    ...issue.evidence,
    currentCommit: e.currentCommit,
    generatedAt: e.generatedAt,
    passed: e.passed,
    failed: e.failed,
    negativeCases: e.negativeCases,
  }
  if (JSON.stringify(next) !== JSON.stringify(issue.evidence)) changed.push(issue.code)
  issue.evidence = next
}

if (changed.length > 0) {
  ledger.updatedAt = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, JSON.stringify(ledger, null, 2) + "\n")
}

let head = "unknown"
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

console.log("M41 ledger sync (derived from evidence files)")
for (const code of changed) console.log(`  updated: ${code}`)
for (const code of skipped) console.log(`  skipped: ${code}`)
if (changed.length === 0) console.log("  already in sync")
console.log(`  HEAD: ${head}`)
