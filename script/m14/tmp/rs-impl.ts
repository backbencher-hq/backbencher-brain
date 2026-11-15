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
let n = 0
const walk = (x: any): void => {
  if (x.type === "impl_item" && n < 3) {
    n++
    console.log("impl_item:")
    for (const k of x.namedChildren ?? []) console.log(`   ${k.type}  ${JSON.stringify(k.text.slice(0,42).replace(/\n/g," "))}`)
  }
  for (const c of x.namedChildren ?? []) walk(c)
}
walk(root)
