import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P()
parser.setLanguage(lang)
const PC = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
const t = parser.parse(fs.readFileSync(PC, "utf8"))
const hits: string[] = []
const w = (n: any) => {
  if (["method_declaration", "field_declaration", "constructor_declaration"].includes(n.type) && n.startPosition.row >= 34 && n.startPosition.row <= 40)
    hits.push(`${n.type}@${n.startPosition.row + 1}:${n.endPosition.row + 1} = ${JSON.stringify(n.text.slice(0, 60))}`)
  for (let i = 0; i < n.childCount; i++) w(n.child(i))
}
w(t.rootNode)
console.log(hits.join("\n"))
const FT = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy"
const t2 = parser.parse(fs.readFileSync(FT, "utf8"))
const c: string[] = []
const w2 = (n: any) => {
  if (n.startPosition.row + 1 === 503 && n.parent && n.parent.startPosition.row + 1 !== 503)
    c.push(`${n.type}@${n.startPosition.row + 1}-${n.endPosition.row + 1} = ${JSON.stringify(n.text.slice(0, 70))}`)
  for (let i = 0; i < n.childCount; i++) w2(n.child(i))
}
w2(t2.rootNode)
console.log("FT503 top-level nodes:", c.join(" | ") || "(none start there)")
