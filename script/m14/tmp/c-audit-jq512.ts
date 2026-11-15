import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const src = readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv_dtoa.c", "utf8")
const tree = parser.parse(src)
const walk = (n: any): void => {
  if (n.startPosition.row + 1 >= 508 && n.startPosition.row + 1 <= 516) {
    if (["struct_specifier", "union_specifier", "enum_specifier", "type_identifier"].includes(n.type)) {
      const nm = n.childForFieldName?.("name")
      console.log(`${n.type} @${n.startPosition.row + 1} name=${nm ? `"${nm.text}" @${nm.startPosition.row + 1}` : "(none)"} text="${n.text.replace(/\n/g, "\\n").slice(0, 40)}"`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
}
walk(tree.rootNode)
