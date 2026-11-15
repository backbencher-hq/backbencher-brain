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
  // CONTROL: instance greet in BOTH -> overrides Sub.greet -> Base.greet MUST emit
  const ctl = "class Base { greet() {} }\nclass Sub extends Base { greet() {} }\n"
  const rc: any = az.analyze(parser.parse(ctl), ctl, "ctl.js")
  console.log("CONTROL overrides: " + JSON.stringify((rc.relationships ?? []).filter((e: any) => e.label === "overrides").map((e: any) => e.from + "->" + e.target)))
  // B5 result-shape dump
  const b5 = "class C {\n  get val() { return 1 }\n  set val(v) {}\n}\n"
  const r5: any = az.analyze(parser.parse(b5), b5, "b5.js")
  console.log("result keys: " + JSON.stringify(Object.keys(r5)))
  for (const k of Object.keys(r5)) {
    const v = (r5 as any)[k]
    if (Array.isArray(v) && v.length && typeof v[0] === "object" && "name" in (v[0] ?? {})) {
      console.log("  " + k + " names: " + JSON.stringify(v.map((x: any) => x.name)))
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
