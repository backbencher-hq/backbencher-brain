// Dump class_body children under an arbitrary wasm. Usage: dump2 <wasm> <file>
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(process.argv[2]))
  const parser = new P(); parser.setLanguage(lang)
  const src = fs.readFileSync(process.argv[3], "utf8")
  const tree = parser.parse(src)
  const walk = (n: any, depth: number) => {
    if (n.type === "class_body") {
      console.log(`${"  ".repeat(depth)}${n.type}`)
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i)
        if (!ch) continue
        const t = ch.type
        if (t === "{" || t === "}" || t === "line_comment") { console.log(`${"  ".repeat(depth + 1)}${t}`); continue }
        console.log(`${"  ".repeat(depth + 1)}${t} :: ${JSON.stringify((ch.text || "").split("\n")[0].slice(0, 55))}`)
      }
      return
    }
    for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch, depth + 1) }
  }
  walk(tree.rootNode, 0)
}
main()
