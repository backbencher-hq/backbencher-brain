import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/tmp/x19.wasm"))
const parser = new P(); parser.setLanguage(lang)
const SRC = `class C {\n  def m(promise) {\n    promise = promise.then { it * 2 } then { it + 6 }\n  }\n}\n`
const t = parser.parse(SRC)
const walk = (x: any, d: number) => {
  const flds = []
  if (x.parent) {
    for (let i = 0; i < x.parent.childCount; i++) if (x.parent.child(i).id === x.id) {
      const fn = x.parent.fieldNameForChild(i)
      if (fn) flds.push(`[field:${fn}]`)
    }
  }
  console.log(`${"  ".repeat(d)}${x.type} children=${x.childCount}${flds.join("")}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 20)) : ""}`)
  for (let i = 0; i < x.childCount; i++) walk(x.child(i), d+1)
}
walk(t.rootNode, 0)
