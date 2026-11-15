/**
 * RUBY LANE — analyzer performance benchmark and budget check. (M60)
 *
 * The lane had no performance ceiling at all: every correctness claim was backed by a
 * measurement and the one claim that was NOT was "does this finish". A correctness
 * number with no time bound is not a ship decision, so this pins both.
 *
 * WHAT IS MEASURED, and what each number means:
 *
 *   throughput   files and relationships per second, single-threaded, on the parse
 *                already in hand. This isolates ANALYSIS from parsing, because
 *                `RealRubyAnalyzer.analyze` never parses - the caller does - so
 *                charging it for parse time would measure web-tree-sitter.
 *   per-file     mean / p95 / max milliseconds for a single `analyze` call. The mean
 *                says throughput; p95 is what a user waits for; max is the tail that
 *                finds a pathological construct.
 *   budget       p95 and total against explicit ceilings, so a regression that is
 *                invisible in a mean (one slow construct in a common file) cannot
 *                pass. The ceilings are the corpus's own measured numbers plus
 *                headroom, and they are stated here rather than left implicit so a
 *                reviewer can argue with them.
 *
 * The benchmark re-uses ONE parse per file across repeated analyze calls, so it
 * measures the analyzer and not the allocator. Runs are warmed: the first pass is
 * JIT and therefore excluded from the reported figures, because reporting a cold
 * first-run number as throughput would overstate variance by an order of magnitude.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-benchmark.ts <corpus-root> [--repeat=N] [--limit=N]
 * Exit code is non-zero if a budget is exceeded, so it can gate CI.
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = "/home/sano/ishaq/backbencher-brain"

/**
 * Explicit ceilings. Stated, not implied.
 *
 * SET FROM MEASUREMENT, with headroom, not from an aspiration. Measured on the full
 * 8,528-file corpus (see `validation/m60/results/ruby-benchmark.json`):
 *
 *   throughput  ~175 files/s,  ~12,900 relationships/s, single-threaded
 *   p95 ~25ms   p99 ~78ms     max ~197ms
 *
 * The throughput floor is 150 files/s - about 15% BELOW the measured figure. A budget
 * pinned at the measurement would fail on any machine slower than the one that
 * produced it, which trains its reader to ignore it; a budget pinned far below it
 * catches nothing. 150 is the tightest value that still absorbs ordinary machine
 * variance while a real regression - the un-hoisted version measured 151 files/s and
 * is still only 1% under this floor, which is exactly why the p95 ceiling below
 * carries most of the signal.
 *
 * The p95 ceiling does the real work. A regression that is invisible in a throughput
 * average - one pathological construct added to a common file - moves p95 without
 * moving the mean, and p95 is what a user actually waits for. `max` is bounded
 * generously (4s) because a single pathological file is a tail problem, not a
 * throughput problem, and pinning it tightly would make the gate flap.
 */
const BUDGET_MS_P95 = 40.0
const BUDGET_MS_MAX = 4000.0
/** Throughput floor, files/second, single-threaded. See the note above. */
const BUDGET_FILES_PER_SEC = 150

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string): void => {
    let e: fs.Dirent[]
    try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) {
      if (x.name.startsWith(".")) continue
      const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) }
      else if (x.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Percentile by nearest-rank on an already-sorted array. No interpolation, so the
 *  reported p95 is a number that was actually observed. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

async function main(): Promise<void> {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const corpus = arg("corpus") ?? "/home/sano/ishaq/bb_tests/repositories"
  const repeat = Number(arg("repeat") ?? 5)
  let files = listRubyFiles(corpus)
  const limit = Number(arg("limit") ?? 0)
  if (limit > 0 && files.length > limit) {
    const stride = files.length / limit
    files = Array.from({ length: limit }, (_, i) => files[Math.floor(i * stride)])
  }

  // Parse ONCE per file. The analyzer never parses, so this isolates it completely.
  const parsed: Array<{ content: string; tree: any; file: string }> = []
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    try {
      const tree = parser.parse(content)
      if (tree === null) continue
      parsed.push({ content, tree, file: f })
    } catch { /* unparseable file is not an analyzer cost */ }
  }

  const analyzer = new RealRubyAnalyzer()
  const perFileMs: number[] = []
  let relationships = 0
  let symbols = 0

  // WARM-UP pass, discarded. Not a formality: the first analyze of a code path pays
  // JIT compilation, and folding that into a throughput number would report a one-off
  // as if it were steady-state.
  for (const { tree, content, file } of parsed) {
    try { analyzer.analyze(tree.rootNode, content, file) } catch { /* counted in the timed pass */ }
  }

  /** Per-file timings BEFORE sorting, so they can be paired with their file. Sorting
   *  in place and then zipping against `parsed` attributes every duration to the wrong
   *  file - which is how the first run reported a 22-line file as its slowest at
   *  327ms when the same file analyzes in 2.3ms. The percentiles are computed from the
   *  sorted array and were always correct; only the per-file attribution was fiction. */
  const perFileUnsorted: number[] = []
  for (const { tree, content, file } of parsed) {
    let best = Number.POSITIVE_INFINITY
    for (let r = 0; r < repeat; r++) {
      const t0 = process.hrtime.bigint()
      let res: any = null
      try {
        res = analyzer.analyze(tree.rootNode, content, file)
      } catch { /* an analyzer throw is a correctness finding, not a timing one */ }
      const t1 = process.hrtime.bigint()
      // BEST of `repeat`, not mean: the best run is the one least contaminated by
      // scheduler noise and GC, which is what a throughput figure should describe.
      // Reporting a mean here would measure the machine's mood.
      best = Math.min(best, Number(t1 - t0) / 1e6)
      // Counted only on the FINAL repeat, so the payload volume is the payload and
      // not `repeat` copies of it. Accumulating every run made the relationship rate
      // and the symbol count both inflated by the repeat factor, which is a number
      // that looks plausible and is wrong.
      if (r === repeat - 1) {
        relationships += (res.relationships ?? []).length
        symbols += (res.symbols ?? []).length
      }
    }
    perFileMs.push(best)
    perFileUnsorted.push(best)
  }

  perFileMs.sort((a, b) => a - b)
  const totalMs = perFileMs.reduce((a, b) => a + b, 0)
  const mean = perFileMs.length > 0 ? totalMs / perFileMs.length : 0
  const p50 = percentile(perFileMs, 50)
  const p95 = percentile(perFileMs, 95)
  const p99 = percentile(perFileMs, 99)
  const max = perFileMs.length > 0 ? perFileMs[perFileMs.length - 1] : 0
  // Paired against the UNSORTED array, which is the fix.
  const slowest = parsed.map((p, i) => ({ file: p.file, ms: perFileUnsorted[i] }))
    .sort((a, b) => b.ms - a.ms).slice(0, 5)
  // Files per SECOND is count / seconds. The earlier form, `1 / seconds`, is
  // "one file per elapsed total" and reads as 0 for any corpus larger than a
  // handful - which is how the first run reported "0 files/s" while simultaneously
  // reporting 41,009 relationships/s. A throughput figure that can print zero while
  // doing visible work is not a measurement.
  const seconds = totalMs / 1000
  const perFile = seconds > 0 ? parsed.length / seconds : 0

  const breaches: string[] = []
  if (p95 > BUDGET_MS_P95) breaches.push(`p95 ${p95.toFixed(2)}ms exceeds ${BUDGET_MS_P95}ms`)
  if (max > BUDGET_MS_MAX) breaches.push(`max ${max.toFixed(2)}ms exceeds ${BUDGET_MS_MAX}ms`)
  if (perFile < BUDGET_FILES_PER_SEC) breaches.push(`throughput ${perFile.toFixed(0)} files/s below ${BUDGET_FILES_PER_SEC}`)

  const report = {
    at: new Date().toISOString(),
    corpus,
    filesParsed: parsed.length,
    repeat,
    analyzerOnly: true,
    parseIsolated: true,
    warmupPassesDiscarded: 1,
    statistic: "best-of-repeat per file",
    relationships, symbols,
    perFileMs: { mean: +mean.toFixed(4), p50: +p50.toFixed(4), p95: +p95.toFixed(4), p99: +p99.toFixed(4), max: +max.toFixed(4), total: +totalMs.toFixed(2) },
    throughput: {
      filesPerSecond: +perFile.toFixed(1),
      relationshipsPerSecond: +(seconds > 0 ? relationships / seconds : 0).toFixed(0),
    },
    budget: { p95Ms: BUDGET_MS_P95, maxMs: BUDGET_MS_MAX, filesPerSecond: BUDGET_FILES_PER_SEC },
    breaches,
    slowestFiles: slowest.map((s) => ({ file: path.relative(corpus, s.file), ms: +s.ms.toFixed(3) })),
  }

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-benchmark.json"), JSON.stringify(report, null, 2))

  console.log("=".repeat(78))
  console.log("RUBY — ANALYZER PERFORMANCE (parse isolated, warm, best-of-repeat)")
  console.log("=".repeat(78))
  console.log(`files=${parsed.length}  relationships=${relationships}  symbols=${symbols}`)
  console.log(`per-file ms: mean=${mean.toFixed(3)}  p50=${p50.toFixed(3)}  p95=${p95.toFixed(3)}  p99=${p99.toFixed(3)}  max=${max.toFixed(3)}`)
  console.log(`throughput:  ${perFile.toFixed(0)} files/s  ${(seconds > 0 ? relationships / seconds : 0).toFixed(0)} relationships/s`)
  console.log(`budget:       p95<=${BUDGET_MS_P95}ms  max<=${BUDGET_MS_MAX}ms  >=${BUDGET_FILES_PER_SEC} files/s`)
  console.log("slowest:")
  for (const s of report.slowestFiles) console.log(`  ${s.ms.toFixed(2).padStart(8)}ms  ${s.file}`)
  console.log(breaches.length === 0 ? "\nPERF BUDGET: pass" : `\nPERF BUDGET: FAIL — ${breaches.join("; ")}`)
  console.log("evidence: validation/m60/results/ruby-benchmark.json")
  if (breaches.length > 0) process.exitCode = 1
}

main()