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
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "class_constant_access_expression" || n.type === "member_access_expression") {
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); kids.push(`${c.type}:'${c.text.slice(0, 12)}'`) }
      const fld = n.childForFieldName("name")
      console.log(`${n.type} field=name:${fld ? `'${fld.text}'` : "NONE"} children=[${kids.join(", ")}]`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
