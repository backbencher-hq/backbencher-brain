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
  const src = fs.readFileSync(f, "utf8")
  const root = p.parse(src).rootNode
  const r: any = await new RealDartAnalyzer().analyze(root, src, f)
  const syms = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)
  console.log("has declined-member:", syms.some((s: string) => /(^|:|\.)declined$/.test(s) && !s.includes("emsInvitation")))
  console.log("top-level value syms:", JSON.stringify(syms.filter((s: string) => !s.includes(".") && !s.includes(":")).slice(0, 10)))
  console.log("any global named declined/cancelled/expired:", syms.filter((s: string) => /declined|cancelled|expired/i.test(s)).slice(0, 6))
  // find the switch: what function/method contains line 1445? owners?
  console.log("total symbols:", syms.length)
}
main()
