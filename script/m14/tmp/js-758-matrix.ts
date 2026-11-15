// Delta matrix: {import static|dynamic} x {filePath probe.js|fixtures/...} x {tree|tree.rootNode}
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const content = fs.readFileSync("validation/m14/fixtures/javascript/chain-root-and-bare-reads.js", "utf8")
  const StaticAZ = (await import("../../../src/ast/real-javascript-analyzer")).RealJavaScriptAnalyzer
  const DynMod: any = await import("../../../src/ast/real-javascript-analyzer")
  const DynAZ = DynMod.RealJavaScriptAnalyzer
  const tree = parser.parse(content)
  for (const [azName, AZ] of [["static", StaticAZ], ["dynamic", DynAZ]] as const) {
    for (const fp of ["probe.js", "fixtures/javascript/chain-root-and-bare-reads.js"]) {
      for (const [argName, arg] of [["tree", tree], ["rootNode", tree.rootNode]] as const) {
        const az: any = new AZ()
        const r = await az.analyze(arg, content, fp)
        console.log(azName + " | " + fp.padEnd(46) + " | " + argName.padEnd(8) + " -> symbols " + r.symbols.length + " rels " + r.relationships.length)
      }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
