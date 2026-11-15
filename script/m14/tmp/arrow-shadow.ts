import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
const D = "function root() {}\nfunction helper() {}\n"
const CASES: [string, string][] = [
  ["arrow param shadows fn",  `${D}function f() { return (root) => root() }`],
  ["arrow param, outer has none", `${D}function f() { return (helper) => helper() }`],
  ["fn expression param",   `${D}function f() { return function (root) { return root() } }`],
  ["arrow param TS param",  `${D}function f(bb: string) { return (root) => root() }`],
  ["named fn nested param",  `${D}function f() { function g(root: string) { return root() } return g }`],
  ["arrow NO shadow, reads outer", `${D}function f() { return () => root() }`],
]
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const [label, src] of CASES) {
    const p = new P(); p.setLanguage(lang)
    const r: any = await new RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, "/tmp/opencode/a.ts")
    const refs = (r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => `${x.source}->${x.target}`)
    console.log(`${label.padEnd(30)} [${refs.join(" | ")}]`)
  }
}
main()
