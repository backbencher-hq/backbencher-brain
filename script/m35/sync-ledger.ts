// script/m35/sync-ledger.ts — M35.G1
// Syncs the M35 ledger's per-issue evidence blocks from the on-disk evidence
// files in validation/m35/results/. A ledger entry is never hand-edited; truth
// comes from the verifier-produced evidence file (M31 sync-ledger pattern).

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m35/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m35/results")

// code -> evidence file name
const EVIDENCE_FILE: Record<string, string> = {
  G1: "G1.json",
  F1: "F1.json",
  E1: "E1.json",
  S1: "S1.json",
  S2: "S2.json",
  S3: "S3.json",
  C1: "C1.json",
  D1: "D1.json",
  X1: "X1.json",
}

type LedgerIssue = {
  code: string
  githubIssue: number
  tool: string
  status: string
  scope: string
  acceptanceCriteria: string[]
  closureRequirements: string[]
  evidence?: Record<string, unknown>
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerIssue[]
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

let synced = 0
const missing: string[] = []
for (const issue of ledger) {
  const file = EVIDENCE_FILE[issue.code]
  const p = path.join(RESULTS_DIR, file)
  if (!existsSync(p)) {
    missing.push(`${issue.code} (${file})`)
    delete issue.evidence
    continue
  }
  const ev = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
  issue.evidence = {
    status: ev.status,
    currentCommit: ev.currentCommit,
    workingTreeRelevantChanges: ev.workingTreeRelevantChanges ?? [],
    verifierCommand: ev.verifierCommand,
    evidenceFile: file,
    generatedAt: ev.generatedAt,
    passed: ev.passed,
    failed: ev.failed,
    negativeCases: ev.negativeCases,
  }
  issue.status = String(ev.status)
  synced++
}

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n")
console.log(`synced ${synced} evidence blocks at ${HEAD.slice(0, 7)}; missing files: ${missing.length ? missing.join(", ") : "none"}`)
if (missing.length === ledger.length) process.exit(1)
