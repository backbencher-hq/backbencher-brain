/**
 * clean-excluded-probe — re-measure, ONE AT A TIME, every file the sharded walk excluded.
 *
 * WHY THIS EXISTS. `src/ast/engine.ts:1441` arms a 120 s `setTimeout` and calls
 * `process.exit(1)` when it fires. That clock is WALL-CLOCK. A shard that shares the
 * machine with nine other lanes can therefore lose the race on a file the parser walks
 * comfortably when it has the box to itself, and the walk's exclusion list cannot tell
 * the two cases apart: both arrive as `[BB-HANG] parser stuck 120s on <path>`.
 *
 * So an exclusion is not a verdict on a file, and this lane does not publish it as one.
 * This probe closes the gap with the smallest available instrument: for each excluded
 * path, spawn ONE child that parses that single file and nothing else, and record what
 * happened. Three outcomes, and the third is the one that matters:
 *
 *   PARSED   — measured, with its edges. It was a CPU race, not a parser limit, and
 *              its edges belong in the population. The count is reported so the caller
 *              can add it.
 *   HUNG     — the same 120 s timeout with nothing else on the machine. A reproducible
 *              parser limit on this file.
 *   ERRORED  — parse failure or crash, recorded as such. Not an empty result.
 *
 * Each child is its own process with its own 120 s budget, so the per-file timing is
 * not contaminated by the other excluded files. Timing is reported because "it parsed
 * in 4 s alone" and "it parsed in 118 s alone" are different claims about whether a
 * sharded walk at a given concurrency can be trusted to include it.
 *
 * Usage:
 *   npx tsx script/m14/clean-excluded-probe.mts --in /tmp/clean-wide-walk
 *   npx tsx script/m14/clean-excluded-probe.mts --in /tmp/clean-wide-walk --json out.json
 */
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

const HERE = path.dirname(new URL(import.meta.url).pathname)
const ROOT = path.resolve(HERE, "..", "..")
const SINGLE = path.join(ROOT, "validation", "m14", "fixtures", "clean", "single-file-walk.mts")

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const IN = arg("--in")
const JSON_OUT = arg("--json")
const TIMEOUT_S = Number(arg("--timeout") ?? 180) || 180

if (!IN || !fs.existsSync(path.join(IN, "walk-summary.json"))) {
  console.error(`usage: clean-excluded-probe.mts --in <walk dir> [--timeout 180] [--json out]`)
  console.error(`  ${IN} has no walk-summary.json`)
  process.exit(2)
}

const summary = JSON.parse(fs.readFileSync(path.join(IN, "walk-summary.json"), "utf8")) as {
  excluded?: string[]; exclusionOrigin?: Record<string, string>; shards?: number; concurrency?: number
}
const excluded = summary.excluded ?? []
if (!excluded.length) {
  console.log(`no excluded files in ${IN} — nothing to probe. The walk measured every file it attempted.`)
  process.exit(0)
}

type Row = { path: string; origin?: string; outcome: "PARSED" | "HUNG" | "ERRORED"; ms: number; symbols: number; edges: number; kinds: Record<string, number>; note?: string }
const rows: Row[] = []

console.log(`clean excluded-file probe`)
console.log(`walk: ${IN}  shards ${summary.shards ?? "?"} at concurrency ${summary.concurrency ?? "?"}`)
console.log(`excluded files: ${excluded.length}   per-file budget: ${TIMEOUT_S}s in an isolated process\n`)

for (const [i, p] of excluded.entries()) {
  const t0 = Date.now()
  let row: Row
  try {
    const r = await execFileP("npx", ["tsx", SINGLE, p], { encoding: "utf8", timeout: TIMEOUT_S * 1000, maxBuffer: 64 * 1024 * 1024 })
    const ms = Date.now() - t0
    const j = JSON.parse(r.stdout) as { symbols?: number; edges?: number; kinds?: Record<string, number> }
    row = { path: p, outcome: "PARSED", ms, symbols: Number(j.symbols ?? 0), edges: Number(j.edges ?? 0), kinds: j.kinds ?? {} }
  } catch (e) {
    const ex = e as { stdout?: string; stderr?: string; signal?: NodeJS.Signals; code?: number | string }
    const ms = Date.now() - t0
    const stderr = ex.stderr ?? ""
    const out = ex.stdout ?? ""
    const hung = /\[BB-HANG\]/.test(stderr) || /\[BB-HANG\]/.test(out) || ex.signal === "SIGTERM"
    row = {
      path: p, outcome: hung ? "HUNG" : "ERRORED", ms, symbols: 0, edges: 0, kinds: {},
      note: (stderr.split("\n").filter((l) => /\[BB-(HANG|PARSE-ERR)\]/.test(l)).join(" ") || `exit ${ex.code ?? ex.signal}`).slice(0, 300),
    }
  }
  row.origin = summary.exclusionOrigin?.[p]
  rows.push(row)
  const pctOfBudget = ((row.ms / (TIMEOUT_S * 1000)) * 100).toFixed(0)
  console.log(`[${String(i + 1).padStart(3)}/${excluded.length}] ${row.outcome.padEnd(7)} ${String(row.ms).padStart(7)}ms (${pctOfBudget}% of budget)  symbols ${row.symbols}  edges ${row.edges}  ${p}`)
  if (row.note) console.log(`        ${row.note}`)
}

const parsed = rows.filter((r) => r.outcome === "PARSED")
const hung = rows.filter((r) => r.outcome === "HUNG")
const errored = rows.filter((r) => r.outcome === "ERRORED")

console.log(`\nPROBE SUMMARY over ${rows.length} excluded file(s), each in its own process:`)
console.log(`  PARSED alone  ${parsed.length}  — CPU race, not a parser limit; edges recoverable`)
console.log(`  HUNG alone    ${hung.length}  — reproducible 120s parser limit with nothing else on the box`)
console.log(`  ERRORED       ${errored.length}  — parse error or crash, recorded above`)
const edges = parsed.reduce((a, r) => a + r.edges, 0)
console.log(`  edges held by the PARSED-alone files: ${edges}`)
console.log(`  symbols in them: ${parsed.reduce((a, r) => a + r.symbols, 0)}`)

if (parsed.length) {
  const sorted = parsed.slice().sort((a, b) => a.ms - b.ms)
  console.log(`\n  the ${parsed.length} file(s) that parse alone, fastest first — the timing decides`)
  console.log(`  whether a sharded walk at a given concurrency would have kept them:`)
  for (const r of sorted) console.log(`    ${String(r.ms).padStart(7)}ms  ${r.path}`)
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    walk: IN, shards: summary.shards, concurrency: summary.concurrency, perFileTimeoutS: TIMEOUT_S,
    parsed: parsed.length, hung: hung.length, errored: errored.length,
    edgesInParsed: edges, rows,
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}