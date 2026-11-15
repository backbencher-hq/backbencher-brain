import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
for (const wasm of [process.argv[2], process.argv[3]]) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  const mk = (annot: string) => `${annot}\ndef x = 1\n`
  const errs = (s: string) => { const t = parser.parse(s); const out: string[] = []; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) out.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}-${x.endPosition.row+1}:${x.endPosition.column+1}]`) ; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(t.rootNode); return out }
  console.log(`--- ${wasm.split('/').pop()}`)
  console.log("  plain def x=1:", JSON.stringify(errs(mk("def y = 0"))))
  console.log("  @Deprecated annot:", JSON.stringify(errs(mk('@Deprecated\ndef x = 1'))))
  console.log("  @Query GString annot:", JSON.stringify(errs(mk('@Query("delete from ${Product p} where 1=1")'))))
}
