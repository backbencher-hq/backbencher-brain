// Print the parse tree S-expression for a groovy snippet passed on stdin/file.
// Usage: bun script/m14/tmp/g841-sexp.ts <file>
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(process.argv[2], "utf8")
  const tree = parser.parse(src)
  console.log(tree.rootNode.toString())
}
main()
