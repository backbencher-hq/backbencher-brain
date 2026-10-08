/**
 * WHICH VB FILES ARE TOXIC TO THE PINNED WASM, AND WHAT DOES A SWEEP ACTUALLY
 * COST? Two questions a per-file count cannot answer, both of which have already
 * destroyed a sweep.
 *
 * THE OBSERVED FAILURES. Four identical sweeps of the same 2,658-file corpus, run
 * for this lane's ontology work, each died with a different file named:
 *
 *   [BB-HANG] parser stuck 120s on p3d/P3D/Battle/BattleAnimations/BAEntityOpacity.vb
 *   [BB-HANG] parser stuck 120s on dismt/Elements/AutoUnattend/ActiveDirectory/ADDSJoinDialog.vb
 *   [BB-PARSE-ERR] vb | …/ADDSJoinDialog.vb | memory access out of bounds
 *   [BB-PARSE-ERR] vb | …/NestBall.vb | …
 *
 * and `src/ast/engine.ts:1408` responds to the hang with `process.exit(1)`. The
 * timer cannot fire while `parser.parse()` blocks — tree-sitter is synchronous
 * WASM — so the message is printed after the block RETURNS, which means the file
 * named is the file whose parse consumed the time, and the process dies with it.
 * A sweep over this corpus is therefore not a repeatable measurement, and no
 * corpus total that has not recorded WHICH files were toxic is a measurement of
 * the language rather than of the wasm.
 *
 * Two numbers settle it, and neither is visible in a relationship count:
 *
 *   1. PER-FILE WALL TIME, measured one file at a time so the attribution is
 *      unambiguous, with the slowest files named. This is also the LATENCY
 *      budget's denominator: `docs/analyzers/ONTOLOGY-WORKSTREAM.md` requires the
 *      lane's payload/latency check to be re-run after adding edges, and a total
 *      wall figure cannot be attributed when a minority of files dominates it.
 *   2. THE TOXIC SET, defined by a threshold rather than by a name, so the set is
 *      reproducible and a future grammar change can be said to have shrunk it.
 *      Both families are reported: files that TRAP the wasm, and files that take
 *      longer than the engine's own 120s self-destruct budget.
 *
 * `--workers` defaults to 1 on purpose. The budget this lane has to re-measure is
 * a single-file parse cost, and concurrency is a separate variable that
 * `vb-fallback-census.ts` already covers.
 *
 * CLI: npx tsx script/m14/vb-parse-timing.ts [--slow-ms 1000] [--sample N] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const CR = process.env.BB_VB_CORPUS_ROOT ?? "$HOME/fixtures/vb-corpus"
const REPOS = (argOf("--repo", "p3d,dismt,pcl,tankex,runtime") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SLOW_MS = parseInt(argOf("--slow-ms", "1000") ?? "1000")
const SAMPLE = parseInt(argOf("--sample", "0") ?? "0")
const OUT = argOf("--out")
/** `engine.ts` installs this self-destruct timer around every `parser.parse`. */
const ENGINE_BOMB_MS = 120000

const files: { repo: string; dir: string; rel: string; abs: string; bytes: number }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { statSync(dir); execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".vb")) continue
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text = ""
    try { text = readFileSync(abs, "utf8").replace(/^\uFEFF/, "") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vb") continue
    files.push({ repo: e, dir, rel, abs, bytes: size })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = SAMPLE > 0 ? files.slice(0, SAMPLE) : files
console.log(`vb parse timing — corpus ${CR}  admitted ${files.length}  drawn ${draw.length}  slow threshold ${SLOW_MS} ms  sequential\n`)

type Row = { file: string; bytes: number; ms: number; symbols: number; rels: number; fallback: boolean; threw: string }
const rows: Row[] = []
let totalMs = 0
for (const f of draw) {
  const t0 = Date.now()
  let symbols = 0, rels = 0, fallback = false, threw = ""
  try {
    const r: any = await parseFile(f.abs, f.dir)
    symbols = (r?.symbols ?? []).length
    rels = (r?.relationships ?? []).length
    fallback = r?.fallback === true
  } catch (e: any) {
    threw = String(e?.message ?? e).slice(0, 120)
  }
  const ms = Date.now() - t0
  totalMs += ms
  rows.push({ file: `${f.repo}/${f.rel}`, bytes: f.bytes, ms, symbols, rels, fallback, threw })
}

const sorted = [...rows].sort((a, b) => b.ms - a.ms)
const slow = sorted.filter((r) => r.ms >= SLOW_MS)
const trapped = sorted.filter((r) => r.threw.length > 0)
const fellBack = sorted.filter((r) => r.fallback)
const overBudget = sorted.filter((r) => r.ms >= ENGINE_BOMB_MS)
const n = Math.max(1, rows.length)

console.log(`files timed: ${rows.length}`)
console.log(`total wall: ${(totalMs / 1000).toFixed(1)} s   mean ${(totalMs / n).toFixed(1)} ms   median ${sorted[Math.floor(sorted.length / 2)]?.ms ?? 0} ms`)
console.log(`files at or over ${SLOW_MS} ms: ${slow.length}  (${((slow.length / n) * 100).toFixed(2)}% of files, ${(slow.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)} s of the ${(totalMs / 1000).toFixed(1)} s total = ${((slow.reduce((a, r) => a + r.ms, 0) / Math.max(1, totalMs)) * 100).toFixed(1)}% of the time)`)
console.log(`files at or over the engine's ${ENGINE_BOMB_MS} ms self-destruct budget: ${overBudget.length}  <- each one KILLS the whole sweep (engine.ts:1408 calls process.exit(1))`)
console.log(`files whose production parse THREW: ${trapped.length}`)
for (const t of trapped.slice(0, 25)) console.log(`    ${t.file}  ${t.ms} ms  ${t.threw}`)
console.log(`files answered WITHOUT the grammar: ${fellBack.length}`)
console.log(`\nslowest 25 files:`)
for (const r of sorted.slice(0, 25)) {
  console.log(`  ${String(r.ms).padStart(7)} ms  ${String(r.bytes).padStart(7)} B  sym ${String(r.symbols).padStart(4)}  rel ${String(r.rels).padStart(5)}${r.fallback ? "  FALLBACK" : ""}${r.threw ? `  THREW ${r.threw}` : ""}  ${r.file}`)
}
if (slow.length > 25) {
  console.log(`\nall files at or over ${SLOW_MS} ms (${slow.length}):`)
  for (const r of slow) console.log(`  ${String(r.ms).padStart(7)} ms  ${String(r.bytes).padStart(7)} B  ${r.file}`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    corpusRoot: CR, admitted: files.length, drawn: draw.length, slowThresholdMs: SLOW_MS,
    engineBombMs: ENGINE_BOMB_MS,
    totalWallMs: totalMs, meanMs: +(totalMs / n).toFixed(1),
    medianMs: sorted[Math.floor(sorted.length / 2)]?.ms ?? 0,
    slowFileCount: slow.length, overBudgetFiles: overBudget.map((r) => r.file),
    trappedFiles: trapped.map((r) => ({ file: r.file, ms: r.ms, threw: r.threw })),
    fallbackFileCount: fellBack.length,
    rows: rows.sort((a, b) => b.ms - a.ms),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
process.exitCode = trapped.length === 0 && overBudget.length === 0 ? 0 : 1
