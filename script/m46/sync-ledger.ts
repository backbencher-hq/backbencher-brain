// script/m46/sync-ledger.ts — M46.G1
// Syncs the M46 ledger's per-issue evidence blocks from the on-disk evidence
// files in validation/m46/results/. A ledger entry is never hand-edited; truth
// comes from the verifier-produced evidence file.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m46/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m46/results")

const EVIDENCE_FILE: Record<string, string> = {
  G1: "G1.json", H1: "H1.json", H2: "H2.json", X1: "X1.json",
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
let flipped = 0
let missing: string[] = []
for (const issue of ledger) {
  const file = EVIDENCE_FILE[issue.code]
  if (!file) continue
  const p = path.join(RESULTS_DIR, file)
  if (!existsSync(p)) {
    missing.push(`${issue.code} (${file})`)
    delete issue.evidence
    if (issue.status === "verified") issue.status = "known-gap"
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
  if (ev.status === "verified" && issue.status !== "verified") {
    issue.status = "verified"
    flipped++
  }
  if (ev.status !== "verified" && issue.status === "verified") issue.status = "known-gap"
}
writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n")
console.log(`M46 ledger synced: ${flipped} flipped to verified${missing.length ? `; missing evidence: ${missing.join(", ")}` : ""}`)
