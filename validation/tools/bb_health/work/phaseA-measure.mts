// Phase A latency baselines for bb_health (charter §6).
// Usage: BB_DATA_DIR=<abs> BB_NO_AUTO_REFRESH=1 node --import tsx phaseA-measure.mts
// Ensures the T0/T1 fixtures are indexed, then measures 5 warm default-argument
// calls per tier. T2 (.bb-data) is measured read-only and is NOT indexed here.
import { existsSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../../src/intelligence/health/health-provider"

const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const RUNS = Number(process.env.BB_MEASURE_RUNS ?? 5)
const dataDir = process.env.BB_DATA_DIR
if (!dataDir) throw new Error("BB_DATA_DIR must be set (isolated)")
if (process.env.BB_NO_AUTO_REFRESH !== "1") throw new Error("BB_NO_AUTO_REFRESH must be 1")

type Tier = { name: string; projectPath: string; index?: boolean; label: string }
const TIERS: Tier[] = [
  { name: "T0", projectPath: path.join(REPO, "test/fixtures/polyglot"), index: true, label: "test/fixtures/polyglot (5 files, ts-js + java-scala)" },
  { name: "T1", projectPath: path.join(REPO, ".perf-fixtures/bb-scale/n100"), index: true, label: ".perf-fixtures/bb-scale/n100 (100 files)" },
  { name: "T2", projectPath: REPO, index: false, label: "workspace .bb-data index" },
]

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

async function ensureIndexed(projectPath: string): Promise<string> {
  const projectId = getProjectId(projectPath)
  const dbPath = BrainDatabase.getDbPath(projectId)
  let files = 0
  if (existsSync(dbPath)) {
    try {
      const raw = await BrainDatabase.getRawInstance(projectId)
      files = Number((raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any)?.c ?? 0)
    } catch { files = 0 }
  }
  if (files === 0) {
    await indexProjectParallel(projectId as any, projectPath, {})
  }
  return projectId
}

const out: any = { schemaVersion: 1, tool: "bb_health", measuredAt: new Date().toISOString(), runs: RUNS, env: { BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH, BB_NO_AUTO_REFRESH_MEANING: "measurement reads; health never auto-refreshes" }, tiers: {} }

for (const tier of TIERS) {
  const projectId = tier.index ? await ensureIndexed(tier.projectPath) : getProjectId(tier.projectPath)
  // One untimed warm-up call, then RUNS measured calls.
  await getUnifiedHealth(projectId, tier.projectPath, {})
  const walls: number[] = []
  const reportTimings: any[] = []
  let report: any = null
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint()
    report = await getUnifiedHealth(projectId, tier.projectPath, {})
    walls.push(Number(process.hrtime.bigint() - t0) / 1e6)
    reportTimings.push(report.timing)
  }
  const sorted = [...walls].sort((a, b) => a - b)
  const text = formatUnifiedHealth(report)
  out.tiers[tier.name] = {
    label: tier.label,
    projectPath: tier.projectPath,
    projectId,
    counts: report.counts,
    freshness: { mode: report.freshness.mode, checked: report.freshness.checked, total: report.freshness.total },
    wallMs: walls.map((w) => Math.round(w)),
    p50Ms: Math.round(pct(sorted, 50)),
    p95Ms: Math.round(pct(sorted, 95)),
    minMs: Math.round(sorted[0]),
    maxMs: Math.round(sorted[sorted.length - 1]),
    reportTimingMedian: { totalMs: report.timing.totalMs, aggregatesMs: report.timing.aggregatesMs, freshnessMs: report.timing.freshnessMs },
    thisCallLine: text.split("\n").find((l: string) => l.startsWith("this call:")) ?? null,
    textBytes: Buffer.byteLength(text, "utf8"),
    warnings: report.warnings.map((w: any) => `${w.severity}:${w.code}`),
  }
  console.log(`${tier.name}: p50=${out.tiers[tier.name].p50Ms}ms p95=${out.tiers[tier.name].p95Ms}ms walls=[${walls.map((w) => Math.round(w)).join(",")}]`)
}
console.log(JSON.stringify(out, null, 2))
