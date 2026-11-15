// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — measures two failure modes a caller can actually hit: (1) what a bb_ask read
//   does to the filesystem for a project that was never indexed, and (2) how long one default call
//   blocks when the configured embedding provider is unreachable, because the query embedding is a
//   network call with a 30 s default bound and the tool's own budget is 5 s.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/missing-index-and-network.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/quick-answer.ts (indexState),
//   src/brain/semantic/engine.ts (embed), src/brain/semantic/embedding-config.ts (timeout).
//
// Usage: BB_DATA_DIR=<scratch> npx tsx read-boundaries.mts <out.json>

import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"
import { quickAnswer } from "../../../../src/intelligence/search/quick-answer"

const outPath = process.argv[2]
if (!outPath) {
  console.error("usage: read-boundaries.mts <out.json>")
  process.exit(2)
}

// ── 1. A read of a project that has no index ───────────────────────────────
const missingId = "no-index-project-" + Date.now()
const missingDir = path.dirname(BrainDatabase.getDbPath(missingId))
const missingBefore = { db: existsSync(BrainDatabase.getDbPath(missingId)), dir: existsSync(missingDir) }
const t0 = performance.now()
const missingAnswer = await quickAnswer(missingId, "how many functions are in this project")
const missingMs = Math.round(performance.now() - t0)
const missingAfter = {
  db: existsSync(BrainDatabase.getDbPath(missingId)),
  dir: existsSync(missingDir),
  entries: existsSync(missingDir) ? readdirSync(missingDir) : [],
}

// ── 2. A default call while the embedding provider is unreachable ──────────
const fixture = mkdtempSync(path.join(tmpdir(), "bb-ask-net-"))
writeFileSync(path.join(fixture, "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
const { getProjectId } = await import("../../../../src/util/project-id")
const { indexProjectParallel, flushBackgroundEmbeddings } = await import("../../../../src/ast/parallel-indexer")
const projectId = getProjectId(fixture)
// Index locally so the fixture itself needs no network; only the QUERY embedding can reach out.
process.env.BB_EMBEDDING_DISABLED = "1"
await indexProjectParallel(projectId, fixture, {})
await flushBackgroundEmbeddings()
delete process.env.BB_EMBEDDING_DISABLED
const callStart = performance.now()
const unreachableAnswer = await quickAnswer(projectId, "how does the request handler work in this service")
const unreachableMs = Math.round(performance.now() - callStart)

// ── 3. A provider that accepts the connection and never answers ────────────
// This is the case the tool's budget actually cares about: a reachable-but-stalling
// provider cannot fail fast, so the call blocks for the configured embedding bound
// before the local fallback runs. BB_EMBEDDING_TIMEOUT_MS is shortened for the probe;
// the shipped default is 30,000 ms (embedding-config.ts).
const { createServer } = await import("node:net")
const stall = createServer((socket) => { socket.on("data", () => {}) })
await new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", () => resolve()))
const port = (stall.address() as any).port
process.env.BB_EMBEDDING_BASE_URL = `http://127.0.0.1:${port}/v1`
process.env.BB_EMBEDDING_MODEL = "stalling-model"
process.env.BB_EMBEDDING_API_KEY = "probe"
process.env.BB_EMBEDDING_TIMEOUT_MS = "3000"
delete process.env.BB_EMBEDDING_DISABLED
const stallStart = performance.now()
const stallAnswer = await quickAnswer(projectId, "how does the request handler work in this service")
const stallMs = Math.round(performance.now() - stallStart)
stall.close()

const report = {
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  missingIndex: {
    projectId: missingId,
    before: missingBefore,
    after: missingAfter,
    answer: missingAnswer.answer.slice(0, 160),
    route: missingAnswer.route,
    /** A read created index files for a project that had none. */
    createdDatabase: !missingBefore.db && missingAfter.db,
    ms: missingMs,
  },
  stallingProvider: {
    projectId,
    probeTimeoutMs: 3000,
    shippedDefaultTimeoutMs: 30_000,
    ms: stallMs,
    method: stallAnswer.retrieval?.method ?? null,
    reason: stallAnswer.retrieval?.fallbackReason ?? null,
    answerFirstChars: stallAnswer.answer.slice(0, 160),
    exceedsToolBudget: stallMs > 5_000,
  },
  unreachableProvider: {
    projectId,
    ms: unreachableMs,
    method: unreachableAnswer.retrieval?.method ?? null,
    reason: unreachableAnswer.retrieval?.fallbackReason ?? null,
    answerFirstChars: unreachableAnswer.answer.slice(0, 160),
    configuredTimeoutMs: 30_000,
    declaredBudgetMs: { toolT2: 5_000, clientTimeout: 30_000 },
  },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
rmSync(fixture, { recursive: true, force: true })
try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
try { rmSync(missingDir, { recursive: true, force: true }) } catch {}
