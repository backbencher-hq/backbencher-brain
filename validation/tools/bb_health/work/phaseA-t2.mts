// Phase A T2 baseline: warm default-argument calls on the workspace .bb-data index.
// Usage: BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 node --import tsx phaseA-t2.mts
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../../src/intelligence/health/health-provider"

const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const RUNS = Number(process.env.BB_MEASURE_RUNS ?? 5)
const projectPath = REPO
const projectId = getProjectId(projectPath)
const walls: number[] = []
const timings: any[] = []
let report: any = null
for (let i = 0; i <= RUNS; i++) {
  const t0 = process.hrtime.bigint()
  report = await getUnifiedHealth(projectId, projectPath, {})
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  if (i === 0) { console.log(`warmup=${Math.round(ms)}ms`); continue }
  walls.push(ms); timings.push(report.timing)
}
const sorted = [...walls].sort((a, b) => a - b)
const pct = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))])
const text = formatUnifiedHealth(report)
const out = {
  schemaVersion: 1, tool: "bb_health", tier: "T2",
  label: "workspace index at .bb-data (charter reference large tier)",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 node --import tsx validation/tools/bb_health/work/phaseA-t2.mts",
  runs: RUNS, measuredAt: new Date().toISOString(),
  projectId, projectPath,
  counts: report.counts,
  freshness: { mode: report.freshness.mode, requestedMode: report.freshness.requestedMode, checked: report.freshness.checked, total: report.freshness.total, fresh: report.freshness.fresh, stale: report.freshness.stale, missing: report.freshness.missing, reasons: report.freshness.reasons.byKind },
  wallMs: walls.map((w) => Math.round(w)),
  p50Ms: pct(50), p95Ms: pct(95), minMs: Math.round(sorted[0]), maxMs: Math.round(sorted[sorted.length - 1]),
  reportTiming: timings.map((t: any) => ({ totalMs: t.totalMs, aggregatesMs: t.aggregatesMs, freshnessMs: t.freshnessMs })),
  thisCallLine: text.split("\n").find(l => l.startsWith("this call:")) ?? null,
  warnings: report.warnings.map((w: any) => `${w.severity}:${w.code}`),
  textBytes: Buffer.byteLength(text, "utf8"),
}
console.log(JSON.stringify(out, null, 2))
