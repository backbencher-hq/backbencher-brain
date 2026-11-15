import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const f = "/home/ishaq2321/bb_tests/repositories/proxicall/lib/ui/screens/ems/employee_dashboard.dart"
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "identifier" && ["declined", "accepted"].includes(n.text)) {
      const par = n.parent
      console.log(`'${n.text}' parent=${par?.type} grand=${par?.parent?.type}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
