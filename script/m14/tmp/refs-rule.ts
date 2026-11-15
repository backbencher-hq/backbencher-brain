import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
const DECLS = `class Kls {}\ninterface Iface {}\nenum En { A }\ntype Ty = number\nfunction fn() {}\nconst cst = 1\nnamespace Ns {}\n`
const CASES: [string, string][] = [
  ["self reference", `${DECLS}function f() { return f }`],
  ["other fn", `${DECLS}function f() { return fn() }`],
  ["class use", `${DECLS}function f() { return Kls }`],
  ["interface use", `${DECLS}function f(o: Iface) { return o }`],
  ["enum use", `${DECLS}function f() { return En }`],
  ["enum member use", `${DECLS}function f() { return En.A }`],
  ["type use in body", `${DECLS}function f() { const x: Ty = 1; return x }`],
  ["const use", `${DECLS}function f() { return cst }`],
  ["namespace use", `${DECLS}function f() { return Ns }`],
  ["member access prop", `${DECLS}function f(o: Iface) { return o.prop }`],
  ["object key", `${DECLS}function f() { return { Kls: 1 } }`],
  ["string literal", `${DECLS}function f() { return "Kls" }`],
  ["shadowed local", `${DECLS}function f() { const Kls = 2; return Kls }`],
  ["label-like", `${DECLS}function f() { for (const Kls of []) { break Kls } }`],
  ["catch param", `${DECLS}function f() { try {} catch (Kls) { return Kls } }`],
  ["nested fn sees outer", `${DECLS}function f() { function g() { return Kls } return g }`],
  ["declared after use", `${DECLS}function f() { return Kls }`],
  ["imported name", `import { Imported } from "./m"\n${DECLS}function f() { return Imported }`],
  ["property shorthand key", `${DECLS}function f() { const o = { Kls }; return o }`],
  ["typeof type", `${DECLS}function f() { return typeof Kls }`],
]
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const [label, src] of CASES) {
    const p = new P(); p.setLanguage(lang)
    const r: any = await new RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, "/tmp/opencode/rule.ts")
    const refs = (r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => `${x.source}->${x.target}`)
    console.log(`${label.padEnd(24)} [${refs.join(" | ")}]`)
  }
}
main()
