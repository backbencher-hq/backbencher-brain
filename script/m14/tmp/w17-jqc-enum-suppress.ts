// W17: why does the oracle drop ITER_FINISHED truth in jv.c?
// Reports the decl identifier's ERROR-ancestor and glue-header position
// (the exact isSuppressedErrorDecl inputs) plus the enum body check.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(path.join(JQ, "src/jv.c"), "utf8")
  const root = p.parse(src).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "enumerator" && n.namedChild(0)?.text === "ITER_FINISHED") {
      console.log("enumerator found at idx " + n.startIndex + " line " + (src.slice(0, n.startIndex).split("\n").length))
      // ERROR ancestors
      let cur: any = n
      let innermost: any = null
      while (cur) {
        if (cur.type === "ERROR") innermost = cur
        cur = cur.parent
      }
      console.log("innermost ERROR: " + (innermost ? innermost.startIndex + ".." + innermost.endIndex : "NONE"))
      if (innermost) {
        // glue header scan (same as oracle): function_definition or bare fd
        const st: any[] = [innermost]
        let headerIdx = -1
        while (st.length) {
          const m = st.pop()!
          if (m !== innermost) {
            if (m.type === "function_definition" && (headerIdx < 0 || m.startIndex < headerIdx)) headerIdx = m.startIndex
            else if (m.type === "function_declarator") {
              let w: any = m
              let bare = true
              while (w) {
                if (w.startIndex === innermost.startIndex && w.endIndex === innermost.endIndex) break
                if (w.type === "declaration" || w.type === "function_definition") { bare = false; break }
                w = w.parent
              }
              if (bare && w && (headerIdx < 0 || m.startIndex < headerIdx)) headerIdx = m.startIndex
            }
          }
          for (let k = 0; k < m.namedChildCount; k++) { const c = m.namedChild(k); if (c) st.push(c) }
        }
        console.log("first glue header idx: " + headerIdx + " -> enumerator " + (headerIdx >= 0 && n.startIndex > headerIdx ? "IS suppressed (after glue)" : "NOT suppressed"))
        console.log("ERROR span text head: " + JSON.stringify(src.slice(innermost.startIndex, innermost.startIndex + 160)))
      }
      // enum body + compound ancestor check (the proposed discriminator)
      const en = n.parent?.parent
      console.log("enum_specifier type: " + (en ? en.type : "?") + " hasBody=" + !!(en && en.childForFieldName("body")))
      let inCompound = false
      let a: any = n
      while (a) { if (a.type === "compound_statement") { inCompound = true; break } a = a.parent }
      console.log("inside compound_statement: " + inCompound)
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  console.log("enumerator not found")
}
main()
