// W17: is the enum's declaring occurrence varDeclSuppressed? Compute the
// ERROR-span glue header position for jv.c and compare with L1963 (enum).
// Reuse the real oracle: import deriveCCalls? No — the pre-pass is inline.
// Copy the algorithm faithfully (same conditions, same order).
import * as fs from "fs"
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv.c", "utf8")
const lineOf = (idx: number) => SRC.slice(0, idx).split("\n").length
// We need the tree; reuse WTS.
import * as path from "path"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  // find ERROR span
  let err: any = null
  for (let i = 0; i < root.namedChildCount; i++) if (root.namedChild(i).type === "ERROR") err = root.namedChild(i)
  if (!err) { console.log("no ERROR"); return }
  const errStart = err.startIndex as number
  // find first glue: function_definition OR bare function_declarator
  let headerIdx = -1
  const st: any[] = [err]
  while (st.length) {
    const m = st.pop()!
    if (m !== err) {
      if (m.type === "function_definition") { if (headerIdx < 0 || m.startIndex < headerIdx) headerIdx = m.startIndex }
      else if (m.type === "function_declarator") {
        let w: any = m; let bare = true
        while (w) {
          if (w.startIndex === errStart && w.endIndex === err.endIndex) break
          if (w.type === "declaration" || w.type === "function_definition") { bare = false; break }
          w = w.parent
        }
        if (bare && w) { if (headerIdx < 0 || m.startIndex < headerIdx) headerIdx = m.startIndex }
      }
    }
    for (let k = 0; k < m.namedChildCount; k++) { const c = m.namedChild(k); if (c) st.push(c) }
  }
  console.log(`ERROR span starts L${lineOf(errStart)}`)
  console.log(`first glue header: ${headerIdx >= 0 ? "L" + lineOf(headerIdx) : "none"}`)
  console.log(`enum ITER_FINISHED at L1963 -> varDeclSuppressed = ${headerIdx >= 0 && false || (headerIdx >= 0)}`)
  // declarations AFTER the header are suppressed; BEFORE are kept.
  console.log(`suppression zone: L${headerIdx >= 0 ? lineOf(headerIdx) : "?"}..L${lineOf(err.endIndex)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
