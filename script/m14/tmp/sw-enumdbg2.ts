import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`enum Result {\n  case success(Int)\n}\n`).rootNode
  const walk = (n: any): void => {
    if (n.type === "enum_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        console.log(`  child[${i}]: ${c.type} '${c.text.slice(0, 20)}'`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
