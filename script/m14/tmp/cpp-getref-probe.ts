// cpp-getref-probe.ts — after the declarator/param fixes, the cpp full extent on
// nlohmann-json went MISSING 1 -> 0 and UNEXPLAINED 1 -> 4, the three new ones all
//   uses push_back -> get_ref   (line 3261 of include/nlohmann/json.hpp, and the two
//   copies of the same header)
// The site is
//   void push_back(initializer_list_t init) {
//     basic_json&& key = init.begin()->moved_or_copied();
//     push_back(typename object_t::value_type(
//         std::move(key.get_ref<string_t&>()), ...));
//   }
// so it is a template-argument call on a member reached through a local whose
// declarator is an rvalue reference. This reproduces the shape at the smallest size
// that keeps those four elements, to learn which of them the edge depends on.
//
//   bun script/m14/tmp/cpp-getref-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const CASES: Array<{ id: string; src: string }> = [
  {
    id: "1. the corpus shape (template call through an rvalue-ref local)",
    src: `class B {\npublic:\n  template <typename T> T get_ref();\n  void push_back(int init) {\n    B&& key = makeB();\n    sink(std::move(key.get_ref<int&>()));\n  }\n};\n`,
  },
  {
    id: "2. same, local by VALUE (no reference declarator)",
    src: `class B {\npublic:\n  template <typename T> T get_ref();\n  void push_back(int init) {\n    B key = makeB();\n    sink(std::move(key.get_ref<int&>()));\n  }\n};\n`,
  },
  {
    id: "3. same, but the local is the function PARAMETER",
    src: `class B {\npublic:\n  template <typename T> T get_ref();\n  void push_back(B key) {\n    sink(std::move(key.get_ref<int&>()));\n  }\n};\n`,
  },
  {
    id: "4. same, no template arguments on the call",
    src: `class B {\npublic:\n  int get_ref();\n  void push_back(int init) {\n    B&& key = makeB();\n    sink(std::move(key.get_ref()));\n  }\n};\n`,
  },
  {
    id: "5. same, but the call result is NOT wrapped in std::move",
    src: `class B {\npublic:\n  template <typename T> T get_ref();\n  void push_back(int init) {\n    B&& key = makeB();\n    sink(key.get_ref<int&>());\n  }\n};\n`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))

  for (const c of CASES) {
    const p = new P()
    p.setLanguage(LANG)
    const root = p.parse(c.src).rootNode
    const res: any = await new mod.RealCppAnalyzer().analyze(root, c.src, "Probe.hpp")
    const rels = (res.relationships as any[]).filter((r: any) => r.target === "get_ref" || r.target === "key")
    console.log(`\n=== ${c.id} ===`)
    console.log(`  errors=${root.hasError} symbols: ${res.symbols.map((s: any) => `${s.kind}:${s.name}`).join(", ")}`)
    console.log(`  edges naming get_ref/key: ${rels.length === 0 ? "(none)" : rels.map((r: any) => `${r.type}[${r.source}->${r.target}]`).join(", ")}`)
    const all = (res.relationships as any[]).map((r: any) => `${r.type}[${r.source}->${r.target}]`)
    console.log(`  all edges: ${all.length === 0 ? "(none)" : all.join(", ")}`)
  }
}
main()
