import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const F = process.argv[3]
const src = fs.readFileSync(F, "utf8")
const t = parser.parse(src)
const out: string[] = []
const w = (n: any) => {
  if (n.type === "ERROR" || n.isMissing) out.push(`${n.type} [${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1}:${n.endPosition.column + 1}] ${JSON.stringify(n.text.slice(0, 70))}`)
  for (let i = 0; i < n.childCount; i++) w(n.child(i))
}
w(t.rootNode)
console.log(`${process.argv[2]}: ${out.length} error nodes`)
for (const o of out) console.log("  " + o)
