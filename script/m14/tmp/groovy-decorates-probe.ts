import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const target = process.argv[2]
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const mod: any = await import("../../../src/ast/real-groovy-analyzer")
const analyzer = new mod.RealGroovyAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar((parser as any).language, (parser as any).constructor) } catch {}
}
const content = readFileSync(target, "utf8")
const tree = parser.parse(content)
const res: any = await analyzer.analyze(tree.rootNode, content, target)
for (const r of res.relationships) {
  if (String(r.type) === "decorates" || String(r.type) === "references") console.log(JSON.stringify(r))
}
