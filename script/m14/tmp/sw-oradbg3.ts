import * as fs from "fs"
import * as path from "path"
async function main() {
  const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(`func m() {\n  log(x)\n}\n`).rootNode
  const mod: any = await import("../../../script/m14/differential")
  console.log("edges:", JSON.stringify(mod.deriveSwiftEdges(root)))
  // walk the tree: find call_expression nodes
  const st: any[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "call_expression") {
      console.log("found call, namedChildren:", Array.isArray((n as any).namedChildren), typeof (n as any).namedChildren)
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
      console.log("  kids:", kids.join(","))
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
main()
