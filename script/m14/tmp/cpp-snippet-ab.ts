// cpp-snippet-ab.ts — snippet-level A/B: HEAD's cpp analyzer (materialized at run
// time) versus the working tree's, over hand-built shapes. Built because the
// corpus-level A/B is 40s per iteration and the question ("which of the three
// edits moved this edge?") is answerable at snippet scale once the shape is right.
//
//   bun script/m14/tmp/cpp-snippet-ab.ts
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const TMP = "/tmp/cpp-snip-ab"

const SNIPPETS: Array<{ id: string; src: string }> = [
  {
    id: "A. member call with explicit template args, as a statement",
    src: `class B {\npublic:\n  void push_back(int init) {\n    sink(key.get_ref<int&>());\n  }\n};\n`,
  },
  {
    id: "B. the corpus shape: 'typename X(...)' argument makes the STATEMENT a declaration",
    src: `class B {\npublic:\n  void push_back(int init) {\n    push_back(typename object_t::value_type(std::move(key.get_ref<int&>()), 1));\n  }\n};\n`,
  },
  {
    id: "C. declaration with a wrapped declarator and an initializer (the environ shape)",
    src: `char **environ;\nint f(void) {\n  char **Environ = environ;\n  return 0;\n}\n`,
  },
  {
    id: "D. extern \"C\" wrapped declaration (corpus shape, no read)",
    src: `extern "C" char **environ;\nint f(void) {\n  return 0;\n}\n`,
  },
]

function materializeHead(): string {
  fs.mkdirSync(TMP, { recursive: true })
  const src = execFileSync("git", ["show", "HEAD:src/ast/real-cpp-analyzer.ts"], { cwd: ROOT, maxBuffer: 64 << 20 }).toString()
  const rewritten = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_m, rel: string) => `from "${path.resolve(ROOT, "src/ast", rel).replace(/\.(ts|js)$/, "")}"`)
  const out = path.join(TMP, "head-cpp-analyzer.ts")
  fs.writeFileSync(out, rewritten)
  return out
}

async function analyzeAll(modPath: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(modPath)
  const out: Record<string, { edges: string[]; syms: string[] }> = {}
  for (const s of SNIPPETS) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(s.src).rootNode
    const res: any = await new mod.RealCppAnalyzer().analyze(root, s.src, "Snip.cpp")
    out[s.id] = {
      edges: (res.relationships as any[]).map((r: any) => `${r.type} ${r.source} -> ${r.target}`),
      syms: (res.symbols as any[]).map((x: any) => `${x.kind}:${x.name}`),
    }
  }
  return out
}

async function main() {
  const head = await analyzeAll(materializeHead())
  const mine = await analyzeAll(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
  for (const s of SNIPPETS) {
    const h = head[s.id], m = mine[s.id]
    const add = m.edges.filter((e) => !h.edges.includes(e))
    const rm = h.edges.filter((e) => !m.edges.includes(e))
    console.log(`\n=== ${s.id} ===`)
    console.log(`  HEAD edges: ${h.edges.join(", ") || "(none)"}`)
    console.log(`  MINE edges: ${m.edges.join(", ") || "(none)"}`)
    if (add.length) console.log(`  + ${add.join(" | ")}`)
    if (rm.length) console.log(`  - ${rm.join(" | ")}`)
    const sa = m.syms.filter((x) => !h.syms.includes(x)), sr = h.syms.filter((x) => !m.syms.includes(x))
    if (sa.length) console.log(`  symbols + ${sa.join(", ")}`)
    if (sr.length) console.log(`  symbols - ${sr.join(", ")}`)
  }
}
main()
