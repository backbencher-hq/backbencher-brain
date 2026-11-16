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
func Map[T any](x T) T { return x }
func F() {
  y := Map[int](1)
  switch t := g(); t > 0 { case true: }
  select { case <-ch: }
  z := Point{X: 1}
}
`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  const d = (n: any, dp: number): void => {
    if (dp > 3) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 30)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  for (const t of ["call_expression"]) {
    const ns = findAll(root, (n) => n.type === t && n.text.includes("Map["))
    console.log("=== generic call:"); if (ns[0]) d(ns[0], 0)
  }
  const sw = findAll(root, (n) => n.type === "expression_switch_statement")[0]
  if (sw) console.log("switch kids:", sw.namedChildren.map((c: any) => c.type).join(","))
  const sel = findAll(root, (n) => n.type === "communication_case")[0]
  if (sel) console.log("commcase kids:", sel.namedChildren.map((c: any) => c.type).join(","))
}
main()
