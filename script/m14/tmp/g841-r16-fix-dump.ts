import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const { ASTEngine } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/engine.ts")
const { RealGroovyAnalyzer } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/real-groovy-analyzer.ts")
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
for (const f of process.argv.slice(3)) {
  const src = fs.readFileSync(f, "utf8")
  const t = parser.parse(src)
  const a = new RealGroovyAnalyzer()
  const res: any = await (a as any).analyze(t.rootNode, src, f)
  console.log(`### ${f}`)
  for (const s of res.symbols ?? []) if (["Split", "distance", "center", "valueOf", "Point", "Distance"].includes(s.name)) console.log(`  SYM ${s.kind} ${s.name} owner=${s.ownerName ?? "-"} line=${s.line_number ?? s.line ?? "?"}`)
  for (const r of res.relationships ?? []) if (r.type === "contains") console.log(`  REL ${r.type} ${r.from} -> ${r.target} @${r.line_number}`)
}
