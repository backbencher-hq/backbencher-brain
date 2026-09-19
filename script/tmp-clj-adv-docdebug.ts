// tmp-clj-adv-docdebug.ts — trace the doc-channel comment walk on a file.
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
const root = p.parse(src).rootNode
for (let i = 0; i < root.namedChildCount; i++) {
  const n = root.namedChild(i)
  if (!n || n.type !== "list_lit") continue
  const head = n.namedChild(0)?.text ?? ""
  if (!head.startsWith("defn")) continue
  console.log(`form ${head} ${n.namedChild(1)?.text} startRow=${n.startPosition.row} ${n.startPosition.row + 1}`)
  let prev = n.previousNamedSibling
  while (prev && prev.type === "comment") {
    console.log(`  comment text=${JSON.stringify(prev.text)} startRow=${prev.startPosition.row} endRow=${prev.endPosition.row} startCol=${prev.startPosition.column} endCol=${prev.endPosition.column}`)
    const before = prev.previousNamedSibling
    console.log(`    before=${before?.type} endRow=${before?.endPosition.row} endCol=${before?.endPosition.column}`)
    prev = prev.previousNamedSibling
  }
}
