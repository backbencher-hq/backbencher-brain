// #841 round 22: case-1 tree — params-head or juxt+lambda-tail?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "/tmp/x22-base.wasm"))
const parser = new P(); parser.setLanguage(lang)

const SRC = `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event.contains('x')\n    }\n  }\n}\n`
const t = parser.parse(SRC).rootNode
const walk = (x: any, d: number): void => {
  const err = x.type === "ERROR" || x.isMissing ? " <<ERROR>>" : ""
  console.log(`${"  ".repeat(d)}${x.type}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 30)) : err}`)
  if (d < 11) for (let i = 0; i < x.childCount; i++) walk(x.child(i), d + 1)
}
walk(t, 0)
