// Round 14, step 2e: does the misparse shape actually emit a fabricated
// `calls -> <TypeName>` edge? For each misparse-shaped juxt node, check whether
// a calls relationship exists with target == type name near that line.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories/grails-core"
const FILES = [
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy",
  "grails-async/core/src/test/groovy/grails/async/PromiseSpec.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/CompilePlugin.groovy",
]

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

// same corrected detector
function findMisparseNodes(node: any, out: any[] = []): any[] {
  const kids = node.children ?? []
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.type === "juxt_function_call") {
      const nameNode = k.childForFieldName?.("name")
      const argNode = k.childForFieldName?.("args")
      const nameText = (nameNode?.text ?? "").trim()
      const argText = (argNode?.text ?? "").trim()
      const nameIsTypeCased = /^[A-Z][A-Za-z0-9_]*(\.[A-Z][A-Za-z0-9_]*)*$/.test(nameText)
      const argsAreBareNames = argText === "" || /^[A-Za-z_][A-Za-z0-9_]*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(argText)
      const next = kids[i + 1]
      if (nameIsTypeCased && argsAreBareNames && next && next.type === "lambda_expression") {
        out.push({ node: k, typeName: nameText, params: argText, line: k.startPosition.row + 1 })
      }
    }
    findMisparseNodes(k, out)
  }
  return out
}

for (const f of FILES) {
  const src = readFileSync(path.join(CORPUS, f), "utf8")
  const t = parser.parse(src)
  const hits = findMisparseNodes(t.rootNode)
  const a = new RealGroovyAnalyzer()
  const res = await (a as any).analyze(t.rootNode, src, f)
  const calls = (res.relationships ?? []).filter((r: any) => r.type === ASTEngine.RelationshipType.Calls)
  console.log(`\n===== ${f.split("/").pop()} — ${hits.length} misparse node(s) =====`)
  for (const h of hits.slice(0, 8)) {
    const leaf = h.typeName.split(".").pop()
    const match = calls.filter((r: any) => (typeof r.target === "string" ? r.target : r.target?.name) === leaf)
    const atLine = match.filter((r: any) => Math.abs((r.line_number ?? -1) - h.line) <= 1)
    console.log(`  L${h.line}  { ${h.typeName} ${h.params} -> … }   calls->"${leaf}": ${match.length} total, ${atLine.length} at that line`)
  }
}
