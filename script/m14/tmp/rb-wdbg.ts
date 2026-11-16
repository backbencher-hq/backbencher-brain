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
  const src = `def @rio.write(buffer)\n super(buffer)\nend\n`;
  const root = await parseSrc(src)
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (!n) return null
    if (pred(n)) return n
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  const sm = find(root, (x) => x.type === "singleton_method")
  console.log("children:", Array.from({length: sm.namedChildCount}, (_, i) => sm.namedChild(i)?.type + ":" + sm.namedChild(i)?.text?.slice(0,12)).join(" | "))
  console.log("name field:", sm.childForFieldName("name")?.type, JSON.stringify(sm.childForFieldName("name")?.text));
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
  console.log("ana:", JSON.stringify((r.relationships ?? []).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)));
}
main()
