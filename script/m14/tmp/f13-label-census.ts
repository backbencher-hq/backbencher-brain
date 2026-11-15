// One-off: which F13 lanes actually exercise the `decls` registry (label `overrides`)?
import fs from "node:fs"
import path from "node:path"
import { LANGS, deriveTreeEdges } from "../differential"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..")
const SNIPPETS: Record<string, (c: string, m: string) => string> = {
  java: (c, m) => `class ${c} { void ${m}() {} }\nclass Sub extends ${c} { void ${m}() {} }\n`,
  kotlin: (c, m) => `open class ${c} { open fun ${m}(): Int = 1 }\nclass Sub : ${c}() { override fun ${m}(): Int = 2 }\n`,
  scala: (c, m) => `class ${c} {\n  def ${m}(): Int = 1\n}\nclass Sub extends ${c} {\n  override def ${m}(): Int = 2\n}\n`,
  groovy: (c, m) => `class ${c} { def ${m}() { 1 } }\nclass Sub extends ${c} { def ${m}() { 2 } }\n`,
  cpp: (c, m) => `class ${c} { public: virtual int ${m}() { return 1; } };\nclass Sub : public ${c} { public: int ${m}() override { return 2; } };\n`,
  dart: (c, m) => `class ${c} { void ${m}() {} }\nclass Sub extends ${c} { @override void ${m}() {} }\n`,
  typescript: (c, m) => `class ${c} { ${m}(): number { return 1 } }\nclass Sub extends ${c} { override ${m}(): number { return 2 } }\n`,
  javascript: (c, m) => `class ${c} { ${m}() { return 1 } }\nclass Sub extends ${c} { ${m}() { return 2 } }\n`,
}
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
for (const [lang, snippet] of Object.entries(SNIPPETS)) {
  const cfg = (LANGS as any)[lang]
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new P()
  parser.setLanguage(grammar)
  const root = parser.parse(snippet("Ordinary", "foo"))!.rootNode
  let edges: any[] = []
  try { edges = deriveTreeEdges(root, lang) } catch (e: any) { console.log(`${lang}: THREW ${e?.message}`); continue }
  const labels = new Map<string, number>()
  for (const e of edges) labels.set(e.label, (labels.get(e.label) ?? 0) + 1)
  console.log(`${lang}: ${edges.length} edge(s) — ${[...labels].map(([k, v]) => `${k}=${v}`).join(" ")}`)
  for (const e of edges.filter((x) => x.label === "overrides")) console.log(`    overrides ${e.from} -> ${e.target}`)
}
