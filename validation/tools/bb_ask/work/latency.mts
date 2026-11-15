// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — measures the real bb_ask handler on one tier: five distinct natural-language
//   queries, warm (one warmup), p50/p95 recorded with the exact argv/env, plus the engine's own
//   retrieval metadata for each call so a latency figure can never be read without the model and
//   coverage that produced it.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/LATENCY.json.
// EDIT TOGETHER WHEN THIS CHANGES — work/index-facts.mts, work/t2-components.mts.
//
// Usage: BB_DATA_DIR=<dir> BB_NO_AUTO_REFRESH=1 npx tsx latency.mts <tier> <projectDir> <out.json>

import { existsSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const tier = process.argv[2]
const projectDir = process.argv[3]
const outPath = process.argv[4]
if (!tier || !projectDir || !outPath) {
  console.error("usage: latency.mts <tier> <projectDir> <out.json>")
  process.exit(2)
}

const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (file: string) => (existsSync(file) ? { size: statSync(file).size, mtimeMs: Math.round(statSync(file).mtimeMs) } : null)
const indexFiles = () => ({ db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) })
// Database bytes must not move and WAL frames must not grow. An absent -wal and a
// zero-byte one both mean "no frames"; only appended frames are a write.
const walFrames = (snapshot: ReturnType<typeof indexFiles>) => snapshot.wal?.size ?? 0
const indexFilesBefore = indexFiles()
const handler = createToolHandlers().bb_ask
const QUERIES = [
  "how does request handling work in this codebase",
  "where is the index lock acquired",
  "how are tool descriptors registered",
  "what parses the configuration file",
  "how does the search engine rank results",
]

async function call(query: string, args: Record<string, unknown> = { query }): Promise<{ ms: number; text: string; isError: boolean }> {
  const t0 = performance.now()
  const result: any = await handler(args, { projectId, projectPath: projectDir } as any)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { ms, text, isError: result?.isError === true }
}
const exactCall = (query: string) => call(query, { query, limit: 1 })

function extract(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const retrieval = text.match(/\[retrieval: ([^\]]*)\]/)
  if (retrieval) for (const part of retrieval[1].split(", ")) {
    const eq = part.indexOf("=")
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  const prov = text.match(/\[provenance: ([^\]]*)\]/)
  if (prov) out.provenance = prov[1]
  const conf = text.match(/confidence: ([0-9.]+)/)
  if (conf) out.confidence = conf[1]
  out.chars = String(text.length)
  out.lines = String(text.split("\n").length)
  return out
}

// One warmup call that is not measured, then five DISTINCT queries: the in-process
// embed cache keys on text, so repeating one query would measure a cache hit.
const warm = await call("warmup — how does the cache work")
const runs: Array<{ query: string; ms: number; isError: boolean; facts: Record<string, string> }> = []
for (const query of QUERIES) {
  const r = await call(query)
  runs.push({ query, ms: r.ms, isError: r.isError, facts: extract(r.text) })
}
// The exact-name route with limit: 1 skips the dense scan entirely; measure it on its own
// so the fast path is evidenced rather than inferred.
const exactQuery = process.env.BB_ASK_EXACT_QUERY ?? ""
const exactRuns: number[] = []
if (exactQuery) {
  for (let index = 0; index < 5; index++) {
    const r = await exactCall(exactQuery)
    exactRuns.push(r.ms)
  }
}
const sortedExact = [...exactRuns].sort((a, b) => a - b)
const exactName = exactQuery
  ? { query: exactQuery, limit: 1, runs: exactRuns, p50: sortedExact[Math.floor((sortedExact.length - 1) * 0.5)], p95: sortedExact[Math.min(sortedExact.length - 1, Math.ceil((sortedExact.length - 1) * 0.95))], max: sortedExact[sortedExact.length - 1] }
  : null

const sorted = runs.map((r) => r.ms).sort((a, b) => a - b)
const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)]
const p95 = sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.95))]
const report = {
  tier,
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  embeddingDisabled: process.env.BB_EMBEDDING_DISABLED === "1",
  route: "handler (source door): createToolHandlers().bb_ask",
  argv: process.argv.slice(2),
  env: {
    BB_DATA_DIR: process.env.BB_DATA_DIR ?? null,
    BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? null,
    BB_EMBEDDING_DISABLED: process.env.BB_EMBEDDING_DISABLED ?? null,
    BB_VECTOR_SCAN_CAP: process.env.BB_VECTOR_SCAN_CAP ?? null,
  },
  warmupMs: warm.ms,
  warmupChars: warm.text.length,
  runs,
  exactName,
  indexFiles: { before: indexFilesBefore, after: indexFiles(), dbUnchanged: indexFilesBefore.db?.size === indexFiles().db?.size && indexFilesBefore.db?.mtimeMs === indexFiles().db?.mtimeMs && walFrames(indexFiles()) === walFrames(indexFilesBefore) },
  p50,
  p95,
  max: sorted[sorted.length - 1],
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ tier, p50, p95, max: report.max, runs: runs.map((r) => ({ ms: r.ms, facts: r.facts })) }, null, 1))
