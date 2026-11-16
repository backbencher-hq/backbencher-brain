// #912: the region around the refused site — the ERROR's own children, and the
// tokens/nodes between it and the call-shaped heading.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const parser = new P(); parser.setLanguage(lang)
const file = "<corpus-root>/bb_tests/repositories/jq/src/builtin.c"
const src = readFileSync(file, "utf8")
const root = parser.parse(src).rootNode
const dump = (n: any, depth: number) => {
  const pad = "  ".repeat(depth)
  const f = (c: any) => (c.isNamed ? "" : "(tok)")
  console.log(`${pad}${n.type}${f(n)}${n.isMissing ? " MISSING" : ""}${n.isError ? " ERROR" : ""} [${n.startPosition.row + 1}..${n.endPosition.row + 1}] ${JSON.stringify(n.text.slice(0, 50))}`)
}
// find the ERROR node spanning line 2055 and its neighbourhood
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "ERROR" && n.startPosition.row + 1 <= 2055 && n.endPosition.row + 1 >= 2055) {
    console.log("=== the ERROR node ===")
    dump(n, 0)
    for (let i = 0; i < n.childCount; i++) dump(n.child(i), 1)
    let sib = n.nextSibling
    console.log("=== siblings after the ERROR ===")
    for (let i = 0; sib && i < 6; i++, sib = sib.nextSibling) dump(sib, 1)
    console.log("=== siblings before the ERROR ===")
    let prev = n.previousSibling
    for (let i = 0; prev && i < 4; i++, prev = prev.previousSibling) dump(prev, 1)
    // the call-shaped heading and its own surroundings
    const call = [...(() => { const q: any[] = []; const s2: any[] = [root]; while (s2.length) { const x = s2.pop()!; if (x.type === "call_expression" && x.startPosition.row + 1 === 2067) q.push(x); for (let k = 0; k < x.childCount; k++) s2.push(x.child(k)) } return q })()]
    console.log("=== the heading call_expression, parent chain ===")
    for (const c of call) {
      let cur = c
      const chain: string[] = []
      while (cur) { chain.push(`${cur.type}[${cur.startPosition.row + 1}]`); cur = cur.parent }
      console.log("  " + chain.join(" < "))
      console.log("  prev sibling before parent's heading:", c.previousSibling ? `${c.previousSibling.type} ${JSON.stringify(c.previousSibling.text.slice(0,40))}` : "(none)")
    }
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
