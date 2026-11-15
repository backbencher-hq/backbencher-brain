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
  const dump = (n: any, d = 0) => {
    const leaf = n.namedChildCount === 0 ? " " + JSON.stringify(src.slice(n.startIndex, n.endIndex)) : ""
    console.log(`${"  ".repeat(d)}${n.type}${leaf}  (parent=${n.parent?.type ?? "-"} named=${n.isNamed})`)
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(root)
  const en = root.namedChild(0)
  console.log("\nenum fields:", JSON.stringify({ name: en.childForFieldName("name")?.text, body: en.childForFieldName("body")?.type }))
  const body = en.childForFieldName("body")
  for (let i = 0; i < body.namedChildCount; i++) {
    const c = body.namedChild(i)
    console.log(`enum body child ${i}: type=${c.type} text=${JSON.stringify(c.text)} parent=${c.parent.type}`)
  }
}
main()
