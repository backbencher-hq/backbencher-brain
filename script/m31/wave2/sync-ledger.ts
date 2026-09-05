// script/m31/wave2/sync-ledger.ts — M31.G3
// Syncs the wave-2 ledger's per-issue evidence blocks from the on-disk
// evidence files in validation/m31/wave2/results/. A ledger entry is never
// hand-edited; truth comes from the verifier-produced evidence file (M21
// sync-manifest / wave-1 sync-ledger pattern). A code whose evidence file
// reports status "verified" is flipped to verified; anything else keeps its
// current status. Run AFTER all four content gates + governance have stamped.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const LEDGER_PATH = path.join(ROOT, "validation/m31/wave2/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")

const EVIDENCE_FILE: Record<string, string> = { D4: "D4.json", G2: "G2.json", F1: "F1.json", D5: "D5.json", G3: "G3.json" }

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
  if (ev.status !== "verified" && issue.status === "verified") {
    issue.status = "known-gap"
  }
}
writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n")
console.log(`wave-2 ledger synced: ${flipped} flipped to verified${missing.length ? `; missing evidence: ${missing.join(", ")}` : ""}`)
