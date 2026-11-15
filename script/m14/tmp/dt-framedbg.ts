import * as fs from "fs"
import * as path from "path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const f = "/home/ishaq2321/bb_tests/repositories/proxicall/lib/ui/screens/ems/employee_dashboard.dart"
  const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
  const an: any = new RealDartAnalyzer()
  // find the function_body containing line 1445, collect locals via the real method
  const walk = (n: any): void => {
    if (n.type === "function_body" && n.startPosition.row + 1 <= 1445 && n.endPosition.row + 1 >= 1445) {
      const out = (an as any).collectDartLocals(n)
      console.log("frame has declined:", out.has("declined"), "cancelled:", out.has("cancelled"), "expired:", out.has("expired"), "size:", out.size)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
main()
