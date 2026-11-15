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
  const src = `fn f(g: &dyn Fn(i32), h: impl Fn(i32), fp: fn(i32)) {\n  let cl = |x: i32| x + g;\n  let arr: [u8; 3] = [0; 3];\n  let r = &raw const g;\n  'outer: loop { break 'outer; }\n  let s = self;\n}\n`
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
      console.log(label, n.type + "=" + JSON.stringify(n.text.slice(0, 18)), "<-", chain.slice(1, 6).join(" < "))
    }
  }
  show("DYN", (n) => n.text === "Fn" || n.text === "dyn")
  show("FNPTR", (n) => n.text === "fp")
  show("CLOS-P", (n) => n.text === "x" && n.type === "identifier")
  show("SELF", (n) => n.text === "self" || n.text === "Self")
  show("LABEL", (n) => n.text.includes("outer"))
  show("RAW", (n) => n.text === "raw")
}
main()
