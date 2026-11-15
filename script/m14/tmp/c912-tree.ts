import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const p = new P(); p.setLanguage(lang)
const f = process.argv[2]
const src = readFileSync(f, "utf8")
const lines = src.split("\n")
function dump(n: any, depth: number, maxDepth: number) {
  const txt = src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 44)).replace(/\n/g, "\\n")
  console.log(`${"  ".repeat(depth)}${n.type}${n.isMissing ? " MISSING" : ""}[${n.startPosition.row + 1}..${n.endPosition.row + 1}] ${depth < maxDepth ? JSON.stringify(txt) : ""}`)
  if (depth >= maxDepth) return
  for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), depth + 1, maxDepth)
}
dump(p.parse(src).rootNode, 0, Number(process.argv[3] ?? 3))
