import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const src = fs.readFileSync(process.argv[3], "utf8")
const lines = src.split("\n")
const errsOf = (s: string) => { const t = parser.parse(s); let n = 0; const root = t.rootNode; const w = (x: any) => { if (x.type === "ERROR" || x.isMissing) n++; for (let i = 0; i < x.childCount; i++) w(x.child(i)) }; w(root); return { n, rootIsError: root.type === "ERROR" } }
// binary search: smallest prefix (in lines) whose parse has root ERROR
let lo = 1, hi = lines.length
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2)
  const r = errsOf(lines.slice(0, mid).join("\n") + "\n}")
  if (r.rootIsError) hi = mid; else lo = mid + 1
}
console.log("first prefix with root-ERROR at line:", lo, "->", JSON.stringify(lines.slice(Math.max(0, lo - 3), lo + 1).join("\n")))
// also: exact error nodes for prefix lo-1..lo+2
const probe = lines.slice(0, lo + 2).join("\n") + "\n}"
const t = parser.parse(probe)
const dump = (n: any, d: number) => { if (n.type === "ERROR" || n.isMissing) console.log(`  ${n.type} [${n.startPosition.row+1}:${n.startPosition.column+1}-${n.endPosition.row+1}:${n.endPosition.column+1}] ${JSON.stringify(n.text.slice(0,80))}`); for (let i = 0; i < n.childCount; i++) dump(n.child(i), d+1) }
dump(t.rootNode, 0)
