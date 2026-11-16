import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(process.argv[2], "utf8")
  const root = p.parse(src).rootNode
  const lines = src.split("\n")
  const walk = (n: any): void => {
    if (n.type === "ERROR" || (n.hasError && n.namedChildCount === 0)) {
      console.log(`node ${n.type} @${n.startIndex} row=${n.startPosition.row} col=${n.startPosition.column} text=${JSON.stringify(n.text.slice(0, 20))}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  console.log("total lines:", lines.length, "last:", JSON.stringify(lines[lines.length - 1]), JSON.stringify(lines[lines.length - 2]))
}
main()
