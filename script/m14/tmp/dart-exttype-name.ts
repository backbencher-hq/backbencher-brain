import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(`extension type $Exec._(int v) implements Object {
  static final _class = 1;
  void close() {}
}
`).rootNode
const n = (root.namedChildren ?? [])[0]
console.log("node:", n?.type)
for (const c of n?.namedChildren ?? []) console.log(`  ${c.type}  ${JSON.stringify(c.text.slice(0, 40))}`)
