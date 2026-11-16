// What does the grammar produce for `new\n  Other()`? Node types only.
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = `export function f() {
  const a = new Thing()
  const b = new
    Other()
  return [a, b]
}
`
async function main() {
  const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init()
  const lang = await Language.load(
    path.join(ROOT, "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm"),
  )
  const p = new Parser()
  p.setLanguage(lang)
  const tree = p.parse(SRC)
  const walk = (n: any, d = 0): void => {
    console.log(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : ` (${JSON.stringify(n.text)})`} [${n.startPosition.row + 1}-${n.endPosition.row + 1}]`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
  }
  walk(tree.rootNode)
  console.log("hasError:", tree.rootNode.hasError)
}

main()
