// tmp-clj-tree.ts — dump the parse tree with namedChild indexes.
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
const src = fs.readFileSync(process.argv[2], "utf8")
const walk = (n: any, d: number, idx: number) => {
  console.log(`${"  ".repeat(d)}[${idx}] ${n.type} L${n.startPosition.row + 1} :: ${n.namedChildCount > 0 ? "" : JSON.stringify(n.text.slice(0, 30))}`)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) walk(c, d + 1, i)
  }
}
walk(p.parse(src).rootNode, 0, 0)
