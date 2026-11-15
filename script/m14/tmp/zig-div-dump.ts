import * as fs from "fs"
import * as path from "path"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const root = await parseSrc(`pub const T3 = if (true) u32 else u64;\nfn f() u32 { const x: T3 = 1; return x; }\n`)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const n of findAll(root, (x) => x.text === "T3")) {
    const chain: string[] = []
    let p: any = n
    while (p) { chain.push(p.type); p = p.parent }
    console.log("T3", n.type, "<-", chain.slice(1, 6).join(" < "))
  }
  console.log("oracle:", JSON.stringify(mod.deriveZigBareUses(root).map((x: any) => x.target)))
}
main()
