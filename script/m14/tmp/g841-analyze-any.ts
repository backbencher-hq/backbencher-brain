// Analyze an arbitrary groovy file with the real analyzer.
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(process.argv[2], "utf8")
  const tree = parser.parse(src)
  const az = new (mod as any).RealGroovyAnalyzer()
  const res = await az.analyze(tree.rootNode, src, process.argv[2])
  for (const s of res.symbols ?? []) console.log(`${s.kind} ${s.name}${s.ownerName ? " owner=" + s.ownerName : ""}`)
  for (const r of res.relationships ?? []) console.log(`${r.type} ${r.source} -> ${r.target}`)
}
main()
