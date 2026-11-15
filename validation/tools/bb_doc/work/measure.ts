// validation/tools/bb_doc/work/measure.ts — Phase A latency baseline for bb_doc.
//
// One process per tier. The handler is the REAL registered handler from
// src/mcp/tool-handlers.ts; the index is a real bb index under BB_DATA_DIR.
// Warm = the tier's project index has been opened and one discarded call has
// completed in this process, so the measurement is the tool and not SQLite
// opening a 3.4 GB database for the first time (that first-call cost is
// recorded separately as `coldMs` because a client pays it too).
//
// Usage:
//   BB_DATA_DIR=... BB_NO_AUTO_REFRESH=1 bun validation/tools/bb_doc/work/measure.ts --tier T0
//   BB_DATA_DIR=... BB_NO_AUTO_REFRESH=1 bun validation/tools/bb_doc/work/measure.ts --tier T2
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const ALL_MODES = ["symbol", "file", "module", "feature", "api", "project", "coverage"] as const
type MeasureMode = (typeof ALL_MODES)[number]
const requestedModes = process.env.BB_DOC_MODES ? process.env.BB_DOC_MODES.split(",") as MeasureMode[] : [...ALL_MODES]
const MODES = ALL_MODES.filter((m) => requestedModes.includes(m))

type Tier = {
  tier: "T0" | "T1" | "T2"
  label: string
  projectPath: string
  targets: Partial<Record<(typeof MODES)[number], string | undefined>>
}

function tierFor(name: string): Tier {
  if (name === "T0") {
    return {
      tier: "T0",
      label: "test/fixtures/polyglot (ts-js, java-scala)",
      projectPath: path.join(REPO, "test/fixtures/polyglot"),
      targets: { symbol: "total", file: "ts-js/src/checkout.ts", module: "ts-js/src", feature: "checkout" },
    }
  }
  if (name === "T1") {
    return {
      tier: "T1",
      label: ".perf-fixtures/bb-scale/n100",
      projectPath: path.join(REPO, ".perf-fixtures/bb-scale/n100"),
      targets: { symbol: "classifyTier", file: "t0001_evidence_tier.ts", module: "t00", feature: "classifyTier" },
    }
  }
  return {
    tier: "T2",
    label: "this workspace's reference index (.bb-data, BB_DATA_DIR)",
    projectPath: REPO,
    targets: { symbol: "generateDocumentation", file: "src/intelligence/documentation/doc-engine.ts", module: "src/intelligence/documentation", feature: "documentation generation" },
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

const tierName = process.argv.includes("--tier") ? String(process.argv[process.argv.indexOf("--tier") + 1]) : "T0"
const tier = tierFor(tierName)
const RUNS = Number(process.env.BB_DOC_RUNS ?? 5)
const projectId = getProjectId(tier.projectPath)
const handler = createToolHandlers().bb_doc

type Row = { mode: string; runs: number[]; bytes: number[]; isError: boolean; coldMs: number | null; note: string }

async function call(mode: string, args: Record<string, unknown>): Promise<{ ms: number; bytes: number; isError: boolean }> {
  const t0 = performance.now()
  const r: any = await handler({ mode, ...args }, { projectPath: tier.projectPath, projectId } as any)
  const ms = performance.now() - t0
  const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { ms, bytes: text.length, isError: r?.isError === true }
}

const rows: Row[] = []
// The opening call is the cold one: DB open + schema/index setup for this
// project in this process. Recorded, never mixed into the warm series.
let coldMs: number | null = null
try {
  const warm = await call("project", {})
  coldMs = Math.round(warm.ms)
} catch (e: any) {
  coldMs = null
  console.error("cold call failed:", e?.message ?? String(e))
}

for (const mode of MODES) {
  const target = tier.targets[mode]
  const args: Record<string, unknown> = {}
  if (target !== undefined) args.target = target
  const runs: number[] = []
  const bytes: number[] = []
  let isError = false
  for (let i = 0; i < RUNS; i++) {
    const r = await call(mode, args)
    runs.push(Math.round(r.ms))
    bytes.push(r.bytes)
    isError = r.isError
  }
  rows.push({ mode, runs, bytes, isError, coldMs, note: target === undefined ? "no target (mode accepts omission)" : "" })
  console.log(`${tier.tier} ${mode}: runs=${runs.join(",")} bytes=${bytes.join(",")} isError=${isError}`)
}

const report = {
  modesMeasured: MODES,
  schemaVersion: 1,
  tool: "bb_doc",
  tier: tier.tier,
  tierLabel: tier.label,
  projectId,
  measuredAt: new Date().toISOString(),
  env: {
    BB_DATA_DIR: process.env.BB_DATA_DIR ?? "(default)",
    BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? "(unset)",
    command: `BB_DATA_DIR=${process.env.BB_DATA_DIR ?? ""} BB_NO_AUTO_REFRESH=1 bun validation/tools/bb_doc/work/measure.ts --tier ${tier.tier}`,
  },
  coldMs,
  runs: RUNS,
  rows: rows.map((r) => {
    const sorted = [...r.runs].sort((a, b) => a - b)
    return {
      mode: r.mode,
      runs: r.runs,
      bytes: r.bytes,
      isError: r.isError,
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      max: sorted[sorted.length - 1],
      note: r.note,
    }
  }),
}
console.log("REPORT " + JSON.stringify(report))
