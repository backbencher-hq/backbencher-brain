// script/m14/tmp/c909-degradation-curve.ts — is M12's cost number a property of
// the analyzer or of its own harness?
//
// #909 evidence so far: the committed `c-complexity.json` recorded 145.7ms/file
// (`userCpuMs: 52,523`, peak RSS 953MB) for 400 files; re-measuring the SAME
// 400-file rule through the same entry gave 28.7ms/file (userCpu 43.1ms/file,
// peak 224MB) and, minutes later, 215.2ms/file (userCpu 217.5ms/file, peak
// 1068MB). A 5x swing in the process's OWN CPU for identical input cannot be
// explained by other load — and F5 already documents this class for its lanes
// ("the module degrades after ~19-31 lanes", fixed there by giving each batch a
// FRESH module). The M12 harness runs all 400 files in ONE process, which is
// exactly the shape that degrades.
//
// This probe measures the shape instead of assuming it: cost per 50-file bucket
// within one run, plus RSS after each bucket. A rising curve means the harness's
// number describes its position in the run, not the analyzer.
//
// Run: bun script/m14/tmp/c909-degradation-curve.ts [fileLimit]
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"

const LIMIT = parseInt(process.argv[2] ?? "400")
const Z = "/home/ishaq2321/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -${LIMIT}`], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)

const BUCKET = 50
console.log(`files=${files.length} avgSize=${(files.reduce((a, f) => a + statSync(f).size, 0) / files.length / 1024).toFixed(1)}KB buckets of ${BUCKET}`)
console.log(`${"bucket".padStart(6)} ${"wallMs/file".padStart(12)} ${"userCpu/file".padStart(13)} ${"rssMB".padStart(8)} ${"rels/1k".padStart(8)}`)

let totalRels = 0
const firstBucket: number[] = []
const lastBucket: number[] = []
for (let start = 0; start < files.length; start += BUCKET) {
  const slice = files.slice(start, start + BUCKET)
  const u0 = process.resourceUsage().userCPUTime
  const t0 = performance.now()
  let rels = 0
  for (const f of slice) {
    try {
      const r: any = await parseFile(f, "/home/ishaq2321/mcp/backbencher-brain")
      rels += r.relationships?.length ?? 0
    } catch {}
  }
  const wall = performance.now() - t0
  const cpu = (process.resourceUsage().userCPUTime - u0) / 1000
  const rssMB = process.memoryUsage().rss / 1048576
  const perFile = wall / slice.length
  ;(start === 0 ? firstBucket : lastBucket).push(perFile)
  console.log(
    `${String(start).padStart(6)} ${perFile.toFixed(1).padStart(12)} ${(cpu / slice.length).toFixed(1).padStart(13)} ${rssMB.toFixed(0).padStart(8)} ${((rels / slice.length) * 1000).toFixed(0).padStart(8)}`,
  )
  totalRels += rels
}
const first = firstBucket[0] ?? 0
const last = lastBucket[lastBucket.length - 1] ?? 0
console.log(`\nfirst bucket ${first.toFixed(1)}ms/file -> last bucket ${last.toFixed(1)}ms/file  (ratio ${(last / first).toFixed(2)}x, rels=${totalRels})`)
console.log(
  last / first > 2
    ? "VERDICT: cost RISES with position in the run — the harness's single-process measurement describes its own degradation, not the analyzer."
    : "VERDICT: cost is flat across the run — position does not explain the swing.",
)
