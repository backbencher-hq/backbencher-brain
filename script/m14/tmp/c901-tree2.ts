import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("/tmp/bb-wasm_tree-sitter-c_tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const lines = readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c", "utf8").split("\n")
const src = lines.slice(218, 395).join("\n")  // S3
const t = parser.parse(src)
console.log("hasError:", t.rootNode.hasError)
let i = 0
for (const c of t.rootNode.children) {
  i++
  const kind = c.isNamed ? c.type : `"${c.type}"`
  const span = `${c.startPosition.row + 219}-${c.endPosition.row + 219}`
  const err = c.hasError ? "  <== hasError" : ""
  const snippet = c.text.split("\n").slice(-2).join(" | ").slice(0, 60)
  console.log(`${String(i).padStart(2)} ${kind.padEnd(24)} lines ${span.padEnd(12)}${err}   ${snippet}`)
}
