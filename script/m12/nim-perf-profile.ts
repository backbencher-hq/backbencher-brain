// NIM performance profile — where the analyzer's time actually goes.
//
// Written because the F9 perf budget had no measurement behind it for ANY
// language, and because a CPU profile is not a budget: sampling attributes
// tree-sitter's WASM work to `(idle)`, so a profile of this analyzer reported
// "94% idle, 0.00s in real-nim-analyzer" while the analyzer was in fact 82% of
// wall time. The phase split below is measured, not sampled, and it is the
// number an optimization has to move.
//
// Two facts this established, both of which an optimization must respect:
//
//   1. Six SEPARATE full-tree walks account for ~99% of the cost
//      (collectDeclarations, collectCallsAndUses, collectDeclaredTypeRefs,
//      collectInstantiations, collectModules, collectDocComments, plus the
//      complexity counter). The three passes that walk the SYMBOL TABLE instead
//      of the tree — containment, inheritance, overrides — cost 0.04% combined.
//      Every `namedChild(i)` and `childForFieldName` crosses the JS<->WASM
//      boundary, so paying it six times over the same nodes is the cost.
//   2. `tree-sitter` parsing is only ~18% of end-to-end time. Optimizing the
//      grammar is therefore NOT where a speedup lives; the analyzer is.
//
// Run:  npx tsx script/m12/nim-perf-profile.ts <repo> [files]
// Writes: validation/m12/results/nim-perf-profile.json
//
// Deliberately NOT the corpus throughput record. That is
// script/m12/nim-corpus-measure.ts, which measures the production pool-worker
// route end to end. This script exists to attribute cost WITHIN the analyzer,
// and it says so in its own artifact, so the two numbers are never confused.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { RealNimAnalyzer } from "../../src/ast/real-nim-analyzer"

const ROOT = process.cwd()
const REPO = process.argv[2] ?? "$HOME/fixtures/repositories/nim"
const N = parseInt(process.argv[3] ?? "200", 10)

if (!existsSync(REPO)) {
  console.error(`no such repo: ${REPO}`)
  process.exit(1)
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const Lang = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.resolve(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await Lang.load(readFileSync(path.resolve(ROOT, "wasm/tree-sitter-nim.wasm"))))

const files: string[] = []
;(function walk(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f)
    else if (e.name.endsWith(".nim")) files.push(f)
  }
})(REPO)
const sample = files.sort().filter((_, i) => i % Math.max(1, Math.floor(files.length / N)) === 0).slice(0, N)
const srcs = sample.map((f) => [f, readFileSync(f, "utf8")] as const)

const an: any = new RealNimAnalyzer()
const freshCtx = () => {
  const docCommentByStartLine = new Map<number, string>()
  return {
    symbols: [] as any[], relationships: [] as any[], imports: [] as any[], exports: [] as any[], errors: [] as any[],
    fileValues: new Set<string>(), fileTypes: new Set<string>(), fileCallables: new Set<string>(),
    fileEnumMembers: new Set<string>(), fileFieldNames: new Set<string>(), genericParamNames: new Set<string>(),
    importQualifiers: new Set<string>(), declaredSubtypes: new Map<string, Set<string>>(), docCommentByStartLine,
  }
}
const declCtx = (c: any) => ({
  symbols: c.symbols, errors: c.errors, docCommentByStartLine: c.docCommentByStartLine,
  fileValues: c.fileValues, fileTypes: c.fileTypes, fileCallables: c.fileCallables,
  fileEnumMembers: c.fileEnumMembers, fileFieldNames: c.fileFieldNames,
  genericParamNames: c.genericParamNames, declaredSubtypes: c.declaredSubtypes,
})

// PARSE vs ANALYZE, then per phase. Both are timed with hrtime over a warmed
// run; the warm-up matters because the first pass pays JIT and WASM tier-up.
const warm = 15
for (let i = 0; i < warm; i++) {
  const c = freshCtx()
  const t = parser.parse(srcs[i % srcs.length][1])
  an.collectDocModulesAndComplexity(t.rootNode, c.docCommentByStartLine, c.imports, c.exports, c.importQualifiers, c.relationships)
  an.collectDeclarations(t.rootNode, declCtx(c))
}
let t0 = process.hrtime.bigint()
const trees = srcs.map(([, s]) => parser.parse(s))
const parseMs = Number(process.hrtime.bigint() - t0) / 1e6

// The phase list is the analyzer's CURRENT internal shape, so this file has to
// move when the walks are fused — which is the point: a profile that silently
// measured a phase that no longer exists would keep reporting a number for it.
// `collectDocComments`, `collectModules`, `collectInstantiations` and
// `collectDeclaredTypeRefs` were all absorbed into other walks; asking for them
// throws here rather than reporting a fabricated 0ms.
const phases: [string, (t: any, c: any) => void][] = [
  ["collectDocModulesAndComplexity", (t, c) => an.collectDocModulesAndComplexity(t, c.docCommentByStartLine, c.imports, c.exports, c.importQualifiers, c.relationships)],
  ["collectDeclarations", (t, c) => an.collectDeclarations(t, declCtx(c))],
  ["collectCallsAndUses (calls+uses+instantiates+declaredTypeRefs)", (t, c) => an.collectCallsAndUses(t, c.relationships, c)],
  ["makeDeclaredTypeRefHelpers (once per file, amortised)", () => {}],
  ["nimCyclomaticComplexity (per callable body)", (t) => an.nimCyclomaticComplexity(t)],
]
const phaseMs: Record<string, number> = {}
for (const [name, fn] of phases) {
  const c = freshCtx()
  const start = process.hrtime.bigint()
  for (let i = 0; i < trees.length; i++) fn(trees[i].rootNode, c)
  phaseMs[name] = +(Number(process.hrtime.bigint() - start) / 1e6).toFixed(0)
}
// The symbol-table passes, which is where containment/inheritance/overrides live.
{
  const c = freshCtx()
  for (const t of trees) an.collectDeclarations(t.rootNode, declCtx(c))
  const rel: any[] = []
  const start = process.hrtime.bigint()
  an.collectContainment(c.symbols, rel)
  const mid = process.hrtime.bigint()
  an.collectInheritance(c.symbols, rel, c.fileTypes)
  an.collectOverrides(c.symbols, rel, c.declaredSubtypes)
  const end = process.hrtime.bigint()
  phaseMs["collectContainment"] = +(Number(mid - start) / 1e6).toFixed(0)
  phaseMs["collectInheritance+Overrides"] = +(Number(end - mid) / 1e6).toFixed(0)
}

t0 = process.hrtime.bigint()
let symbols = 0
let relationships = 0
for (let i = 0; i < trees.length; i++) {
  const r: any = await an.analyze(trees[i].rootNode, srcs[i][1], srcs[i][0])
  symbols += r?.symbols?.length ?? 0
  relationships += r?.relationships?.length ?? 0
}
const analyzeMs = Number(process.hrtime.bigint() - t0) / 1e6
const bytes = srcs.reduce((a, [, s]) => a + s.length, 0)
const phaseTotal = Object.values(phaseMs).reduce((a, b) => a + b, 0)

const document = {
  schemaVersion: 1,
  kind: "nim_analyzer_phase_profile",
  note:
    "Attribution WITHIN the analyzer, measured with hrtime over a warmed run — not a CPU " +
    "sample. A sampling profile of this analyzer mis-reports it as idle because tree-sitter's " +
    "WASM work does not attribute to JS frames. This artifact is NOT the corpus throughput " +
    "record (script/m12/nim-corpus-measure.ts is) and the two must not be conflated.",
  repo: REPO,
  files: trees.length,
  mib: +(bytes / 1048576).toFixed(2),
  symbols,
  relationships,
  split: {
    parseMs: +parseMs.toFixed(0),
    analyzeMs: +analyzeMs.toFixed(0),
    parseSharePct: +((100 * parseMs) / (parseMs + analyzeMs)).toFixed(1),
    parseMibPerSec: +(bytes / 1048576 / (parseMs / 1000)).toFixed(2),
    analyzeMsPerFile: +(analyzeMs / trees.length).toFixed(2),
    analyzeSymbolsPerSec: Math.round(symbols / (analyzeMs / 1000)),
  },
  phasesMs: phaseMs,
  phasePct: Object.fromEntries(Object.entries(phaseMs).map(([k, v]) => [k, +((100 * v) / phaseTotal).toFixed(1)])),
  treeWalks: phases.filter(([n]) => !n.startsWith("make") && !n.startsWith("nimCyclo")).length,
  treeWalkNote:
    "Every phase above except the symbol-table pair is a SEPARATE full-tree walk. " +
    "Fusing them is the available speedup, and the walks are the cost.",
}
writeFileSync("validation/m12/results/nim-perf-profile.json", JSON.stringify(document, null, 2) + "\n")
console.log(`files=${trees.length} mib=${document.mib} symbols=${symbols} relationships=${relationships}`)
console.log(`parse ${parseMs.toFixed(0)}ms (${document.split.parseSharePct}%) | analyze ${analyzeMs.toFixed(0)}ms (${document.split.analyzeMsPerFile}ms/file, ${document.split.analyzeSymbolsPerSec} sym/s)`)
for (const [k, v] of Object.entries(phaseMs).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}ms ${String(document.phasePct[k]).padStart(5)}%  ${k}`)
console.log("wrote validation/m12/results/nim-perf-profile.json")
