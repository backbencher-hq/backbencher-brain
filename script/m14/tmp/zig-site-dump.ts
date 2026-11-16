import * as fs from "fs"
import * as path from "path"
async function parse(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const root = await parse(process.argv[2])
  const want = process.argv[3].split(",")
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of want) {
    console.log("##### " + t)
    for (const n of findAll(root, (x) => x.text === t && (x.type === "identifier" || x.type === "field_expression")).slice(0, 6)) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log("@" + n.startIndex, n.type, "<-", chain.slice(1, 6).join(" < "))
    }
  }
}
main()
