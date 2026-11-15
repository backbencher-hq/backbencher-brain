import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
for (const wasm of [process.argv[2], process.argv[3]]) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  const G1 = 'import org.grails.datastore.mapping.query.api.Queryable\n@Query("delete from ${Product p} where 1=1")\ndef x = 1'
  const errs = (s: string) => { const t = parser.parse(s); const out: string[] = []; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) out.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}-${x.endPosition.row+1}:${x.endPosition.column+1}]${x.text ? JSON.stringify(x.text.slice(0,20)) : ""}`); for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return out }
  console.log(`--- ${wasm.split('/').pop()}`)
  console.log("  G1 no-newline:", JSON.stringify(errs(G1)))
  console.log("  G1 newline:   ", JSON.stringify(errs(G1 + "\n")))
}
