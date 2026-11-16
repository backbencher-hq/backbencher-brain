// cpp-declarator-tree-probe.ts — `char **environ;` published no symbol and lost
// its use, while `int cacheSize;` published one and kept it (see
// cpp-environ-param-probe.ts, cases C vs E). The pre-pass in real-cpp-analyzer.ts
// names pointer_declarator/reference_declarator/array_declarator explicitly, so the
// failure is either the parse SHAPE (the declarator is not a direct child of the
// declaration) or the symbol emitter. This dumps both, per shape.
//
//   bun script/m14/tmp/cpp-declarator-tree-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SHAPES = [
  "int cacheSize;",
  "int *cacheSize;",
  "int **cacheSize;",
  "int &cacheSize = other;",
  "int cacheSize[4];",
  "char **environ;",
  'extern "C" char **environ;',
  "static char **environ;",
  "const char *name;",
  "char *const name = 0;",
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))

  for (const decl of SHAPES) {
    const src = `${decl}\nint f(void) {\n  return (int)(long)&cacheSize;\n}\nint g(void) {\n  return (int)(long)&environ;\n}\nint h(void) {\n  return (int)(long)&name;\n}\n`
    const p = new P()
    p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const declNode = root.namedChildren.find((n: any) => n.type === "declaration" || n.type === "linkage_specification")
    const res: any = await new mod.RealCppAnalyzer().analyze(root, src, "Probe.cpp")
    console.log(`\n=== ${decl} ===`)
    console.log(`  decl node: ${declNode?.type}  children: ${declNode ? declNode.namedChildren.map((c: any) => c.type).join(", ") : "(none)"}`)
    console.log(`  sexp: ${(declNode?.toString() ?? "").replace(/\s+/g, " ").slice(0, 200)}`)
    console.log(`  symbols: ${res.symbols.filter((s: any) => s.kind === "variable").map((s: any) => s.name).join(", ") || "(no variable symbols)"}`)
    const uses = res.relationships.filter((r: any) => r.type === "uses")
    console.log(`  uses edges: ${uses.map((r: any) => `${r.source}->${r.target}`).join(", ") || "(none)"}`)
  }
}
main()
