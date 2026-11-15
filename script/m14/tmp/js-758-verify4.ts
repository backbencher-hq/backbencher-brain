// #758 verify round 4 — probe bug fixed: pass tree.rootNode (not tree).
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
function rel(r: any, label: string) {
  return JSON.stringify((r.relationships ?? []).filter((e: any) => e.label === label).map((e: any) => e.from + "->" + e.target))
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const run = (src: string, file: string) => az.analyze(parser.parse(src).rootNode, src, file)
  // CONTROL: instance greet both sides -> overrides MUST emit
  const ctl = "class Base { greet() {} }\nclass Sub extends Base { greet() {} }\n"
  console.log("CONTROL overrides (expect Sub.greet->Base.greet): " + rel(run(ctl, "ctl.js"), "overrides"))
  // B4 EXACT: instance base + STATIC sub -> overrides MUST NOT emit
  const b4 = "class Base { greet() {} }\nclass Sub extends Base { static greet() {} }\n"
  console.log("B4 overrides (expect []): " + rel(run(b4, "b4.js"), "overrides"))
  // B5 EXACT: get/set pair -> both bodies' calls + both symbols
  const b5 = "class Store {\n  constructor() { this.inner = 0; }\n  get value() { return track(this.inner); }\n  set value(v) { this.inner = wrap(v); }\n}\nnew Store()\n"
  const r5 = run(b5, "b5.js")
  console.log("B5 calls (expect track AND wrap): " + rel(r5, "calls"))
  const valSyms = (r5.symbols ?? []).filter((s: any) => s.name === "val")
  console.log("B5 val symbols: " + JSON.stringify(valSyms.map((s: any) => ({ kind: s.kind, isStatic: s.isStatic, owner: s.ownerName }))))
  // B8: already verified live via conv-j-b8.ts (isDefault:true, viaAliasDefault:true)
}
main().catch((e) => { console.error(e); process.exit(1) })
