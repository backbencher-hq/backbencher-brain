// print the parse tree of an import statement, so the root-cause test ("is this
// MISSING target imported?") extracts names the way the grammar actually spells them
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const file = process.argv[2]
const want = process.argv[3] ?? "import_statement"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const p = new P()
p.setLanguage(gl)
const root = p.parse(fs.readFileSync(file, "utf8")).rootNode
let shown = 0
const walk = (n: any, d: number): void => {
  if (n.type === want && shown < 4) {
    shown++
    const sub = (m: any, dd: number): void => {
      console.log("  ".repeat(dd) + `${m.type}${m.isNamed ? "" : " (anon)"}  ${JSON.stringify(m.text.slice(0, 70))}`)
      for (const c of m.namedChildren ?? []) sub(c, dd + 1)
    }
    sub(n, 0)
    return
  }
  for (const c of n.namedChildren ?? []) walk(c, d + 1)
}
walk(root, 0)
if (!shown) console.log(`no ${want} found in ${file}`)