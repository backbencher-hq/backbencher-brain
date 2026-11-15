import * as fs from "fs"
import * as path from "path"
import { RealZigAnalyzer } from "../../../src/ast/real-zig-analyzer"
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
  const src = `const E = error{ Bad };\nfn f() u8 { const e = error.Bad; return e; }\n`
  const root = await parse(src)
  const r: any = await new RealZigAnalyzer().analyze(root, src, "T.zig")
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind + (s.ownerName ? "(" + s.ownerName + ")" : ""))))
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const n of findAll(root, (x: any) => x.type === "error_type")) {
    console.log("errtype kids:", n.namedChildren.map((c: any) => c.type + "=" + c.text).join(" | "))
  }
}
main()
