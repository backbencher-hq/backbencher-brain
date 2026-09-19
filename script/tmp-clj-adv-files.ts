// tmp-clj-adv-files.ts — run analyzer on corpus files, filter edges by pattern
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const mod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()
const F = process.argv[2]; const filter = process.argv[3] ?? ""
const src = fs.readFileSync(F, "utf8")
const res = analyzer.analyze(p.parse(src).rootNode, src, F)
console.log(`### ${F}`)
for (const r of res.relationships) {
  const s = `${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} meta=${JSON.stringify(r.metadata)}`
  if (filter === "" || s.includes(filter)) console.log(s)
}
console.log("IMPORTS:", JSON.stringify(res.imports.map((i: any) => ({ m: i.module, items: i.items, line: i.line }))))
console.log("PATTERNS:", JSON.stringify(res.metadata.patterns))
