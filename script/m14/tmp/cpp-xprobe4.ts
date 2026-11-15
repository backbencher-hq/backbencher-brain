import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const cases: Record<string, string> = {
    S1_enum_bare_init: `int LIMIT = 100;
enum E { A = LIMIT, B = 2 };
int use() { return A; }
`,
    S2_multi_nsdmi: `int G = 1;
struct S {
    int x = G, y = 2;
};
`,
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = await parseSrc(src)
    const r: any = await new RealCppAnalyzer().analyze(root, src, "x.cpp")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const truth = [...mod.deriveTreeEdges(root, "cpp"), ...mod.deriveCppEdges(root), ...mod.deriveCppBareUses(root)].filter((x: any) => x.label === "uses").map((x: any) => `(${x.from})->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  ana: ${JSON.stringify(uses)}\n  ora: ${JSON.stringify(truth)}`)
  }
  const root = await parseSrc(`void Outer::Inner::m() { n = 1; }`)
  const dump = (n: any, dp: number): void => {
    if (dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 26)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (pred(n)) return n
    for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  console.log("--- nested declarator:");
  dump(find(root, (x) => x.type === "function_declarator"), 0)
}
main()
