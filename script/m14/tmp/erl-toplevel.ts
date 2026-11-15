import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
const p = new P(); p.setLanguage(gl)
const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
const hist = new Map<string, number>()
for (const c of root.namedChildren ?? []) hist.set(c.type, (hist.get(c.type) ?? 0) + 1)
console.log("top-level node types:", [...hist].map(([k, v]) => `${k}=${v}`).join("  "))
// show one of each interesting type
const want = ["preproc_define", "record_decl", "type_alias", "fun_decl", "spec"]
for (const c of root.namedChildren ?? []) {
  if (!want.includes(c.type)) continue
  const sub = (n: any, d: number): void => {
    if (d > 2) return
    console.log("  ".repeat(d) + `${n.type}  ${JSON.stringify(n.text.slice(0, 46))}`)
    for (const k of n.namedChildren ?? []) sub(k, d + 1)
  }
  sub(c, 1)
  break
}
