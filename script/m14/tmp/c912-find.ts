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
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "ERROR" && n.startPosition.row + 1 <= 2067 && n.endPosition.row + 1 >= 2067) {
    console.log(`ERROR rows ${n.startPosition.row + 1}..${n.endPosition.row + 1} (${n.endPosition.row - n.startPosition.row + 1} lines), children=${n.namedChildCount}`)
    const kids: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); kids.push(`${c.type}@${c.startPosition.row + 1}`) }
    console.log("  children:", kids.join(" "))
    console.log("  --- first 12 lines of the region")
    const lines = src.split("\n")
    for (let i = n.startPosition.row; i < Math.min(lines.length, n.startPosition.row + 12); i++) console.log(`  ${i + 1}| ${lines[i]}`)
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
