/**
 * 2026-09-29: is the per-symbol cost drift in the ANALYZER, or in the PARSE that feeds it?
 *
 * WHY THIS QUESTION, AND WHY IT MATTERS MORE THAN THE NUMBER. The complexity section of the
 * analyzer's doc claims a hot path with no super-linear term, and this session withdrew that claim
 * because three identical runs gave per-symbol drift of 49%, 91% and 54%. The withdrawal was the
 * honest move, but it is not the last word: the DIRECTION has been consistent on every run including
 * three on a host at load 5.7, so a super-linear term probably exists rather than being load noise.
 *
 * The measurement that was never done is the obvious one. Every figure so far came from timing
 * `ASTEngine.parseFile`, which bundles two very different costs:
 *
 *   1. tree-sitter parse, in a FIXED-SIZE wasm heap that JS GC cannot reclaim. differential.ts's own
 *      comment records that the module degrades after 19-31 lanes and that only 21 grammar modules
 *      are ever live because the heap is not returned. Growth inside that heap would show up as
 *      super-linear wall time while the analyzer did nothing wrong.
 *   2. the analyzer's own passes.
 *
 * Those have opposite implications. Drift in (1) is an engine characteristic and the analyzer's
 * linearity claim survives intact. Drift in (2) is a real algorithmic defect in code this lane owns,
 * and it is fixable.
 *
 * So this times them separately, over growing prefixes of one pinned corpus, taking the minimum over
 * runs per size so a single noisy run cannot decide it, and reports the per-SYMBOL drift of each. The
 * pinned prefix matters for a second reason the earlier instrument already documented: symbols/file
 * swings 11.2 to 17.8 across sizes, so a per-file number measures the sample rather than the code.
 */
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
function arg(f: string): string | undefined { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new P()
parser.setLanguage(grammar)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))

const SIZES = [50, 100, 200, 400]
const RUNS = Number(arg("--runs") ?? 5)
const listFile = arg("--list")!
const all = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean)

interface Row { size: number; syms: number; parseMs: number; analyzeMs: number }
const rows: Row[] = []

for (const size of SIZES) {
  const files = all.slice(0, size)
  const texts: string[] = []
  for (const f of files) {
    try {
      const t = fs.readFileSync(f, "utf8")
      if (t.length <= 1_000_000) texts.push(t)
    } catch { /* unreadable */ }
  }
  let bestParse = Number.POSITIVE_INFINITY
  let bestAnalyze = Number.POSITIVE_INFINITY
  let syms = 0
  for (let r = 0; r < RUNS; r++) {
    // A FRESH analyzer per run: if the analyzer accumulated cross-file state the reuse case would
    // hide it, and if it does not, reusing one instance is the honest production shape. Measuring a
    // fresh instance also means the parse timing below is not polluted by analyzer work.
    const a = new mod.RealCSharpAnalyzer()
    const roots: any[] = []
    let tp = 0
    for (const t of texts) {
      const t0 = performance.now()
      const root = parser.parse(t)?.rootNode
      tp += performance.now() - t0
      roots.push(root)
    }
    let ta = 0
    for (let i = 0; i < texts.length; i++) {
      if (!roots[i]) continue
      const t0 = performance.now()
      try { const res = await a.analyze(roots[i], `f${i}.cs`, texts[i]); syms += res?.symbols?.length ?? 0 } catch { /* as above */ }
      ta += performance.now() - t0
    }
    if (tp < bestParse) bestParse = tp
    if (ta < bestAnalyze) bestAnalyze = ta
    syms = Math.round(syms / RUNS)
  }
  rows.push({ size: texts.length, syms, parseMs: bestParse, analyzeMs: bestAnalyze })
}

console.log(`parse vs analyze — ${os.cpus().length} cores, load ${fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]}, min over ${RUNS} runs\n`)
console.log("  files  symbols   parse ms/file   parse us/sym   analyze ms/file   analyze us/sym")
for (const r of rows) {
  const pf = r.parseMs / r.size, af = r.analyzeMs / r.size
  console.log(`  ${String(r.size).padStart(5)}${String(r.syms).padStart(9)}${pf.toFixed(2).padStart(15)}${(1000 * pf / (r.syms / r.size)).toFixed(1).padStart(15)}${af.toFixed(2).padStart(17)}${(1000 * af / (r.syms / r.size)).toFixed(1).padStart(17)}`)
}
const first = rows[0], last = rows[rows.length - 1]
const symsPer = (n: number) => rows.map((r) => n === 0 ? 1000 * (r.parseMs / r.size) / (r.syms / r.size) : 1000 * (r.analyzeMs / r.size) / (r.syms / r.size))
const drift = (vals: number[]) => 100 * ((vals[vals.length - 1] / vals[0]) - 1)
const dp = drift(symsPer(0)), da = drift(symsPer(1))
console.log(`\n  PARSE   per-symbol drift ${first.syms} -> ${last.syms} symbols: ${dp >= 0 ? "+" : ""}${dp.toFixed(1)}%`)
console.log(`  ANALYZE per-symbol drift ${first.syms} -> ${last.syms} symbols: ${da >= 0 ? "+" : ""}${da.toFixed(1)}%`)
console.log(`\n  READ THIS BEFORE CONCLUDING ANYTHING, because the two possibilities have opposite`)
console.log(`  consequences and only one of them is a defect in code this lane owns.`)
console.log(`    drift concentrated in PARSE    -> the wasm heap does not shrink and JS GC cannot`)
console.log(`                                     reclaim it. An engine characteristic; the analyzer's`)
console.log(`                                     linearity claim SURVIVES and should be restored.`)
console.log(`    drift concentrated in ANALYZE  -> a real algorithmic defect here, and worth finding.`)
console.log(`    drift in both                  -> allocation pressure feeding both, still not the`)
console.log(`                                     analyzer's algorithm.`)
console.log(`    large drift in NEITHER         -> the earlier figure was dominated by parse+analyze`)
console.log(`                                     together plus GC, and per-symbol cost is roughly flat.`)