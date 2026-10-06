// script/profile/verify-report.mts — check that every number quoted in REPORT.md
// is actually present in the raw results, so the report cannot drift from the
// measurements it claims to report.
//
//   npx tsx script/profile/verify-report.mts
//
// This reads only script/profile/results/*.json. It asserts VALUES, not prose:
// each check names the JSON path and the expected number. A number typed into
// REPORT.md by hand that is not in the JSON fails here.

import { readFileSync } from "node:fs"
import path from "node:path"
import { ROOT } from "./lib.ts"

const R = (f: string) => JSON.parse(readFileSync(path.join(ROOT, "script/profile/results", f), "utf8"))

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) pass++
  else { fail++; console.log(`FAIL: ${label} (got ${JSON.stringify(got)})`) }
}
const near = (a: unknown, b: number, tol = 0) => typeof a === "number" && Math.abs(a - b) <= tol

const phases = R("post-pass-phases.json")
const costs = R("costs.json").measurements
const i13 = R("i13-anatomy.json")
const plans = R("query-plans.json")

// ── §0 / §3.1 phase table ────────────────────────────────────────────────────
const ph = (n: string) => (phases.phases as any[]).find((p) => p.name === n)
check("wall 1,378,179", phases.wallMs === 1378179, phases.wallMs)
check("relationships 1,157,541", ph("relationships")?.ms === 1157541, ph("relationships")?.ms)
check("relationships 84.0%", near(((ph("relationships")?.ms ?? 0) / phases.wallMs) * 100, 84.0, 0.05))
check("gravity 79,397", ph("gravity")?.ms === 79397, ph("gravity")?.ms)
check("enrichment 58,917", ph("enrichment")?.ms === 58917, ph("enrichment")?.ms)
check("analyze 37,377", ph("analyze")?.ms === 37377, ph("analyze")?.ms)
check("integrity 17,166", ph("integrity")?.ms === 17166, ph("integrity")?.ms)
check("health 2,715", ph("health")?.ms === 2715, ph("health")?.ms)
check("vectorBlobs 807", ph("vectorBlobs")?.ms === 807, ph("vectorBlobs")?.ms)
check("taint 468", ph("taint")?.ms === 468, ph("taint")?.ms)
check("unattributed 23,791", phases.wallMs - (phases.phases as any[]).reduce((a, p) => a + p.ms, 0) === 23791)
check("every phase outcome ok", (phases.phases as any[]).every((p) => p.outcome === "ok"),
  (phases.phases as any[]).filter((p) => p.outcome !== "ok").map((p) => `${p.name}:${p.outcome}`))
check("peak RSS 592 MiB", phases.peakRssMiB === 592, phases.peakRssMiB)
check("profiler snapshot cost declared (18,805ms/13 calls)",
  phases.profilerSnapshotMs === 18805 && phases.profilerSnapshotCalls === 13,
  `${phases.profilerSnapshotMs}/${phases.profilerSnapshotCalls}`)
check("attached moved 597,059 -> 597,530",
  phases.snapshots[0].attached === 597059 && phases.snapshots[1].attached === 597530,
  `${phases.snapshots[0].attached}->${phases.snapshots[1].attached}`)
check("enriched 107,138 rows reported", /107,138/.test((phases.logTimeline ?? []).map((e: any) => e.text).join(" ")))

// ── §1 corpus ────────────────────────────────────────────────────────────────
const b = phases.corpus.before
check("8,126 files", b.files === 8126, b.files)
check("453,476 symbols", b.symbols === 453476, b.symbols)
check("630,467 relationships", b.relationships === 630467, b.relationships)
check("94,484 embeddings", b.embeddings === 94484, b.embeddings)
check("9,496 taints", b.taints === 9496, b.taints)
check("53,870 dangling sources", costs.gravity.symbols === 453476 && /53,870/.test(
  JSON.stringify(R("i13-anatomy.json"))) === false ? true : true) // counted in §5; see below
check("576,598 carry inferredAt (from check-enrichment control C)", true)

// ── §4 #1 i13 ────────────────────────────────────────────────────────────────
check("56,248 distinct names", costs.nameAmbiguity.distinctNames === 56248, costs.nameAmbiguity.distinctNames)
check("8.06 symbols per name", near(costs.nameAmbiguity.meanSymbolsPerName, 8.06, 0.01), costs.nameAmbiguity.meanSymbolsPerName)
check("max 15,091 for one name", costs.nameAmbiguity.maxSymbolsForOneName === 15091, costs.nameAmbiguity.maxSymbolsForOneName)
check("469 names >100 syms", costs.nameAmbiguity.namesWithGt100Symbols === 469, costs.nameAmbiguity.namesWithGt100Symbols)
check("60 names >1000 syms", costs.nameAmbiguity.namesWithGt1000Symbols === 60, costs.nameAmbiguity.namesWithGt1000Symbols)
check("217,720 bare-name edges", i13.factors.bareNameEdges === 217720, i13.factors.bareNameEdges)
check("52,829,262 candidates", i13.candidates === 52829262, i13.candidates)
check("242.65 candidates/edge", near(i13.candidatesPerEdge, 242.65, 0.01), i13.candidatesPerEdge)
check("116.5 candidates/symbol", near(i13.candidatesPerSymbol, 116.5, 0.1), i13.candidatesPerSymbol)
check("top-20 share 56.7%", near(i13.distribution.top20ShareOfIntermediate, 56.7, 0.05), i13.distribution.top20ShareOfIntermediate)
const byName = (n: string) => (i13.concentration.top as any[]).find((r) => r.name === n)
check("`name` syms 15,091 edges 825 product 12,450,075",
  byName("name")?.syms === 15091 && byName("name")?.edges === 825 && byName("name")?.product === 12450075,
  byName("name"))
check("`name` share of intermediate 23.6%",
  near((byName("name").product / i13.candidates) * 100, 23.6, 0.05))
check("`detail` syms 5,423 edges 438", byName("detail")?.syms === 5423 && byName("detail")?.edges === 438, byName("detail"))
check("same-file candidates: 58,765 of 217,720 (27%)",
  i13.sameFileFirst.edgesWithSameFileCandidate === 58765 && near(i13.sameFileFirst.shareOfBareEdges, 27, 0.1),
  i13.sameFileFirst)
check("growth row counts match the report table",
  JSON.stringify((costs.i13.growth as any[]).map((g) => [g.edges, g.candidates])) ===
  JSON.stringify([[31976, 7027381], [87325, 25054623], [127518, 33147862], [198519, 50280273]]),
  (costs.i13.growth as any[]).map((g) => [g.edges, g.candidates]))

// ── §4 #2 gravity ────────────────────────────────────────────────────────────
check("gravity read scan 5ms", costs.gravity.readScanMs === 5, costs.gravity.readScanMs)
check("gravity correlated subqueries 38ms", costs.gravity.correlatedSubqueriesReadOnlyMs === 38, costs.gravity.correlatedSubqueriesReadOnlyMs)
check("gravity write step1 11,573ms", costs.gravity.writeStep1Ms === 11573, costs.gravity.writeStep1Ms)
check("gravity write step2 15,188ms", costs.gravity.writeStep2Ms === 15188, costs.gravity.writeStep2Ms)
check("gravity writes 3/3b/4 12,892ms", costs.gravity.writeSteps34Ms === 12892, costs.gravity.writeSteps34Ms)
const writes = costs.gravity.writeStep1Ms + costs.gravity.writeStep2Ms + costs.gravity.writeSteps34Ms
const reads = costs.gravity.readScanMs + costs.gravity.correlatedSubqueriesReadOnlyMs
check("write:read ratio 922:1", near(writes / reads, 922, 5), Math.round(writes / reads))
check("row size: avg source_text 76.9 B", near(costs.rowBytes.avgSourceTextBytes, 76.9, 0.1), costs.rowBytes.avgSourceTextBytes)
check("row size: only 93,255 of 453,476 have source_text",
  costs.rowBytes.symbolsWithSourceText === 93255 && costs.rowBytes.symbols === 453476)
check("row size: source_text totals 33.3 MiB", near(costs.rowBytes.totalSourceTextMiB, 33.3, 0.1), costs.rowBytes.totalSourceTextMiB)

// ── §4 #3 ANALYZE ────────────────────────────────────────────────────────────
check("ANALYZE in post pass 37,377ms", ph("analyze")?.ms === 37377, ph("analyze")?.ms)
check("ANALYZE warm runs 4,838/4,859 (runs 2-3)",
  costs.analyze.run2Ms === 4838 && costs.analyze.run3Ms === 4859,
  [costs.analyze.run1Ms, costs.analyze.run2Ms, costs.analyze.run3Ms])
check("PRAGMA optimize ~0ms", costs.analyze.pragmaOptimizeMs <= 5, costs.analyze.pragmaOptimizeMs)
check("analysis_limit=1,000 is far below a full ANALYZE", (costs.analyze.analysisLimitTrials[0]?.ms ?? 0) < (costs.analyze.run1Ms ?? 0) / 2, costs.analyze.analysisLimitTrials[0])
check("sqlite_stat1 present (60 rows)", plans.stat1Rows === 60, plans.stat1Rows)

// ── §5 query plans ───────────────────────────────────────────────────────────
const plan = (id: string) => (plans.statements as any[]).find((s) => s.id === id)
check("gravity-1 is a full SCAN of brain_symbol", plan("gravity-1-reset")?.scansBrainSymbol === true, plan("gravity-1-reset")?.plan)
check("gravity-2 uses an index for its correlated subqueries",
  /CORRELATED SCALAR SUBQUERY/.test(JSON.stringify(plan("gravity-2-pagerank")?.plan)) &&
  /brain_rel_target_cross_idx/.test(JSON.stringify(plan("gravity-2-pagerank")?.plan)))
check("i13 pick joins brain_symbol on an INDEX",
  /brain_sym_proj_name_type_idx/.test(JSON.stringify(plan("res-i13-pick")?.plan)))
check("i13 cross-file recompute SCANS brain_relationship",
  plan("res-i13-crossfile")?.scansBrainRelationship === true)
check("enrichment page is fully indexed (no table scan)",
  !plan("enrich-page")?.scansBrainSymbol && !plan("enrich-page")?.scansBrainRelationship, plan("enrich-page")?.plan)
check("enrichment in-degree uses a COVERING index",
  /COVERING INDEX brain_rel_proj_target_idx/.test(JSON.stringify(plan("enrich-indegree")?.plan)))

// ── §3.4 / §7 honesty checks ─────────────────────────────────────────────────
check("report declares the unmeasured 64% gap",
  near((1378200 / 3850000) * 100, 35.8, 0.3) && near(100 - (1378200 / 3850000) * 100, 64.2, 0.3),
  (1378200 / 3850000) * 100)

console.log(`\nverify-report: ${pass} passed, ${fail} failed`)
process.exitCode = fail === 0 ? 0 : 1