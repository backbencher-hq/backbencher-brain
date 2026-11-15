import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const F = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const src = fs.readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
const start = src.indexOf("CMPP__EXPORT(void *, cmpp_mrealloc)")
const st: any[] = [root]
let node: any = null
while (st.length) {
  const n = st.pop()!
  if (n.startIndex === start) { node = n; break }
  for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
}
console.log("node at the heading:", node?.type)
function dump(n: any, d: number, max = 4): string {
  let o = "  ".repeat(d) + `${n.type}${n.isError ? "(ERROR)" : ""}${n.isMissing ? "(MISSING)" : ""} "${(n.text || "").replace(/\s+/g, " ").slice(0, 50)}"\n`
  if (d < max) for (let i = 0; i < n.childCount; i++) o += dump(n.child(i), d + 1, max)
  return o
}
// print the ancestry chain then the subtree of the nearest top-level-ish ancestor
const chain: string[] = []
let c: any = node
while (c) { chain.push(`${c.type}${c.isError ? "(ERROR)" : ""}`); c = c.parent }
console.log("ancestry:", chain.join(" < "))
let anc: any = node
while (anc && anc.parent && !["ERROR", "translation_unit"].includes(anc.parent.type)) anc = anc.parent
console.log(dump(anc, 0, 4))
