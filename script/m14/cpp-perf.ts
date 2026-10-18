/**
 * cpp-perf — the C++ lane's D5 performance row.
 *
 * WHAT IT MEASURES, and why this surface. The differential's own baseline records
 * `fmt:cpp` at **154.1 ms per file** (`validation/m14/differential-baseline.json`), and the
 * differential computes that number as the per-file `parse + analyze` wall time over its draw
 * (`script/m14/differential.ts:23600-23627`). This instrument measures the SAME two components
 * separately on a stated draw, so the ratio against the pinned number is a comparison of the same
 * surface rather than an apples-to-oranges one:
 *
 *   parseMs    `parser.parse(content, path)` only — the grammar cost
 *   analyzeMs  `RealCppAnalyzer.analyze(root, content, path)` — the analyzer cost
 *
 * HONESTY BOUNDS (the programme's own rule: a wall-clock on a shared box is OBSERVED, not portable):
 *   - the draw is deterministic (the differential's cpp extension set for fmt: cc,cpp,cxx,h,hpp,
 *     sorted, stride to N) so a re-run is comparable to its own past, but it is NOT the
 *     differential's cold-pool rotation and the two draws are never merged;
 *   - the reported `loadAvg1` is the machine context; the ratio is printed and marked
 *     **UNSCORED** because the pinned baseline was recorded on a different machine state and the
 *     programme's no-re-pin ruling (`#871`) says a busy-machine number must not be scored;
 *   - it does not measure resolution, correctness or memory, and cannot attribute cost to a
 *     function — that needs a CPU profile.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-perf.ts [--sample 60] [--json <path>]
 */
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as os from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const REPO = "fmt"
/** The differential's cpp extension universe (the baseline's draw universe), NOT the gate's 9. */
const DIFF_EXTS = ["cc", "cpp", "cxx", "h", "hpp"]
const SAMPLE = (() => {
  const j = process.argv.find((a) => a.startsWith("--sample="))
  return j ? Number(j.slice("--sample=".length)) : Number(process.argv[process.argv.indexOf("--sample") + 1] || 60)
})()
const JSON_OUT = (() => {
  const j = process.argv.find((a) => a.startsWith("--json="))
  return j ? j.slice("--json=".length) : null
})()

const { getParser } = await import("./run-fixtures")
const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))

const repoDir = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean)
} catch {
  console.error(`cpp-perf: ${repoDir} is not a git checkout (BB_CORPUS_ROOT=${CR})`)
  process.exit(2)
}
const admitted = tracked
  .filter((rel) => {
    const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
    const dot = base.lastIndexOf(".")
    return dot >= 0 && DIFF_EXTS.includes(base.slice(dot + 1))
  })
  .sort()
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const draw: string[] = []
for (let i = 0; i < admitted.length && draw.length < SAMPLE; i += stride) draw.push(admitted[i])

const parser: any = await getParser("cpp")
const analyzer = new mod.RealCppAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar(parser.language, parser.constructor) } catch { /* main pass only, same contract as the runner */ }
}

const rows: Array<{ file: string; bytes: number; parseMs: number; analyzeMs: number; totalMs: number }> = []
for (const rel of draw) {
  const abs = path.join(repoDir, rel)
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }
  const t0 = performance.now()
  const tree: any = parser.parse(content, abs)
  const parseMs = performance.now() - t0
  const t1 = performance.now()
  const result: any = await analyzer.analyze(tree.rootNode, content, rel)
  const analyzeMs = performance.now() - t1
  tree.delete?.()
  if (!result) continue
  rows.push({ file: rel, bytes: content.length, parseMs: +parseMs.toFixed(2), analyzeMs: +analyzeMs.toFixed(2), totalMs: +(parseMs + analyzeMs).toFixed(2) })
}
if (rows.length === 0) {
  console.error("cpp-perf: measured 0 files — refusing to report a row")
  process.exit(2)
}
const sorted = [...rows].sort((a, b) => a.totalMs - b.totalMs)
const total = rows.reduce((a, r) => a + r.totalMs, 0)
const parse = rows.reduce((a, r) => a + r.parseMs, 0)
const analyze = rows.reduce((a, r) => a + r.analyzeMs, 0)
const mean = total / rows.length
const median = sorted[Math.floor(sorted.length / 2)].totalMs
const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))].totalMs
const max = sorted[sorted.length - 1].totalMs
const totalKiB = rows.reduce((a, r) => a + r.bytes, 0) / 1024
const BASELINE_MS = 154.1
const load = os.loadavg()[0]

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-perf.ts",
  measuredAt: new Date().toISOString(),
  repo: REPO,
  draw: {
    sample: rows.length,
    admittedInRepo: admitted.length,
    extensions: DIFF_EXTS,
    strategy: "the differential's cpp extension set for fmt, sorted, stride — a stated deterministic draw, not the differential's cold-pool rotation",
  },
  machine: { platform: process.platform, arch: process.arch, cores: os.cpus().length, loadAvg1: +load.toFixed(2) },
  row: {
    meanMsPerFile: +mean.toFixed(1),
    medianMsPerFile: median,
    p90MsPerFile: p90,
    maxMsPerFile: max,
    msPerKiB: +(total / totalKiB).toFixed(3),
    analyzerSharePct: +(100 * analyze / total).toFixed(1),
    parseSharePct: +(100 * parse / total).toFixed(1),
    filesMeasured: rows.length,
  },
  perFile: sorted,
  baselineComparison: {
    pinnedBaseline: { source: "validation/m14/differential-baseline.json counts['fmt:cpp'].perf.avgMsPerFile", msPerFile: BASELINE_MS, surface: "differential per-file parse+analyze wall time over its draw" },
    ratio: +(mean / BASELINE_MS).toFixed(2),
    scored: false,
    whyUnscored: "the pinned baseline was recorded on a different machine state and the programme's no-re-pin ruling (#871) forbids scoring a busy-machine wall clock; the ratio is DISCLOSED, not a pass/fail",
  },
  note: "same measurement surface as the baseline (parse+analyze per file, both timed separately here); the draw differs from the differential's rotation and is stated so the two are never merged.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  fs.mkdirSync(path.dirname(path.resolve(ROOT, JSON_OUT)), { recursive: true })
  fs.writeFileSync(path.resolve(ROOT, JSON_OUT), json)
}
process.stdout.write(
  `cpp perf — repo ${REPO} · draw ${rows.length} of ${admitted.length} admitted files (${DIFF_EXTS.join(",")}, stride) · load ${report.machine.loadAvg1}\n` +
  `  mean ${report.row.meanMsPerFile} ms/file · median ${median} · p90 ${p90} · max ${max} · ${report.row.msPerKiB} ms/KiB\n` +
  `  analyzer share ${report.row.analyzerSharePct}% · parse share ${report.row.parseSharePct}%\n` +
  `  vs pinned differential baseline ${BASELINE_MS} ms/file (fmt:cpp): ratio ${report.baselineComparison.ratio}x — UNSCORED (shared box, #871 no-re-pin)\n`,
)
