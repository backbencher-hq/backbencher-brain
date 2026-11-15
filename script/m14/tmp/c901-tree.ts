import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("/tmp/bb-wasm_tree-sitter-c_tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const src = readFileSync("validation/m14/fixtures/c/macro-forward-read.c", "utf8")
const t = parser.parse(src)
let out = t.rootNode.toString()
// print only the tail after the comment
console.log(out.split("*/").pop()?.slice(0, 1400))
