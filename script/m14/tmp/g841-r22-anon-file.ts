// #841 round 22: analyzer-level diff for DefaultGrailsJsonViewHelper
import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/grails-core/grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultGrailsJsonViewHelper.groovy"
const WASM = process.argv[2]
if (WASM) {
  // overwrite the repo wasm + purge the engine mirror so the engine loads THIS build
  fs.copyFileSync(WASM, path.join(ROOT, "wasm/tree-sitter-groovy.wasm"))
  try { fs.rmSync("/tmp/bb-wasm_tree-sitter-groovy_tree-sitter-groovy.wasm") } catch {}
}
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)
const src = fs.readFileSync(FILE, "utf8")
const tree = parser.parse(src)
const a = new RealGroovyAnalyzer()
const result = a.analyze(tree, FILE, src)
const calls = (result.relationships ?? []).filter((r: any) => r.type === "calls")
console.log(`wasm=${WASM ?? "repo-current"} total_rels=${result.relationships?.length} total_calls=${calls.length}`)
const ps = calls.filter((r: any) => JSON.stringify(r).includes("processSimple"))
console.log(`calls->processSimple: ${ps.length}`)
for (const r of ps.slice(0, 8)) console.log("  ", JSON.stringify(r).slice(0, 160))
