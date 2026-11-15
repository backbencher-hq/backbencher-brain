import * as fs from "fs"; import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const src = fs.readFileSync("/tmp/cx.dart", "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root: any = p.parse(src).rootNode
  const walk = (n: any, d: number) => {
    if (d > 3) return
    console.log(`${"  ".repeat(d)}${n.type}`)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, d + 1) }
  }
  walk(root, 0)
  // sibling facts for the declaration node
  const cls = root.namedChild(0)
  const body = cls.childForFieldName("body")
  for (let i = 0; i < body.namedChildCount; i++) {
    const c = body.namedChild(i)
    console.log(`class_body child ${i}: ${c.type} ; nextNamedSibling=${c.nextNamedSibling?.type ?? "null"}`)
  }
}
main()
