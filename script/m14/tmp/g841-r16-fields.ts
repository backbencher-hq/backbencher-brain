import fs from "node:fs"
import path from "node:path"
const { ASTEngine } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/engine.ts")
const { RealGroovyAnalyzer } = await import("<corpus-root>/mcp/backbencher-brain/src/ast/real-groovy-analyzer.ts")
const parser = await ASTEngine.getParser("groovy" as any)
const f = "<corpus-root>/bb_tests/repositories/grails-core/grails-gsp/plugin/src/main/groovy/org/grails/plugins/web/taglib/FormTagLib.groovy"
const src = fs.readFileSync(f, "utf8")
const t = parser.parse(src)
const a = new RealGroovyAnalyzer()
const res: any = await (a as any).analyze(t.rootNode, src, f)
console.log("SYMBOL keys:", Object.keys(res.symbols[0] ?? {}))
console.log("REL keys:", Object.keys(res.relationships[0] ?? {}))
console.log(JSON.stringify(res.symbols[0]))
console.log(JSON.stringify(res.relationships[0]))
