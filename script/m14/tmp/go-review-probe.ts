import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
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
  await run("G-bare-reads", `package p\nvar G int\nfunc F() int { return G }\n`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("uses"))))
    if (!rels(r).some((s: string) => s.includes("->G"))) throw new Error("bare global read emits nothing (claim TRUE)")
  })
  await run("G-index-range", `package p\nvar m map[string]int\nvar k string\nfunc F() int { return m[k] }\n`, (r) => {
    if (!rels(r).some((s: string) => s.includes("->k") || s.includes("->m"))) throw new Error("index/key reads lost (claim TRUE)")
  })
  await run("G-dot-import", `package p\nimport . "fmt"\nfunc F() { Println("x") }\n`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("calls"))))
    if (!rels(r).some((s: string) => s.includes("->Println"))) throw new Error("dot-imported call lost (claim TRUE)")
  })
  await run("G-generic-call", `package p\nfunc Map[T any](x T) T { return x }\nfunc F() int { return Map[int](1) }\n`, (r, root) => {
    console.log("   calls=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("calls"))) + " hasError=" + root.hasError)
    if (!rels(r).some((s: string) => s.includes("->Map"))) throw new Error("generic-instantiated call lost (claim TRUE)")
  })
  await run("G-tilde-union-embed", `package p\ntype C interface { ~int | ~string }\ntype U interface { int | string }\n`, (r) => {
    console.log("   extends=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("extends"))) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
  })
  await run("G5-package-range", `package p\n`, (r) => {
    const pkg = (r.symbols ?? []).find((s: any) => s.name === "p")
    console.log("   range=" + JSON.stringify(pkg?.range))
    if (pkg && pkg.range.endIndex !== 9) throw new Error("package endIndex off (claim TRUE): " + pkg.range.endIndex)
  })
  await run("G3-complexity-fields", `package p\nfunc F() int { if true { return 1 }; return 0 }\n`, (r) => {
    console.log("   complexity=" + (r.metadata ?? {}).complexity + " cyc=" + (r.metadata ?? {}).cyclomaticComplexity)
    if ((r.metadata ?? {}).complexity !== (r.metadata ?? {}).cyclomaticComplexity) throw new Error("complexity != cyclomatic (claim TRUE)")
  })
  await run("G-blank-ident", `package p\nimport "fmt"\nvar _ = fmt.Sprint("x")\nfunc F() {}\n`, (r) => {
    if ((r.symbols ?? []).some((s: any) => s.name === "_")) throw new Error("blank identifier symbol (claim TRUE)")
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
