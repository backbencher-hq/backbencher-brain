// script/m40/sync-ledger.ts — M40.G1
// Syncs the M40 ledger's per-issue evidence blocks from the on-disk evidence
// files in validation/m40/results/. A ledger entry is never hand-edited; truth
// comes from the verifier-produced evidence file (M31/M35 sync-ledger pattern).

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m40/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m40/results")

// code -> evidence file name
const EVIDENCE_FILE: Record<string, string> = {
  G1: "G1.json",
  A1: "A1.json",
  A2: "A2.json",
  A3: "A3.json",
  A4: "A4.json",
  A5: "A5.json",
  A6: "A6.json",
  A7: "A7.json",
  A8: "A8.json",
  A9: "A9.json",
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
  evidence?: Record<string, unknown> | null
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as LedgerIssue[]
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

let synced = 0
const missing: string[] = []
for (const issue of ledger) {
  const file = EVIDENCE_FILE[issue.code]
  if (!file) throw new Error(`ledger code ${issue.code} has no EVIDENCE_FILE mapping`)
  const p = path.join(RESULTS_DIR, file)
  if (!existsSync(p)) {
    missing.push(`${issue.code} (${file})`)
    issue.evidence = null
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
