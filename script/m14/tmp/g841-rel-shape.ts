// Dump the FULL relationship object to learn the real field names.
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = `class C { def f() { g(1) } }\n`
  const tree = parser.parse(src)
  const az = new (mod as any).RealGroovyAnalyzer()
  const res = await az.analyze(tree.rootNode, src, "probe.groovy")
  console.log(JSON.stringify((res.relationships ?? []).slice(0, 3), null, 1))
  console.log("--- symbol[0]:", JSON.stringify((res.symbols ?? [])[0]))
}
main()
