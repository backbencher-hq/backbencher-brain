import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  let failures = 0
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "T.go")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { failures++; console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  await run("G11-empty-iface", `package p\ntype Anything interface {}\ntype S struct {}\nfunc (s S) String() string { return "" }\n`, (r) => {
    console.log("   implements=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("implements"))))
  })
  await run("G3-discrim", `package p\nvar A, B, C, D, E int\nfunc F() {}\nfunc G() {}\n`, (r) => {
    console.log("   complexity=" + (r.metadata ?? {}).complexity + " cyc=" + (r.metadata ?? {}).cyclomaticComplexity)
    if ((r.metadata ?? {}).complexity === (r.metadata ?? {}).cyclomaticComplexity) throw new Error("unexpected equality (probe vacuous)")
  })
  await run("G-shapes", `package p\nOuter: for i := 0; i < 3; i++ {\n if i > 1 { break Outer }\n goto Done\n Done:\n}\nfunc F() {\n ch := make(chan int)\n select { case v := <-ch: _ = v\n default: }\n}\n`, (r, root) => {
    const types = new Set<string>()
    const walk = (n: any): void => { types.add(n.type); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) } }
    walk(root)
    console.log("   labeled=" + findAll(root, (n) => (n.text === "Outer" || n.text === "Done") && n.type === "identifier").length + " label_names=" + findAll(root, (n) => n.type === "label_name").length)
    console.log("   goto=" + findAll(root, (n) => n.type === "goto_statement").length + " hasError=" + root.hasError)
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
