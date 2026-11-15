import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
const want = new Set(["enum_variant_list", "field_declaration_list", "declaration_list"])
const walk = (n: any): void => {
  if (want.has(n.type)) {
    console.log(`${n.type}:`)
    for (const c of n.namedChildren ?? []) console.log(`    ${c.type}  ${JSON.stringify(c.text.slice(0,30))}`)
  }
  for (const c of n.namedChildren ?? []) walk(c)
}
walk(root)
