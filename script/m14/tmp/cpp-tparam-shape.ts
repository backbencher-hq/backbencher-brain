import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES = [
  "template <int N> struct A {};",
  "template <int N = 3> struct B {};",
  "int M = 1; template <int N = M> struct C {};",
  "template <typename T = int> struct D {};",
]
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const parser = new P(); parser.setLanguage(g)
  for (const src of CASES) {
    const tree = parser.parse(src)
    console.log("### " + JSON.stringify(src))
    const walk = (n: any, d: number) => {
      if (d > 6) return
      console.log("  ".repeat(d) + n.type + " :: " + JSON.stringify(String(n.text).slice(0, 26)))
      for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1)
    }
    walk(tree.rootNode, 0)
  }
}
main()
