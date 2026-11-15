import fs from "node:fs"
const WASM = process.argv[2]
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))
const parser = new P()
parser.setLanguage(lang)
const errsOf = (src: string) => { const t = parser.parse(src); let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }
const body = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`
console.log(`WASM=${WASM}`)
console.log(`  B attrs.int('total')   errs=${errsOf(body("def t = attrs.int('total')"))}`)
console.log(`  B attrs.boolean('x')   errs=${errsOf(body("def b = attrs.boolean('omitNext')"))}`)
console.log(`  B foo.int (read)       errs=${errsOf(body("def t = foo.int"))}`)
console.log(`  B int('x') (non-gap)   errs=${errsOf(body("def t = int('x')"))}`)
console.log(`  A def x = to UploadPage errs=${errsOf(body("def x = to UploadPage"))}`)
const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy"
const G = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-web-core/src/test/groovy/org/grails/web/servlet/mvc/GrailsParameterMapTests.groovy"
for (const [name, path, line] of [["FormTagLib", F, 503], ["GrailsParameterMapTests", G, 205]] as Array<[string, string, number]>) {
  if (!fs.existsSync(path)) { console.log(`  ${name}: MISSING`); continue }
  const src = fs.readFileSync(path, "utf8")
  const t = parser.parse(src)
  let errs = 0
  const w = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
  w(t.rootNode)
  const onLine: any[] = []
  const w2 = (n: any) => { if (n.startPosition.row + 1 === line) onLine.push(n); for (let i = 0; i < n.childCount; i++) w2(n.child(i)) }
  w2(t.rootNode)
  const mi = onLine.find((n) => n.type === "method_invocation")
  console.log(`  ${name} errors=${errs} MI@${line}=${mi ? JSON.stringify(mi.text.slice(0, 30)) : "NONE"}`)
}
// extra signals for the bisect
const PC = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-test-examples/hibernate7/views-functional-tests/grails-app/controllers/functional/tests/ProductController.groovy"
if (fs.existsSync(PC)) {
  const src2 = fs.readFileSync(PC, "utf8")
  const t2 = parser.parse(src2)
  let hasMD = false
  const w3 = (n: any) => { if ((n.type === "method_declaration" || n.type === "function_definition") && n.startPosition.row === 37) hasMD = true; for (let i = 0; i < n.childCount; i++) w3(n.child(i)) }
  w3(t2.rootNode)
  console.log(`  ProductController method_decl@38=${hasMD}`)
}
const GT = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-web-core/src/test/groovy/org/grails/web/servlet/GrailsParameterMapTests.groovy"
