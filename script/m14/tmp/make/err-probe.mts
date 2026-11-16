import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-make.wasm")))
const parser = new P(); parser.setLanguage(g)
for (const f of process.argv.slice(2)) {
  const src = readFileSync(path.join(ROOT, f), "utf8")
  const tree = parser.parse(src)
  let err = 0, miss = 0
  const walk = (n: any) => { if (n.type === "ERROR") err++; if (n.isMissing) miss++; for (const c of n.namedChildren ?? []) walk(c) }
  walk(tree.rootNode)
  console.log(`${f}: ERROR=${err} MISSING=${miss} hasError=${tree.rootNode.hasError}`)
}
