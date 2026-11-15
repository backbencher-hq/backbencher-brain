// T2 default-shape budget probe: the same shape the release battery measures —
// `bb_security({})` (live scan) against the shared 3.6 GB reference index,
// in-process through the handler map, one warm-up run + measured warm runs.
// Records runtime, counts, db size/mtime, loadavg and the full text head so a
// budget verdict can be checked rather than trusted.
import { readFileSync, statSync } from "node:fs"
import { cpus, loadavg } from "node:os"
import path from "node:path"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const DATA = path.join(ROOT, ".bb-data")
process.env.BB_DATA_DIR = DATA
process.env.BB_NO_AUTO_REFRESH = "1"

const projectId = getProjectId(ROOT)
const dbPath = path.join(DATA, "projects", projectId, "brain.db")
const stat = () => {
  const s = statSync(dbPath)
  return { bytes: s.size, mtimeMs: s.mtimeMs }
}

const MEASURED = Number(process.env.MEASURED_RUNS ?? 8)
const WARMUP = Number(process.env.WARMUP_RUNS ?? 1)

async function main() {
  const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
  const ctx = { projectPath: ROOT, projectId }
  const before = stat()
  const load = loadavg().slice(0, 3)
  const runtime = `${process.release?.name ?? "node"} ${process.version}${(globalThis as any).Bun ? ` (bun ${(globalThis as any).Bun.version})` : ""}`

  const warm: number[] = []
  for (let i = 0; i < WARMUP; i++) {
    const t0 = performance.now()
    const r = await handlers.bb_security({}, ctx)
    warm.push(Math.round(performance.now() - t0))
    if (r?.isError) throw new Error("warm-up refused: " + String(r?.content?.[0]?.text ?? "").slice(0, 200))
  }
  const runs: number[] = []
  let text = ""
  for (let i = 0; i < MEASURED; i++) {
    const t0 = performance.now()
    const r = await handlers.bb_security({}, ctx)
    runs.push(Math.round(performance.now() - t0))
    text = String(r?.content?.[0]?.text ?? "")
  }
  const after = stat()
  const sorted = [...runs].sort((a, b) => a - b)
  const p50 = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
  const report = {
    schemaVersion: 1,
    tool: "bb_security",
    shape: "default live scan, in-process handler",
    runtime,
    node: process.version,
    bun: (globalThis as any).Bun?.version ?? null,
    cpus: cpus().length,
    loadavg: load,
    projectId,
    dbPath: path.relative(ROOT, dbPath),
    dbBefore: before,
    dbAfter: after,
    dbUnchanged: before.bytes === after.bytes && before.mtimeMs === after.mtimeMs,
    warmupRuns: WARMUP,
    warmupMs: warm,
    measuredRuns: MEASURED,
    runsMs: runs,
    p50Ms: p50,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1],
    minMs: sorted[0],
    budgetMs: 5000,
    withinBudget: p95 <= 5000,
    outputBytes: Buffer.byteLength(text),
    head: text.split("\n").slice(0, 2).join("\n"),
    census: (text.match(/\[scan:[^\n]*/) ?? [""])[0],
  }
  console.log(JSON.stringify(report, null, 2))
}

await main()
