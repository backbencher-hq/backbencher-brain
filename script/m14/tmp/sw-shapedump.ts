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
  const src = fs.readFileSync(process.argv[2], "utf8")
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const watch = new Set((process.argv[3] ?? "").split(","))
  const walk = (n: any, d: number): void => {
    if (watch.size > 0 && !watch.has(n.type)) { for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), d); return }
    const t = n.isNamed ? n.type : `'${n.text.slice(0, 10)}'`
    const id = n.isNamed && ["simple_identifier", "identifier", "type_identifier"].includes(n.type) ? ` '${n.text.slice(0, 20)}'` : ""
    console.log("  ".repeat(d) + t + id)
    if (d > 5) return
    for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
  }
  walk(root, 0)
}
main()
