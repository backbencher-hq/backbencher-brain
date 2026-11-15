import * as fs from "fs"; import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const src = fs.readFileSync("/tmp/cx.dart", "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root: any = p.parse(src).rootNode
  const sig = root.namedChild(0).childForFieldName("body").namedChild(0)
  console.log(`sig.type=${sig.type} nextNamedSibling=${sig.nextNamedSibling?.type}`)
  for (const [label, file] of [["HEAD", "script/m14/tmp/dt-head-analyzer.ts"], ["CURRENT", "src/ast/real-dart-analyzer"]] as const) {
    const mod: any = await import(path.join(ROOT, file))
    const a: any = new mod.RealDartAnalyzer()
    console.log(`${label}: methodComplexity(sig)=${a.methodComplexity(sig)} hasBody(sig)=${a.hasBody(sig)}`)
    const r: any = await a.analyze(root, src, "cx.dart")
    console.log(`${label}: symbol complexity=${r.symbols.find((s: any) => s.name === "describe")?.complexity}`)
  }
}
main()
