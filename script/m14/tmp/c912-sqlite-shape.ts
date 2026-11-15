import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const p = new P(); p.setLanguage(lang)
for (const [f, row] of [["/home/ishaq2321/bb_tests/repositories/sqlite/src/os_win.c", 379], ["/home/ishaq2321/bb_tests/repositories/sqlite/src/os_win.c", 400]]) {
  const src = readFileSync(f, "utf8")
  const root = p.parse(src).rootNode
  let hit: any = null
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "call_expression" && n.startPosition.row + 1 === row) hit = n
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
  }
  console.log(`=== ${path.basename(f)}:${row}`)
  if (!hit) { console.log("  no call_expression starts there"); continue }
  console.log("  call text:", JSON.stringify(src.slice(hit.startIndex, hit.endIndex).slice(0, 100)))
  const chain: string[] = []
  let w: any = hit
  while (w) { chain.push(`${w.type}[${w.startPosition.row + 1}]`); w = w.parent }
  console.log("  ancestry:", chain.join(" < "))
  const lines = src.split("\n")
  console.log("  lines:")
  for (let i = row - 2; i < row + 3; i++) console.log(`    ${i + 1}| ${lines[i]}`)
}
