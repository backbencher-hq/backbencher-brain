import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/tmp/x21.wasm"))
const parser = new P(); parser.setLanguage(lang)
const SRC = `class C {\n  def m(builder) {\n    _ * builder.isPaginationEnabledList() >> false\n  }\n}\n`
const t = parser.parse(SRC)
const walk = (x: any, d: number) => {
  console.log(`${"  ".repeat(d)}${x.type}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 24)) : x.type === "ERROR" ? " << " + JSON.stringify(x.text.slice(0, 50)) : ""}`)
  if (d < 9) for (let i = 0; i < x.childCount; i++) walk(x.child(i), d+1)
}
walk(t.rootNode, 0)
