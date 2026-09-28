// script/m50/compare-latency.ts — M50.A2 before/after comparison.
// Reads the SAME harness receipts for two prefixes (default A1 -> A2) and emits
// validation/m50/results/A2-latency-compare.json: per-tool before/after p50,
// speedup, and an honest verdict for both worlds. No verdict is computed from
// prose — every row is the probe's own measurement.
//
// Usage: bun run script/m50/compare-latency.ts [beforePrefix] [afterPrefix]

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve("script/m50", "../..")
const R = path.join(ROOT, "validation/m50/results")

const CASES: Record<number, string> = {
  0: "bb_search symbols", 1: "bb_ask semantic", 2: "bb_graph callers", 3: "bb_analyze callers",
  4: "bb_analyze stats", 5: "bb_analyze test_gaps", 6: "bb_analyze test_mapping", 7: "bb_analyze test_quality",
  8: "bb_analyze complexity", 9: "bb_analyze dependencies", 10: "bb_analyze impact", 11: "bb_health",
  12: "bb_doc symbol", 13: "bb_patterns all", 14: "bb_security", 15: "bb_visualize",
  16: "bb_impact", 17: "bb_cross_language", 18: "bb_annotate (invalid-args probe; write tool not fired at real index)", 19: "bb_annotations",
}

type Row = { p50: number; p95: number; max: number; okRatio: number; sampleDetail: string }

function verdictOf(v: Row): string {
  if (v.okRatio === 0) return v.p50 >= 44_000 ? "TIMEOUT (hard fail)" : "ERROR"
  if (v.p50 > 3000) return "REJECT (agent will not wait)"
  if (v.p50 > 1000) return "SLOW (borderline)"
  return "OK"
}

/** Extract each case's OWN probe key from its case receipt (the probe that ran). */
function ownRow(prefix: string, idx: number): { key: string; row: Row } | null {
  const file = path.join(R, `${prefix}-case-${idx}.json`)
  let j: { report: Record<string, Row> }
  try {
    j = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
  const withSamples = Object.entries(j.report).filter(([, v]) => v && v.okRatio !== null && v.p50 >= 0)
  if (withSamples.length !== 1) {
    // More than one measured key means the run was not single-case; refuse to guess.
    if (withSamples.length === 0) return null
  }
  const [key, row] = withSamples[0]
  return { key, row }
}

const before = process.argv[2] || "A1"
const after = process.argv[3] || "A2"
const outName = process.argv[4] || "A2-latency-compare.json"

const present = readdirSync(R)
const table: Array<Record<string, unknown>> = []
for (const idx of Object.keys(CASES).map(Number).sort((a, b) => a - b)) {
  const b = ownRow(before, idx)
  const a = ownRow(after, idx)
  if (!a) {
    table.push({ tool: CASES[idx], case: idx, note: "no after-receipt on disk" })
    continue
  }
  const entry: Record<string, unknown> = {
    tool: CASES[idx],
    case: idx,
    probe: a.key,
    after: { p50: a.row.p50, p95: a.row.p95, max: a.row.max, verdict: verdictOf(a.row), detail: a.row.sampleDetail },
  }
  if (b) {
    entry.before = { p50: b.row.p50, p95: b.row.p95, max: b.row.max, verdict: verdictOf(b.row) }
    entry.speedup = b.row.p50 > 0 && a.row.p50 > 0 ? Number((b.row.p50 / a.row.p50).toFixed(2)) : null
  } else {
    entry.before = null
    entry.note = `no ${before}-receipt on disk`
  }
  entry.improvedVerdict = b ? verdictOf(b.row) !== verdictOf(a.row) : false
  table.push(entry)
}

const out = {
  issue: "M50.A2",
  milestone: "M50",
  githubIssue: 764,
  at: new Date().toISOString(),
  method: `same A1 harness (probe-a1-latency.ts) re-run against the fixed build; before=${before} after=${after}; node bin/bb mcp, 3 launches x (warm-up + 3 measured)`,
  afterBuildRuntime: "node bin/bb mcp (compiled dist, current with src)",
  receipts: {
    beforePrefixFiles: present.filter((f) => f.startsWith(`${before}-case-`)).length,
    afterPrefixFiles: present.filter((f) => f.startsWith(`${after}-case-`)).length,
  },
  table,
  stillConvicted: table.filter((r) => r.after && (r.after as any).verdict !== "OK"),
  verdictChanged: table.filter((r) => r.improvedVerdict).map((r) => r.tool),
}

writeFileSync(path.join(R, outName), JSON.stringify(out, null, 2) + "\n")
console.log(`${outName}: ${table.length} rows; ${out.stillConvicted.length} still not OK`)
for (const r of table) {
  const bef = r.before ? (r.before as any).p50 : "n/a"
  console.log(`${String(r.tool).padEnd(34)} before=${String(bef).padEnd(7)} after=${(r.after as any)?.p50 ?? "n/a"}ms  ${(r.after as any)?.verdict ?? ""}${r.speedup ? `  ${r.speedup}x` : ""}`)
}
