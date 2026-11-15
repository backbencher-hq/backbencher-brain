import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SRC = `class C {\n    String optionTag(label, selected, registry) {\n        return "<option\${selected ? ' selected=\"selected\"' : ''}>\${label}/\${registry.lookup(\"G7\")}</option>"\n    }\n}\n`
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`=== ${wasm.replace(/^.*\//, '')}`)
  const t = parser.parse(SRC)
  const find = (x: any): any => { if (x.type === "string_interpolation") return x; for (let i = 0; i < x.childCount; i++) { const r = find(x.child(i)); if (r) return r } return null }
  // find the LAST interpolation (registry.lookup one)
  const all: any[] = []
  const walk = (x: any) => { if (x.type === "string_interpolation") all.push(x); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
  walk(t.rootNode)
  const dump = (x: any, d: number) => { console.log(`${"  ".repeat(d)}${x.type}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 20)) : ""}`); if (d < 7) for (let i = 0; i < x.childCount; i++) dump(x.child(i), d+1) }
  dump(all[all.length - 1], 1)
}
