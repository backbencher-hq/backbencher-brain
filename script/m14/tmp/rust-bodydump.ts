import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`struct S { f: Point }
enum E { V(Point), W { q: Point }, U }
type A = Vec<Point>;
union U2 { a: Point }
`).rootNode
  const dump = (n: any, dp: number): void => {
    if (dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 24)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  for (let i = 0; i < root.namedChildCount; i++) { console.log("=== "); dump(root.namedChild(i), 0) }
}
main()
