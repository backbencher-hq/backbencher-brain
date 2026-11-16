import * as fs from "fs"
import * as path from "path"
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
    undef: `def m\n undef helper\nend\n`,
    defined: `def m(x)\n return 1 if defined?(Foo)\n return 2 if defined?(bar)\nend\n`,
  })) {
    const root = await parseSrc(src)
    const tru = mod.deriveRubyEdges(root).map((x: any) => `${x.label}[${x.from}->${x.target}]`)
    console.log(`=== ${name} ora: ${JSON.stringify(tru)}`)
  }
}
main()
