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
  for (const [name, src] of Object.entries({
    objdef: `def @rio.check?\n true\nend\n`,
    selfdef: `module Rake\n def self.included(base)\n end\nend\n`,
  })) {
    const root = await parseSrc(src)
    const dump = (n: any, dp: number): void => {
      if (!n || dp > 2) return
      console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 24)))
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1)
    }
    const find = (n: any, pred: (x: any) => boolean): any => {
      if (!n) return null
      if (pred(n)) return n
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), pred); if (r) return r }
      return null
    }
    console.log(`=== ${name}:`);
    dump(find(root, (x) => x.type === "method" || x.type === "singleton_method"), 0)
    const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
    console.log("  ana:", JSON.stringify((r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)), JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)));
    console.log("  ora:", JSON.stringify(mod.deriveRubyEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)))
  }
}
main()
