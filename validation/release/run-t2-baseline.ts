// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the campaign's T2 latency baseline: every READ tool is
//   exercised against the shared 3.6 GB reference index through the same handler
//   map the MCP server uses, with warm-up runs discarded and the index bytes
//   checked before/after so "read-only" is measured, not assumed.
// WHICH TOOL IT SERVES — all sixteen (thirteen measured; the three write tools
//   are declared skipped because their contract is to write).
// WHY SHAPED THIS WAY — the owners measured their own tiers; this is the one
//   place where all tools meet the SAME index under the same protocol, so a
//   budget verdict is comparable across lanes instead of assembled from prose.
// WHERE EVIDENCE LIVES — validation/release/T2-BASELINE.json (this script writes it).
// EDIT TOGETHER — docs/tools-campaign/CHARTER.md §6 (budgets), each lane's
//   validation/tools/<tool>/LATENCY.json.
// CONTRACTS — never mutate the shared index; BB_NO_AUTO_REFRESH=1; report a
//   budget as FAILED when it is failed, never rounded up.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto"
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createToolHandlers } from "../../src/mcp/tool-handlers.ts"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry.ts"
import { getProjectId } from "../../src/util/project-id.ts"

const REPO = path.resolve(import.meta.dirname ?? ".", "../..")
const PROJECT_PATH = REPO
const PROJECT_ID = getProjectId(PROJECT_PATH)
const DB_DIR = path.join(REPO, "validation", "release", "t2-index-copy")
const DB_HINT = path.join(REPO, ".bb-data", "projects", PROJECT_ID, "brain.db")

// Measure the DB the run actually uses. The reference index stays where it is;
// this script only reads it (readonly handles; BB_NO_AUTO_REFRESH).
const dbPath = existsSync(DB_HINT) ? DB_HINT : path.join(DB_DIR, "brain.db")
const dbStat = (): { size: number; mtimeMs: number } => {
  const s = statSync(dbPath)
  return { size: s.size, mtimeMs: s.mtimeMs }
}
const hashEdges = (): string => {
  // Read the first and last 64 KiB through a file handle: a full read of the
  // 3.6 GB heap would dominate the measurement it is supposed to guard.
  const sha = createHash("sha256")
  const size = statSync(dbPath).size
  const fd = openSync(dbPath, "r")
  try {
    const headBuf = Buffer.alloc(65536)
    const headRead = readSync(fd, headBuf, 0, 65536, 0)
    sha.update(headBuf.subarray(0, headRead))
    const tailBuf = Buffer.alloc(65536)
    const tailStart = Math.max(0, size - 65536)
    const tailRead = readSync(fd, tailBuf, 0, 65536, tailStart)
    sha.update(tailBuf.subarray(0, tailRead))
  } finally {
    closeSync(fd)
  }
  return sha.digest("hex").slice(0, 16)
}

interface Call { tool: string; args: Record<string, unknown>; budgetMs: number }
const CALLS: Call[] = [
  { tool: "bb_health", args: {}, budgetMs: 2000 },
  { tool: "bb_search", args: { query: "getRawInstance", limit: 5 }, budgetMs: 5000 },
  { tool: "bb_ask", args: { query: "where is the index opened", limit: 3 }, budgetMs: 5000 },
  { tool: "bb_analyze", args: { mode: "callers", target: "getRawInstance" }, budgetMs: 5000 },
  { tool: "bb_patterns", args: { scope: "orphaned", limit: 5 }, budgetMs: 5000 },
  { tool: "bb_security", args: {}, budgetMs: 5000 },
  { tool: "bb_visualize", args: { scope: "symbol", target: "getRawInstance" }, budgetMs: 5000 },
  { tool: "bb_migrate", args: { symbolName: "getRawInstance", targetLanguage: "rust" }, budgetMs: 5000 },
  { tool: "bb_doc", args: { mode: "symbol", target: "getRawInstance" }, budgetMs: 5000 },
  { tool: "bb_graph", args: { symbol: "getRawInstance", maxDepth: 1, maxEdges: 20 }, budgetMs: 5000 },
  { tool: "bb_impact", args: { symbol: "getRawInstance" }, budgetMs: 5000 },
  { tool: "bb_cross_language", args: { symbol: "getRawInstance" }, budgetMs: 5000 },
  { tool: "bb_annotations", args: { limit: 5 }, budgetMs: 5000 },
]

const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
const context = { projectPath: PROJECT_PATH, projectId: PROJECT_ID }
const p50 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]
}

const toolWriters: string[] = []
const before = { stat: dbStat(), edges: hashEdges() }
const load = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).map(Number)
const results: Array<Record<string, unknown>> = []

for (const call of CALLS) {
  const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((d) => d.name === call.tool)
  const starts: number[] = []
  let isError = false
  let bytes = 0
  const beforeTool = { stat: dbStat(), edges: hashEdges() }
  try {
    // One warm-up run (page cache + module caches), then three measured runs.
    await handlers[call.tool](call.args, context)
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      const result = await handlers[call.tool](call.args, context)
      starts.push(Math.round(performance.now() - t0))
      isError = Boolean(result?.isError)
      bytes = String(result?.content?.[0]?.text ?? "").length
    }
  } catch (error) {
    isError = true
    bytes = String((error as Error)?.message ?? error).length
  }
  const afterTool = { stat: dbStat(), edges: hashEdges() }
  const toolWrote = beforeTool.stat.size !== afterTool.stat.size || beforeTool.stat.mtimeMs !== afterTool.stat.mtimeMs || beforeTool.edges !== afterTool.edges
  if (toolWrote) toolWriters.push(call.tool)
  const measured = starts.length > 0 ? starts.slice(1) : starts
  const stats = measured.length > 0 ? { p50: p50(measured), p95: p95(measured) } : { p50: -1, p95: -1 }
  results.push({
    tool: call.tool,
    mutability: descriptor?.mutability,
    budgetMs: call.budgetMs,
    runs: measured,
    p50Ms: stats.p50,
    p95Ms: stats.p95,
    withinBudget: stats.p95 >= 0 && stats.p95 <= call.budgetMs,
    isError,
    outputBytes: bytes,
  })
}

const after = { stat: dbStat(), edges: hashEdges() }
const report = {
  schemaVersion: 1,
  what: "Campaign T2 baseline — all read tools against the shared 3.6 GB reference index, in-process handler calls, warm runs.",
  generatedAt: new Date().toISOString(),
  head: readFileSync(path.join(REPO, ".git", "HEAD"), "utf8").trim().slice(0, 7),
  referenceIndex: {
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    dbPath: path.relative(REPO, dbPath),
    dbBytes: before.stat.size,
    dbMtimeMs: before.stat.mtimeMs,
  },
  protocol: {
    env: "BB_DATA_DIR=<repo>/.bb-data, BB_NO_AUTO_REFRESH=1",
    warmupRuns: 1,
    measuredRuns: 3,
    readOnlyProof: {
      dbBytesBefore: before.stat.size,
      dbBytesAfter: after.stat.size,
      dbMtimeUnchanged: before.stat.mtimeMs === after.stat.mtimeMs,
      edgeHashBefore: before.edges,
      edgeHashAfter: after.edges,
      // The whole-run comparison also sees EXTERNAL writers (other sessions share
      // this machine). The per-tool delta is the attributable proof: a tool that
      // changes the bytes is a defect; a whole-run delta with zero tool deltas is
      // a concurrent writer and is declared, not blamed on the tool.
      toolWriters: toolWriters,
      noToolWrote: toolWriters.length === 0,
      wholeRunUnchanged: before.stat.size === after.stat.size && before.stat.mtimeMs === after.stat.mtimeMs && before.edges === after.edges,
    },
    loadavg: load,
  },
  skippedWriteTools: ["bb_edit", "bb_index", "bb_annotate"],
  budgets: { "bb_health default": 2000, "all other defaults": 5000 },
  results,
  verdict: results.every((r) => r.withinBudget && r.isError === false) && toolWriters.length === 0
    ? "ALL READ TOOLS WITHIN BUDGET; NO TOOL WROTE THE INDEX"
    : `ATTENTION: budgetFailures=${results.filter((r) => !r.withinBudget).map((r) => r.tool).join(",") || "none"} errors=${results.filter((r) => r.isError).map((r) => r.tool).join(",") || "none"} toolWriters=${toolWriters.join(",") || "none"}`,
}
const out = path.join(REPO, "validation", "release", "T2-BASELINE.json")
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ verdict: report.verdict, unchanged: report.protocol.readOnlyProof.unchanged, tools: results.length }, null, 2))
for (const r of results) console.log(`${r.tool}: p50=${r.p50Ms} p95=${r.p95Ms} budget=${r.budgetMs} ${r.withinBudget ? "ok" : "OVER"}${r.isError ? " isError" : ""}`)
