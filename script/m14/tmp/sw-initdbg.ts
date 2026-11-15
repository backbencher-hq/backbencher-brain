import * as fs from "fs"
import * as path from "path"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = `class Base {\n  init(_ x: Int) {}\n}\nclass Child: Base {\n  override init(_ x: Int) {\n    super.init(x)\n  }\n}\n`
  const root = p.parse(src).rootNode
  const an: any = new RealSwiftAnalyzer()
  console.log("recv:", (an as any).navigationReceiver ? "has helper" : "MISSING HELPER")
  // replicate: find super.init call nav
  const walk = (n: any): void => {
    if (n.type === "call_expression" && n.text.includes("super.init")) {
      const fn = (an as any).findChildByType(n, "simple_identifier") || (an as any).findChildByType(n, "identifier") || (an as any).findChildByType(n, "navigation_expression")
      console.log("funcNode:", fn?.type)
      if (fn && fn.type === "navigation_expression") {
        console.log("recv:", (an as any).navigationReceiver(fn), "leaf:", (an as any).navigationLeaf(fn))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  const r: any = await an.analyze(root, src, "t.swift")
  console.log("rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
}
main()
