import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const cases: Record<string, string> = {
    struct_typedef: `typedef int Counter;\nstruct Point { int x; int y; };\nenum Color { Red, Green };\nCounter gTotal = 0;\n`,
    update_field: `struct S { int count; };\nvoid bump(struct S *s) {\n  s->count++;\n  s->count = 0;\n}\n`,
  }
  for (const [name, src] of Object.entries(cases)) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const r: any = await new RealCAnalyzer().analyze(root, src, "t.c")
    console.log("=== " + name)
    console.log("  syms:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`)))
    console.log("  rels:", JSON.stringify((r.relationships ?? []).filter((x: any) => !["contains"].includes(String(x.type).toLowerCase())).map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  }
}
main()
