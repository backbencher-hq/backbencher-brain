import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const errsOf = (s: string) => { const t = parser.parse(s); let n = 0; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return n }
const r17style = (l: string) => `class C {\n    void m() {\n        ${l}\n    }\n}\n`
const r18style = (l: string) => `class C { def m(attrs) { ${l} } }`
const lines = ["def t = attrs.int('total')", "def x = e.evaluateMappings mappings", "def x = f bar"]
for (const l of lines) {
  console.log(`  "${l.slice(0, 30)}"  voidm-wrapper errs=${errsOf(r17style(l))}   defm-wrapper errs=${errsOf(r18style(l))}`)
}
