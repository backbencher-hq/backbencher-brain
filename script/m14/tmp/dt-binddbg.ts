import * as fs from "fs"
import * as path from "path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const f = "<corpus-root>/bb_tests/repositories/proxicall/lib/ui/screens/ems/employee_dashboard.dart"
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  const an: any = new RealDartAnalyzer()
  const walk = (n: any): void => {
    if (n.type === "constant_pattern" && n.startIndex <= 49349 && n.endIndex >= 49349) {
      console.log("found constant_pattern, isBinding:", (an as any).isBindingPatternContext(n))
      let c: any = n, d = 0
      const chain: string[] = []
      while (c && d++ < 8) { chain.push(c.type); c = c.parent }
      console.log("chain:", chain.join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
