import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const lines = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/zig/lib/std/os/linux.zig", "utf8").split("\n")
  const src = lines.slice(5965, 5972).join("\n") + "\n"
  const root = await parse(src)
  const d = (n: any, dp: number): void => {
    if (dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 36)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  d(root, 0)
}
main()
