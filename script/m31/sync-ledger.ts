// script/m31/sync-ledger.ts — M31.G1
// Syncs the M31 ledger's per-issue evidence blocks from the on-disk evidence
// files in validation/m31/results/. A ledger entry is never hand-edited; truth
// comes from the verifier-produced evidence file (M21 sync-manifest pattern).

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m31/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m31/results")

// code -> evidence file name (a verifier may write a more descriptive file)
const EVIDENCE_FILE: Record<string, string> = {
  G1: "G1.json",
  D1: "D1.json",
  D2: "D2.json",
  D3: "D3.json",
  T1: "T1.json",
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
const HEAD = (() => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process")
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
})()

let synced = 0
let missing: string[] = []
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
console.log(`synced ${synced} evidence blocks; missing files: ${missing.length ? missing.join(", ") : "none"}`)
if (missing.length === ledger.length) process.exit(1)
