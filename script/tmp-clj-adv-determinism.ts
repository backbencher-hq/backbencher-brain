// tmp-clj-adv-determinism.ts — same file analyzed twice must emit identical ordered edges.
import * as fs from "node:fs"; import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-clojure-analyzer")
for (const F of process.argv.slice(2)) {
  const src = fs.readFileSync(F, "utf8")
  const a = new anaMod.RealClojureAnalyzer(); const r1 = a.analyze(p.parse(src).rootNode, src, F)
  const b = new anaMod.RealClojureAnalyzer(); const r2 = b.analyze(p.parse(src).rootNode, src, F)
  const s1 = JSON.stringify({ rel: r1.relationships, sym: r1.symbols, imp: r1.imports, meta: r1.metadata })
  const s2 = JSON.stringify({ rel: r2.relationships, sym: r2.symbols, imp: r2.imports, meta: r2.metadata })
  console.log(`${path.basename(F)}: identical=${s1 === s2} rels=${r1.relationships.length}`)
}
