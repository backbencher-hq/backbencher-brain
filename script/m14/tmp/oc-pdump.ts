import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(fs.readFileSync("/tmp/oc-aug2.m", "utf8")).rootNode
  const walk = (n: any): void => {
    if ((n.type === "field_expression" || n.type === "identifier") && (n.text === "count" || n.text === "_level")) {
      const par = n.parent
      console.log(`${n.type} '${n.text}' parent=${par?.type} parFirst=${par?.namedChild(0)?.type}[${par?.namedChild(0)?.startIndex}] self=[${n.startIndex}]`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
