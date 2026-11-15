// #758 verify-before-fix: B4 static-override, B5 accessor-pair, B8 as-default.
// Mirrors conv-j-b8.ts's working parse pattern (inline calls, \n strings).
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
function show(az: any, parser: any, src: string, tag: string) {
  const tree: any = parser.parse(src)
  const r: any = az.analyze(tree, src, "probe.js")
  console.log("== " + tag + " ==")
  console.log("  overrides: " + JSON.stringify((r.relationships ?? []).filter((e: any) => e.label === "overrides").map((e: any) => e.from + "->" + e.target)))
  console.log("  calls: " + JSON.stringify((r.relationships ?? []).filter((e: any) => e.label === "calls").map((e: any) => e.from + "->" + e.target)))
}
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const b4 = "class Base { static create() { return 1; } }\nclass Sub extends Base { static create() { return 2; } }\n"
  const b5 = "class Store {\n  constructor() { this.inner = 0; }\n  get value() { return track(this.inner); }\n  set value(v) { this.inner = wrap(v); }\n}\nnew Store()\n"
  show(az, parser, b4, "B4 static-override: Sub.create overrides Base.create?")
  show(az, parser, b5, "B5 accessor pair: track() AND wrap() must both emit")
}
main().catch((e) => { console.error(e); process.exit(1) })
