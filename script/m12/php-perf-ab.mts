// PHP A/B — is a change to the analyzer FASTER, and is its output IDENTICAL?
//
// Two numbers, both required, and a change that improves one while breaking the
// other is a regression, not an improvement:
//
//   1. speed, measured noise-proofly. The php profile moved 19.21 -> 22.31
//      ms/file between two consecutive runs of the SAME code, so a single
//      before/after pair on this machine means nothing. This runs the two
//      analyzers INTERLEAVED (A,B,A,B,...) so any drift in machine load hits
//      both equally, then reports the MEDIAN of per-round ratios rather than a
//      ratio of totals.
//   2. output equality, field-by-field. Compare the analyzed RESULT of every
//      file: symbols, relationships, imports, exports, errors. A faster analyzer
//      that quietly drops an edge is not faster, it is wrong — and the whole
//      point of A/B-ing is that "it got faster" and "it still agrees" are
//      separate claims needing separate evidence.
//
// Run:  bun script/m12/php-perf-ab.mts [baselineRef] [files] [reps]
//   baselineRef defaults to HEAD~1, so the usual use is "did my last commit
//   make anything faster, and did it change anything?".
// Writes: validation/m12/results/php-perf-ab.json
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
import { RealPhpAnalyzer } from "../../src/ast/real-php-analyzer"

const ROOT = process.cwd()
const REPO = process.env.CORPUS ?? "$HOME/fixtures/repositories/phpunit"
const BASELINE = process.argv[2] ?? "HEAD~1"
const N = parseInt(process.argv[3] ?? "120", 10)
const REPS = parseInt(process.argv[4] ?? "9", 10)
const LIVE = "src/ast/real-php-analyzer.ts"
const TMP = path.join(ROOT, "script/m14/tmp/php-baseline-analyzer.mts")

if (!existsSync(REPO)) { console.error(`no such repo: ${REPO}`); process.exit(1) }

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const Lang = wts.Language ?? wts.default?.Lang
await P.init({ locateFile: () => path.resolve(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await Lang.load(readFileSync(path.resolve(ROOT, "wasm/tree-sitter-php.wasm")))

const files: string[] = execSync(`git ls-files -z -- '*.php'`, { cwd: REPO, maxBuffer: 1 << 28 })
  .toString().split("\0").filter(Boolean).sort()
const sample = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / N)) === 0).slice(0, N)
const srcs = sample.map((f) => [path.relative(REPO, path.join(REPO, f)), readFileSync(path.join(REPO, f), "utf8")] as const)

// Materialize the baseline analyzer as its own module so both versions can be
// live at once. Importing the ref's source verbatim (not a hand copy) is the
// only way the comparison cannot drift from what is actually committed.
const baselineSrc = execSync(`git show ${BASELINE}:${LIVE}`, { cwd: ROOT, maxBuffer: 1 << 26 }).toString()
if (baselineSrc === readFileSync(path.join(ROOT, LIVE), "utf8")) {
  console.log(`baseline ${BASELINE} is byte-identical to the working ${LIVE} — nothing to compare`)
  process.exit(0)
}
// The baseline module is materialized OUTSIDE src/ast/, so its own relative
// specifiers would no longer resolve. Re-root them at the real src/ast/ rather
// than dropping the file inside the analyzer directory, which several gates
// enumerate. A hand-copied import would be a silent way to A/B the wrong code.
const AST_DIR = path.resolve(ROOT, "src/ast")
const reRooted = baselineSrc.replace(/(from\s+["'])(\.[^"']*)/g, (_m, q, rel) => `${q}${path.resolve(AST_DIR, rel)}`)
writeFileSync(TMP, reRooted)
const { RealPhpAnalyzer: Baseline }: any = await import(TMP)

const trees = srcs.map(([, s]) => { const p = new P(); p.setLanguage(grammar); return p.parse(s) })
const live: any = new RealPhpAnalyzer()
const base: any = new Baseline()

// --- output equality, on every file, BEFORE any timing ---
const canon = (r: any) => JSON.stringify({
  symbols: (r?.symbols ?? []).map((s: any) => [s.kind, s.name, s.ownerName ?? null, s.range?.startLine ?? s.startLine ?? null, s.range?.endLine ?? s.endLine ?? null]),
  relationships: (r?.relationships ?? []).map((x: any) => [x.type ?? x.relationshipType, x.source, x.target, x.confidence ?? null, x.line_number ?? null]),
  imports: (r?.imports ?? []).map((i: any) => [i.module ?? i.path, i.items ?? [], i.isDefaultImport ?? null]),
  exports: (r?.exports ?? []).map((e: any) => [e.name ?? e, e.kind ?? null]),
  errors: (r?.errors ?? []).length,
})
const diffs: string[] = []
for (let i = 0; i < trees.length; i++) {
  const rel = srcs[i][0]
  const a = canon(await live.analyze(trees[i].rootNode, srcs[i][1], rel))
  const b = canon(await base.analyze(trees[i].rootNode, srcs[i][1], rel))
  if (a !== b && diffs.length < 12) diffs.push(rel)
}

// --- speed: interleaved, median of per-round ratios ---
const runOnce = async (an: any): Promise<number> => {
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < trees.length; i++) await an.analyze(trees[i].rootNode, srcs[i][1], srcs[i][0])
  return Number(process.hrtime.bigint() - t0) / 1e6 / trees.length
}
for (let i = 0; i < 2; i++) { await runOnce(live); await runOnce(base) }   // warm both
const ratios: number[] = [], liveMs: number[] = [], baseMs: number[] = []
for (let r = 0; r < REPS; r++) {
  const l = await runOnce(live)
  const b = await runOnce(base)
  liveMs.push(l); baseMs.push(b); ratios.push(b / l)                        // >1 means live is faster
}
const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

const spreadPctNow = ((Math.max(...liveMs) - Math.min(...liveMs)) / median(liveMs)) * 100

const art = {
  schemaVersion: 1, milestone: "M12", language: "php",
  purpose: "noise-proof A/B: speed change AND output equality, reported separately",
  baseline: BASELINE, live: LIVE,
  corpus: REPO,
  revision: execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim(),
  generatedAt: new Date().toISOString(),
  sample: `${sample.length} of ${files.length} tracked .php files (deterministic strided)`,
  reps: REPS,
  method: "interleaved A,B per round; median of per-round ratios; output compared field-by-field on every file before timing",
  outputIdentical: diffs.length === 0,
  outputDiffFiles: diffs,
  speed: {
    liveMsPerFile: +median(liveMs).toFixed(3),
    baselineMsPerFile: +median(baseMs).toFixed(3),
    speedup: +median(ratios).toFixed(3),
    spreadPct: +(((Math.max(...liveMs) - Math.min(...liveMs)) / median(liveMs)) * 100).toFixed(1),
    // A speedup is only a claim if the measurement can support it. The php
    // profile moved 19.21 -> 22.31 ms/file between two consecutive runs of
    // IDENTICAL code, and a 5-rep A/B on a busy shared box showed a 106%
    // spread — so below this threshold the run is reported as INDETERMINATE
    // rather than as a result. Interleaving removes drift, not contention.
    verdict: spreadPctNow > 25 ? "INDETERMINATE (spread too high to claim a speedup)" : "MEASURABLE",
  },
}
writeFileSync(path.join(ROOT, "validation/m12/results/php-perf-ab.json"), JSON.stringify(art, null, 2) + "\n")
try { execSync(`rm -f ${TMP}`) } catch { /* the baseline module is disposable */ }

console.log(`php A/B vs ${BASELINE} over ${sample.length} files x ${REPS} interleaved reps`)
console.log(`  live ${art.speed.liveMsPerFile} ms/file | baseline ${art.speed.baselineMsPerFile} ms/file | speedup ${art.speed.speedup}x (run spread ${art.speed.spreadPct}%)`)
console.log(`  output identical: ${art.outputIdentical ? "YES" : `NO — ${diffs.length} file(s): ${diffs.slice(0, 5).join(", ")}`}`)
console.log(`  speed verdict: ${art.speed.verdict}`)
