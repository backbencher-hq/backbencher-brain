import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function parseSrc(f: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(fs.readFileSync(f, "utf8")).rootNode
}
async function main() {
  const f = "<corpus-root>/bb_tests/repositories/rack/test/spec_rewindable_input.rb"
  const root = await parseSrc(f)
  console.log("hasError:", root.hasError)
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  for (const m of findAll(root, (x) => (x.type === "singleton_method") && x.text.includes("write"))) {
    const nm = (m as any).childForFieldName?.("name")
    console.log(`singleton namefield=${nm?.type}:${JSON.stringify(nm?.text)} kids=[${Array.from({length: m.namedChildCount}, (_, i) => m.namedChild(i)?.type).join(",")}]`)
  }
  const src = fs.readFileSync(f, "utf8")
  const r: any = await new RealRubyAnalyzer().analyze(root, src, "spec_rewindable_input.rb")
  console.log("calls->write:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls" && x.target === "write").map((x: any) => `${x.source}->${x.target}`)))
}
main()
