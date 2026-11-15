// FS034 — print the truth oracle's rows for ONE source name, with the analyzer's verdict
// beside each. The residual's biggest class is 24 rows sourced to `convTypeAux` in
// ilreflect.fs, and `convTypeAux` is declared with `and` at line 743 while the rows sit at
// line 720 — inside a DIFFERENT function. Two implementations disagreeing about which
// function a call is in is a scope bug in one of them, and this prints which.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) { await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") }); (P as any).__init = true }
const file = process.argv[2]!
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const root = parser.parse(src).rootNode
const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
const r: any = await new RealFsharpAnalyzer().analyze(root, src, file)
const truth = deriveFsharpEdges(root, r.symbols ?? [])
const rels = new Set((r.relationships ?? []).map((x: any) => `${x.type}|${x.source}|${x.target}`))
const want = process.argv[3]!
for (const e of truth) {
  if (e.from !== want) continue
  const k = `calls|${e.from}|${e.to}`
  console.log(`L${String(e.line).padStart(5)}  truth ${e.label} ${e.from} -> ${e.to}   analyzer has it: ${rels.has(k)}`)
}
