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
  const r: any = az.analyze(parser.parse("const x = 1;\nexport { x as default };\n").rootNode, "const x = 1;\nexport { x as default };\n", "p.js")
  process.stdout.write("exports: " + JSON.stringify(r.exports) + "\n")
  const r2: any = az.analyze(parser.parse("const y = 1;\nexport default y;\n").rootNode, "const y = 1;\nexport default y;\n", "p2.js")
  process.stdout.write("export default y: " + JSON.stringify(r2.exports) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
