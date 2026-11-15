import * as fs from "fs"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function main() {
  const src = fs.readFileSync("validation/m14/fixtures/ruby/second-review.rb", "utf8")
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "/home/ishaq2321/mcp/backbencher-brain/node_modules/web-tree-sitter/tree-sitter.wasm" })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  console.log("hasError:", root.hasError)
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "second-review.rb")
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}${s.ownerName ? "(" + s.ownerName + ")" : ""}`)))
  console.log("rels:", JSON.stringify((r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  console.log("imports:", JSON.stringify((r.imports ?? []).map((i: any) => i.module)));
  console.log("exports:", JSON.stringify((r.exports ?? []).map((e: any) => e.name)));
}
main()
