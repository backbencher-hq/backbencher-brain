import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const src = `class A\n def a; end\n def b; end\n undef a, b\nend\n`
  const root = await parseSrc(src)
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
  console.log("ana:", JSON.stringify((r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  console.log("ora:", JSON.stringify(mod.deriveRubyEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)))
}
main()
