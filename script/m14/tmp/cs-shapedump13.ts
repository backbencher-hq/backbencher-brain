import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dump = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 30)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1, max)
  }
  {
    const root = p.parse(`using System.Linq; class A { void M() { var q = from x in xs select x into g; } }`).rootNode
    const find = (n: any, t: string): any => {
      if (!n) return null
      if (n.type === t) return n
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), t); if (r) return r }
      return null
    }
    console.log("--- full query:"); dump(find(root, "query_expression"), 0, 4)
  }
  {
    const root = p.parse(`class A { void M() { foreach (var x in ys) { } } }`).rootNode
    const find = (n: any, t: string): any => {
      if (!n) return null
      if (n.type === t) return n
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), t); if (r) return r }
      return null
    }
    console.log("--- foreach children:"); dump(find(root, "foreach_statement"), 0, 2)
  }
}
main()
