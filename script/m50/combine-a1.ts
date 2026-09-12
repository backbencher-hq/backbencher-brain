// script/m50/combine-a1.ts — merge A1-case-*.json into the A1 evidence file.
// Every conviction names its measured numbers; no prose-only verdicts.
// Usage: bun run script/m50/combine-a1.ts

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
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

const rows: Array<{ tool: string; probe: string; p50: number; p95: number; max: number; okRatio: number; verdict: string }> = []
const seen = new Set<string>()
for (const f of readdirSync(R).filter((f) => /^A1-case-\d+\.json$/.test(f)).sort()) {
  const idx = Number(f.match(/A1-case-(\d+)\.json/)![1])
  const j = JSON.parse(readFileSync(path.join(R, f), "utf8"))
  // Each case file contains measurements for ALL probes (the full CASES list
  // ran in that process); the case's OWN probe key is the one whose args
  // prefix matches this case's recorded args. Match on tool-name + args
  // prefix from the CASES label (first two words: tool + distinguishing arg).
  const label = CASES[idx] ?? ""
  const primary = label.split(" ")[0]
  // Find this case's exact key: prefer the key containing the label's second word.
  const second = label.split(" ")[1] ?? ""
  const candidates = Object.keys(j.report).filter((k) => k.startsWith(primary + " "))
  const own = candidates.find((k) => second && k.includes(second)) ?? candidates[0]
  if (!own || seen.has(own + "#" + idx)) continue
  seen.add(own + "#" + idx)
  const v = j.report[own]
  const p50 = v.p50
  const verdict = !v.okRatio ? (p50 >= 44000 ? "TIMEOUT (hard fail)" : "ERROR") : p50 > 3000 ? "REJECT (agent will not wait)" : p50 > 1000 ? "SLOW (borderline)" : "OK"
  rows.push({ tool: CASES[idx] ?? own, probe: own, p50, p95: v.p95, max: v.max, okRatio: v.okRatio, verdict })
}

const A1 = {
  // M50.G1 evidence contract: numeric issue, status vocabulary, pass/fail
  // counters and a commit stamp. A1 is a MEASUREMENT, so its counters are the
  // number of tools probed and the number that came back ERROR/TIMEOUT — the
  // honest "failed" axis for an issue whose deliverable is the census itself.
  issue: 763,
  milestone: "M50",
  status: "measured",
  passed: rows.filter((r) => r.verdict !== "ERROR" && r.verdict !== "TIMEOUT (hard fail)").length,
  failed: rows.filter((r) => r.verdict === "ERROR" || r.verdict === "TIMEOUT (hard fail)").length,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  at: new Date().toISOString(),
  runtime: "node bin/bb mcp (production shape), fresh process per launch, warm-up + 3 measured calls x3 launches (per-call timeout 45s unless noted)",
  repoIndexState: {
    note: "CRITICAL context discovered during A1: the repo resolves to projectId 1d3d57103be91b8f9716d70199fe28a3f39245d9 whose brain.db is 816MB (3,040 files / 168,705 symbols / 172,869 relationships). A SECOND, EMPTY db (1d3d57103be91b8f9716d70199f0cd63, 0 rows) also existed from earlier probing. All latency numbers below are against the REAL 816MB index — the honest production shape.",
    splitBrain: "Two project ids for the same repo existed simultaneously (one empty). Root cause of the empty one: earlier probes created a BB_DATA_DIR-era DB; every fresh MCP server process re-derived the id and opened the REAL one. No code defect implicated for the split itself, but the empty DB masked real costs during earlier ad-hoc tests.",
  },
  table: rows,
  convictions: [
    { tool: "bb_patterns", p50: "90006 (TIMEOUT at 90s)", evidence: "A1-case-13.json + stdio probes timing out at 45s/90s/100s; in-process on the real DB it also does not return in 100s; raw SQL reconstruction on the real DB: usage-row load 1.7s + 37,281 symbols scanned + 0.4s loop — the handler runs the FULL pattern scan per call and materializes 33,603 findings (>90% of the codebase flagged) before slicing to the 20-item display", rootCause: "O(all symbols) full-pattern scan per call + finding-volume explosion; at this scale the answer is useless even if it returned" },
    { tool: "bb_graph", p50: 18859, evidence: "A1-case-2.json (18.4–20.7s warm); reconstructed name-join walk on the real DB: 3 hops / 1,496 nodes = 334,931ms — the engine's per-hop symbol-NAME join shape scales catastrophically on 168k symbols", rootCause: "per-hop name-join traversal (not id-keyed adjacency); each hop re-scans relationship joins" },
    { tool: "bb_analyze complexity", p50: 2895, evidence: "A1-case-8.json (2.6–11.6s warm, high variance — filesystem-stat dependent)", rootCause: "per-call complexity aggregation across all 3,040 files with per-file stat/hash work" },
    { tool: "bb_ask", p50: 4827, evidence: "A1-case-1.json (4.7–4.8s warm)", rootCause: "embedding-provider round-trip inside the call path; re-ranking over 168k symbol vectors" },
    { tool: "bb_analyze test_gaps / test_mapping", p50: 1584, evidence: "A1-case-5/6.json (1.5–1.9s warm)", rootCause: "full mapping join over 37k production symbols + 50k usage rows per call" },
    { tool: "parameter-shape divergence", p50: 0, evidence: "bb_graph + bb_impact + bb_cross_language take `symbol`; bb_analyze takes `target`; bb_search takes `query`. Probe guess-errors recorded verbatim: 'unknown or irrelevant options: target, direction' (bb_graph), 'unknown or irrelevant options: target' (bb_impact), 'unknown or irrelevant options: query' (bb_cross_language). With correct args all three are fast (551/195ms).", rootCause: "graph-family tools use a different parameter vocabulary than analyze/search; every wrong guess is an error round-trip an agent learns from" },
  ],
  fast: rows.filter((r) => r.verdict === "OK").map((r) => `${r.tool} (${r.p50}ms)`),
  acceptanceNote:
    "This file is the A1 evidence: convictions above are A2's worklist. No fixes are claimed here. `passed`/`failed` count probe verdicts that returned vs ERROR/TIMEOUT — for a measurement issue that is the honest axis (the convictions ARE the output).",
  verifierCommand: "bun run script/m50/probe-a1-latency.ts <caseIdx> (x20) && bun run script/m50/combine-a1.ts",
}

mkdirSync(R, { recursive: true })
writeFileSync(path.join(R, "A1.json"), JSON.stringify(A1, null, 2) + "\n")
console.log(`A1.json written: ${rows.length} rows, ${A1.convictions.length} convictions`)
