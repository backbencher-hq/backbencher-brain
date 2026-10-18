/**
 * solidity-perf — the Solidity lane's D5 performance row, measured on the SAME surface and
 * population as the recorded M60 baseline, with the ratio honestly unscored.
 *
 * THE BASELINE IT IS COMPARED TO: `validation/m60/results/solidity-perf.json` (gate
 * M60.solidity-perf, commit c25c144d) measured the WHOLE production corpus (389 files; test/ and
 * *.t.sol excluded) with `parseFile` per file, three trials, and reported the MINIMUM per-file time
 * across trials as the estimator (contention only adds time, so the fastest trial is the closest
 * available approach to the unloaded figure, an upper bound). It recorded min 59.738 ms/file at
 * loadAvg1 21.17. This instrument reproduces that shape on the CURRENT corpus:
 *
 *   · same population rule (git ls-files '*.sol', exclude test/ and *.t.sol) — counted and printed,
 *   · same production entry (`parseFile` from src/ast/pool-worker, the call engine.ts makes),
 *   · same estimator (minimum per-file across trials, median and load alongside),
 *   · a separate parse-vs-analyze split on a fixed subsample, so the ANALYZER share is reported and
 *     not inferred from a single number.
 *
 * HONESTY BOUNDS: a wall clock on a shared box is OBSERVED, not portable. The ratio against the
 * recorded baseline is DISCLOSED and marked UNSCORED because the programme's no-re-pin ruling (#871)
 * forbids scoring a busy-machine wall clock; the baseline's own `perfIsQualified` was false at
 * loadAvg1 21.17 and this run reports its own load. It measures speed only — not correctness, not
 * resolution, not memory.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/solidity-perf.ts [--trials=2] [--json=<path>]
 */
import * as os from "node:os"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { readFileSync } from "node:fs"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const REPO = "solidity"
const argOf = (flag: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : null
}
const TRIALS = Math.max(1, Number(argOf("--trials") ?? process.env.BB_PERF_TRIALS ?? "2"))
const JSON_OUT = argOf("--json")
const BASELINE_MIN_MS = 59.738 // M60.solidity-perf, min of 3 trials, 389 files, loadAvg1 21.17

const repoDir = path.join(CR, REPO)
let tracked: string[]
try {
  tracked = execFileSync("git", ["-C", repoDir, "ls-files", "*.sol"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\n").filter(Boolean)
} catch {
  console.error(`solidity-perf: ${repoDir} is not a git checkout (BB_CORPUS_ROOT=${CR})`)
  process.exit(2)
}
const production = tracked.filter((r) => !(r.startsWith("test/") || r.includes("/test/") || r.endsWith(".t.sol"))).sort()
if (production.length === 0) {
  console.error("solidity-perf: 0 production .sol files — refusing to report a row")
  process.exit(2)
}

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))

const trials: Array<{ trial: number; loadAvg1: number; wallMs: number; perFileMs: number; files: number; facts: number }> = []
for (let t = 1; t <= TRIALS; t++) {
  const load1 = os.loadavg()[0]
  const t0 = performance.now()
  let facts = 0
  for (const rel of production) {
    const r: any = await parseFile(path.join(repoDir, rel), repoDir)
    facts += (r.symbols?.length ?? 0) + (r.relationships?.length ?? 0)
  }
  const wallMs = performance.now() - t0
  trials.push({ trial: t, loadAvg1: Number(load1.toFixed(2)), wallMs: Number(wallMs.toFixed(1)), perFileMs: Number((wallMs / production.length).toFixed(3)), files: production.length, facts })
  if (t < TRIALS) await new Promise((r) => setTimeout(r, 3000))
}
const perFile = trials.map((x) => x.perFileMs).sort((a, b) => a - b)
const best = perFile[0]
const median = perFile[Math.floor(perFile.length / 2)]

// The analyzer-share split on a fixed subsample (first 40 production files): parse time and
// analyze() time are timed separately, so the share is measured rather than inferred.
const parserMod: any = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const parser: any = await parserMod.getParser("solidity")
const analyzerMod: any = await import(path.join(ROOT, "src/ast/real-solidity-analyzer.ts"))
const analyzer = new analyzerMod.RealSolidityAnalyzer()
let parseMs = 0
let analyzeMs = 0
let splitBytes = 0
const splitFiles = production.slice(0, 40)
for (const rel of splitFiles) {
  const abs = path.join(repoDir, rel)
  const content = readFileSync(abs, "utf8")
  splitBytes += content.length
  const t0 = performance.now()
  const tree: any = parser.parse(content, abs)
  parseMs += performance.now() - t0
  const t1 = performance.now()
  await analyzer.analyze(tree.rootNode, content, rel)
  analyzeMs += performance.now() - t1
  tree.delete?.()
}
const totalSplit = parseMs + analyzeMs

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-perf.ts",
  measuredAt: new Date().toISOString(),
  repo: REPO,
  population: { productionFiles: production.length, allSolidityFiles: tracked.length, rule: "git ls-files *.sol; exclude test/ and *.t.sol (the M60 baseline's rule)", repoDir },
  machine: { platform: process.platform, arch: process.arch, cores: os.cpus().length, loadAvg1: Number(os.loadavg()[0].toFixed(2)) },
  row: {
    trials,
    estimator: "minimum per-file time across trials (contention only adds time; an upper bound on the unloaded figure)",
    minMsPerFile: best,
    medianMsPerFile: median,
    wallMsBestTrial: trials.reduce((a, b) => (a.perFileMs <= b.perFileMs ? a : b)).wallMs,
    factsBestTrial: trials.reduce((a, b) => (a.perFileMs <= b.perFileMs ? a : b)).facts,
    analyzerSharePct: totalSplit > 0 ? Number(((100 * analyzeMs) / totalSplit).toFixed(1)) : null,
    split: { files: splitFiles.length, parseMs: Number(parseMs.toFixed(1)), analyzeMs: Number(analyzeMs.toFixed(1)), msPerKiB: Number((totalSplit / (splitBytes / 1024)).toFixed(3)) },
  },
  baselineComparison: {
    baseline: {
      source: "validation/m60/results/solidity-perf.json (gate M60.solidity-perf, commit c25c144d)",
      estimator: "min per-file of 3 trials over 389 production files",
      minMsPerFile: BASELINE_MIN_MS,
      loadAvg1: 21.17,
      qualified: false,
    },
    ratio: Number((best / BASELINE_MIN_MS).toFixed(2)),
    scored: false,
    whyUnscored: "the baseline was recorded at loadAvg1 21.17 with its own perfIsQualified=false; the programme's no-re-pin ruling (#871) forbids scoring a busy-machine wall clock. The ratio is DISCLOSED, not a pass/fail.",
  },
  note: "same population rule, same production entry (parseFile) and same estimator as the baseline; the box is shared and each trial's loadAvg1 is recorded so a reader can judge contention.",
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const target = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, json)
}
process.stdout.write(
  `solidity perf — ${production.length} production .sol files x ${TRIALS} trial(s) · load ${report.machine.loadAvg1}\n` +
  `  min ${best} ms/file · median ${median} ms/file (trials: ${trials.map((t) => `${t.perFileMs}@${t.loadAvg1}`).join(" · ")})\n` +
  `  analyzer share ${report.row.analyzerSharePct}% · ${report.row.split.msPerKiB} ms/KiB on the ${splitFiles.length}-file split (parse ${report.row.split.parseMs} ms / analyze ${report.row.split.analyzeMs} ms)\n` +
  `  vs recorded M60 baseline min ${BASELINE_MIN_MS} ms/file (389 files, load 21.17): ratio ${report.baselineComparison.ratio}x — UNSCORED (#871 no-re-pin)\n`,
)
