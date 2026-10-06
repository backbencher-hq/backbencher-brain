/**
 * PROTOBUF LANE — IS `parseFile` DETERMINISTIC? The gate's own EMITTED rows move.
 *
 * ## The observation
 *
 * `script/m14/protobuf-ruling-table-proof.mts` runs the arbiter twice over the SAME 847
 * admitted files in the SAME process invocation — run (b) with protobuf absent from
 * `LANGS`, run (c) with it present. The arbiter does not read `LANGS` for anything except
 * the instrument grammar, so the two walks are the same population through the same
 * entry point. The EMITTED rows did not agree:
 *
 *   run (b)   uses 13,482   contains 40,631
 *   run (c)   uses 13,477   contains 40,605
 *
 * imports 1,574, exports 4 and overrides 2 were identical in both. So two of the five
 * emitted types drift and three do not, which is the shape a TIMEOUT or a truncation
 * boundary produces: a file that is cut mid-parse loses the edges it had not yet emitted,
 * and the high-volume types are where a cut is most likely to land.
 *
 * ## Why it is worth measuring rather than mentioning
 *
 * Every count this lane reports is a count over a walk that goes through `parseFile`, so
 * a walk-to-walk wobble is a wobble in the report. A verdict that says "uses 13,477
 * edges" and another that says "uses 13,482" are the same claim unless the spread is
 * stated, and the honest form is the range plus the population it was measured over.
 *
 * ## What this measures
 *
 * The production entry point — `parseFile` from `src/ast/pool-worker.ts`, NOT `analyze()`,
 * which is a per-file unit that skips the pipeline's pool, timeout and truncation stages.
 * A FIXED file list, walked REPEATEDLY in one process, so the file set cannot be the
 * explanation and the only variable left is the walk itself. Reported per run: edges per
 * relationship type, files that produced zero relationships, and whether any single file's
 * edge count moved between runs.
 *
 * CLI: npx tsx script/m14/protobuf-parsefile-variance.mts [--runs 3] [--files 120]
 */
import { parseFile } from "../../src/ast/pool-worker"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ROOT = path.resolve(import.meta.dirname, "../..")
const argOf = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt
}
const RUNS = argOf("runs", 3)
const WANT = argOf("files", 120)
const OUT = process.env.PB_OUT ?? "/tmp/opencode/pb/parsefile-variance.json"

// ---------------------------------------------------------------- a FIXED list, sorted
const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  const walk = (d: string): void => {
    let kids: string[]
    try {
      kids = readdirSync(d)
    } catch {
      return
    }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs)
        continue
      }
      if (k.endsWith(".proto") && st.size <= 512 * 1024) all.push(abs)
    }
  }
  walk(dir)
}
const files = all.slice(0, WANT)
console.error(`population: ${files.length} .proto files of ${all.length} discovered, walked ${RUNS}x`)

type PerFile = { edges: number; byType: Record<string, number>; failed: boolean }
type RunResult = { byType: Record<string, number>; edges: number; filesWithNoEdges: number; failed: number; rows: PerFile[] }

/**
 * ONE pass over the fixed list at the given concurrency. The arbiter walks with
 * `await Promise.all(Array.from({ length: 8 }, () => worker()))`, so 8 is the
 * concurrency whose behaviour is this lane's verdict surface; 1 is the control.
 */
async function pass(concurrency: number): Promise<RunResult> {
  const byType: Record<string, number> = {}
  const rows: PerFile[] = new Array(files.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++
      if (i >= files.length) return
      const abs = files[i]
      const row: PerFile = { edges: 0, byType: {}, failed: false }
      try {
        const r: any = await parseFile(abs, path.dirname(abs))
        for (const x of r?.relationships ?? []) {
          const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
          byType[t] = (byType[t] ?? 0) + 1
          row.byType[t] = (row.byType[t] ?? 0) + 1
          row.edges++
        }
      } catch {
        row.failed = true
      }
      rows[i] = row
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  let edges = 0
  let filesWithNoEdges = 0
  let failed = 0
  for (const row of rows) {
    edges += row.edges
    if (row.edges === 0) filesWithNoEdges++
    if (row.failed) failed++
  }
  return { byType, edges, filesWithNoEdges, failed, rows }
}

const CONCURRENCIES = argOf("concurrency", 0) > 0 ? [Number(process.argv[process.argv.indexOf("--concurrency") + 1])] : [1, 8]
const modes: { concurrency: number; perRun: RunResult[] }[] = []
for (const c of CONCURRENCIES) {
  const perRun: RunResult[] = []
  for (let run = 0; run < RUNS; run++) {
    const r = await pass(c)
    perRun.push(r)
    console.error(`concurrency ${c}, run ${run + 1}: edges ${r.edges}  files with no edges ${r.filesWithNoEdges}  failed ${r.failed}`)
  }
  modes.push({ concurrency: c, perRun })
}

// ---------------------------------------------------------------- which files moved
const moversOf = (perRun: RunResult[]): { file: string; runs: number[]; delta: number }[] => {
  const out: { file: string; runs: number[]; delta: number }[] = []
  for (let i = 0; i < files.length; i++) {
    const counts = perRun.map((r) => r.rows[i].edges)
    const d = Math.max(...counts) - Math.min(...counts)
    if (d > 0) out.push({ file: path.relative(CR, files[i]), runs: counts, delta: d })
  }
  return out.sort((a, b) => b.delta - a.delta)
}

const shape = (perRun: RunResult[]) => {
  const types = [...new Set(perRun.flatMap((r) => Object.keys(r.byType)))].sort()
  return {
    totals: { runs: perRun.map((r) => r.edges), min: Math.min(...perRun.map((r) => r.edges)), max: Math.max(...perRun.map((r) => r.edges)) },
    perType: types.map((t) => {
      const counts = perRun.map((r) => r.byType[t] ?? 0)
      const min = Math.min(...counts)
      const max = Math.max(...counts)
      return { type: t, runs: counts, min, max, spread: max - min, relativeToMin: min === 0 ? null : (max - min) / min }
    }),
    filesWhoseEdgeCountMoved: moversOf(perRun).length,
    topMovers: moversOf(perRun).slice(0, 15),
    filesWithNoEdgesPerRun: perRun.map((r) => r.filesWithNoEdges),
    failedPerRun: perRun.map((r) => r.failed),
  }
}

const report = {
  population: {
    corpusRoot: CR,
    discovered: all.length,
    walked: files.length,
    runs: RUNS,
    entryPoint: "parseFile from src/ast/pool-worker.ts",
    ordering: "readdirSync(CR).sort(), then a sorted recursive walk, then the first N — a fixed list, identical every run",
    concurrencies: CONCURRENCIES,
    note: "The arbiter walks with 8 concurrent workers, so 8 is this lane's verdict surface and 1 is the control.",
  },
  byConcurrency: Object.fromEntries(modes.map((m) => [String(m.concurrency), shape(m.perRun)])),
}
writeFileSync(OUT, JSON.stringify(report, null, 2))

console.log("")
console.log(`population: ${files.length} files x ${RUNS} runs at each concurrency, production parseFile, a FIXED file list`)
for (const m of modes) {
  const s = shape(m.perRun)
  console.log("")
  console.log(`concurrency ${m.concurrency}   total edges per run: ${s.totals.runs.join("  ")}   spread ${s.totals.max - s.totals.min} (${(((s.totals.max - s.totals.min) / (s.totals.min || 1)) * 100).toFixed(4)}% of min)`)
  console.log("  type          run1    run2    run3    spread")
  for (const t of s.perType) console.log(`  ${t.type.padEnd(12)} ${t.runs.map((n) => String(n).padStart(6)).join(" ")}  ${String(t.spread).padStart(6)}${t.spread > 0 ? `  <-- MOVES ${t.relativeToMin === null ? "" : `(${(t.relativeToMin * 100).toFixed(3)}%)`}` : ""}`)
  console.log(`  files whose own edge count moved between runs: ${s.filesWhoseEdgeCountMoved} of ${files.length}`)
  for (const mv of s.topMovers.slice(0, 8)) console.log(`    ${mv.runs.join(" / ")}  ${mv.file}`)
  console.log(`  files with no edges per run: ${s.filesWithNoEdgesPerRun.join(" ")}   parse failures per run: ${s.failedPerRun.join(" ")}`)
}
console.log("")
console.log(`wrote ${OUT}`)