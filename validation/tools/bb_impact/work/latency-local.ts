// T0/T1 latency measurement for bb_impact (charter §6): tiny polyglot fixture and
// the synthetic scale fixture, warm, 5 runs, p50/p95. Writes ONLY under
// validation/tools/bb_impact/. BB_DATA_DIR is set by the caller to the tool's own
// index dir; BB_NO_AUTO_REFRESH=1 keeps every measurement read-only.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const DEP_KINDS = ["calls", "instantiates", "extends", "implements"]
const h: any = createToolHandlers()

type TierResult = {
  tier: string
  subject: string
  indexDir: string
  projectId: string
  symbol: string
  calls: number
  warm: boolean
  runsMs: number[]
  p50Ms: number
  p95Ms: number
  outcome: Record<string, unknown>
}

function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]!
}

async function hubSymbol(pid: string): Promise<string> {
  const raw: any = await (BrainDatabase as any).getRawInstance(pid)
  const row = raw
    .prepare(
      "SELECT s.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id " +
        "WHERE r.project_id = ? AND r.relationship_type IN (" +
        DEP_KINDS.map(() => "?").join(",") +
        ") GROUP BY s.name ORDER BY n DESC LIMIT 1",
    )
    .get(pid, ...DEP_KINDS) as { name: string; n: number } | undefined
  if (!row) throw new Error(`no dependency hub in project ${pid}`)
  return row.name
}

async function measure(tier: string, subject: string, projectPath: string, pid: string): Promise<TierResult> {
  const symbol = await hubSymbol(pid)
  const ctx = { projectPath, projectId: pid }
  const callOnce = async () => {
    const t0 = performance.now()
    const r = await h.bb_impact({ symbol }, ctx)
    const ms = performance.now() - t0
    const parsed = JSON.parse(String(r.content[0].text))
    if (r.isError) throw new Error(`bb_impact error: ${String(r.content[0].text).slice(0, 200)}`)
    return { ms, parsed }
  }
  await callOnce() // warm-up
  await callOnce() // second warm-up: JIT + caches
  const runs: number[] = []
  let last: any = null
  for (let i = 0; i < 5; i++) {
    const r = await callOnce()
    runs.push(Number(r.ms.toFixed(1)))
    last = r.parsed
  }
  const sorted = [...runs].sort((a, b) => a - b)
  return {
    tier,
    subject,
    indexDir: process.env.BB_DATA_DIR ?? "",
    projectId: pid,
    symbol,
    calls: 5,
    warm: true,
    runsMs: runs,
    p50Ms: Number(percentile(sorted, 50).toFixed(1)),
    p95Ms: Number(percentile(sorted, 95).toFixed(1)),
    outcome: {
      shownCount: last?.shownCount,
      totalCountIfKnown: last?.totalCountIfKnown,
      truncated: last?.truncated,
      truncatedReason: last?.truncationReason,
      depthReached: last?.traversal?.depthReached,
      countVerification: last?.countVerification,
      freshness: last?.freshness && { fresh: last.freshness.fresh, stale: last.freshness.stale, missing: last.freshness.missing },
      autoRefresh: last?.autoRefresh ?? null,
    },
  }
}

async function indexFixture(dir: string): Promise<{ pid: string }> {
  const pid = getProjectId(dir)
  await indexProjectParallel(pid, dir, {})
  return { pid }
}

const results: TierResult[] = []

// T0 — test/fixtures/polyglot (ts-js)
const t0 = await indexFixture(path.join(ROOT, "test/fixtures/polyglot/ts-js"))
results.push(await measure("T0", "test/fixtures/polyglot/ts-js", path.join(ROOT, "test/fixtures/polyglot/ts-js"), t0.pid))

// T1 — .perf-fixtures/bb-scale/n100 (n50 fallback if absent)
const n100 = path.join(ROOT, ".perf-fixtures/bb-scale/n100")
const t1Dir = existsSync(n100) ? n100 : path.join(ROOT, ".perf-fixtures/bb-scale/n50")
const t1 = await indexFixture(t1Dir)
results.push(await measure("T1", path.relative(ROOT, t1Dir), t1Dir, t1.pid))

mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "latency-local.json"), JSON.stringify({ generatedAt: new Date().toISOString(), bbNoAutoRefresh: process.env.BB_NO_AUTO_REFRESH ?? null, command: "BB_DATA_DIR=validation/tools/bb_impact/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-local.ts", results }, null, 2) + "\n")
console.log(JSON.stringify(results, null, 2))
