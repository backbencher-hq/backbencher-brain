import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)
const CASES: Array<[string, string]> = [
  ["B1 attrs.int('total')", "def t = attrs.int('total')"],
  ["B6 foo.int (read)", "def t = foo.int"],
  ["B4 control attrs.integer", "def t = attrs.integer('total')"],
  ["A2 def x = to UploadPage", "def x = to UploadPage"],
  ["A8 if (foo bar)", "if (foo bar) { }"],
  ["A3 def m = ev.evaluateMappings mappings", "def m = ev.evaluateMappings mappings"],
]
const body = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`
const dump = (x: any, d = 0): string => {
  const pad = "  ".repeat(d)
  const txt = x.childCount === 0 ? JSON.stringify(x.text.slice(0, 24)) : ""
  const own = x.type === "ERROR" || x.isMissing ? " <<<<" : ""
  let s = `${pad}${x.type}${own} ${txt}\n`
  for (let i = 0; i < x.childCount; i++) s += dump(x.child(i), d + 1)
  return s
}
for (const [name, line] of CASES) {
  console.log(`\n########## ${name}`)
  const t = parser.parse(body(line))
  const lines = dump(t.rootNode).split("\n")
  // print only the method-body interior (skip program/class/method noise)
  console.log(lines.slice(0, 26).join("\n"))
}
