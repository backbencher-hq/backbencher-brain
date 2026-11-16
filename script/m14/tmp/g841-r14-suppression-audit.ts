// #841 round 14: audit the 8 calls->TypeName edges the recovery suppressed.
// For each, print the source line and the parse shape at that line. The
// suppression is only correct if the line is a typed closure parameter list
// misparsed as juxt_function_call(name: Type, args: names) + lambda_expression.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"

const CASES: Array<{ f: string; line: number; target: string }> = [
  { f: "grails-core/grails-async/core/src/test/groovy/grails/async/SynchronousPromiseFactorySpec.groovy", line: 172, target: "Closure" },
  { f: "grails-core/grails-core/src/test/groovy/grails/plugins/GrailsPluginSorterSpec.groovy", line: 139, target: "TestPlugin" },
  { f: "grails-core/grails-core/src/test/groovy/grails/plugins/GrailsPluginSorterSpec.groovy", line: 140, target: "TestPlugin" },
  { f: "grails-core/grails-data-neo4j/grails-datastore-gorm-neo4j/src/main/groovy/org/grails/datastore/gorm/neo4j/engine/Neo4jAssociationQueryExecutor.groovy", line: 129, target: "Association" },
  { f: "grails-core/grails-data-neo4j/grails-datastore-gorm-neo4j/src/main/groovy/org/grails/datastore/gorm/neo4j/engine/Neo4jQuery.groovy", line: 420, target: "Association" },
  { f: "grails-core/grails-datamapping-core/src/main/groovy/org/grails/compiler/gorm/GormEntityTransformation.groovy", line: 479, target: "AnnotationNode" },
  { f: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/core/GrailsGradlePlugin.groovy", line: 670, target: "Dependency" },
  { f: "grails-core/grails-shell-cli/src/main/groovy/org/grails/cli/profile/commands/CommandRegistry.groovy", line: 89, target: "Command" },
]

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function lineAt(src: string, n: number): string {
  return (src.split("\n")[n - 1] ?? "").trim()
}

for (const c of CASES) {
  const f = path.join(CORPUS, c.f)
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const hits: string[] = []
  const walk = (node: any) => {
    if (node.type === "juxt_function_call") {
      const nameNode = node.childForFieldName("name")
      const args = node.childForFieldName("args")
      if (nameNode && args && nameNode.text.trim().startsWith(c.target)) {
        hits.push(`    L${node.startPosition.row + 1} juxt(name=${JSON.stringify(nameNode.text)}, args=${JSON.stringify(args.text)})`)
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const ch = node.namedChild(i)
      if (ch) walk(ch)
    }
  }
  walk(tree.rootNode)
  console.log(`\n== ${c.f.split("/").pop()}  target=${c.target}  line=${c.line}`)
  console.log(`   source L${c.line}: ${lineAt(src, c.line)}`)
  if (c.line > 1) console.log(`   source L${c.line - 1}: ${lineAt(src, c.line - 1)}`)
  if (hits.length === 0) console.log(`   !! NO juxt node naming ${c.target} — suppression NOT explained by the guard`)
  else for (const h of hits) console.log(h)
}
