import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`using System.Linq; class A { void M() { var q = from x in xs select x into g; var r = from a in bs where a > 1 orderby a select a; } }`).rootNode
  console.log("hasError:", root.hasError);
  const kinds = new Set<string>()
  const walk = (n: any): void => {
    if (!n) return
    if (/clause|query|into/.test(n.type)) kinds.add(n.type + "::" + JSON.stringify(n.text.slice(0, 28)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) walk(n.namedChild(i))
  }
  walk(root)
  console.log([...kinds].join("\n"))
}
main()
