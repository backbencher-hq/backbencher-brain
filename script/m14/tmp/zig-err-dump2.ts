import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm".replace("cpp", "zig")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const root = await parse(`const E = error{ Bad };\nfn f() u8 { const e = error.Bad; return e; }\n`)
  const d = (n: any, dp: number): void => {
    if (dp > 5) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 30)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const fe of findAll(root, (n) => n.type === "variable_declaration" && n.text.includes("error.Bad"))) { console.log("==="); d(fe, 0) }
}
main()
