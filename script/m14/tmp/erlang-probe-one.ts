// Why does one file yield nothing? Print the tree's shape, hasError, and node count.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const file = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
const tree = parser.parse(fs.readFileSync(file, "utf8"))
console.log("hasError:", tree!.rootNode.hasError, "| top-level named children:", tree!.rootNode.namedChildCount)
let n = 0
const counts = new Map<string, number>()
const walk = (nd: any) => { n++; counts.set(nd.type, (counts.get(nd.type) ?? 0) + 1); for (let i = 0; i < nd.namedChildCount; i++) walk(nd.namedChild(i)) }
walk(tree!.rootNode)
console.log("total nodes:", n)
console.log("first 12 top-level forms:")
for (let i = 0; i < Math.min(12, tree!.rootNode.namedChildCount); i++) {
  const c = tree!.rootNode.namedChild(i)
  console.log(`  ${c.type}@${c.startPosition.row + 1} "${c.text.slice(0, 46).replace(/\n/g, " ")}"`)
}
console.log("ERROR nodes:", counts.get("ERROR") ?? 0)
