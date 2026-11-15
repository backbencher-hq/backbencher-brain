// FS037 — does `ASTEngine.parseFile` see the same analyzer as calling `analyze()` directly?
//
// The residual probes disagreed on the same 120 files: fs028 reported 127 UNEXPLAINED
// open-path rows where a direct call reported 0. The only difference between them is the
// entry point — fs028 goes through the engine's `parseFile`, this lane's probes construct
// the analyzer themselves. The engine is the PRODUCTION path (the fixture runner uses it),
// so if the two disagree then every number measured off the direct call is a number about a
// program nobody runs, and the honest thing is to know which one is real before reporting
// either. This prints both, side by side, for one file.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
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
const tree = parser.parse(src)

const viaEngine: any = await ASTEngine.parseFile(file, src)
const viaDirect: any = await new RealFsharpAnalyzer().analyze(tree.rootNode, src, file)

const rows = (r: any) =>
  (r.relationships ?? [])
    .filter((x: any) => x.type === "references" && !x.metadata?.declaredOn)
    .map((x: any) => `${x.source} -> ${x.target}`)
    .sort()
const a = rows(viaEngine)
const b = rows(viaDirect)
console.log(`engine parseFile : ${a.length} open rows   symbols=${viaEngine.symbols?.length} rels=${viaEngine.relationships?.length} errors=${(viaEngine.errors ?? []).length}`)
console.log(`direct analyze() : ${b.length} open rows   symbols=${viaDirect.symbols?.length} rels=${viaDirect.relationships?.length} errors=${(viaDirect.errors ?? []).length}`)
console.log(`IDENTICAL: ${JSON.stringify(a) === JSON.stringify(b)}`)
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.log("  only engine:", a.filter((x) => !b.includes(x)).slice(0, 4))
  console.log("  only direct:", b.filter((x) => !a.includes(x)).slice(0, 4))
}
