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
func f(ch chan int, m map[string]int) {
  switch t := g(); t > 0 { case true: }
  select { case <-ch: }
  goto Done
Done:
  _ = m
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
    for (const n of findAll(root, pred).slice(0, 4)) {
      const chain: string[] = []
      let p: any = n
      while (p) { chain.push(p.type); p = p.parent }
      console.log(label, n.type + "=" + JSON.stringify(n.text.slice(0, 16)), "<-", chain.slice(1, 6).join(" < "))
    }
  }
  show("GOTO-OP", (n) => n.text === "Done")
  show("PURE-RECV", (n) => n.type === "receive_statement")
  show("SW-INIT", (n) => n.type === "expression_switch_statement")
  show("DOT", (n) => n.type === "dot" || n.text === ".")
}
main()
