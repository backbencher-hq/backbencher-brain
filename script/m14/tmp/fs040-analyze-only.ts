// FS040 — the ANALYZER's own cost, with parsing excluded.
//
// A per-file dump on a 719 KB compiler file times the PARSE too, and the M12 envelope already
// records that parse dominating there — which is how a real regression can hide: the two
// measurements differ by less than the noise in the parse.
//
// This parses ONCE, then times `analyze()` alone, N times, and reports the median. It exists
// because two root-walking helpers were added to the declared-type pass this round
// (`outermostCallableAbove`, `outermostTypeDefinitionAbove`), and that pass runs once per TYPE
// NODE — so the shape is O(n · depth) and the only way to know whether it matters is to
// measure the thing it sits inside.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const file = process.argv[2]!
const N = Number(process.argv[3] ?? 5)
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const t0 = performance.now()
const tree = parser.parse(src)
const parseMs = performance.now() - t0
// A FRESH ANALYZER PER ITERATION, and that is the whole point of the second version of this
// probe. The first version reused one analyzer across all iterations, and once the owner walks
// were memoised in a WeakMap keyed on the tree's nodes, iterations 2..N read a cache that run 1
// had already filled — with the SAME tree object — and reported 772 ms where the honest cold
// cost is roughly double. The measurement was not wrong about the code; it was measuring a
// warmed cache and calling it a per-file cost, which is the exact substitution the M12 envelope
// warns against when it separates parse from analysis. A benchmark that shares mutable state
// with itself is not a benchmark.
const times: number[] = []
let rels = 0
let syms = 0
for (let i = 0; i < N; i++) {
  const az = new RealFsharpAnalyzer()
  const a = performance.now()
  const r: any = await az.analyze(tree.rootNode, src, file)
  times.push(performance.now() - a)
  rels = (r.relationships ?? []).length
  syms = (r.symbols ?? []).length
}
times.sort((a, b) => a - b)
console.log(
  `${path.basename(file)}  ${(src.length / 1024).toFixed(0)}KB  parse ${parseMs.toFixed(0)}ms (once)  ` +
    `analyze COLD ${times[0]!.toFixed(0)}ms  median ${times[Math.floor(N / 2)]!.toFixed(0)}ms  ` +
    `symbols ${syms}  relationships ${rels}`,
)
