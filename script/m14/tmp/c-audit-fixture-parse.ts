import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const src = readFileSync("validation/m14/fixtures/c/callsite-lines-825.c", "utf8")
const tree = parser.parse(src)
console.log("hasError:", tree.rootNode.hasError)
const walk = (n: any): void => {
  if (n.type === "ERROR" || n.isMissing) console.log("  node", n.type, n.isMissing ? "(missing)" : "", "@", n.startPosition.row + 1)
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
}
walk(tree.rootNode)
