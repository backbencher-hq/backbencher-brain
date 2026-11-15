import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const src = `trait Audited { boolean audited = true }
class Service implements Audited, Serializable { }
`
const tree = parser.parse(src)
const dump = (n: any, d = 0) => {
  console.log("  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + `  "${String(n.text).split("\n")[0]}"`)
  for (const c of n.children) dump(c, d + 1)
}
dump(tree.rootNode)
