import fs from "node:fs"
const { ASTEngine } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/engine.ts")
const { RealGroovyAnalyzer } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/real-groovy-analyzer.ts")
const SRC = `class C {\n  def m(promise) {\n    promise = promise.then { it * 2 } then { it + 6 }\n  }\n}\n`
fs.writeFileSync("/tmp/g841-r19-edge-src.groovy", SRC)
const parser = await ASTEngine.getParser("groovy" as any)
const t = parser.parse(SRC)
const a = new RealGroovyAnalyzer()
const result = await (a as any).analyze(t.rootNode, SRC, "/tmp/g841-r19-edge-src.groovy")
const rels = result.relationships ?? result.rels ?? []
for (const r of rels) console.log(JSON.stringify(r))
console.log("symbols:", (result.symbols ?? []).map((s: any) => `${s.name}:${s.kind}`).join(", "))
