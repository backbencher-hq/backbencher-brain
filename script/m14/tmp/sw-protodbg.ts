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
  const f = "/home/ishaq2321/bb_tests/repositories/swift-nio/IntegrationTests/tests_04_performance/test_01_resources/test_ping_pong_1000_reqs_1_conn.swift"
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  // find the class_declaration and dump keyword tokens + bases
  const walk = (n: any): void => {
    if (n.type === "class_declaration" && n.text.includes("PongDecoder")) {
      const toks: string[] = []
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed) toks.push(c.type) }
      console.log("anon tokens:", JSON.stringify(toks.slice(0, 8)))
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "inheritance_specifier") console.log("base spec:", JSON.stringify(c.text))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
