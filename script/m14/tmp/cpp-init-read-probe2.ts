// cpp-init-read-probe2.ts — case 7 of the first probe lost the edge:
//   `int *g; int f(void) { int *p = g; return p ? 1 : 0; }`   -> (none)
// while `int g; int f(void) { int x = g; return x; }` -> uses[f->g].
// Two things differ (the global's type AND the local's declarator), so this splits
// them, and also asks whether a POINTER LOCAL's initializer loses CALLS as well as
// USES — which would make it a context rule, not a name-resolution rule.
//
//   bun script/m14/tmp/cpp-init-read-probe2.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<{ id: string; src: string }> = [
  { id: "a. int global, POINTER local initializer", src: `int g;\nint f(void) { int *p = g; return 0; }\n` },
  { id: "b. int global, pointer local ASSIGNED later", src: `int g;\nint f(void) { int *p; p = &g; return 0; }\n` },
  { id: "c. pointer global, plain local via cast", src: `int *g;\nint f(void) { int v = (int)(long)g; return v; }\n` },
  { id: "d. pointer global, pointer local initializer", src: `int *g;\nint f(void) { int *p = g; return 0; }\n` },
  { id: "e. CALL in a pointer local's initializer", src: `int h(void);\nint f(void) { int *p = (int*)h(); return 0; }\n` },
  { id: "f. CALL in a plain local's initializer (control)", src: `int h(void);\nint f(void) { int v = h(); return v; }\n` },
  { id: "g. auto* local from a call", src: `int h(void);\nint f(void) { auto *p = (int*)h(); return 0; }\n` },
  { id: "h. pointer local with a braced initializer", src: `int h(void);\nint f(void) { int *p{h()}; return 0; }\n` },
  { id: "i. array local initializer read of a global", src: `int g;\nint f(void) { int a[2] = { g, g }; return a[0]; }\n` },
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
    const tree = (() => {
      const all: string[] = []
      const walk = (n: any) => { all.push(n.type); for (const ch of n.children) walk(ch) }
      walk(root)
      return all
    })()
    const res: any = await new mod.RealCppAnalyzer().analyze(root, c.src, "Probe.cpp")
    const rels = res.relationships as any[]
    console.log(`\n=== ${c.id} ===`)
    console.log(`  node kinds: ${[...new Set(tree)].filter((t: string) => /declarator|statement|expression|call|identifier/.test(t)).join(", ")}`)
    console.log(`  relationships: ${rels.length === 0 ? "(none)" : rels.map((r: any) => `${r.type}[${r.source}->${r.target}]`).join(", ")}`)
  }
}
main()
