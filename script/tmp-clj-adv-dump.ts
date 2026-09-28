// tmp-clj-adv-dump.ts — full symbol+relationship dump for a fixture file.
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
const src = fs.readFileSync(F, "utf8")
const res = analyzer.analyze(p.parse(src).rootNode, src, F)
for (const s of res.symbols) {
  console.log(`SYM ${s.name} [${s.kind}] owner=${s.ownerName} scope=${s.scope} doc=${JSON.stringify((s as any).docstring ?? null)} comments=${JSON.stringify(s.comments ?? null)}`)
}
for (const r of res.relationships) {
  console.log(`REL ${r.source} -[${r.type}]-> ${r.target} line=${r.line_number ?? "NULL"} arity=${(r.metadata as any)?.callArity ?? "-"}`)
}
console.log(`IMPORTS ${JSON.stringify(res.imports.map((i: any) => `${i.module}:${i.items.join("|")}@${i.line}`))}`)
