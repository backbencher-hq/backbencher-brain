import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/php-shapes10.php", "utf8")).rootNode
  const dump = (n: any, d: number): void => {
    const t = n.isNamed ? n.type : `'${n.text.slice(0, 8)}'`
    const id = n.isNamed && ["name", "variable_name"].includes(n.type) ? ` '${n.text.slice(0, 14)}'` : ""
    console.log("  ".repeat(d) + t + id)
    if (d > 5) return
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
  }
  const walk = (n: any): void => {
    if (n.type === "member_call_expression" || n.type === "member_access_expression" || n.type === "encapsed_string") { dump(n, 0); console.log("---") }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
