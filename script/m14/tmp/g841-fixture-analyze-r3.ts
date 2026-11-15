// Analyze the round-3 #841 fixture with the real analyzer to author the
// expectation from live emission (authored-before-run protocol).
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync("validation/m14/fixtures/groovy/grammar-round3-841.groovy", "utf8")
  const tree = parser.parse(src)
  const az = new (mod as any).RealGroovyAnalyzer()
  const res = await az.analyze(tree.rootNode, src, "fixtures/groovy/grammar-round3-841.groovy")
  console.log("parseError:", (res as any).parseError ?? "(none reported)")
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) {
    console.log(`${s.kind ?? "?"} ${s.name}${s.ownerName ? " owner=" + s.ownerName : ""}${s.visibility ? " vis=" + s.visibility : ""}`)
  }
  console.log("=== relationships ===")
  for (const r of res.relationships ?? []) {
    console.log(`${r.type} ${r.source} -> ${r.target}${r.meta?.isFieldAccess ? " [field]" : ""}`)
  }
}
main()
