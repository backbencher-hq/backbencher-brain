import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P()
parser.setLanguage(lang)
const F = "<corpus-root>/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
const t = parser.parse(fs.readFileSync(F, "utf8"))
const kinds: string[] = []
const w = (n: any) => { if (["method_declaration", "field_declaration", "constructor_declaration", "function_definition"].includes(n.type) && n.startPosition.row + 1 >= 20 && n.startPosition.row + 1 <= 55) kinds.push(`${n.type}@${n.startPosition.row + 1}`); for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
w(t.rootNode)
let errs = 0; const we = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) we(n.child(i)) }; we(t.rootNode)
console.log(`PC: errors=${errs} nodes=${kinds.join(" ")}`)
const G = "<corpus-root>/bb_tests/repositories/grails-core/grails-web-core/src/test/groovy/org/grails/web/servlet/GrailsParameterMapTests.groovy"
if (fs.existsSync(G)) { const s2 = fs.readFileSync(G, "utf8"); const t2 = parser.parse(s2); let e2 = 0; const w2 = (n: any) => { if (n.type === "ERROR" || n.isMissing) e2++; for (let i = 0; i < n.childCount; i++) w2(n.child(i)) }; w2(t2.rootNode); console.log(`GPM: errors=${e2}`) } else console.log("GPM missing")
