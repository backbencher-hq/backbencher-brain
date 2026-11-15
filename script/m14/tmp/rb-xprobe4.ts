import * as fs from "fs"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  for (const [name, src] of Object.entries({
    endlessbare: `class Account\n def label = name\n def v = 42\nend\n`,
    regulardef: `class Account\n def m\n name\n end\nend\n`,
  })) {
    const root = await parseSrc(src)
    const r: any = await new RealRubyAnalyzer().analyze(root, src, "x.rb")
    const ana = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => `${x.source}->${x.target}`)
    const tru = mod.deriveRubyEdges(root).filter((x: any) => x.label === "calls").map((x: any) => `${x.from}->${x.target}`)
    console.log(`=== ${name}\n  ana: ${JSON.stringify(ana)}\n  ora: ${JSON.stringify(tru)}`)
  }
}
main()
