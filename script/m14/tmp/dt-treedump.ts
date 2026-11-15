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
  const src = fs.readFileSync(process.argv[2], "utf8")
  const root = p.parse(src).rootNode
  const dump = (n: any, d: number): void => {
    const txt = n.isNamed ? (n.type === "identifier" || n.type === "type_identifier" ? ` '${n.text}'` : "") : ` '${n.text.slice(0, 12)}'`
    console.log("  ".repeat(d) + (n.isNamed ? "" : "'") + n.type + txt)
    if (d > 7) return
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
  }
  dump(root, 0)
}
main()
