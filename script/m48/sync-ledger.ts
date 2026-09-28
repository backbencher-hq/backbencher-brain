// script/m48/sync-ledger.ts — M48.G1 infra
// Syncs the ledger per-issue evidence from the on-disk evidence files in
// validation/m48/results/<CODE>.json. Truth comes from the verifier-produced
// files; a ledger entry is never hand-edited.

import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const LEDGER_PATH = path.join(ROOT, "validation/m48/ledger.json")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
const files = readdirSync(RESULTS_DIR).filter((f) => /^[A-Z0-9]+\.json$/.test(f))

for (const issue of ledger.issues as Array<Record<string, any>>) {
  const f = files.find((x) => x.replace(/\.json$/, "") === issue.code)
  if (!f) {
    issue.status = "pending"
    issue.evidenceFile = null
    issue.stamp = null
    issue.evidence = null
    continue
  }
  const ev = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"))
  issue.status = ev.status === "verified" ? "verified" : ev.status ?? "known-gap"
  issue.evidenceFile = `${issue.code}.json`
  issue.stamp = ev.currentCommit ?? null
  issue.evidence = {
    status: ev.status ?? "known-gap",
    currentCommit: ev.currentCommit ?? null,
    passed: ev.passed ?? 0,
    failed: ev.failed ?? 0,
    negativeCases: ev.negativeCases ?? 0,
    evidenceFile: `${issue.code}.json`,
    generatedAt: ev.generatedAt ?? null,
    failures: ev.failures ?? [],
  }
}

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n")
console.log(`M48 LEDGER SYNC: ${files.length} evidence file(s) applied`)
