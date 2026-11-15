import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const src = 'import org.grails.datastore.mapping.query.api.Queryable\n@Query("delete from ${Product p} where 1=1")\ndef x = 1'
const t = parser.parse(src)
const dump = (n: any, d: number) => {
  if (n.startPosition.row + 1 >= 2 && (d <= 8 || n.type === "ERROR" || n.isMissing)) console.log(`${"  ".repeat(d)}${n.type}${n.isMissing ? "(MISSING)" : ""} [${n.startPosition.row+1}:${n.startPosition.column+1}] ${JSON.stringify(n.text.slice(0,60))}`)
  for (let i = 0; i < n.childCount; i++) dump(n.child(i), d+1)
}
dump(t.rootNode, 0)
