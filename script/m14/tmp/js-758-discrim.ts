// Discriminator: fixture-file input through MY probe setup.
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
  const content = fs.readFileSync("validation/m14/fixtures/javascript/chain-root-and-bare-reads.js", "utf8")
  const tree = parser.parse(content)
  console.log("rootNode:", tree?.rootNode?.type ?? "NULL", "hasError:", tree?.rootNode?.hasError)
  const r: any = az.analyze(tree, content, "probe.js")
  console.log("SYMBOLS(" + r.symbols.length + "): " + JSON.stringify(r.symbols.map((s: any) => s.name)).slice(0, 300))
  console.log("RELS(" + r.relationships.length + ")")
}
main().catch((e) => { console.error(e); process.exit(1) })
