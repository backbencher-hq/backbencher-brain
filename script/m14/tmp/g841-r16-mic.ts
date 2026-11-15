import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-datamapping-core/src/main/groovy/org/grails/datastore/gorm/internal/MethodInvokingClosure.groovy"
const src = fs.readFileSync(F, "utf8")
const t = parser.parse(src)
const show = (n: any, d = 0): string => {
  const head = `${" ".repeat(d)}${n.type} [${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1}:${n.endPosition.column + 1}] ${JSON.stringify(n.text.length > 46 ? n.text.slice(0, 46) : n.text)}`
  const kids = n.namedChildCount ? Array.from({ length: n.namedChildCount }, (_, i) => show(n.namedChild(i), d + 2)) : []
  return [head, ...kids].join("\n")
}
let errs = 0
const w = (n: any) => { if (n.type === "ERROR" || n.isMissing) errs++; for (let i = 0; i < n.childCount; i++) w(n.child(i)) }
w(t.rootNode)
console.log(`errors=${errs}`)
const w2 = (n: any) => {
  if (n.type === "class_body") { console.log(show(n, 0)); return }
  for (let i = 0; i < n.childCount; i++) w2(n.child(i))
}
w2(t.rootNode)
