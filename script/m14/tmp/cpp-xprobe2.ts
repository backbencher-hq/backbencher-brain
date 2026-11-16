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
const CASES: Record<string, string> = {
  R1_range_binding: `int use(int k);
void f() {
    for (auto& [k, v] : m) { use(k); }
}
`,
  R2_filescope_binding: `struct P { int x; int y; };
P p{1, 2};
auto [gx, gy] = p;
int r1() { return gx; }
int r2() { return gy; }
`,
  R3_nested_outline: `struct Outer {
    struct Inner {
        int n;
        void m();
    };
};
void Outer::Inner::m() {
    n = n + 1;
}
`,
  R4_ns_free_fn: `namespace ns {
int helper = 1;
}
int helper = 2;
void ns::work() {
    int z = helper;
}
`,
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
async function main() {
  const mod: any = await import("../../../script/m14/differential")
  const which = process.argv[2]
  for (const [name, src] of Object.entries(CASES)) {
    if (which && name !== which) continue
    const root = await parseSrc(src)
    const r: any = await new RealCppAnalyzer().analyze(root, src, "x.cpp")
    const uses = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => `${x.source}->${x.target}`)
    const truth = [...mod.deriveTreeEdges(root, "cpp"), ...mod.deriveCppEdges(root), ...mod.deriveCppBareUses(root)].filter((x: any) => x.label === "uses").map((x: any) => `(${x.from})->${x.target}`)
    console.log(`=== ${name} err=${root.hasError}\n  ana: ${JSON.stringify(uses)}\n  ora: ${JSON.stringify(truth)}`)
  }
}
main()
