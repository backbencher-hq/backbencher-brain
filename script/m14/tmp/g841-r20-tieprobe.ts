import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/tmp/x20.wasm"))
const parser = new P(); parser.setLanguage(lang)
const CASES: [string, string][] = [
  ["T1 single-index assign", `class C {\n  def m(employee, params) {\n    employee.properties['firstName'] = params\n  }\n}\n`],
  ["T2 bare single-index", `def x = y['a']\n`],
  ["T3 multi-index bare expr", `def x = y['a', 'b']\n`],
  ["T4 multi-index assign", `class C {\n  def m(employee, params) {\n    employee.properties['firstName', 'lastName'] = params\n  }\n}\n`],
]
for (const [name, SRC] of CASES) {
  const t = parser.parse(SRC)
  const errs: string[] = []
  const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}]`); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
  walk(t.rootNode)
  const find = (x: any, kinds: string[]): any => { if (kinds.includes(x.type)) return x; for (let i = 0; i < x.childCount; i++) { const r = find(x.child(i), kinds); if (r) return r } return null }
  const aa = find(t.rootNode, ["array_access", "assignment_expression", "juxt_function_call"])
  console.log(`${name} errs=${errs.length} topMatch=${aa ? aa.type : "none"}`)
}
