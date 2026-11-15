import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const errs = (s: string) => { const t = parser.parse(s); let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }
const cases: Array<[string, string]> = [
  ["one-line class, static field", "@Entity class AW { static hasMany = [books: Book] }"],
  ["one-line class, plain field", "class AW { static hasMany = [books: Book] }"],
  ["one-line class, typed field", "class AW { static Map books }"],
  ["multi-line class, static field", "class AW {\n  static hasMany = [books: Book]\n}"],
  ["one-line class, method", "class AW { def m() { 1 } }"],
  ["one-line class, modifier-only field", "class AW { static }"],
  ["one-line if", "def m() {\n  if (x) attrs.remove('id')\n  1\n}"],
]
for (const [name, src] of cases) console.log(`  ${name.padEnd(38)} errs=${errs(src)}`)
