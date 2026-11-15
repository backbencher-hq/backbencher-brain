// Parse the round-3 fixture and list every ERROR/MISSING node.
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync("validation/m14/fixtures/groovy/grammar-round3-841.groovy", "utf8")
  const tree = parser.parse(src)
  console.log("hasError:", (tree.rootNode as any).hasError)
  const walk = (n: any) => {
    if (n.type === "ERROR" || n.isMissing) console.log(`${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 70))}`)
    for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) }
  }
  walk(tree.rootNode)
}
main()
