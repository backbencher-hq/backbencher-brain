// script/profile/report-post.mts — turn the DISCARDED Proxy run into the tables
// REPORT.md quotes, with the PROFILER'S OWN queries removed.
//
//   npx tsx script/profile/report-post.mts
//
// WHY THE SUBTRACTION IS NOT OPTIONAL. The profiler counts rows at every phase
// edge by calling `SELECT COUNT(*)` through the same instrumented handle. Those
// are the profiler's queries, not the product's, and they are not free: a
// COUNT(*) over 630k rows with an index takes ~1.8s here, and 14 of them add
// up. Reporting them as product cost would credit the product with work this
// script did. They are identified by their exact SQL text and excluded.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ROOT } from "./lib.ts"

const res = JSON.parse(readFileSync(path.join(ROOT, "script/profile/results/post-pass-PROXIED-DISCARDED.json"), "utf8"))

/** SQL issued by THIS script's snapshots. Matched exactly, by design. */
const PROFILER_QUERIES = [
  "SELECT COUNT(*) c FROM brain_file",
  "SELECT COUNT(*) c FROM brain_symbol",
  "SELECT COUNT(*) c FROM brain_relationship",
  "SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id IS NOT NULL AND target_symbol_id != ''",
  "SELECT COUNT(*) c FROM brain_relationship WHERE metadata IS NOT NULL",
  "SELECT COUNT(*) c FROM brain_taint_flow",
  "SELECT COUNT(*) c FROM brain_semantic_embedding",
]

const isProfilerQuery = (sample: string) => PROFILER_QUERIES.some((q) => sample === q)

const self = res.topStatements.filter((s: any) => isProfilerQuery(s.sample))
const selfMs = self.reduce((a: number, s: any) => a + s.ms, 0)
const selfCalls = self.reduce((a: number, s: any) => a + s.calls, 0)
const product = res.topStatements.filter((s: any) => !isProfilerQuery(s.sample))

console.log(`corpus: ${res.corpus.before.files.toLocaleString()} files / ${res.corpus.before.symbols.toLocaleString()} symbols / ${res.corpus.before.relationships.toLocaleString()} relationships`)
console.log(`wall ${(res.wallMs / 1000).toFixed(1)}s | reported totalMs ${(res.reportedTotalMs / 1000).toFixed(1)}s | window drift ${(res.windowReconstruction.drift * 100).toFixed(1)}% (${res.windowReconstruction.reliable ? "reliable" : "UNRELIABLE"})`)
console.log(`total SQL ${(res.totalSqlMs / 1000).toFixed(1)}s, of which ${(selfMs / 1000).toFixed(1)}s (${selfCalls} calls) is the PROFILER's own COUNT(*) snapshots — excluded below`)
console.log(`net product SQL ${((res.totalSqlMs - selfMs) / 1000).toFixed(1)}s of ${(res.wallMs / 1000).toFixed(1)}s wall`)
console.log(`peak RSS ${res.peakRssMiB} MiB`)

console.log(`\n=== PHASES ===`)
console.log(`  ${"phase".padEnd(15)}${"ms".padStart(9)}${"%wall".padStart(8)}${"sql_ms".padStart(9)}${"nonsql".padStart(9)}  anchored`)
for (const w of res.windows) {
  console.log(`  ${w.name.padEnd(15)}${String(w.ms).padStart(9)}${((w.ms / res.wallMs) * 100).toFixed(1).padStart(7)}%${String(w.sqlMs).padStart(9)}${String(w.nonSqlMs).padStart(9)}  ${w.anchored ? "yes" : "no"}`)
}

console.log(`\n=== TOP PRODUCT STATEMENTS (profiler queries removed) ===`)
console.log(`  ${"ms".padStart(8)}${"%wall".padStart(8)}${"calls".padStart(7)}${"rows".padStart(10)}  statement`)
for (const s of product.slice(0, 18)) {
  console.log(`  ${String(s.ms).padStart(8)}${((s.ms / res.wallMs) * 100).toFixed(1).padStart(7)}%${String(s.calls).padStart(7)}${String(s.rows).padStart(10)}  ${s.sample.slice(0, 130)}`)
}

console.log(`\n=== PHASE OUTCOMES ===`)
for (const p of res.phases) console.log(`  ${p.name.padEnd(15)} ${String(p.ms).padStart(8)}ms  ${p.outcome}`)

console.log(`\n=== ROW COUNTS AT EACH PHASE EDGE ===`)
const keys = ["files", "symbols", "relationships", "attached", "enriched", "taints", "embeddings"] as const
console.log(`  ${"tag".padEnd(34)}${keys.map((k) => k.slice(0, 9).padStart(11)).join("")}`)
for (const s of res.snapshots) {
  console.log(`  ${String(s.tag).slice(0, 33).padEnd(34)}${keys.map((k) => String((s as any)[k]).padStart(11)).join("")}`)
}

const out = {
  wallMs: res.wallMs,
  reportedTotalMs: res.reportedTotalMs,
  windowReconstruction: res.windowReconstruction,
  profilerOverheadMs: selfMs,
  profilerOverheadCalls: selfCalls,
  netProductSqlMs: res.totalSqlMs - selfMs,
  nonSqlMs: res.wallMs - (res.totalSqlMs - selfMs),
  peakRssMiB: res.peakRssMiB,
  phases: res.phases,
  windows: res.windows,
  topProductStatements: product.slice(0, 20),
  snapshots: res.snapshots,
  corpus: res.corpus,
}
writeFileSync(path.join(ROOT, "script/profile/results/post-pass-summary.json"), JSON.stringify(out, null, 2))
console.log(`\nwrote ${path.join(ROOT, "script/profile/results/post-pass-summary.json")}`)