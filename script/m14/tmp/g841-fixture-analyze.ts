// Analyze the #841 fixture source with the real analyzer to author the
// expectation (authored-before-run protocol: expectations describe the FIX,
// never copied from buggy output — here the fix IS the grammar round).
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync("/tmp/g841-fixture.groovy", "utf8")
  const tree = parser.parse(src)
  const az = new (mod as any).RealGroovyAnalyzer()
  const res = await az.analyze(tree.rootNode, src, "fixtures/groovy/grammar-residuals-841.groovy")
  console.log("parseError:", (res as any).parseError ?? "(none reported)")
  console.log("symbols:", JSON.stringify((res.symbols ?? []).map((s: any) => ({ n: s.name, k: s.kind }))))
  const rels = (res.relationships ?? []).map((r: any) => `${r.type}:${r.source}->${r.target}`)
  console.log("relationships:", JSON.stringify(rels, null, 0))
}
main()
