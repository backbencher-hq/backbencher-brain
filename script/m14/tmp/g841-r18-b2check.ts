import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
for (const wasm of [process.argv[2], process.argv[3]]) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  const errs = (s: string) => { const t = parser.parse(s); const out: string[] = []; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) out.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}-${x.endPosition.row+1}:${x.endPosition.column+1}]${JSON.stringify(x.text.slice(0,25))}`); for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return out }
  const G1 = 'import org.grails.datastore.mapping.query.api.Queryable\n@Query("delete from ${Product p} where 1=1")\ndef x = 1\n'
  const G4 = "class C { static foo(a) { a }; static void main(String[] a) { def p = 'P'; println \"x ${C.foo p} y\" } }\n"
  console.log(`--- ${wasm.includes('b2') ? 'B2 (juxt only)' : 'HEAD r17'}`)
  console.log("  G1:", JSON.stringify(errs(G1)))
  console.log("  G4:", JSON.stringify(errs(G4)))
}
