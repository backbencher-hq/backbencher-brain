// script/profile/profile-post.mts — WHERE DOES INDEX TIME ACTUALLY GO?
//
//   npx tsx script/profile/profile-post.mts [--keep] [--repeat 2]
//
// Runs the REAL `runPostProcessing` over a COPY of the real repo index and
// reports the per-phase wall clock the product itself records, with row counts
// at every phase edge.
//
// WHY THERE IS NO SQL PROFILER HERE. An earlier revision wrapped
// `BrainDatabase.getRawInstance` in a Proxy to time every statement. It worked
// for six of the eight phases and BROKE the seventh: `enrichRelationships`
// threw after 2 ms under the Proxy and took 54 s without it (measured, both
// ways — see check-enrichment.mts). better-sqlite3 11.10.0 exposes no
// `db.trace`, so there is no hook that observes statements without changing the
// object's behaviour.
//
// So this script does NOT touch the product's DB handle at all. It reports only
// what the product measures itself, which is trustworthy by construction:
// `runPostProcessing` returns `PostProcessingPhaseTiming[]` and it is the same
// number the CLI prints. Statement-level costs are measured SEPARATELY, by
// running the statements directly against a copy (measure-costs.mts), where no
// product code is involved.
//
// Row counts are taken through a SEPARATE read-only handle so that the counting
// can neither alter nor be attributed to the product's connection.
//
// SAFETY: the real index is copied first; nothing in the user's ~/.bb is
// opened for writing.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { ROOT, stageCorpus, freeMiB } from "./lib.ts"

const argv = process.argv.slice(2)
const argOf = (k: string, d: string) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const has = (k: string) => argv.includes(k)
const SRC_PID = argOf("--src", "818db37d8f54173ad1357ab24627373da2e9418c")
const REPEAT = Number(argOf("--repeat", "1"))

type Counts = {
  tag: string; files: number; symbols: number; relationships: number
  attached: number; enriched: number; taints: number; embeddings: number
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "bb-profile-post-"))
  process.env.BB_DATA_DIR = dataDir
  const free = freeMiB(tmpdir())
  if (Number.isFinite(free) && free < 12_000) {
    console.log(`ABORT: need ~12 GiB free on the volume holding the copy, found ${free} MiB`)
    process.exitCode = 1
    return
  }

  console.log(`staging corpus ${SRC_PID} -> ${dataDir}`)
  stageCorpus(SRC_PID, dataDir)

  const dbPath = path.join(dataDir, "projects", SRC_PID, "brain.db")
  // A separate, read-only handle for counting. Never the product's.
  const counter = new DatabaseSync(dbPath, { readOnly: true })
  const snap = (tag: string): Counts => {
    const one = (sql: string) => {
      const t = process.hrtime.bigint()
      let v = 0
      try { v = Number((counter.prepare(sql).get() as any)?.c ?? 0) } catch { v = -1 }
      return { v, ms: Number(process.hrtime.bigint() - t) / 1e6 }
    }
    return {
      tag,
      files: one("SELECT COUNT(*) c FROM brain_file").v,
      symbols: one("SELECT COUNT(*) c FROM brain_symbol").v,
      relationships: one("SELECT COUNT(*) c FROM brain_relationship").v,
      attached: one("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id IS NOT NULL AND target_symbol_id != ''").v,
      enriched: one("SELECT COUNT(*) c FROM brain_relationship WHERE metadata IS NOT NULL").v,
      taints: one("SELECT COUNT(*) c FROM brain_taint_flow").v,
      embeddings: one("SELECT COUNT(*) c FROM brain_semantic_embedding").v,
    }
  }

  const { runPostProcessing } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  const before = snap("before")
  console.log(`corpus: ${before.files.toLocaleString()} files / ${before.symbols.toLocaleString()} symbols / ${before.relationships.toLocaleString()} relationships / ${before.enriched.toLocaleString()} enriched`)

  const logEvents: Array<{ at: number; text: string }> = []
  const snapshots: Counts[] = []
  const rss: Array<{ at: number; rss: number; heap: number }> = []
  let snapCostMs = 0
  let sampleCostMs = 0

  const logger = {
    log: (...a: unknown[]) => {
      const text = a.map((x) => String(x)).join(" ")
      logEvents.push({ at: Date.now(), text })
      const t = process.hrtime.bigint()
      snapshots.push(snap(text.trim().slice(0, 56)))
      snapCostMs += Number(process.hrtime.bigint() - t) / 1e6
      const m = process.memoryUsage()
      rss.push({ at: Date.now(), rss: m.rss, heap: m.heapUsed })
    },
    // The enrichment progress bar writes here; on a pipe it emits a line per
    // milestone. Recorded (not printed) so the log is a usable phase timeline.
    write: (s: string) => {
      const now = Date.now()
      for (const chunk of s.split("\n")) {
        if (chunk.trim()) logEvents.push({ at: now, text: chunk.trim() })
      }
    },
  }

  const runs: Array<{ res: any; start: number; end: number }> = []
  for (let r = 0; r < REPEAT; r++) {
    snapCostMs = 0
    const start = Date.now()
    console.log(`\n=== run ${r + 1}/${REPEAT}: runPostProcessing (full derived pass) ===`)
    const res = await runPostProcessing(SRC_PID as any, { logger, lockHeld: true })
    const end = Date.now()
    runs.push({ res, start, end })
    const t = process.hrtime.bigint()
    const after = snap("after")
    snapCostMs += Number(process.hrtime.bigint() - t) / 1e6
    console.log(`  ${res.phases.map((p: any) => `${p.name}=${p.ms}ms/${p.outcome}`).join("  ")}`)
    console.log(`  wall ${((end - start) / 1000).toFixed(1)}s | reported totalMs ${(res.totalMs / 1000).toFixed(1)}s | integrityHealth ${res.integrityHealth ?? "n/a"}`)
    if (r === 0) M_snapAfter = after
  }

  const last = runs[runs.length - 1]
  const out = {
    corpus: { srcProjectId: SRC_PID, before, after: M_snapAfter },
    wallMs: last.end - last.start,
    reportedTotalMs: last.res.totalMs,
    phases: last.res.phases,
    // The profiler's own counting cost, so it can be excluded from any reading
    // of the wall clock. It runs on a SEPARATE handle and is not in the product's
    // phases, but it is inside the measured wall clock and must be declared.
    profilerSnapshotMs: Math.round(snapCostMs),
    profilerSnapshotCalls: snapshots.length,
    peakRssMiB: Math.round(Math.max(0, ...rss.map((s) => s.rss)) / 1024 / 1024),
    rssAtPhaseEdgesMiB: snapshots.map((s, i) => ({ tag: s.tag, rssMiB: rss[i] ? Math.round(rss[i].rss / 1024 / 1024) : null })),
    snapshots,
    logTimeline: logEvents.map((e) => ({ atMs: e.at - last.start, text: e.text.slice(0, 140) })),
    integrityHealth: last.res.integrityHealth,
  }
  if (REPEAT > 1) {
    out.repeat = runs.map((r, i) => ({
      i: i + 1,
      wallMs: r.end - r.start,
      phases: r.res.phases.map((p: any) => ({ name: p.name, ms: p.ms, outcome: p.outcome })),
    }))
  }

  writeFileSync(path.join(ROOT, "script/profile/results/post-pass-phases.json"), JSON.stringify(out, null, 2))

  console.log(`\n=== PHASE BREAKDOWN (authoritative: the product's own timers) ===`)
  console.log(`    wall ${(out.wallMs / 1000).toFixed(1)}s over ${runs.length} run(s)`)
  console.log(`    ${"phase".padEnd(15)}${"ms".padStart(9)}${"%wall".padStart(9)}   outcome`)
  for (const p of out.phases as any[]) {
    console.log(`    ${p.name.padEnd(15)}${String(p.ms).padStart(9)}${((p.ms / out.wallMs) * 100).toFixed(1).padStart(8)}%   ${p.outcome}`)
  }
  const accounted = (out.phases as any[]).reduce((a, p) => a + p.ms, 0)
  console.log(`    ${"UNATTRIBUTED".padEnd(15)}${String(out.wallMs - accounted).padStart(9)}${(((out.wallMs - accounted) / out.wallMs) * 100).toFixed(1).padStart(8)}%   (lock acquire/release + open)`)
  console.log(`\n    profiler's own COUNT(*) snapshots: ${out.profilerSnapshotMs}ms over ${out.profilerSnapshotCalls} calls, on a separate read-only handle`)
  console.log(`    peak RSS ${out.peakRssMiB} MiB`)
  console.log(`\n=== ROW COUNTS AT EACH PHASE EDGE ===`)
  const keys = ["files", "symbols", "relationships", "attached", "enriched", "taints", "embeddings"] as const
  console.log(`    ${"tag".padEnd(38)}${keys.map((k) => k.slice(0, 10).padStart(12)).join("")}`)
  for (const s of out.snapshots) {
    console.log(`    ${String(s.tag).slice(0, 37).padEnd(38)}${keys.map((k) => String((s as any)[k]).padStart(12)).join("")}`)
  }
  console.log(`\nwrote ${path.join(ROOT, "script/profile/results/post-pass-phases.json")}`)

  counter.close()
  if (!has("--keep")) {
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* best effort */ }
  } else {
    console.log(`corpus kept at ${dataDir}`)
  }
}

let M_snapAfter: Counts | null = null

main().catch((e) => {
  console.error("profile-post failed:", e)
  process.exitCode = 1
})