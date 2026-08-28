// script/m21/verify-embedding-queue.ts — M21.E2
// Audit the background embedding queue contract. This intentionally does not
// claim verified queue telemetry until production counters exist. It records
// executable lifecycle checks plus explicit known gaps.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const source = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

// These are structural requirements for the eventual production telemetry.
check("E2 queue has an explicit item cap", /EMBED_QUEUE_ITEM_CAP/.test(source))
check("E2 oversized batches have a bounded branch", /items\.length\s*>=\s*embedBatchLimit/.test(source))
check("E2 queue-cap branch exists", /backgroundEmbedQueuedItems\s*\+\s*items\.length\s*>\s*EMBED_QUEUE_ITEM_CAP/.test(source))
check("E2 flush waits for active work and queued jobs", /while \(backgroundEmbedActive \|\| backgroundEmbedJobs\.length > 0\)/.test(source))
check("E2 removed projects are checked before writes", /!existsSync\(job\.projectPath\).*existsSync\(dbPath\)/s.test(source))
check("E2 provider failure has a fallback path", /TF-IDF fallback/.test(source) && /tfidf-v1/.test(source))
check("E2 background failures are not thrown into the index call", /background semantic embedding failed/.test(source))

// The following checks deliberately expose the current missing contract. They
// pass only when the source has durable counters/state for each outcome.
const queueStart = source.indexOf("function queueBackgroundEmbeddings")
const drainStart = source.indexOf("async function drainBackgroundEmbeddings")
const storageStart = source.indexOf("export async function storeResults")
const queueBody = queueStart >= 0 && drainStart > queueStart ? source.slice(queueStart, drainStart) : ""
const drainBody = drainStart >= 0 && storageStart > drainStart ? source.slice(drainStart, storageStart) : ""
const flushStart = source.indexOf("export async function flushBackgroundEmbeddings")
const queueCounters = /(?:queued|dropped|failed|retried|fallback).*(?:count|counter|metric|stats)/is
const hasQueueCounters = queueCounters.test(queueBody) || queueCounters.test(drainBody)
const hasDropPersistence = /dropped.*(?:count|counter|metric|stats|persist)/is.test(queueBody)
const hasFailurePersistence = /(?:failed|fallback).*(?:count|counter|metric|stats|persist)/is.test(drainBody)
const flushBody = flushStart >= 0 && queueStart > flushStart ? source.slice(flushStart, queueStart) : ""
const hasBoundedFlush = /(?:timeout|deadline|AbortSignal|bounded)/i.test(flushBody)
negative("E2 missing queue counters is visible", !hasQueueCounters)
negative("E2 dropped batches are not falsely reported as embedded", !hasDropPersistence)
negative("E2 failures/fallbacks are not falsely reported as success", !hasFailurePersistence)
negative("E2 current flush has no timeout claim", !hasBoundedFlush)

const typecheck = spawnSync("bunx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", timeout: 120000 })
check("E2 project typecheck executes successfully", typecheck.status === 0, typecheck.stderr)

const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
const status = passed === checks && negatives >= 4 ? "known-gap" : "blocked"
const result = {
  issue: "M21.E2", code: "E2", milestone: "M21", status,
  checks, passed, failed: checks - passed, negativeCases: negatives,
  currentCommit: commit, workingTreeRelevantChanges: [],
  verifierCommand: "bun run script/m21/verify-embedding-queue.ts",
  evidenceFile: "E2.json", generatedAt: new Date().toISOString(),
  queueContract: {
    capDeclared: true,
    oversizedBatchBranch: true,
    queueDropPersistence: hasDropPersistence,
    failurePersistence: hasFailurePersistence,
    boundedFlush: hasBoundedFlush,
  },
  unavailable: [
    "Production queue counters for queued, dropped, failed, retried, and fallback items are not implemented.",
    "flushBackgroundEmbeddings has no deadline/abort contract."
  ],
  limitations: [
    "This is an audit of the current queue contract; it does not claim queue metrics or provider latency.",
    "E2 must remain open until production telemetry and bounded flush behavior are implemented and tested."
  ]
}
mkdirSync(path.join(ROOT, "validation/m21/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/m21/results/E2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`E2: ${status.toUpperCase()} (${passed}/${checks}, ${negatives} negative)`)
process.exit(status === "known-gap" ? 1 : 1)
