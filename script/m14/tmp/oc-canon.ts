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
  const p = new P(); p.setLanguage(LANG)
  const src = `typedef int Counter;\nstruct Point { int x; int y; };\nenum Color { Red, Green };\ntypedef struct { int w; } Size;\ntypedef struct Node { int v; struct Node *next; } Node;\n`
  const root = p.parse(src).rootNode
  const r: any = await new RealCAnalyzer().analyze(root, src, "t.c")
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => `${s.kind}:${s.ownerName ? s.ownerName + "." : ""}${s.name}`)))
  console.log("exp:", JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
}
main()
