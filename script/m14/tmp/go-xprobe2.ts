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
  G1b_multi_assign_only: `package p
var a int
var b int
func f() {
    a, b = 1, 2
}
`,
  G1c_single_assign_only: `package p
var a int
func f() {
    a = 1
}
`,
  G1d_index_assign: `package p
var arr [10]int
var i int
func f() {
    arr[i] = 1
}
`,
  G2b_select_declare: `package p
var v int
func f(ch chan int) {
    select {
    case v := <-ch:
        _ = v
    default:
    }
}
`,
  G2c_select_assign: `package p
var w int
func f(ch chan int) {
    select {
    case w = <-ch:
        _ = w
    default:
    }
}
`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parseSrc(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "x.go")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}`)
  }
}
main()
