import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "<corpus-root>/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`func m() {\n  log(x)\n}\n`).rootNode
  // manually replicate the oracle walk for the call node
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "call_expression") {
      console.log("call found. namedChildCount:", n.namedChildCount)
      try {
        const nc = (n as any).namedChildren
        console.log("namedChildren isArray:", Array.isArray(nc), "len:", nc?.length)
        const callee = nc.find((c: any) => c.type === "simple_identifier" || c.type === "identifier" || c.type === "navigation_expression")
        console.log("callee:", callee?.type, callee?.text)
      } catch (e: any) {
        console.log("THREW:", e?.message)
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
main()
