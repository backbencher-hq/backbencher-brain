// #841 r24: typed-declarator slot probe + tree dump of the failure
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "/tmp/x24.wasm"))
const parser = new P(); parser.setLanguage(lang)
const CASES: Array<[string, string]> = [
  ["T2 def multi", `def u = sumService.sum 1, 2\n`],
  ["T2t typed multi", `int sum = sumService.sum 1, 2\n`],
  ["T1 def named multi", `def u = g.link controller: 'x', action: 'y'\n`],
  ["T1t typed named multi", `String u = g.link controller: 'x', action: 'y'\n`],
  ["T2ts typed multi in class", `class C {\n  def m() {\n    int sum = svc.sum 1, 2\n  }\n}\n`],
]
for (const [name, src] of CASES) {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}@r${n.startPosition.row + 1} len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  console.log(`${name.padEnd(26)} ${errs.length ? "ERR " + errs.slice(0, 2).join(",") : "CLEAN"}`)
  if (errs.length && name === "T2t typed multi") {
    const sexp = t.toString()
    console.log("  sexp:", sexp.slice(0, 400))
  }
}
