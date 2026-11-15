// Latency on the three tiers the charter defines.
//
//   T0 test/fixtures/polyglot, own BB_DATA_DIR
//   T1 .perf-fixtures/bb-scale/n100, own BB_DATA_DIR
//   T2 this workspace's .bb-data index (counts + mtime recorded with the sample)
//
// Two measurements per tier, because they answer different questions:
//   * inProcessHandler — createToolHandlers().bb_security on a warm process.
//     This is the engine+handler cost the charter's budgets are about.
//   * mcpRoundTrip — a fresh MCP stdio session per call: what a client actually
//     waits for (includes the source-door startup).
//
// p50/p95 use nearest-rank over 5 samples; with n=5 the p95 IS the maximum, and
// the file says so rather than pretending otherwise.
import { existsSync, readFileSync, statSync } from "node:fs"
import { loadavg, cpus } from "node:os"
import path from "node:path"
import {
  DATA, LANE, ROOT, dataDirFor, ensureDirs, mcpCall, writeEvidence, gitHead, sqliteFileStats,
} from "./lib"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import type { ToolContext } from "../../../../src/mcp/tools/shared"

process.env.BB_DATA_DIR = DATA
ensureDirs()

function pct(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(q * sorted.length))
  return sorted[rank - 1]!
}
function summarise(samples: number[]) {
  return {
    n: samples.length,
    samplesMs: samples.map((s) => Math.round(s)),
    p50: Math.round(pct(samples, 0.5)),
    p95: Math.round(pct(samples, 0.95)),
    max: Math.round(Math.max(...samples)),
    min: Math.round(Math.min(...samples)),
    p95Note: samples.length <= 5 ? "n<=5: nearest-rank p95 equals the maximum sample" : undefined,
  }
}

async function inProcess(tier: string, dir: string, projectId: string, dataDir: string, args: Record<string, unknown>, runs = 5) {
  process.env.BB_DATA_DIR = dataDir
  process.env.BB_NO_AUTO_REFRESH = "1"
  const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
  const handlers = createToolHandlers()
  const ctx: ToolContext = { projectPath: dir, projectId }
  const handler = handlers.bb_security!
  // Warm: first call pays the open path (migrations/healers) and any lazy import.
  const warmStarted = Date.now()
  const warm = await handler(args, ctx)
  const warmMs = Date.now() - warmStarted
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    const result = await handler(args, ctx)
    samples.push(Date.now() - started)
    if (result.isError) throw new Error(`${tier} in-process call refused: ${(result.content ?? []).map((c: any) => c?.text).join("").slice(0, 200)}`)
  }
  const text = (warm.content ?? []).map((c: any) => c?.text ?? "").join("\n")
  return { tier, args, method: "inProcessHandler (warm process)", warmMs, latency: summarise(samples), responseBytes: Buffer.byteLength(text), responseHead: text.slice(0, 300) }
}

async function mcpRoundTrip(tier: string, dir: string, dataDir: string, args: Record<string, unknown>, runs: number) {
  const samples: number[] = []
  let last = { ok: false, isError: true, text: "", bytes: 0 }
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    const call = await mcpCall(dir, args, { dataDir, timeoutMs: 180_000 })
    samples.push(Date.now() - started)
    last = { ok: call.ok, isError: call.isError, text: call.text.slice(0, 300), bytes: Buffer.byteLength(call.text) }
    if (!call.ok || call.isError) throw new Error(`${tier} MCP call refused: ${call.text.slice(0, 200)}`)
  }
  return { tier, args, method: "mcpRoundTrip (fresh session per call, source door)", latency: summarise(samples), responseBytes: last.bytes, responseHead: last.text }
}

async function counts(dataDir: string, projectId: string) {
  process.env.BB_DATA_DIR = dataDir
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  return {
    files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any).c,
    symbols: (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any).c,
    relationships: (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(projectId) as any).c,
    taintFlows: (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow WHERE project_id=?").get(projectId) as any).c,
  }
}

async function main() {
  const fixturesFile = path.join(LANE, "work", "fixtures.json")
  const fixtures = existsSync(fixturesFile) ? JSON.parse(readFileSync(fixturesFile, "utf8")) : null
  const fixtureRows: any[] = fixtures?.fixtures ?? []
  const t0 = fixtureRows.find((f) => f.tier === "T0")
  const t1 = fixtureRows.find((f) => f.tier === "T1")

  const out: any = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    phase: "A-baseline",
    environment: { node: process.version, loadavg: loadavg(), cpus: cpus().length },
    commands: {
      inProcess: "BB_DATA_DIR=<tier dir> BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-latency.ts",
      mcpDoor: "same script; MCP sessions spawn `tsx src/cli/index.ts mcp --dir <tier dir>`",
    },
    budgets: { T0_p95_ms: 250, T1_p95_ms: 1000, T2_p95_ms: 5000, clientTimeout_ms: 30000 },
    tiers: [],
  }

  // ── T0 ──────────────────────────────────────────────────────────────────
  if (t0) {
    const dataDir = dataDirFor("t0")
    out.tiers.push(await inProcess("T0-tiny", t0.dir, t0.projectId, dataDir, {}))
    out.tiers.push(await mcpRoundTrip("T0-tiny", t0.dir, dataDir, {}, 3))
    out.tiers.push({ tier: "T0-tiny", project: { dir: t0.dir, projectId: t0.projectId, dataDir, counts: await counts(dataDir, t0.projectId) } })
  }
  // ── T1 ──────────────────────────────────────────────────────────────────
  if (t1) {
    const dataDir = dataDirFor("t1")
    out.tiers.push(await inProcess("T1-synthetic", t1.dir, t1.projectId, dataDir, {}))
    out.tiers.push(await inProcess("T1-synthetic", t1.dir, t1.projectId, dataDir, { history: true }))
    out.tiers.push(await mcpRoundTrip("T1-synthetic", t1.dir, dataDir, {}, 3))
    out.tiers.push({ tier: "T1-synthetic", project: { dir: t1.dir, projectId: t1.projectId, dataDir, counts: await counts(dataDir, t1.projectId) } })
  }
  // ── T2 ──────────────────────────────────────────────────────────────────
  {
    const t2Dir = ROOT
    const t2Data = path.join(ROOT, ".bb-data")
    const t2Id = getProjectId(t2Dir)
    const before = sqliteFileStats(t2Data, t2Id)
    const t2Counts = await counts(t2Data, t2Id)
    // `counts` sets BB_DATA_DIR to the T2 dir; resolve the path AFTER that so the
    // recorded dbPath/dbBytes belong to the index that was actually measured.
    const dbPath = BrainDatabase.getDbPath(t2Id)
    out.tiers.push(await inProcess("T2-reference", t2Dir, t2Id, t2Data, {}))
    out.tiers.push(await mcpRoundTrip("T2-reference", t2Dir, t2Data, {}, 3))
    const after = sqliteFileStats(t2Data, t2Id)
    out.tiers.push({
      tier: "T2-reference",
      project: {
        dir: t2Dir, projectId: t2Id, dataDir: t2Data, counts: t2Counts, dbPath,
        dbBytes: existsSync(dbPath) ? statSync(dbPath).size : null,
        dbMtime: existsSync(dbPath) ? new Date(statSync(dbPath).mtimeMs).toISOString() : null,
      },
      dbFilesBefore: before, dbFilesAfter: after,
      concurrencyNote: "the fleet shares .bb-data and writes this index; T2 p50 is the honest warm figure and the db-file deltas are not attributable to this tool alone",
    })
  }

  out.tiers = out.tiers.map((t: any) => {
    if (!t.latency) return t
    const budget = t.tier.startsWith("T0") ? "T0_p95_ms" : t.tier.startsWith("T1") ? "T1_p95_ms" : "T2_p95_ms"
    return { ...t, budgetMs: (out.budgets as any)[budget], withinBudget: t.latency.p95 <= (out.budgets as any)[budget], withinClientTimeout: t.latency.p95 < out.budgets.clientTimeout_ms }
  })

  const file = writeEvidence("latency-A.json", out)
  console.log(file)
  for (const t of out.tiers) {
    if (t.latency) console.log(`${t.tier} ${t.method} p50=${t.latency.p50}ms p95=${t.latency.p95}ms budget=${t.budgetMs} within=${t.withinBudget} samples=${JSON.stringify(t.latency.samplesMs)}`)
    if (t.project) console.log(`${t.tier} counts=${JSON.stringify(t.project.counts)}`)
  }
}
await main()
