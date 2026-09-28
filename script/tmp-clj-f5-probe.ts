// tmp-clj-f5-probe.ts — analyzer edge dump for one F5-diff file.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass()
p.setLanguage(g)
const mod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new mod.RealClojureAnalyzer()

const F = process.argv[2]
const filter = process.argv[3] ?? ""
const src = fs.readFileSync(F, "utf8")
const res = analyzer.analyze(p.parse(src).rootNode, src, F)
console.log("symbols:", res.symbols.filter((s: any) => s.name.includes("report") || (s.metadata?.isMethodImpl)).map((s: any) => `${s.name}[${s.kind}] owner=${s.ownerName}`).join(", "))
for (const r of res.relationships) {
  const s = JSON.stringify(r)
  if (s.includes(filter)) console.log(`${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} meta=${JSON.stringify(r.metadata)}`)
}
console.log("aliases of interest: check imports:", JSON.stringify(res.imports.map((i: any) => ({ m: i.module, items: i.items }))))
