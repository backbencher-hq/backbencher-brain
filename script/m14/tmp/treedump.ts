import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const p = new P(); p.setLanguage(g)
  const src = process.argv[2]
  const t = p.parse(src)
  const dump = (n: any, d: number): void => {
    const txt = String(n.text ?? "").split("\n")[0].slice(0, 40)
    console.log("  ".repeat(d) + n.type + (n.isMissing ? " [MISSING]" : "") + "  " + JSON.stringify(txt))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(t.rootNode, 0)
}
main()
