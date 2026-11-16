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
  const src = `class Watcher
  def hook(obj)
    def obj.cached
      1
    end
    def @cfg.memo
      2
    end
    obj
  end
end
`;
  const root = await parseSrc(src)
  console.log("hasError:", root.hasError)
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
  console.log("rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => ["calls", "uses"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)));
  const mod: any = await import("../../../script/m14/differential")
  console.log("ora:", JSON.stringify(mod.deriveRubyEdges(root).filter((x: any) => ["calls", "uses"].includes(x.label)).map((x: any) => `${x.label}[${x.from}->${x.target}]`)))
}
main()
