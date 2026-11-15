// FS032 — the `open X` rows, printed from BOTH sides for one file.
// The differential reports ~123 UNEXPLAINED module-path references per 120 files and two
// successive fixes did not move the number, which is the signal to stop guessing and
// print what each side actually emits. The two lists are keyed the way the harness keys
// them (label, source, target) so the diff below is the residual, not an approximation.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const file = process.argv[2]!
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const root = parser.parse(src).rootNode
const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
const r: any = await new RealFsharpAnalyzer().analyze(root, src, file)
const truth = deriveFsharpEdges(root, r.symbols ?? [])

const A = new Map<string, number>()
for (const x of (r.relationships ?? [])) if (x.type === "references" && !x.metadata?.declaredOn) {
  A.set(`references|${x.source}|${x.target}`, (A.get(`references|${x.source}|${x.target}`) ?? 0) + 1)
}
const T = new Map<string, number>()
for (const e of truth) if (e.label === "references" && !e.declaredOn) {
  T.set(`references|${e.from}|${e.to}`, (T.get(`references|${e.from}|${e.to}`) ?? 0) + 1)
}
console.log(`analyzer open-path rows: ${[...A.values()].reduce((a, b) => a + b, 0)}   truth: ${[...T.values()].reduce((a, b) => a + b, 0)}`)
const onlyA = [...A.keys()].filter((k) => !T.has(k))
const onlyT = [...T.keys()].filter((k) => !A.has(k))
console.log(`only analyzer (${onlyA.length}):`); for (const k of onlyA.slice(0, 6)) console.log("   ", k)
console.log(`only truth (${onlyT.length}):`); for (const k of onlyT.slice(0, 6)) console.log("   ", k)
