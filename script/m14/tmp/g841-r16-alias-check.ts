import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/tmp/g841-r16-alias.wasm"))
const parser = new P()
parser.setLanguage(lang)
const B = ["class C {\\n    void m() {\\n        def t = attrs.int('total')\\n    }\\n}\\n", "class C {\\n    void m() {\\n        def b = attrs.boolean('omitNext')\\n    }\\n}\\n"]
for (const src of B) {
  const t = parser.parse(src)
  let errs = 0; const types: string[] = []
  const w = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; if (["method_invocation", "field_access", "integral_type", "boolean_type", "identifier"].includes(n.type) && n.startPosition.row === 2) types.push(`${n.type}:${JSON.stringify(n.text)}`); for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
  w(t.rootNode)
  console.log(`errs=${errs}  row3 nodes: ${types.join(" ")}`)
}
const F = "<corpus-root>/bb_tests/repositories/grails-core/grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy"
const src = fs.readFileSync(F, "utf8")
const t = parser.parse(src)
let errs = 0
const w = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
w(t.rootNode)
const onLine: any[] = []
const w2 = (n: any) => { if (n.startPosition.row + 1 === 503) onLine.push(n); for (let i = 0; i < n.childCount; i++) w2(n.child(i)) }
w2(t.rootNode)
const mi = onLine.find((n) => n.type === "method_invocation")
console.log(`FormTagLib errors=${errs} onLine=[${onLine.map((n) => n.type).slice(0, 14).join(",")}] MI=${mi ? JSON.stringify(mi.text.slice(0, 30)) : "NONE"}`)
