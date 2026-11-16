import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/tmp/g841-r16-vall.wasm"))
const parser = new P()
parser.setLanguage(lang)
const ISO = `class ProductController extends RestfulController {\n    @Override\n    def index(Integer max) {\n        params.max = Math.min(max ?: 10, 100)\n        return [productList: listAllResources(params)]\n    }\n}\n`
const ISO2 = ISO.replace("params.max = Math.min(max ?: 10, 100)", "params.max = Math.min(max ?: 10, 100)\n        params.int('offset')")
for (const [name, src] of [["isolated", ISO], ["isolated+int", ISO2]] as Array<[string, string]>) {
  const t = parser.parse(src)
  const kinds: string[] = []
  const w = (n: any) => { if (["method_declaration", "field_declaration", "constructor_declaration", "function_definition", "method_invocation"].includes(n.type)) kinds.push(`${n.type}@${n.startPosition.row + 1}`); for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
  w(t.rootNode)
  let errs = 0; const we = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) we(n.child(i)) }; we(t.rootNode)
  console.log(`${name}: errors=${errs} kinds=${kinds.join(" ")}`)
}
// the real file: list method/field/constructor nodes between lines 30-50
const F = "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
const t = parser.parse(fs.readFileSync(F, "utf8"))
const kinds: string[] = []
const w = (n: any) => { if (["method_declaration", "field_declaration", "constructor_declaration", "function_definition"].includes(n.type) && n.startPosition.row + 1 >= 20 && n.startPosition.row + 1 <= 55) kinds.push(`${n.type}@${n.startPosition.row + 1}:${JSON.stringify(n.text.slice(0, 34))}`); for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
w(t.rootNode)
console.log("real file 20-55: " + kinds.join("\n                  "))
