import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const p = new P(); p.setLanguage(lang)
const f = "/home/ishaq2321/bb_tests/repositories/jq/src/builtin.c"
const src = readFileSync(f, "utf8")
const root = p.parse(src).rootNode
let target: any = null
const st: any[] = [root]
while (st.length) { const n = st.pop()!; if (n.type === "ERROR" && n.startPosition.row + 1 === 2055) target = n; for (let i = 0; i < n.childCount; i++) st.push(n.child(i)) }
const call = target.parent.parent          // ERROR < argument_list < call_expression
console.log(`call_expression rows ${call.startPosition.row + 1}..${call.endPosition.row + 1}`)
console.log("  text head:", JSON.stringify(src.slice(call.startIndex, call.startIndex + 90)))
let s: any = call.previousSibling
for (let g = 0; s && g < 3; g++) { console.log(`  prev ${s.type}@${s.startPosition.row + 1}: ${JSON.stringify(src.slice(s.startIndex, Math.min(s.endIndex, s.startIndex + 60)))}`); s = s.previousSibling }
console.log("  argument_list children:")
const args = target.parent
for (let i = 0; i < Math.min(args.namedChildCount, 6); i++) {
  const c = args.namedChild(i)
  console.log(`    ${c.type}@${c.startPosition.row + 1}..${c.endPosition.row + 1} ${JSON.stringify(src.slice(c.startIndex, Math.min(c.endIndex, c.startIndex + 50)))}`)
}
console.log("  argument_list last named children:")
for (let i = Math.max(0, args.namedChildCount - 4); i < args.namedChildCount; i++) {
  const c = args.namedChild(i)
  console.log(`    ${c.type}@${c.startPosition.row + 1}..${c.endPosition.row + 1} ${JSON.stringify(src.slice(c.startIndex, Math.min(c.endIndex, c.startIndex + 50)))}`)
}
