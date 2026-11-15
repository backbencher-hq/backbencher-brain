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
  const mod: any = await import(path.join(ROOT, "src/ast/real-dart-analyzer"))
  const a: any = new mod.RealDartAnalyzer()
  const orig = a.processFunctionOrMethod.bind(a)
  let n = 0
  a.processFunctionOrMethod = (node: any, sig: any, symbols: any, ...rest: any[]) => {
    const before = symbols.length
    const ret = orig(node, sig, symbols, ...rest)
    const added = symbols.slice(before)
    console.log(`#${++n} node=${node.type} sig=${sig.type} -> pushed ${added.map((s: any) => `${s.name}@c${s.complexity}`).join(",")}`)
    if (symbols.length > before) symbols.splice(before, symbols.length - before, ...added)  // keep payload
    return ret
  }
  const r: any = await a.analyze(root, src, "cx.dart")
  console.log("final:", r.symbols.map((s: any) => `${s.name}@c${s.complexity}`).join(", "))
}
main()
