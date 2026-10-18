/**
 * TS PERF ROW — the lane's D5 performance evidence, in a form the machine cannot lie about.
 *
 * ## Why a lane-local instrument
 *
 * `script/m14/ast-walk-cost.ts` measures the machine-independent counters (`type/node`,
 * `parent/node`) over ONE pinned sample per lane, and its TypeScript sample is
 * `aspnetcore/src/SignalR/.../HttpConnection.test.ts` — a path that does not exist in the
 * overnight corpus, so the shared instrument reports typescript as UNMEASURED ("sample missing
 * from the corpus"), not as passing. A lane whose perf row cannot be measured has no perf row, so
 * this script measures the row directly on files that ARE in the corpus.
 *
 * ## What it measures, and the honesty bounds
 *
 * Two times per file, min-of-N within one process (so warm-up is paid once and reported):
 *
 *   parseMs    `parser.parse(content)` only — the grammar cost
 *   analyzeMs  `analyzer.analyze(tree, …)` — the ANALYZER cost, which this lane's history shows
 *              dominates (measured 2026-09: 57 ms parse vs 1,863 ms analyze on a 108 KiB file,
 *              97.0% analyzer)
 *
 * Wall-clock is machine- and load-dependent; this box is shared, so the numbers are reported as
 * OBSERVED on a named machine at a named time and are NOT a portable gate. The ratio
 * analyze/parse IS structural and is what the row is for. File choice is deterministic (the three
 * largest admitted .ts files per a fixed scan), so a re-run is comparable to its own past.
 *
 * ## What it does NOT measure
 *
 * Not resolution, not correctness, not memory. It cannot attribute cost to a function — that needs
 * a CPU profile, which `ast-walk-cost.ts`'s header records as the method.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-perf.ts [--files 3] [--reps 3] [--json out]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../src/ast/real-typescript-analyzer"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const wantFiles = Number(argOf("--files") ?? 3)
const reps = Number(argOf("--reps") ?? 3)
const jsonOut = argOf("--json")

// Deterministic candidates: the largest admitted .ts files per repo, then the globally largest
// `wantFiles` — large and deep is the shape the cost class shows on.
const candidates: { abs: string; size: number }[] = []
let scannedRepos = 0
for (const name of fs.readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  scannedRepos++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".ts")) continue
    if (detectLanguageFromPath(rel) !== "typescript") continue
    const abs = path.join(dir, rel)
    try {
      const st = fs.statSync(abs)
      if (st.size > 0 && st.size <= SIZE_CAP) candidates.push({ abs, size: st.size })
    } catch {
      /* absent tracked file is not a perf sample */
    }
  }
}
candidates.sort((a, b) => b.size - a.size || (a.abs < b.abs ? -1 : 1))
const picked = candidates.slice(0, wantFiles)

const parser = await ASTEngine.getParser("typescript" as any)
const samples: any[] = []
for (const { abs, size } of picked) {
  const content = fs.readFileSync(abs, "utf8")
  let parseMs = Number.POSITIVE_INFINITY
  let analyzeMs = Number.POSITIVE_INFINITY
  let tree: any = null
  for (let rep = 0; rep < reps; rep++) {
    const t0 = performance.now()
    tree = parser.parse(content)
    const t1 = performance.now()
    if (tree === null) throw new Error(`no parse tree for ${abs}`)
    const analyzer = new RealTypeScriptAnalyzer()
    const t2 = performance.now()
    analyzer.analyze(tree.rootNode, content, path.join(path.basename(path.dirname(abs)), path.basename(abs)))
    const t3 = performance.now()
    parseMs = Math.min(parseMs, t1 - t0)
    analyzeMs = Math.min(analyzeMs, t3 - t2)
  }
  samples.push({
    file: abs.startsWith(CR) ? abs.slice(CR.length + 1) : abs,
    bytes: size,
    parseMs: Number(parseMs.toFixed(1)),
    analyzeMs: Number(analyzeMs.toFixed(1)),
    analyzeSharePct: Number(((100 * analyzeMs) / (parseMs + analyzeMs)).toFixed(1)),
  })
}

const totalBytes = samples.reduce((n, s) => n + s.bytes, 0)
const totalAnalyze = samples.reduce((n, s) => n + s.analyzeMs, 0)
const totalParse = samples.reduce((n, s) => n + s.parseMs, 0)
const report = {
  language: "typescript",
  method: "min-of-N in one process; parse vs analyze; wall-clock is machine/load dependent, the RATIO is structural",
  reps,
  corpusReposScanned: scannedRepos,
  candidates: candidates.length,
  samples,
  totals: {
    bytes: totalBytes,
    parseMs: Number(totalParse.toFixed(1)),
    analyzeMs: Number(totalAnalyze.toFixed(1)),
    analyzeSharePct: Number(((100 * totalAnalyze) / (totalParse + totalAnalyze || 1)).toFixed(1)),
    analyzeMsPerKiB: Number((totalAnalyze / (totalBytes / 1024 || 1)).toFixed(1)),
  },
}
console.log("TS PERF ROW — parse vs analyze (min-of-N, one process)")
console.log(`population: ${samples.length} largest admitted .ts file(s) from ${candidates.length} candidate(s) across ${scannedRepos} repo(s), ${(totalBytes / 1024).toFixed(0)} KiB total; reps ${reps}`)
console.log(`${"file".padEnd(72)} ${"KiB".padStart(7)} ${"parseMs".padStart(9)} ${"analyzeMs".padStart(10)} ${"analyze%".padStart(9)}`)
for (const s of samples) {
  console.log(`${s.file.slice(-72).padEnd(72)} ${(s.bytes / 1024).toFixed(0).padStart(7)} ${String(s.parseMs).padStart(9)} ${String(s.analyzeMs).padStart(10)} ${String(s.analyzeSharePct).padStart(9)}`)
}
console.log(`TOTAL: parse ${report.totals.parseMs} ms · analyze ${report.totals.analyzeMs} ms · analyzer share ${report.totals.analyzeSharePct}% · ${report.totals.analyzeMsPerKiB} ms analyze per KiB`)
console.log("NOTE: wall-clock on a shared box; the analyzer SHARE and ms/KiB are the portable readings. Not a resolution or correctness claim.")
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
