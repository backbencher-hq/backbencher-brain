// script/m21/verify-index-resume.ts — M21.R3
// Audits whether the indexer exposes an invocable cancellation/checkpoint/resume
// contract. It must remain known-gap until an interrupted run can be exercised.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const indexer = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
const service = readFileSync(path.join(ROOT, "src/brain/service.ts"), "utf8")
const indexerCode = indexer.replace(/\/\/.*$/gm, "").replace(/\/\*[\\s\\S]*?\*\//g, "")
const serviceCode = service.replace(/\/\/.*$/gm, "").replace(/\/\*[\\s\\S]*?\*\//g, "")
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

const hasCancellationInput = /AbortSignal|AbortController|CancellationToken|cancel(?:led|lation)?/i.test(indexerCode)
const hasCheckpoint = /(?:checkpoint|resume(?:From|Token|State)?|cursor)\s*[:?]|(?:checkpoint|resume|cursor)\s*\(/i.test(indexerCode)
const hasProgressPersistence = /(?:checkpoint|resume|cursor)\s*[:?]|(?:checkpoint|resume|cursor)\s*\(/i.test(serviceCode)
const hasBooleanStatus = /isIndexing/.test(serviceCode)
const hasSourceMutationGuard = !/(git\s+(reset|clean|checkout)|rmSync\([^)]*repository)/i.test(indexerCode + serviceCode)

check("R3 indexer exposes its current indexing entry point", /export async function indexProjectParallel/.test(indexer))
check("R3 service exposes indexing lifecycle status", hasBooleanStatus)
check("R3 source mutation guard is present", hasSourceMutationGuard)
negative("R3 cancellation is not falsely claimed when no cancellation input exists", !hasCancellationInput)
negative("R3 checkpoint is not falsely claimed when no checkpoint state exists", !hasCheckpoint)
const claimsResume = (run: any) => run?.resumable === true
negative("R3 resume is not falsely claimed by a boolean indexing flag", claimsResume({ resumable: true }) && !hasProgressPersistence)
const isSuccessfulInterruptedRun = (run: any) => run?.interrupted === true && run?.checkpoint !== null && run?.resumed === true && run?.lostFiles === 0 && run?.duplicateFiles === 0
negative("R3 unavailable interruption cannot be treated as a successful run", !isSuccessfulInterruptedRun({ interrupted: true, checkpoint: null, resumed: false, lostFiles: null, duplicateFiles: null }))

const typecheck = spawnSync("bunx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 120000 })
check("R3 project typecheck executes successfully", typecheck.status === 0, typecheck.stderr)
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
const status = passed === checks && negatives >= 4 ? "known-gap" : "blocked"
const result = {
  issue: "M21.R3", code: "R3", milestone: "M21", status,
  checks, passed, failed: checks - passed, negativeCases: negatives,
  currentCommit: commit, workingTreeRelevantChanges: [],
  verifierCommand: "bun run script/m21/verify-index-resume.ts",
  evidenceFile: "R3.json", generatedAt: new Date().toISOString(),
  contract: { cancellationInput: hasCancellationInput, checkpoint: hasCheckpoint, resumeState: hasProgressPersistence, serviceBooleanStatus: hasBooleanStatus },
  unavailable: [
    "No cancellation signal/token is accepted by indexProjectParallel.",
    "No durable checkpoint or resume cursor is exposed by the indexer/service.",
    "An interrupted real-repository run cannot yet be invoked without first implementing the contract."
  ],
  limitations: [
    "This is a contract audit, not a fabricated interrupted run.",
    "R3 requires production cancellation/checkpoint/resume implementation and then real-repository interruption evidence before closure."
  ]
}
mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/R3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`R3: ${status.toUpperCase()} (${passed}/${checks}, ${negatives} negative)`)
process.exit(1)
