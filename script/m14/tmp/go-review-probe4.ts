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
  await run("G-generic-composite", `package p\ntype Box[T any] struct { v T }\nfunc F() { b := Box[int]{v: 1} }\n`, (r, root) => {
    console.log("   inst=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("instantiates"))) + " hasError=" + root.hasError)
    if (!rels(r).some((s: string) => s.includes("->Box"))) throw new Error("generic composite construction lost (claim TRUE)")
  })
  await run("G26-versioned-import", `package p\nimport "gopkg.in/yaml.v3"\nfunc F() { yaml.Marshal(1) }\n`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => i.module + ":" + JSON.stringify(i.items))) + " calls=" + JSON.stringify(rels(r).filter((s: string) => s.startsWith("calls"))))
  })
  console.log(failures ? failures + " FAILURES" : "ALL GREEN")
}
main()
