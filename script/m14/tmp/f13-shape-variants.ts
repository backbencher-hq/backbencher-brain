// One-off: shape variants for the lanes whose default F13 pair yields no `overrides` truth
// (cpp, dart) — is the declaration registry reachable by ANY simple pair?
import fs from "node:fs"
import path from "node:path"
import { LANGS, deriveTreeEdges } from "../differential"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..")
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

const VARIANTS: [string, string, (c: string, m: string) => string][] = [
  ["cpp/nonvirtual", "cpp", (c, m) => `class ${c} { public: int ${m}() { return 1; } };\nclass Sub : public ${c} { public: int ${m}() { return 2; } };\n`],
  ["cpp/no-override-kw", "cpp", (c, m) => `class ${c} { public: virtual int ${m}() { return 1; } };\nclass Sub : public ${c} { public: int ${m}() { return 2; } };\n`],
  ["cpp/struct", "cpp", (c, m) => `struct ${c} { virtual int ${m}() { return 1; } };\nstruct Sub : ${c} { int ${m}() { return 2; } };\n`],
  ["cpp/decl-only", "cpp", (c, m) => `class ${c} { public: virtual int ${m}(); };\nclass Sub : public ${c} { public: int ${m}(); };\n`],
  ["dart/abstract", "dart", (c, m) => `abstract class ${c} { void ${m}(); }\nclass Sub extends ${c} { @override void ${m}() {} }\n`],
  ["dart/implements", "dart", (c, m) => `abstract class ${c} { void ${m}(); }\nclass Sub implements ${c} { @override void ${m}() {} }\n`],
]
for (const [name, lang, snippet] of VARIANTS) {
  const cfg = (LANGS as any)[lang]
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new P()
  parser.setLanguage(grammar)
  const root = parser.parse(snippet("Ordinary", "foo"))!.rootNode
  let edges: any[] = []
  try { edges = deriveTreeEdges(root, lang) } catch (e: any) { console.log(`${name}: THREW ${e?.message}`); continue }
  console.log(`${name}: ${edges.length} edge(s) — ${edges.map((e) => `${e.label} ${e.from}->${e.target}`).join(" | ")}`)
}
