/**
 * MEASURES the per-parse wasm temp-file growth that the pass-15 arbiter hang sits on.
 *
 * WHY. The pass-15 `--fresh` walk printed a correct table and then exited 1:
 *
 *   [BB-PARSE-ERR] sql | duckdb/benchmark/aoc24/queries/day02.sql | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on .../day02.sql — exiting
 *
 * That file does NOT hang on its own — `hang-isolate.mts` parses it through the same
 * production `parseFile` in 1,456ms with 1 symbol and 1 relationship, no trap. So the
 * fault is a property of the WALK and not of the file, which makes the accumulation the
 * thing to measure rather than the input.
 *
 * `src/ast/engine.ts` `resolveWasm` writes a fresh copy of the grammar to
 * `os.tmpdir()/bb-wasm_<path>_<pid>_<hrtime>` on every resolve, and its own comment says
 * it "deliberately does NOT unlink" because another process may be mid-load — correct,
 * and it names the cost as "unbounded tmpdir growth". Because the tag carries `hrtime`,
 * the name is unique PER CALL, so there is no reuse to amortise it: one 676 KB copy per
 * parse. A 1,962-file walk therefore writes on the order of 1.3 GB, and the wasm
 * instances behind them accumulate alongside it.
 *
 * The engine already knows about the other half of this — `getParser` recreates the
 * parser every 500 files "prevents WASM memory accumulation that causes hangs after
 * ~9,000 parses". So both the file growth and the memory growth are KNOWN and neither is
 * bounded by the walk.
 *
 * This probe counts what one bounded walk costs, so the hang has a number attached to it.
 * It reads only; it deletes nothing (another process may hold one of these open, which is
 * precisely why the engine will not unlink).
 *
 * Run: npx tsx validation/m14/fixtures/sql/wasm-growth.mts [fileCount]
 */

import { execFileSync } from "node:child_process"
import { readdirSync, statSync, existsSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(process.argv[2] ?? 300)

const PAT = /^bb-wasm_tree-sitter-sql_/
function census(): { n: number; bytes: number } {
  let n = 0
  let bytes = 0
  for (const f of readdirSync("/tmp")) {
    if (!PAT.test(f)) continue
    n++
    try {
      bytes += statSync(`/tmp/${f}`).size
    } catch {}
  }
  return { n, bytes }
}

// A bounded, deterministic slice of the same population the arbiter admits, so the number
// here is about the same corpus rather than a different one.
const files: { abs: string; dir: string; rel: string }[] = []
for (const repo of readdirSync(CR)) {
  if (files.length >= N) break
  const dir = `${CR}/${repo}`
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "ls-files", "-z", "*.sql"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
      .slice(0, 40)
      .forEach((rel) => {
        if (files.length < N) files.push({ abs: `${dir}/${rel}`, dir, rel: `${repo}/${rel}` })
      })
  } catch {}
}

const before = census()
console.log(`corpus root: ${CR}`)
console.log(`files sampled: ${files.length} (cap ${N})`)
console.log(`\ntmpdir BEFORE  sql wasm files: ${before.n}  ${(before.bytes / 1048576).toFixed(1)} MiB`)

let ok = 0
let degraded = 0
let rels = 0
const t0 = Date.now()
for (const f of files) {
  try {
    const r: any = await parseFile(f.abs, f.dir)
    rels += r?.relationships?.length ?? 0
    if (r?.degraded) degraded++
    ok++
  } catch {
    /* a trap is a datapoint, not a reason to stop counting */
  }
}
const after = census()

console.log(`\nparsed ok ${ok}/${files.length}, degraded ${degraded}, rels ${rels}, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`tmpdir AFTER   sql wasm files: ${after.n}  ${(after.bytes / 1048576).toFixed(1)} MiB`)
const dn = after.n - before.n
console.log(`\nGROWTH over ${files.length} parseFile calls: +${dn} files (+${((after.bytes - before.bytes) / 1048576).toFixed(1)} MiB)`)
console.log(`  per parse call: ${(dn / Math.max(1, files.length)).toFixed(2)} files, ${(((after.bytes - before.bytes) / 1048576) / Math.max(1, files.length)).toFixed(3)} MiB`)
const projected = (dn / Math.max(1, files.length)) * 1962
console.log(`  projected for the arbiter's 1,962-file walk: +${projected.toFixed(0)} files, +${((projected * (after.bytes - before.bytes) / Math.max(1, dn)) / 1048576).toFixed(0)} MiB in /tmp`)
console.log(`\nnothing deleted: engine.ts deliberately leaves these because another process may be mid-load.`)