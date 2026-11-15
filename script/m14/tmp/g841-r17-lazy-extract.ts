import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2]))
const parser = new P(); parser.setLanguage(lang)
const { RealGroovyAnalyzer } = await import("/home/ishaq2321/mcp/backbencher-brain/src/ast/real-groovy-analyzer.ts")
const F = process.argv[3]
const src = fs.readFileSync(F, "utf8")
const t = parser.parse(src)
const a = new RealGroovyAnalyzer()
const r: any = await (a as any).analyze(t.rootNode, src, F)
console.log(`symbols=${(r.symbols ?? []).length} rels=${(r.relationships ?? []).length}`)
for (const s of (r.symbols ?? []).slice(0, 6)) console.log(`  ${s.kind} ${s.name} @${s.range?.startLine}`)
