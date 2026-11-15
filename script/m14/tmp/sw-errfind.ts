import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  console.log("hasError:", root.hasError)
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) console.log("BAD:", n.type, JSON.stringify(n.text.slice(0, 50)), "line", n.startPosition.row + 1)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
}
main()
