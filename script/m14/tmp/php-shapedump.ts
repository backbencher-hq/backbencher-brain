import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(process.argv[2], "utf8")
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const dump = (n: any, d: number): void => {
    const t = n.isNamed ? n.type : `'${n.text.slice(0, 10)}'`
    const id = n.isNamed && ["name", "variable_name"].includes(n.type) ? ` '${n.text.slice(0, 24)}'` : ""
    console.log("  ".repeat(d) + t + id)
    if (d > 7) return
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
  }
  const walk = (n: any): void => {
    if ((n.type === "method_declaration" || n.type === "function_definition" || n.type === "expression_statement") && n.startPosition.row + 1 === Number(process.argv[3])) { dump(n, 0); return }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  if (process.argv[3]) walk(root); else dump(root, 0)
}
main()
