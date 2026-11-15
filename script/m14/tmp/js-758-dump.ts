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
  const ctl = "class Base { greet() {} }\nclass Sub extends Base { greet() {} }\n"
  const r: any = az.analyze(parser.parse(ctl), ctl, "ctl.js")
  console.log("SYMBOLS(" + r.symbols.length + "): " + JSON.stringify(r.symbols).slice(0, 600))
  console.log("RELS(" + r.relationships.length + "): " + JSON.stringify(r.relationships).slice(0, 600))
  console.log("errors: " + JSON.stringify(r.errors).slice(0, 200))
}
main().catch((e) => { console.error(e); process.exit(1) })
