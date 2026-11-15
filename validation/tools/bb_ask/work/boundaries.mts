// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — Phase-B boundary probe: it checks the three behaviours the read
//   path promises after the fix — a missing index is not created, a stalling embedding
//   provider cannot exceed the tool's wait ceiling, and a limit outside 1..100 is
//   refused with the door's own words.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/boundaries-phaseB.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/{quick-answer,semantic-search}.ts,
//   src/mcp/tools/bb_ask/handler.ts.
//
// Usage: BB_DATA_DIR=<indexed tier data dir> npx tsx boundaries.mts <indexedProjectDir> <out.json>

import { createServer } from "node:net"
import { existsSync, writeFileSync } from "node:fs"
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const indexedDir = process.argv[2]
const outPath = process.argv[3]
if (!indexedDir || !outPath) {
  console.error("usage: boundaries.mts <indexedProjectDir> <out.json>")
  process.exit(2)
}
const ask = createToolHandlers().bb_ask
const textOf = (result: any) => (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")

// ── 1. A missing index must not become a database ──────────────────────────
const missingProjectId = "bb-ask-no-index-" + Date.now()
const missingDbPath = BrainDatabase.getDbPath(missingProjectId)
const missingAnswer: any = await ask({ query: "how many functions are in this project" }, { projectId: missingProjectId, projectPath: "/tmp/bb-ask-missing" } as any)
const missing = {
  dbCreated: existsSync(missingDbPath),
  isError: missingAnswer?.isError === true,
  routeLine: textOf(missingAnswer).split("\n").find((line) => line.startsWith("answer:"))?.slice(0, 120) ?? "",
  provenance: textOf(missingAnswer).split("\n").find((line) => line.includes("[provenance:")) ?? "",
}

// ── 2. A limit outside 1..100 is refused with the door's words ─────────────
const indexedProjectId = getProjectId(indexedDir)
const refusal = await ask({ query: "request handling", limit: 0 }, { projectId: indexedProjectId, projectPath: indexedDir } as any)
const overCeiling = await ask({ query: "request handling", limit: 101 }, { projectId: indexedProjectId, projectPath: indexedDir } as any)
const limitRefusals = {
  zero: { isError: refusal?.isError === true, text: textOf(refusal).slice(0, 200) },
  overCeiling: { isError: overCeiling?.isError === true, text: textOf(overCeiling).slice(0, 200) },
}

// ── 3. A provider that accepts and never answers is bounded ────────────────
const stall = createServer((socket) => { socket.on("data", () => {}) })
await new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", () => resolve()))
const port = (stall.address() as any).port
process.env.BB_EMBEDDING_BASE_URL = `http://127.0.0.1:${port}/v1`
process.env.BB_EMBEDDING_MODEL = "stalling-model"
process.env.BB_EMBEDDING_API_KEY = "probe"
process.env.BB_EMBEDDING_TIMEOUT_MS = "30000" // shipped default; the tool ceiling must win
delete process.env.BB_EMBEDDING_DISABLED
const startedAt = performance.now()
const stalled: any = await ask({ query: "how does request handling work" }, { projectId: indexedProjectId, projectPath: indexedDir } as any)
const stalledMs = Math.round(performance.now() - startedAt)
stall.close()
const stalledText = textOf(stalled)
const stallingProvider = {
  ms: stalledMs,
  withinCeiling: stalledMs < 5000,
  timeoutNote: stalledText.split("\n").find((line) => line.includes("did not answer within"))?.slice(0, 260) ?? "",
  retrieval: stalledText.split("\n").find((line) => line.includes("[retrieval:"))?.slice(0, 420) ?? "",
}

const report = {
  indexedDir,
  indexedProjectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  missingIndex: missing,
  limitRefusals,
  stallingProvider,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
