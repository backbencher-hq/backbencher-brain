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
  J1_dotimport_read: `package p
import . "consts"
const Local = 1
func f() int {
    return MaxValue + Local
}
`,
  J2_typeparam_collide: `package p
const T = 1
func f[T any]() int {
    return T
}
`,
  J3_valuedot_method: `package p
type S struct{ n int }
func (s S) Get() int { return s.n }
func f() int {
    var s S
    get := s.Get
    return get()
}
`,
  J4_for_assign_init: `package p
var i int
var n int
func f() {
    for i = 0; i < n; i++ {
    }
}
`,
}
async function main() {
  for (const [name, src] of Object.entries(CASES)) {
    const root = await parseSrc(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "x.go")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const calls = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}\n  calls: ${JSON.stringify(calls)}`)
  }
}
main()
