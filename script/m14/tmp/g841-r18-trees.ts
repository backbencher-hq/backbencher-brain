import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const cases: Array<[string, string]> = [
  ["GString annot", 'import org.grails.datastore.mapping.query.api.Queryable\n@Query("delete from ${Product p} where 1=1")\ndef x = 1'],
  ["spaced chain", "class C { def m(p) { p = p.then { it * 2 } then { it + 6 } } }"],
  ["subscript assign", "class C { def m(p, v) { p.properties['a', 'b'] = v } }"],
]
for (const [name, src] of cases) {
  console.log(`===== ${name} =====`)
  const t = parser.parse(src)
  const dump = (n: any, d: number) => {
    if (d <= 7 || n.type === "ERROR" || n.isMissing) console.log(`${"  ".repeat(d)}${n.type}${n.isMissing ? "(MISSING)" : ""} [${n.startPosition.row+1}:${n.startPosition.column+1}] ${JSON.stringify(n.text.slice(0,60))}`)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), d+1)
  }
  dump(t.rootNode, 0)
}
