import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `package p
type Point struct { X int }
func f(y int) {
  p := Point{X: y}
  switch y.(type) { case int: }
  select { case r := <-ch: _ = r }
  _ = y
}
`
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
  show("STRUCTKEY-X", (n) => n.text === "X")
  show("BARE-SWITCH", (n) => n.type === "type_switch_statement")
  show("SELASSIGN", (n) => n.text === "r")
  show("BLANK", (n) => n.text === "_")
  const sw = findAll(root, (n) => n.type === "type_switch_statement")[0]
  if (sw) console.log("tswitch kids:", sw.namedChildren.map((c: any) => c.type).join(","))
  const sc = findAll(root, (n) => n.type === "communication_case")[0]
  if (sc) console.log("commcase kids:", sc.namedChildren.map((c: any) => c.type).join(","))
}
main()
