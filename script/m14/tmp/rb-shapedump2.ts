import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const p = new P(); p.setLanguage(LANG)
  for (const src of [`class A\n def size=(v)\n @size = v\n end\nend\n`, `undef foo\n`, `foo rescue nil\n`]) {
    const root = p.parse(src).rootNode
    const dump = (n: any, dp: number): void => {
      if (!n || dp > 3) return
      console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify((n.text ?? "").slice(0, 26)))
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) dump(n.namedChild(i), dp + 1)
    }
    console.log("===" + JSON.stringify(src.split("\n")[0])); dump(root, 0)
  }
}
main()
