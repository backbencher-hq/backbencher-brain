import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const dump = (n: any, dp: number): void => {
    if (!n || dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 28)))
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1)
  }
  const root = p.parse(`def m(x)\n return 1 if defined?(bar)\nend\n`).rootNode
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (!n) return null
    if (pred(n)) return n
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  const ifn = find(root, (x) => x.type === "if_modifier" || x.type === "if")
  console.log("--- if node:"); dump(ifn, 0)
}
main()
