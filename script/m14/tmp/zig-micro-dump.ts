import * as fs from "fs"
import * as path from "path"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const root = await parseSrc(`const A: u32 = 1;\npub const B = A;\n`)
  const d = (n: any, dp: number): void => {
    if (dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 24)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  d(root, 0)
}
main()
