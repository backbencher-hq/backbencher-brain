// #758 verify round 2: exact shapes from the issue text.
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  // B4 EXACT: instance base greet + STATIC sub greet -> must NOT emit overrides
  const b4 = "class Base { greet() {} }\nclass Sub extends Base { static greet() {} }\n"
  const r4: any = az.analyze(parser.parse(b4), b4, "b4.js")
  console.log("B4 overrides (expect NONE): " + JSON.stringify((r4.relationships ?? []).filter((e: any) => e.label === "overrides").map((e: any) => e.from + "->" + e.target)))
  // B5 EXACT: get/set pair -> symbols should show both
  const b5 = "class C {\n  get val() { return 1 }\n  set val(v) {}\n}\n"
  const r5: any = az.analyze(parser.parse(b5), b5, "b5.js")
  const syms: any[] = r5.symbols ?? []
  console.log("B5 symbols named val: " + JSON.stringify(syms.filter((s: any) => s.name === "val").map((s: any) => ({ kind: s.kind, scope: s.scope ?? s.ownerName ?? "?" }))))
  console.log("B5 all symbol names: " + JSON.stringify(syms.map((s: any) => s.name)))
}
main().catch((e) => { console.error(e); process.exit(1) })
