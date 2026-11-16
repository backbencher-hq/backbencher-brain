import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`class A { int v; int P { get { return v; } set { v = value; } } void M() { this.N(); base.N(); } }`).rootNode
  const walk = (n: any): void => {
    if (!n) return
    const t = (n.text ?? "")
    if (t === "this" || t === "base" || t === "value") console.log(`node ${n.type} text=${JSON.stringify(t)} named=${n.isNamed} parent=${n.parent?.type}`);
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
