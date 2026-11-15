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
const CASES: Record<string, string> = {
  Q1_outline_member: `struct Foo {
    int count;
    void bar();
};
void Foo::bar() {
    count = count + 1;
}
`,
  Q1b_inline_member: `struct Foo {
    int count;
    void bar() {
        count = count + 1;
    }
};
`,
  Q2_structured_binding: `int x = 1;
struct P { int x; int y; };
void f() {
    P p{0, 0};
    auto [x, y] = p;
    int z = x + y;
}
`,
  Q3_sizeof_default: `int g = 5;
void f(int y = sizeof(g)) {
    int z = g;
}
`,
  Q3b_decltype_param: `int g = 5;
void f(decltype(g) y) {
    int z = g;
}
`,
  Q13_enum_init: `enum E { A = 1, B = A + 1 };
int use() { return B; }
`,
  Q15_designated: `struct Pt { int x; int y; };
int g = 5;
Pt make() {
    Pt p{ .x = g, .y = 1 };
    return p;
}
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
