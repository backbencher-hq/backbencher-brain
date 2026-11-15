// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — measures the lexical-fallback route of bb_ask on a real index:
//   the content search that runs when no embedding clears the similarity floor, with
//   per-query wall time, match mode, truncation and the content words actually probed,
//   plus the cost of one full substring needle so the term budget is justified by a
//   measurement rather than by taste.
// WHICH TOOL IT SERVES — bb_ask (read; lexical fallback) via
//   src/intelligence/search/content-search.ts.
// WHY IT IS SHAPED THIS WAY — the 5 s release budget applies to a DEFAULT answer, so the
//   fallback route needs its own number, not an aggregate that hides it behind vector
//   calls. The needle figure is the unit cost the giant-corpus term budget trades against.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/lexical-latency.json (and the
//   T2-local row of LATENCY.json).
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/content-search.ts
//   (GIANT_TERM_BUDGET), src/intelligence/search/semantic-search.ts (keywordFallback),
//   docs/BB_ASK.md (measured latency).
//
// Usage:
//   BB_DATA_DIR=<dir> npx tsx validation/tools/bb_ask/work/lexical-latency.mts <projectDir> <out.json>
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { searchContent } from "../../../../src/intelligence/search/content-search"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) {
  console.error("usage: lexical-latency.mts <projectDir> <out.json>")
  process.exit(2)
}

const QUERIES = [
  "how does request handling work in this codebase",
  "where is the index lock acquired",
  "how are tool descriptors registered",
  "what parses the configuration file",
  "how does the search engine rank results",
]

const projectId = getProjectId(projectDir)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })

const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(projectId) as any).c
const runs: any[] = []
for (const query of QUERIES) {
  const t0 = performance.now()
  const result = await searchContent(projectId, query, { maxResults: 5 })
  const ms = Math.round((performance.now() - t0) * 10) / 10
  runs.push({
    query,
    ms,
    totalMatches: (result as any).totalMatches ?? null,
    matchMode: (result as any).matchMode ?? null,
    truncated: (result as any).truncated ?? null,
    probedTerms: (result as any).termMatch?.queryTerms ?? null,
    topMatched: (result as any).termMatch?.topMatched ?? null,
  })
}

// Unit cost: one FULL substring needle (rare term, no early LIMIT exit) across the four
// matchable columns — the work the giant-corpus term budget multiplies by term count.
const needleBase = "SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start,0)>0 AND name NOT LIKE '/%/%' AND "
const needle = "%acquired%"
const tNeedle = performance.now()
const needleMatches = (raw.prepare(needleBase + "(name LIKE ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE OR docstring LIKE ? COLLATE NOCASE OR source_text LIKE ? COLLATE NOCASE)").get(projectId, needle, needle, needle, needle) as any).c
const needleMs = Math.round((performance.now() - tNeedle) * 10) / 10

const sorted = runs.map((run) => run.ms).sort((a, b) => a - b)
const report = {
  schemaVersion: 1,
  tool: "bb_ask",
  title: "lexical fallback latency on a real index",
  generatedAt: new Date().toISOString(),
  currentCommit: (await import("node:child_process")).execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
  projectDir,
  indexSymbols: symbols,
  budgetMs: 5000,
  runs,
  p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
  p95: sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * 0.95))],
  max: sorted[sorted.length - 1],
  withinBudget: sorted[sorted.length - 1] < 5000,
  needleProbe: { term: "acquired", columns: 4, ms: needleMs, matches: needleMatches, note: "one full-corpus substring scan; the giant-corpus terms route probes at most GIANT_TERM_BUDGET=4 words per query" },
  limitations: [
    "Measured on an isolated copy of the reference index; the live shared index also pays for other processes' I/O.",
    "Page cache is cold for the first query in a process; the first row is retained and labelled by order.",
  ],
}
writeFileSync(path.resolve(projectDir.startsWith("/") ? outPath : outPath), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ p50: report.p50, p95: report.p95, max: report.max, withinBudget: report.withinBudget, needleMs, runs: runs.map((run) => `${run.ms}ms/${run.matchMode}/terms=${run.probedTerms?.length ?? 0}/trunc=${run.truncated}`) }, null, 1))
process.exit(report.withinBudget ? 0 : 1)
