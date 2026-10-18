// JAVASCRIPT PERF PROBE — the lane's own measurement of `parse + analyze` cost per file, compared
// to the differential baseline row the completeness inventory's section F scores against.
//
// WHY A LANE INSTRUMENT. The differential's perf numbers are written into its artifact, but a
// scoped `--lang javascript` run explicitly refuses to write M14.0.F5 (it would replace the
// canonical sweep's claim with a smaller one), so a lane that needs a FRESH reading of its own perf
// row — with the current analyzer digest — has no way to get one from the differential's output.
// This probe measures exactly the same unit the baseline row records: for each sampled file, the
// wall time of the production parse+analyze path, reported as an average and compared to
// `validation/m14/differential-baseline.json`'s `counts["<repo>:<lang>"].perf.avgMsPerFile`.
//
// It is a measurement, not a gate: it prints numbers, changes no artifact, and exits 0 unless the
// baseline row or the corpus is missing (an instrument that cannot find its own comparison refuses
// to report a green).
//
// USAGE
//   export BB_CORPUS_ROOT=$PWD/.corpus
//   bun run script/m14/js-perf-probe.ts --repo=lodash --sample=60
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const REPO = process.argv.find((a) => a.startsWith("--repo="))?.slice("--repo=".length) ?? "lodash"
const SAMPLE = Number(process.argv.find((a) => a.startsWith("--sample="))?.slice("--sample=".length) ?? 60)
const EXTENSIONS = ["js", "jsx", "mjs", "cjs"]
const SIZE_CAP = 1024 * 1024

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    let st
    try { st = statSync(abs) } catch { continue }
    // symlinked corpus directories: statSync follows the link, the walk keeps going
    if (st.isDirectory()) { walk(abs, out); continue }
    const dot = name.lastIndexOf(".")
    if (dot < 0) continue
    if (!EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())) continue
    if (st.size > SIZE_CAP) continue
    out.push(abs)
  }
}

const files: string[] = []
const repoDir = path.join(CR, REPO)
try { walk(repoDir, files) } catch {
  console.error(`js-perf-probe: corpus repo not found at ${repoDir} (set BB_CORPUS_ROOT)`)
  process.exit(2)
}
files.sort()
const stride = Math.max(1, Math.floor(files.length / SAMPLE))
const sample: string[] = []
for (let i = 0; i < files.length && sample.length < SAMPLE; i += stride) sample.push(files[i])

const baselinePath = path.join(process.cwd(), "validation", "m14", "differential-baseline.json")
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { counts?: Record<string, { perf?: { avgMsPerFile?: number | null } }> }
const row = baseline.counts?.[`${REPO}:javascript`]
const baselineMs = row?.perf?.avgMsPerFile ?? null
if (baselineMs === null || baselineMs === undefined) {
  console.error(`js-perf-probe: no baseline perf row for ${REPO}:javascript — refusing to report a number with nothing to compare it to`)
  process.exit(2)
}

const durations: number[] = []
let analysed = 0
// Warm-up: the first parse pays one-time wasm compilation, which would poison a 55-file average.
try { await parseFile(sample[0], repoDir, { projectRoot: repoDir }) } catch { /* warm-up is best-effort */ }
for (const f of sample) {
  const t0 = performance.now()
  try {
    await parseFile(f, repoDir, { projectRoot: repoDir })
    durations.push(performance.now() - t0)
    analysed++
  } catch { /* a file that cannot be read is not a duration */ }
}
if (analysed === 0) {
  console.error("js-perf-probe: parsed 0 files — DEAD measurement, nothing reported")
  process.exit(2)
}
const sum = durations.reduce((a, b) => a + b, 0)
const avg = sum / durations.length
const sorted = [...durations].sort((a, b) => a - b)
console.log(JSON.stringify({
  probe: "js-perf-probe",
  command: `bun run script/m14/js-perf-probe.ts --repo=${REPO} --sample=${SAMPLE}`,
  population: { repo: REPO, corpusFiles: files.length, sampled: sample.length, analysed },
  measured: {
    avgMsPerFile: Number(avg.toFixed(1)),
    p50MsPerFile: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
    maxMsPerFile: Number(sorted[sorted.length - 1].toFixed(1)),
  },
  baseline: { source: "validation/m14/differential-baseline.json", row: `${REPO}:javascript`, avgMsPerFile: baselineMs },
  ratio: Number((avg / baselineMs).toFixed(3)),
  note: "measurement only; the completeness inventory's section F is the budget gate",
}, null, 1))
