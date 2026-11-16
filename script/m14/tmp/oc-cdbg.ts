import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  for (const src of [`struct S { int count; };\nvoid bump(struct S *s) {\n  s->count++;\n}\n`, `struct S { int count; };\nvoid bump(struct S *s) {\n  s->count = 0;\n}\n`]) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const r: any = await new RealCAnalyzer().analyze(root, src, "t.c")
    console.log(JSON.stringify(src.split("\n")[2].trim()), "->", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${String(x.type)}[${x.source}->${x.target}]`)))
  }
}
main()
