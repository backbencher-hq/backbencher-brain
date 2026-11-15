// #841 round 22: bound the typed-closure juxt misparse — which bodies die?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const cases: Array<[string, string]> = [
  ["1 typed, newline, 1-dot body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event.contains('x')\n    }\n  }\n}\n`],
  ["2 typed, newline, 2-dot body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["3 typed, newline, no-dot body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event\n    }\n  }\n}\n`],
  ["4 typed, same-line body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event -> event.formattedMessage.contains('x') }\n  }\n}\n`],
  ["5 untyped, newline, 2-dot body", `class C {\n  def m() {\n    xs.findAll { event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["6 typed, newline, call body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      handle(event)\n    }\n  }\n}\n`],
  ["7 typed, newline, assign body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      def y = event.formattedMessage\n      y\n    }\n  }\n}\n`],
  ["8 typed, two params", `class C {\n  def m() {\n    xs.each { ILoggingEvent a, String b ->\n      a.formattedMessage.contains(b)\n    }\n  }\n}\n`],
  ["9 typed, closure-empty body", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n    }\n  }\n}\n`],
  ["10 typed, method call on head", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event.format()\n    }\n  }\n}\n`],
]
for (const [name, src] of cases) {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`[${n.startPosition.row + 1}] ${JSON.stringify(n.text.slice(0, 36))}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  console.log(`${name.padEnd(32)} ${errs.length === 0 ? "CLEAN" : "ERR: " + errs.slice(0, 2).join(" | ")}`)
}
