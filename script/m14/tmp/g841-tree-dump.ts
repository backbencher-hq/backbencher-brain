// Dump class_body child node types to see method vs constructor classification.
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
  const walk = (n: any, depth: number) => {
    if (n.type === "class_body" || n.type === "ERROR") {
      console.log(`${"  ".repeat(depth)}${n.type}`)
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i)
        if (!ch) continue
        const label = ch.type === "function_definition" || ch.type === "method_declaration" || ch.type === "constructor_declaration" || ch.type === "field_declaration" || ch.type === "ERROR"
          ? `${ch.type} :: ${JSON.stringify((ch.text || "").split("\n")[0].slice(0, 50))}`
          : ch.type
        console.log(`${"  ".repeat(depth + 1)}${label}`)
      }
      return
    }
    for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch, depth + 1) }
  }
  walk(tree.rootNode, 0)
}
main()
