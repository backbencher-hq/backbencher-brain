import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `package p
var G int
func f() {
  i := 0
  i++
  j--
  switch i {
  case 1:
  default:
  }
  select {
  case v := <-ch:
  default:
  }
  for k := range m {}
}
`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["inc_statement", "dec_statement", "default_case", "default_statement", "short_var_declaration", "range_clause", "communication_case", "receive_statement", "go_statement"]) {
    const ns = findAll(root, (n) => n.type === t)
    console.log(t, "x" + ns.length, ns[0] ? JSON.stringify(ns[0].text.slice(0, 30)) : "")
  }
}
main()
