import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
const D = `class Kls {}\n`
const CASES: [string, string][] = [
  ["for-of const shadow", `${D}function f() { for (const Kls of []) { break } }`],
  ["for-of + break label", `${D}function f() { for (const Kls of []) { break Kls } }`],
  ["label block", `${D}function f() { Kls: for (;;) { break Kls } }`],
  ["plain label, no shadow", `${D}function f() { Kls: for (;;) { break Kls } }`],
  ["catch binding only", `${D}function f() { try {} catch (Kls) { return Kls } }`],
  ["let shadow, no label", `${D}function f() { let Kls = 1; return Kls }`],
]
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const [label, src] of CASES) {
    const p = new P(); p.setLanguage(lang)
    const r: any = await new RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, "/tmp/opencode/lab.ts")
    const refs = (r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => `${x.source}->${x.target}`)
    console.log(`${label.padEnd(24)} [${refs.join(" | ")}]`)
  }
}
main()
