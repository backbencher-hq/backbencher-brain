import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const p = new P(); p.setLanguage(lang)
const f = "<corpus-root>/bb_tests/repositories/jq/src/builtin.c"
const src = readFileSync(f, "utf8")
const root = p.parse(src).rootNode
// find the ERROR at row 2055 (0-based 2054)
let target: any = null
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "ERROR" && n.startPosition.row + 1 === 2055) target = n
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
if (!target) { console.log("not found"); process.exit(0) }
const chain: string[] = []
let w: any = target
while (w) { chain.push(`${w.type}[${w.startPosition.row + 1}]`); w = w.parent }
console.log("ancestry:", chain.join(" < "))
console.log("prev siblings of the ERROR:")
let s: any = target.previousSibling
for (let g = 0; s && g < 6; g++) {
  console.log(`  ${s.type}@${s.startPosition.row + 1}..${s.endPosition.row + 1} hash=${s.type === "ERROR" ? "" : ""}`)
  const txt = src.slice(s.startIndex, Math.min(s.endIndex, s.startIndex + 120)).replace(/\n/g, "\\n")
  console.log(`     | ${txt}`)
  s = s.previousSibling
}
console.log("the ERROR's first 3 lines:")
const lines = src.split("\n")
for (let i = target.startPosition.row; i < target.startPosition.row + 3; i++) console.log(`   ${i + 1}| ${lines[i]}`)
