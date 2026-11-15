// Old-grammar control: does def-method -> constructor + phantom 'def' property pre-exist?
import * as fs from "fs"
async function main() {
  const mod = await import("../../../src/ast/real-groovy-analyzer")
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(process.argv[2]))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync("/tmp/g841-oldchk.groovy", "utf8")
  const tree = parser.parse(src)
  const az = new (mod as any).RealGroovyAnalyzer()
  const res = await az.analyze(tree.rootNode, src, "probe.groovy")
  for (const s of res.symbols ?? []) console.log(`${s.kind} ${s.name}`)
  for (const r of res.relationships ?? []) if (r.type === "calls") console.log(`calls ${r.source} -> ${r.target}`)
}
main()
