/**
 * WHY THE PROBE'S WIDTH-4 ARM READ 0 FOR TWO DAYS
 * ----------------------------------------------
 * `engine-concurrency-probe.ts` sampled the corpus by a STRIDE (`i % stride === 0`) and its width-4
 * arm degraded 0 times across three runs on 400- and 500-file samples. Two full-population runs then
 * measured width 4 degrading on 2 files each. Both findings are correct; the question this file
 * settles is whether the stride sample could have SEEN the width-4 failures at all.
 *
 * If the failing files sit at indices the stride skips, then "width 4 is clean" was never a statement
 * about width 4 — it was a statement about which files the sample happened to contain, printed by an
 * instrument whose own header says the two runs differ ONLY in width. That is a sampling-adequacy
 * defect in the probe's DEFAULT, and it is the same shape as the `overrides` stride-8 finding this
 * lane already documents: a per-type count below the sample's resolution cannot distinguish "dead
 * code" from "rare construct", and here it cannot distinguish "clean width" from "unsampled file".
 *
 * This file re-derives the probe's OWN enumeration — same `detectLanguageFromPath` admission, same
 * per-repo `git ls-files`, same sort — and then reports, for each file named by a degraded run, its
 * index in that ordering and whether each stride sample would have included it. No corpus parse, so
 * it runs in seconds and cannot itself be degraded.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/julia/width4-sample-coverage.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "julia"

/**
 * The files a degraded run actually degraded, grouped by the width that saw them. Sourced from the
 * probe's own `FILES THAT DEGRADED OR THREW` output, not from a re-parse — the point is to ask
 * whether the sample COULD have covered them, which is answerable from the ordering alone.
 */
const OBSERVED: { width: number; file: string }[] = [
  { width: 4, file: "Graphs.jl/test/digraph/transitivity.jl" },
  { width: 4, file: "Graphs.jl/test/degeneracy.jl" },
  { width: 4, file: "DataFrames.jl/src/groupeddataframe/complextransforms.jl" },
  { width: 4, file: "Graphs.jl/test/simplegraphs/simplegraphs.jl" },
  { width: 4, file: "Graphs.jl/test/community/modularity.jl" },
  { width: 4, file: "Graphs.jl/test/community/louvain.jl" },
  { width: 8, file: "json_jl/vendor/test.jl" },
  { width: 8, file: "julia/Compiler/extras/CompilerDevTools/test/testpkg.jl" },
  { width: 8, file: "DataFrames.jl/test/constructors.jl" },
  { width: 8, file: "Graphs.jl/test/linalg/spectral.jl" },
  { width: 8, file: "DataFrames.jl/src/other/utils.jl" },
  { width: 8, file: "Graphs.jl/test/traversals/greedy_color.jl" },
]

// ---------------------------------------------------------------- the probe's enumeration
const files: { repo: string; rel: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  } catch {
    continue
  }
  for (const rel of tracked.split("\0")) {
    if (!rel.endsWith(".jl")) continue
    const abs = path.join(dir, rel)
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel })
  }
}

const index = new Map(files.map((f, i) => [`${f.repo}/${f.rel}`, i]))
console.log(`width4 sample coverage — julia`)
console.log(`corpus root: ${CR}`)
console.log(`admitted ${files.length} .jl files (same admission + ordering as engine-concurrency-probe.ts)\n`)

// The probe's default is `--files 400`; the other sample this lane ran is 500. Both are reported
// because "width 4 was clean" was observed on both.
const LIMITS = [400, 500]
console.log(`file                                     width  index  stride4(400)  stride3(500)`)
console.log(`${"-".repeat(78)}`)
const covered = { 400: 0, 500: 0 }
for (const o of OBSERVED) {
  const i = index.get(o.file)
  if (i === undefined) {
    console.log(`${o.file.padEnd(40)} ${String(o.width).padEnd(6)} NOT IN ADMITTED SET`)
    continue
  }
  const stride400 = Math.max(1, Math.floor(files.length / 400))
  const stride500 = Math.max(1, Math.floor(files.length / 500))
  // The probe's sample is `filter((_, i) => i % stride === 0).slice(0, LIMIT)` — membership needs the
  // index to be a stride multiple AND to fall among the first LIMIT such multiples, which is a
  // different bound from `i < LIMIT`. Getting this wrong would understate coverage.
  const in400 = i % stride400 === 0 && i / stride400 < 400
  const in500 = i % stride500 === 0 && i / stride500 < 500
  if (in400) covered[400]++
  if (in500) covered[500]++
  console.log(
    `${o.file.padEnd(40)} ${String(o.width).padEnd(6)} ${String(i).padEnd(7)} ${(in400 ? "INCLUDED" : "skipped").padEnd(14)} ${in500 ? "INCLUDED" : "skipped"}`,
  )
}

console.log(`\nstride for limit 400 = ${Math.max(1, Math.floor(files.length / 400))}; for limit 500 = ${Math.max(1, Math.floor(files.length / 500))}`)
console.log(`  (the probe's slice is \`filter(i % stride === 0).slice(0, LIMIT)\`, so at limit 500 over`)
console.log(`   ${files.length} files the stride is 3 and the sample is every third file)`)
console.log(`\nfiles a degraded run degraded that the sample COULD have seen: ${covered[400]}/12 at limit 400, ${covered[500]}/12 at limit 500`)
const w4 = OBSERVED.filter((o) => o.width === 4)
const w4c400 = w4.filter((o) => {
  const i = index.get(o.file)
  return i !== undefined && i % Math.max(1, Math.floor(files.length / 400)) === 0
}).length
const w4c500 = w4.filter((o) => {
  const i = index.get(o.file)
  return i !== undefined && i % Math.max(1, Math.floor(files.length / 500)) === 0
}).length
console.log(`  of the ${w4.length} WIDTH-4 failures: ${w4c400} reachable at limit 400, ${w4c500} at limit 500`)
console.log(`\nREAD: reachability is NECESSARY but NOT SUFFICIENT, and the counts say how weak the arm's 0 was.`)
console.log(`  At limit 400 the sample contained ${w4c400} of the ${w4.length} width-4 failures, and that arm still read 0 — so the trap is`)
console.log(`  probabilistic rather than per-file, which is the finding. But an arm that reaches ${w4c400} of ${w4.length} known-failing files and`)
console.log(`  reports 0 is weak evidence, and this lane quoted it as the reproducible half of §8 row 2.`)
console.log(`  The measurement that settles width 4 is the FULL-POPULATION arm, which is what the doc now cites.`)