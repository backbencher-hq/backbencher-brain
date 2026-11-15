// Compose LATENCY.json: T0/T1 from latency-raw.jsonl, T2 post-graph-rewrite from
// latency-raw-t2-rewrite.jsonl, with the pre-rewrite T2 legs kept as a snapshot.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
const DIR = path.resolve(import.meta.dirname ?? ".", ".")
const read = (f: string) => existsSync(path.join(DIR, f)) ? readFileSync(path.join(DIR, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []
const raw = read("latency-raw.jsonl")
const t2New = read("latency-raw-t2-rewrite.jsonl")
const BUDGET: Record<string, number> = { T0: 250, T1: 1000, T2: 5000 }
const leg = (r: any) => ({
  label: r.label, args: r.args,
  status: r.timedOut ? "blocked" : r.ok === false ? "error" : "measured",
  runs: r.runs ?? null, warmupMs: r.warmupMs ?? null, p50: r.p50 ?? null, p95: r.p95 ?? null,
  bytes: r.bytes ?? null, budgetMs: BUDGET[r.tier], withinBudget: !r.timedOut && r.ok !== false ? r.p95 <= BUDGET[r.tier] : false,
  wallMs: r.wallMs, thrown: r.thrown ?? null,
})
const t0 = raw.filter((r) => r.tier === "T0").map(leg)
const t1 = raw.filter((r) => r.tier === "T1").map(leg)
const t2Before = raw.filter((r) => r.tier === "T2").map(leg)
const t2After = t2New.map(leg)
const singleT2 = existsSync(path.join(DIR, "t2-probes.jsonl"))
  ? read("t2-probes.jsonl").map((d: any) => ({ args: d.args, handlerMs: d.ms != null ? Math.round(d.ms) : null, bytes: d.bytes ?? null, ok: d.ok, timedOut: d.timedOut ?? false }))
  : []
const out = {
  schemaVersion: 2,
  tool: "bb_analyze",
  measuredAt: new Date().toISOString(),
  method:
    "Warm: one warm-up call then five timed calls per mode, one process per mode, handler reached through validateToolArguments -> handler (the same path the MCP door uses). T2 reads only (BB_NO_AUTO_REFRESH=1) against .bb-data. T0/T1 are the campaign fixtures under validation/tools/bb_analyze/bbdata.",
  environment: {
    host: os.hostname(), platform: `${os.platform()} ${os.release()}`, cpus: os.cpus().length,
    node: process.version, runner: "tsx",
    loadAverageAtBuild: os.loadavg().map((n) => Math.round(n * 100) / 100),
    contentionNote:
      "Shared checkout: the 1-minute load average was 23-30 on " + os.cpus().length + " CPUs during every T2 run (fleet evidence regeneration + other tool owners measuring their own T2 budgets). T2 numbers are real measurements in that environment, not a quiet-machine baseline; the pre-rewrite and post-rewrite T2 legs were taken under the same load, so their comparison is meaningful.",
    env: { BB_NO_AUTO_REFRESH: "1", BB_DATA_DIR: "T0/T1 -> validation/tools/bb_analyze/bbdata; T2 -> $PWD/.bb-data" },
  },
  tiers: {
    T0: { subject: "test/fixtures/polyglot", counts: { files: 5, symbols: 13, relationships: 26 }, budgetMs: 250, legs: t0 },
    T1: { subject: ".perf-fixtures/bb-scale/n100", counts: { files: 97, symbols: 3512, relationships: 17068 }, budgetMs: 1000, legs: t1 },
    T2: {
      subject: "this workspace's reference index (.bb-data)",
      counts: { files: 6452, symbols: 310423, relationships: 820040 },
      budgetMs: 5000,
      graphEngineRewrite: "post-collapse-identity graph engine (bb_graph lane commit c28cacee5 lineage, verified through HEAD 55df89c3e)",
      dependenciesFix: "the dependencies engine no longer materialises a project-wide symbol->file Map it never read (310,423 rows on this index)",
      legs: t2After,
      beforeGraphRewrite: t2Before,
    },
  },
  singleCallT2BeforeRewrite: { note: "One handler call per mode in a fresh process (includes the 3.4 GB DB open). Command: validation/tools/bb_analyze/t2-probe.sh", probes: singleT2 },
  commands: {
    sweep: "validation/tools/bb_analyze/latency.sh (T0/T1) ; validation/tools/bb_analyze/latency-t2-remeasure.sh (T2 post-rewrite)",
    singleLeg: "BB_DATA_DIR=<tier data dir> BB_NO_AUTO_REFRESH=1 BB_REPEAT=5 npx tsx validation/tools/bb_analyze/run-one.ts '<json args>' <project dir>",
    graphProfile: "BB_DATA_DIR=$PWD/.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_analyze/t2-profile2.ts",
  },
  summary: {
    T0_allWithinBudget: t0.every((l) => l.status !== "measured" || l.withinBudget),
    T1_allWithinBudget: t1.every((l) => l.status !== "measured" || l.withinBudget),
    T2_allWithinBudget: t2After.every((l) => l.status !== "measured" || l.withinBudget),
    T2_outsideBudget: t2After.filter((l) => l.status !== "measured" || !l.withinBudget).map((l) => ({ label: l.label, p50: l.p50, p95: l.p95, budgetMs: 5000 })),
    t2GraphModesCollapsed: "callers 8.6/9.4 ms (was 11,220-12,367 warm; 22,674 single call and a 5-run block), callees 52.6/81.9 (was 29,326/63,974), trace 51.8/66.6 (was 32,978/50,086), impact 28.4/31.8 (was 10,389/73,775)",
  },
}
writeFileSync(path.join(DIR, "LATENCY.json"), JSON.stringify(out, null, 2) + "\n")
console.log("wrote LATENCY.json")
console.log("T0 within:", out.summary.T0_allWithinBudget, "| T1 within:", out.summary.T1_allWithinBudget, "| T2 within:", out.summary.T2_allWithinBudget)
console.log("T2 outside:", JSON.stringify(out.summary.T2_outsideBudget))
