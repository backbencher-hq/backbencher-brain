/**
 * WHEN in a process's life does the wasm trap appear, and is this lane's analyzer
 * ever reached on a file that traps?
 *
 * WHAT IS ALREADY MEASURED (this round, one fresh process per arm, same 1,962-file
 * population = every git-tracked `.sql` <=512 KB, repos in name order):
 *
 *   arm                                        files  traps
 *   population, concurrency 1                    1962      0
 *   population, concurrency 8                    1962      0
 *   the 4 files the pass-15 walk named, alone       4      0
 *   the same 4 files, 300 rounds each                900      0
 *   population, then the SAME population again    1962      traps, pass 2 only
 *
 * So: no single file is poison (900 parses of the three named offenders, clean), and
 * concurrency is not the variable (both concurrencies clean over the full population).
 * What differs in the trapping run is that the process had already parsed ~1,962 files
 * before the trapping ones. The variable is the process's own parse COUNT.
 *
 * TWO NUMBERS THIS FILE EXISTS TO PRODUCE
 *
 *   1. `firstTrapAtParse` — the parse ordinal of the first `[BB-PARSE-ERR]`. If that is
 *      in the thousands and not in the single digits, then no per-file quarantine can
 *      remove it, because the offending file parses clean in a fresh process: the
 *      property belongs to the process, not to the input. That is a §8 item
 *      (`src/ast/engine.ts`), because the parser cache is shared machinery.
 *
 *   2. `analyzeCallsOnTrappingFiles` — whether `RealSqlAnalyzer.analyze` was invoked at
 *      all on a file that trapped. `engine.ts` arms `parseBomb` and calls
 *      `parser.parse(content)` BEFORE it reaches the analyzer, so a trap there is
 *      upstream of this lane. The order in the source is readable; whether the throw
 *      lands there is a measurement, and it is the measurement that assigns the defect
 *      an owner.
 *
 * WHY THE ORDINALS ARE NEEDED AT ALL: `[BB-PARSE-ERR]` carries no ordinal, and
 * `parseFile` swallows the throw into `extractFallback` (pool-worker.ts:1219), so the
 * returned object cannot be told apart from a real parse. `stderr.write` is wrapped for
 * the duration of the walk to attach the ordinal of the parse in flight at the moment
 * the line was written; the wrapper passes every chunk through unchanged.
 *
 * Run: npx tsx validation/m14/fixtures/sql/trap-onset.mts [fileLimit] [concurrency]
 */

import { readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { RealSqlAnalyzer } from "../../../../src/ast/real-sql-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 4000)
const CONC = Number(process.argv[3] ?? 8)

// Same admission rule as the arbiter, stated rather than assumed equal to it: git-tracked,
// .sql, <=512 KB, repos in name order. The arbiter additionally content-sniffs some files;
// this probe does not, so its population can be a subset of the arbiter's.
const files: { abs: string; dir: string; rel: string }[] = []
for (const repo of readdirSync(CR).sort()) {
  if (files.length >= LIMIT) break
  const dir = `${CR}/${repo}`
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.sql"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (files.length >= LIMIT) break
    const abs = `${dir}/${rel}`
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    files.push({ abs, dir, rel: `${repo}/${rel}` })
  }
}

// Count analyzer invocations per file. `analyze` takes `filePath` as its THIRD
// positional argument (real-sql-analyzer.ts:619) and keeps no field for it, so the
// wrapper reads the argument rather than `this`.
const analyzeByFile = new Map<string, number>()
const orig = (RealSqlAnalyzer as any).prototype.analyze
if (!orig) {
  console.error("RealSqlAnalyzer.prototype.analyze is absent — this probe cannot answer its own question")
  process.exit(2)
}
;(RealSqlAnalyzer as any).prototype.analyze = function (this: any, ...a: any[]) {
  const p = typeof a[2] === "string" ? a[2] : "(no filePath argument)"
  analyzeByFile.set(p, (analyzeByFile.get(p) ?? 0) + 1)
  return orig.apply(this, a)
}

let parseOrdinal = 0
let inFlight = 0
const traps: { at: number; file: string; inFlight: number }[] = []
const origWrite = process.stderr.write.bind(process.stderr)
;(process.stderr as any).write = (chunk: any, ...rest: any[]) => {
  const s = typeof chunk === "string" ? chunk : String(chunk)
  if (s.includes("[BB-PARSE-ERR]")) {
    const m = s.match(/BB-PARSE-ERR\]\s*\S+\s*\|\s*(\S+?)\s*\|/)
    traps.push({ at: parseOrdinal, file: m ? m[1] : "(unparsed)", inFlight })
    origWrite(`[probe] trap at ordinal=${parseOrdinal} inFlight=${inFlight} :: ${s.trim()}\n`)
  }
  return (origWrite as any)(chunk, ...rest)
}

console.log(`population ${files.length} git-tracked .sql <=512KB, repos in name order, concurrency ${CONC}`)
console.log(`analyze wrapper installed: yes`)

let next = 0
let ok = 0
const t0 = Date.now()
const worker = async () => {
  for (;;) {
    const i = next++
    if (i >= files.length) return
    const f = files[i]
    parseOrdinal++
    inFlight++
    try {
      await parseFile(f.abs, f.dir)
      ok++
    } catch {
      /* pool-worker swallowed it already; the stderr marker is the only signal */
    } finally {
      inFlight--
    }
    if (parseOrdinal % 500 === 0)
      console.log(`  parsed ${parseOrdinal}/${files.length} traps=${traps.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

const secs = (Date.now() - t0) / 1000
const relOf = (abs: string) => files.find((f) => f.abs === abs)?.rel ?? abs
const analyzed = traps.filter((t) => (analyzeByFile.get(t.file) ?? 0) > 0)

console.log(`\nwalk done: ${ok}/${files.length} returned, ${traps.length} traps, ${secs.toFixed(1)}s`)
console.log(`first trap at parse ordinal: ${traps.length ? traps[0].at : "none"}`)
console.log(`trap ordinals: ${traps.map((t) => t.at).join(", ") || "none"}`)
console.log(`trapping files: ${traps.map((t) => relOf(t.file)).join(", ") || "none"}`)
console.log(`analyze() invoked on a trapping file: ${analyzed.length} of ${traps.length}`)
console.log(`distinct files analyze() was invoked on: ${analyzeByFile.size} of ${files.length}`)
console.log(
  traps.length
    ? `READING: the first trap lands at parse ${traps[0].at} of ${files.length}, and ${analyzed.length === 0 ? "the analyzer was never reached on a trapping file" : "the analyzer WAS reached on a trapping file"}`
    : `READING: no trap in ${files.length} parses at concurrency ${CONC}. The pass-15 trap needs a longer-lived process than this one.`,
)