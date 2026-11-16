import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const F = "<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const root = parser.parse(fs.readFileSync(F, "utf8")).rootNode
const st: any[] = [root]; const hits: any[] = []
while (st.length) { const n = st.pop()!; if (n.startPosition.row + 1 >= 5525 && n.startPosition.row + 1 <= 5534) hits.push(n); for (let i = 0; i < n.childCount; i++) st.push(n.child(i)) }
let item: any = hits.find(h => h.type === "translation_unit" || h.parentType === "translation_unit")
// deepest-first: print the smallest node covering the region
const smallest = hits.filter(h => h.parent === hits[hits.length-1]).pop() ?? hits[hits.length-1]
function dump(n: any, d: number, max = 5): string { let o = "  ".repeat(d) + `${n.type}${n.isError ? "(ERROR)" : ""} "${(n.text||"").replace(/\s+/g," ").slice(0,44)}"\n`; if (d < max) for (let i = 0; i < n.childCount; i++) o += dump(n.child(i), d+1, max); return o }
// find the top-level item containing L5527
const st2: any[] = [root]; let top: any = null
while (st2.length) { const n = st2.pop()!; if (n.parent?.type === "translation_unit" && n.startPosition.row + 1 <= 5527 && n.endPosition.row + 1 >= 5527) top = n; for (let i = 0; i < n.childCount; i++) st2.push(n.child(i)) }
console.log("top-level item at L5527:", top?.type)
if (top) console.log(dump(top, 0, 4))
