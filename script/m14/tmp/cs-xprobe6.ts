import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const cases: Record<string, string> = {
    T1_typeparams: `class C<T> {\n T M(T x) { return x; }\n}\n`,
    T2_wherebase: `class C<T> where T : class {\n void M() { }\n}\nclass D : Base {\n}\n`,
    T3_tupletype: `class A {\n void M() { (int a, int b) t = (1, 2); _ = a; }\n}\n`,
    T4_tuplepat: `class A {\n static int a = 1;\n static int b = 2;\n bool M((int, int) t) { return t is (int a, int b); }\n}\n`,
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = await parseSrc(src)
    const r: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  uses: ${JSON.stringify(uses)}`)
  }
}
main()
