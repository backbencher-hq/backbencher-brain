import * as fs from "fs"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const ctl = "class Base { greet() {} }\nclass Sub extends Base { greet() {} }\n"
  const tree: any = parser.parse(ctl)
  console.log("rootNode:", tree?.rootNode?.type ?? "NULL")
  const r: any = az.analyze(tree, ctl, "ctl.js")
  console.log("SYMBOLS(" + r.symbols.length + "): " + JSON.stringify(r.symbols).slice(0, 400))
  console.log("OVERRIDES: " + JSON.stringify(r.relationships.filter((e: any) => e.label === "overrides")))
}
main().catch((e) => { console.error(e); process.exit(1) })
