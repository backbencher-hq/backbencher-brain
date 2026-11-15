import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
const CASES: Record<string, string> = {
  G1_multi_assign: `package p
var a int
var b int
func f() int {
    a, b = 1, 2
    return a + b
}
`,
  G2_select_cases: `package p
func f(ch chan int) {
    select {
    case v := <-ch:
        _ = v
    case w = <-ch:
        _ = w
    }
}
`,
  G3_arraylen_param: `package p
const N = 10
func f(a [N]int) int {
    return N
}
`,
  G4_map_keys: `package p
type Color int
const Red Color = 1
func f() map[Color]int {
    return map[Color]int{Red: 1}
}
`,
  G5_generic_call: `package p
func Map[T any](x T) T { return x }
func f() int {
    return Map[int](1)
}
`,
  G6_method_value: `package p
type T struct{}
func (t T) M() int { return 1 }
var H = T.M
func f() int {
    return H(T{})
}
`,
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "x.go")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}`)
  }
}
main()
