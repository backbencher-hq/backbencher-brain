// #841 round 23: varargs + default-value closure params, plus regression shapes
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "/tmp/x23.wasm"))
const parser = new P(); parser.setLanguage(lang)
const CASES: Array<[string, string, number]> = [
  ["N1 varargs param", `class C {\n  def m() {\n    def create = { String... names -> names.each { println it } }\n  }\n}\n`, 0],
  ["N2 default value", `class C {\n  def m() {\n    def f = { boolean includeTests, String filePath = null -> println filePath }\n  }\n}\n`, 0],
  ["N3 varargs+default combo", `class C {\n  def m() {\n    def g = { String prefix = 'x', String... rest -> println rest }\n  }\n}\n`, 0],
  ["N4 real TestDataService line", `class C {\n  def m() {\n    def create = { String... names -> names.each { save new User([username: it, password: 'x'] + flags) } }\n  }\n}\n`, 0],
  ["C1 untyped plain (r22 hold)", `class C {\n  def m() {\n    xs.findAll { event -> event.formattedMessage.contains('x') }\n  }\n}\n`, 0],
  ["C2 typed plain (r22 hold)", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event -> event.formattedMessage.contains('x') }\n  }\n}\n`, 0],
]
for (const [name, src, wantErrs] of CASES) {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`[${n.startPosition.row + 1}]`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  const ok = errs.length === wantErrs ? "ok" : `MISMATCH want=${wantErrs}`
  console.log(`${name.padEnd(28)} errs=${errs.length} ${ok}`)
}
