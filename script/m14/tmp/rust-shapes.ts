import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `struct P { x: i32 }\nmacro_rules! mm { ($x:expr) => { $x } }\nfn f(a: i32, (b, c): (i32, i32), S { d }: S) {\n  for e in 0..a { let _ = e; }\n  let g = P { x };\n  let h = Self;\n}\n`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  const show = (label: string, pred: (x: any) => boolean) => {
    for (const n of findAll(root, pred).slice(0, 4)) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log(label, n.type + "=" + JSON.stringify(n.text.slice(0, 16)), "<-", chain.slice(1, 6).join(" < "))
    }
  }
  show("SHORTHAND-X", (n) => n.text === "x")
  show("SELF", (n) => n.text === "Self")
  show("META", (n) => n.text.includes("$"))
  show("UNDER", (n) => n.text === "_")
  show("LPAT", (n) => n.text === "e" && n.type === "identifier")
}
main()
