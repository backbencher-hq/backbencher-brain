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
import . "fmt"
func f(a, b int) {
  x, y := 1, 2
  var z int = x
  for i, v := range []int{1} { _ = i + v }
  if w := f2(); w > 0 { }
  switch t := x.(type) { case int: _ = t }
  select { case r := <-ch: _ = r }
  Lbl: for { break Lbl }
  m := map[string]int{"k": 1}
  s := Struct{X: y}
}
`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const d = (n: any, dp: number): void => {
    if (dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 30)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["short_var_declaration", "range_clause", "keyed_element", "import_spec", "type_switch_statement", "labeled_statement"]) {
    const ns = findAll(root, (n) => n.type === t)
    console.log("=== " + t + " x" + ns.length)
    if (ns[0]) d(ns[0], 0)
  }
}
main()
