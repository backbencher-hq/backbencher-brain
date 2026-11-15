// #841 round 22: bisect — what context flips `{ Type name -> ... }` into a juxt misparse?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const cases: Array<[string, string]> = [
  ["A two-seg def-method", `class C {\n  def m() {\n    providerAppender.list.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["B three-seg def-method", `class C {\n  def m() {\n    a.b.c.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["C two-seg typed-method", `class C {\n  private List<ILoggingEvent> m() {\n    providerAppender.list.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["D one-seg def-method", `class C {\n  def m() {\n    xs.findAll { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
  ["E typed-method only", `class C {\n  private List<ILoggingEvent> m() {\n    event.formattedMessage.contains('x')\n  }\n}\n`],
  ["F bare closure stmt", `class C {\n  def m() {\n    def f = { ILoggingEvent event ->\n      event.formattedMessage.contains('x')\n    }\n  }\n}\n`],
]
for (const [name, src] of cases) {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`[${n.startPosition.row + 1}:${n.startPosition.column}] ${JSON.stringify(n.text.slice(0, 40))}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  console.log(`${name.padEnd(26)} ${errs.length === 0 ? "CLEAN" : "ERR: " + errs.slice(0, 3).join(" | ")}`)
}
