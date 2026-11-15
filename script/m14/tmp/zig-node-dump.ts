import * as fs from "fs"
import * as path from "path"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const root = await parse(process.argv[2])
  const target = Number(process.argv[3])
  const find = (n: any): any => {
    if (n.startIndex === target && n.type === "identifier") return n
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.startIndex <= target && target < c.endIndex) { const r = find(c); if (r) return r } }
    return null
  }
  const n = find(root)
  console.log("node:", n.type, JSON.stringify(n.text))
  const p = n.parent
  console.log("parent:", p.type, "namedChildCount:", p.namedChildCount)
  for (let i = 0; i < p.namedChildCount; i++) {
    const c = p.namedChild(i)
    console.log(`  [${i}] ${c.type} ${c.startIndex}-${c.endIndex} ${JSON.stringify(c.text.slice(0, 24))}`)
  }
}
main()
