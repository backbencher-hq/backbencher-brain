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
  const src = `const Point = struct { X: i32 };\nfn f(p: Point) i32 {\n  var q = Point{ .X = p.X };\n  blk: { break :blk; }\n  var n: ?u32 = null;\n  var u = undefined;\n  var t = true;\n  return q.X;\n}\n`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  const show = (label: string, pred: (x: any) => boolean) => {
    for (const n of findAll(root, pred).slice(0, 3)) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log(label, n.type + "=" + JSON.stringify(n.text.slice(0, 14)), "<-", chain.slice(1, 6).join(" < "))
    }
  }
  show("DOTKEY-X", (n) => n.text === "X")
  show("LABEL", (n) => n.text === "blk")
  show("NULL", (n) => n.text === "null")
  show("UNDEF", (n) => n.text === "undefined")
  show("TRUE", (n) => n.text === "true")
  show("VARDECL", (n) => n.type === "variable_declaration")
}
main()
