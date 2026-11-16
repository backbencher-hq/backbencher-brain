import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `typedef int Counter;\nstruct Point { int x; int y; };\nenum Color { Red, Green };\ntypedef struct { int w; } Size;\n`
  const root = p.parse(src).rootNode
  const dump = (n: any, d: number): void => {
    if (d > 3) return
    if (n.isNamed) console.log("  ".repeat(d) + n.type + (n.type === "identifier" || n.type === "type_identifier" ? ` [${n.text}]` : ""))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(root, 0)
}
main()
