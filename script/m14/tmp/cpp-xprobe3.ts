import * as fs from "fs"
import * as path from "path"
import { RealCppAnalyzer } from "../../../src/ast/real-cpp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const cases: Record<string, string> = {
    R5_template_outline: `template <typename T>
struct Box {
    T v;
    void push(T x);
};
template <typename T>
void Box<T>::push(T x) {
    T old = v;
    v = x;
}
`,
    R6_nsdmi: `int LIMIT = 100;
struct S {
    int x = LIMIT;
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
  const root = await parseSrc(`int LIMIT = 100;
struct S {
    int x = LIMIT;
};
`)
  const dump = (n: any, dp: number): void => {
    if (dp > 5) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 24)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, pred: (x: any) => boolean): any => {
    if (pred(n)) return n
    for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), pred); if (r) return r }
    return null
  }
  console.log("--- NSDMI subtree:");
  dump(find(root, (x) => x.type === "field_declaration" && x.text.includes("LIMIT")), 0)
}
main()
