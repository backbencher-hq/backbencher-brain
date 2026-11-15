import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
const p = new P(); p.setLanguage(gl)
const src = `class C { int x = 0; }
enum E { a }
mixin M { void m() {} }
extension X on int { int t() => 1; }
extension type ET._(int v) implements Object { int get d => v; }
abstract class AC { void g() {} }
mixin class MC {}
`
const root = p.parse(src).rootNode
console.log("declaration node types the grammar produces at TOP LEVEL:")
for (const c of root.namedChildren ?? []) {
  const body = (c.namedChildren ?? []).find((x: any) => String(x.type).includes("body"))
  console.log(`  ${String(c.type).padEnd(28)} body=${body?.type ?? "-"}  ${JSON.stringify(c.text.slice(0, 44))}`)
}
