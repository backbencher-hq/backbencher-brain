/**
 * PER-FILE ANALYZE COST, one build at a time, with progress on stderr.
 *
 * WHY THIS EXISTS. Running `script/incoming-rust/rust-r7-audit.ts --repo=ripgrep`
 * on this branch printed, from `src/ast/pool-worker.ts`'s own 45s self-timeout:
 *
 *   [ERROR] [ast-engine] analyzer timeout - forcefully aborting
 *           {"filePath":".../ripgrep/crates/core/flags/defs.rs"}
 *
 * and the run's totals fell to 24,820 edges / 4,016 symbols where the same
 * instrument on the pre-R7 commit printed 29,660 / 5,150. One 246 KB file
 * producing nothing at all is a big enough share of that delta to matter, and it
 * has two opposite explanations: a real performance regression from the R7
 * commits, or a wall-clock budget lost to a loaded machine (many lanes run
 * concurrently on this box). Guessing wrong in either direction is bad — the
 * first ships a silent whole-file loss, the second ships a phantom defect — so
 * this measures.
 *
 * WHAT IT MEASURES. `analyze()` called directly: no worker, no watchdog, no
 * retry, so nothing can hide the real number. Two builds in ONE process so the
 * comparison is not a number about two different machine loads:
 *
 *   branch = this worktree's src/ast/real-rust-analyzer.ts
 *   main   = the main checkout's copy of the same file
 *
 * Population is derived: every `.rs` path `git ls-files` reports for ripgrep,
 * filtered to files over 100 KB, then the one named by `--file=`. No list is
 * hand-written.
 *
 * Progress goes to stderr and the table to stdout, because a tool that prints
 * only at the end turns a slow file into an apparently-hung process — which is
 * exactly how RUST-D21 lost a whole corpus sweep to an empty printout.
 *
 * NO REGULAR EXPRESSION. `endsWith`, `join`, `statSync` only.
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-perf-regress.ts [--runs=3] [--file=defs.rs]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealRustAnalyzer } from "../../src/ast/real-rust-analyzer"

const MAIN_ROOT = "$HOME/backbencher-brain"
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const RUNS = Number(ARGS.find((a) => a.startsWith("--runs="))?.slice(7) ?? 3)
const FILE = ARGS.find((a) => a.startsWith("--file="))?.slice(7) ?? "defs.rs"
const log = (m: string): void => {
  process.stderr.write(`${m}\n`)
}

const tracked = execFileSync("git", ["-C", join(CR, "ripgrep"), "ls-files", "-z", "*.rs"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
const big = tracked
  .map((rel) => ({ rel, abs: join(CR, "ripgrep", rel) }))
  .filter((f) => {
    try {
      return statSync(f.abs).size > 100_000
    } catch {
      return false
    }
  })
  .sort((a, b) => (a.rel < b.rel ? -1 : 1))
const sel = big.filter((x) => (FILE === "*" ? true : x.rel.endsWith(FILE)))
log(`population: ${big.length} tracked ripgrep .rs files over 100 KB; selected ${sel.length}`)

const parser = await getParser("rust")
const branchAnalyzer = new RealRustAnalyzer()
log("branch analyzer loaded")

const med = (xs: number[]): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]

const rows: string[] = []
for (const f of process.env.RUST_PERF_SKIP_BRANCH ? [] : sel) {
  const content = readFileSync(f.abs, "utf8")
  const bytes = content.length
  const pr = await parser.parse(content, f.abs)
  log(`parsed ${f.rel} (${bytes} B)`)
  branchAnalyzer.analyze(pr.rootNode, content, f.abs)
  const bms: number[] = []
  let bEdges = 0
  let bSyms = 0
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now()
    const r: any = branchAnalyzer.analyze(pr.rootNode, content, f.abs)
    bms.push(performance.now() - t)
    if (i === 0) {
      bEdges = (r?.relationships ?? []).length
      bSyms = (r?.symbols ?? []).length
    }
    log(`  branch run ${i + 1}/${RUNS}: ${bms[i].toFixed(0)} ms`)
  }
  pr?.delete?.()
  const row = `${f.rel}  ${bytes} B  branch median ${med(bms).toFixed(0)} ms  edges ${bEdges}  symbols ${bSyms}`
  log(row)
  rows.push(row)
}

// The main-checkout build is loaded only if the caller asked for the comparison,
// because importing a second copy of a 160 KB analyzer module is itself slow on
// a loaded box and the branch-side number is the one that settles the question.
if (!process.env.RUST_PERF_SKIP_MAIN) {
  try {
    const M = await import(`${MAIN_ROOT}/src/ast/real-rust-analyzer.ts`)
    const mainAnalyzer = new M.RealRustAnalyzer()
    log("main analyzer loaded")
    for (const f of sel) {
      const content = readFileSync(f.abs, "utf8")
      const pr = await parser.parse(content, f.abs)
      mainAnalyzer.analyze(pr.rootNode, content, f.abs)
      const mms: number[] = []
      let mEdges = 0
      let mSyms = 0
      for (let i = 0; i < RUNS; i++) {
        const t = performance.now()
        const r: any = mainAnalyzer.analyze(pr.rootNode, content, f.abs)
        mms.push(performance.now() - t)
        if (i === 0) {
          mEdges = (r?.relationships ?? []).length
          mSyms = (r?.symbols ?? []).length
        }
        log(`  main run ${i + 1}/${RUNS}: ${mms[i].toFixed(0)} ms`)
      }
      pr?.delete?.()
      const i = rows.findIndex((x) => x.startsWith(f.rel))
      rows[i] = `${rows[i]}   || main median ${med(mms).toFixed(0)} ms  edges ${mEdges}  symbols ${mSyms}`
      log(`  ${rows[i]}`)
    }
  } catch (e) {
    log(`main build unavailable: ${String(e).slice(0, 120)}`)
  }
}

console.log("\n=== per-file analyze() cost ===")
for (const r of rows) console.log(r)
console.log(
  "\nThe two edge columns are NOT expected to match: the branch removed 1,280 placeholder-sourced",
)
console.log(
  "edges (rule R7) and added a const/static scope owner, so fewer edges here is the intended",
)
console.log("direction. What the TIME column settles is whether the R7 commits pushed a file past")
console.log("the worker's 45s self-timeout, which deletes the whole file from the graph silently.")