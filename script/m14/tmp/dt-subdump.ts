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
    const t = n.isNamed ? n.type : `'${n.text.slice(0, 8)}'`
    const id = n.isNamed && (n.type === "identifier" || n.type === "type_identifier") ? ` '${n.text}'` : ""
    const args = n.isNamed && n.type === "selector" ? (n.namedChildren.some((c: any) => c.type === "argument_part") ? " [ARGS]" : "") : ""
    console.log("  ".repeat(d) + t + id + args)
    if (d > 5) return
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d + 1)
  }
  const lines = src.split("\n")
  const target = Number(process.argv[3])
  const walk = (n: any): void => {
    if (n.type === "expression_statement" && n.startPosition.row + 1 === target) { dump(n, 0); return }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
