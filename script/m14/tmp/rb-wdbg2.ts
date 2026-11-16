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
  const src = `it "x" do\n def @rio.check?\n def @io.write(b)\n super(b)\n end\n end\nend\n`;
  const root = await parseSrc(src)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  for (const m of findAll(root, (x) => x.type === "singleton_method" || x.type === "method")) {
    const nm = (m as any).childForFieldName?.("name")
    console.log(`${m.type} namefield=${nm?.type}:${JSON.stringify(nm?.text)} kids=[${Array.from({length: m.namedChildCount}, (_, i) => m.namedChild(i)?.type).join(",")}]`)
  }
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
  console.log("ana:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)));
}
main()
