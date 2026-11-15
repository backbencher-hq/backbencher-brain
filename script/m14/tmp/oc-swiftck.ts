import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const mod: any = await import("../../../src/ast/real-swift-analyzer")
  const Cls = mod.RealSwiftAnalyzer ?? mod.default ?? Object.values(mod).find((v: any) => v && v.prototype && v.prototype.analyze)
  const src = `extension String {\n  func trimmed() -> String { return self }\n}\n`
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const r: any = await new Cls().analyze(root, src, "t.swift")
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`)))
  console.log("exp:", JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
}
main()
