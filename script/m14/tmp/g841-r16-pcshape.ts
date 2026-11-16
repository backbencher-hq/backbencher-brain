import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const PC = "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
const t = parser.parse(fs.readFileSync(PC, "utf8"))
const show = (n: any, d = 0): string => {
  const head = `${" ".repeat(d)}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1}:${n.endPosition.column + 1}] ${JSON.stringify(n.text.length > 42 ? n.text.slice(0, 42) : n.text)}`
  const kids = n.namedChildCount ? Array.from({ length: n.namedChildCount }, (_, i) => show(n.namedChild(i), d + 2)) : []
  return [head, ...kids].join("\n")
}
const w = (n: any) => {
  if (["field_declaration", "constructor_declaration", "method_declaration"].includes(n.type) && n.startPosition.row >= 35 && n.startPosition.row <= 39) console.log(show(n))
  for (let i = 0; i < n.childCount; i++) w(n.child(i))
}
w(t.rootNode)
