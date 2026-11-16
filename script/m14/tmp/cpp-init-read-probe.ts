// cpp-init-read-probe.ts — the corpus MISSING edge is
//   FuzzerUtilDarwin.cpp :: uses (expr) -> environ
// at line 98, `char **Environ = environ; // Read from global` — a read of a
// file-scope global inside a LOCAL DECLARATION'S INITIALIZER. Direct reads work
// (`&environ` in a return emits `uses f->environ`). This walks the contexts one at
// a time to find which ones lose the edge, on a plain int global so the declarator
// shape cannot be the variable.
//
//   bun script/m14/tmp/cpp-init-read-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<{ id: string; src: string }> = [
  { id: "1. direct return of the global", src: `int g;\nint f(void) { return g; }\n` },
  { id: "2. local DECLARED with the global as initializer (the corpus shape)", src: `int g;\nint f(void) { int x = g; return x; }\n` },
  { id: "3. local declared, then assigned the global", src: `int g;\nint f(void) { int x; x = g; return x; }\n` },
  { id: "4. global used in a binary expression", src: `int g;\nint f(void) { return g + 1; }\n` },
  { id: "5. global used as a call argument", src: `int g;\nint h(int);\nint f(void) { return h(g); }\n` },
  { id: "6. global in an if condition", src: `int g;\nint f(void) { if (g) return 1; return 0; }\n` },
  { id: "7. global inside a pointer local's initializer (pointer target too)", src: `int *g;\nint f(void) { int *p = g; return p ? 1 : 0; }\n` },
  { id: "8. local shadowing the global (must NOT emit)", src: `int g;\nint f(void) { int g = 1; return g; }\n` },
  { id: "9. parameter shadowing the global (must NOT emit)", src: `int g;\nint f(int g) { return g; }\n` },
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
    const res: any = await new mod.RealCppAnalyzer().analyze(root, c.src, "Probe.cpp")
    const rels = res.relationships as any[]
    console.log(`\n=== ${c.id} ===`)
    console.log(`  relationships: ${rels.length === 0 ? "(none)" : rels.map((r: any) => `${r.type}[${r.source}->${r.target}]`).join(", ")}`)
  }
}
main()
