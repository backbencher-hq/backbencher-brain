import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const src = "class C {\n    void m() {\n        def x = f bar, baz\n    }\n}\n"
const t = parser.parse(src)
const dump = (n: any, d: number) => { console.log("  ".repeat(d) + `${n.type} [${n.startPosition.row+1}:${n.startPosition.column+1}] ${JSON.stringify(n.text.slice(0,40))}`); for (let i = 0; i < n.childCount; i++) dump(n.child(i), d+1) }
dump(t.rootNode, 0)
