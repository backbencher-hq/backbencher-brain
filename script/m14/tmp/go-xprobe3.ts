import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  H1_inc_only: `package p
var i int
func f() {
    i++
}
`,
  H2_type_in_varinit: `package p
const A = 1
type Box struct { v int }
func f() {
    var x = Box{A: 1}
    _ = x
}
`,
  H3_template_param_read: `package p
const T = 1
func f() {
}
func g() int {
    return T
}
`,
  H4_dot_blank_import: `package p
import _ "fmt"
import . "strings"
func f() string {
    return "x"
}
`,
  H5_go_defer: `package p
func work() {}
func f() {
    go work()
    defer work()
}
`,
  H6_mixed_lhs: `package p
var arr [10]int
var i int
var b int
func f() {
    arr[i], b = 1, 2
}
`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parseSrc(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "x.go")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}\n  calls: ${JSON.stringify(calls)}\n  imports: ${JSON.stringify((r.imports ?? []).map((x: any) => x.module))}`)
  }
}
main()
