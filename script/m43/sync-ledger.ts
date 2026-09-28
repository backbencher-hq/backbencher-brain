// script/m43/sync-ledger.ts — M43.G1
// Syncs the M43 ledger's per-issue evidence blocks from the on-disk evidence
// files in validation/m43/results/. A ledger entry is never hand-edited; truth
// comes from the verifier-produced evidence file (M31/M40 pattern).

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m43/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Array<Record<string, any>>
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

let synced = 0
let missing: string[] = []
for (const issue of ledger) {
  const file = path.join(RESULTS_DIR, `${issue.code}.json`)
  if (!existsSync(file)) {
    missing.push(issue.code)
    delete issue.evidence
    continue
  }
  const ev = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  issue.evidence = {
    status: ev.status,
    currentCommit: ev.currentCommit,
    workingTreeRelevantChanges: ev.workingTreeRelevantChanges ?? [],
    verifierCommand: ev.verifierCommand,
    evidenceFile: `${issue.code}.json`,
    generatedAt: ev.generatedAt,
    passed: ev.passed,
    failed: ev.failed,
    negativeCases: ev.negativeCases,
  }
  synced++
}

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n")
console.log(`M43 ledger synced: ${synced} evidence blocks, missing: ${missing.length ? missing.join(",") : "none"} (HEAD ${HEAD.slice(0, 7)})`)
