import { readFileSync } from "node:fs"
import { join } from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(readFileSync(join(ROOT, "wasm", "tree-sitter-make.wasm")))
const parser = new P(); parser.setLanguage(g)
const src = readFileSync(process.argv[2], "utf8")
const tree = parser.parse(src)
const walk = (n: any) => {
  if (n.type === "ERROR") { const t = n.text.replace(/\n/g, "\\n"); console.log(`L${n.startPosition.row + 1}: ${t.slice(0, 140)}`) }
  for (const c of n.namedChildren ?? []) walk(c)
}
walk(tree.rootNode)
