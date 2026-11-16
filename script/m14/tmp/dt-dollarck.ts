import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/dt-interp2.dart", "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "identifier_dollar_escaped") console.log("dollar_escaped text:", JSON.stringify(n.text))
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
