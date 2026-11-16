import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`class A { void M() { try { F(); } catch (System.Exception e) when (e != null) { G(); } } }`).rootNode
  const dump = (n: any, dp: number): void => {
    if (!n || dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 30)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, t: string): any => {
    if (!n) return null
    if (n.type === t) return n
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), t); if (r) return r }
    return null
  }
  dump(find(root, "catch_clause"), 0)
}
main()
