// #841 round 14: why does candidate C keep a fabricated calls->Type edge?
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = `
class TestTaskShardingPlugin {
    private static void registerShardTask(Project rootProject, Set<Test> candidateTasks, ShardConfiguration configuration) {
        rootProject.tasks.register(SHARD_TASK_NAME) { Task task ->
            task.group = 'verification'
            task.dependsOn {
                collectCandidateTasks(rootProject, candidateTasks).findAll { Test testTask ->
                    isSelectedForShard(testTask, configuration)
                }
            }
        }
    }
}
`

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)
const tree = parser.parse(SRC)
const analyzer = new RealGroovyAnalyzer()

const res = await ASTEngine.parseFile("/tmp/candidate.groovy", SRC) as any
console.log("fabricated calls:")
for (const r of res.relationships ?? []) {
  if (r.type !== "calls") continue
  const t = typeof r.target === "object" ? r.target?.name : r.target
  if (/^[A-Z]/.test(t)) console.log(`  calls -> ${t} @L${r.line_number}  source=${typeof r.source === "object" ? r.source?.name : r.source}`)
}

console.log("\njuxt nodes and guard verdict:")
const walk = (node: any, depth: number) => {
  if (node.type === "juxt_function_call") {
    const nameNode = node.childForFieldName("name")
    const args = node.childForFieldName("args")
    const verdict = nameNode ? (analyzer as any).looksLikeTypedClosureMisparse(node, nameNode) : "no-name"
    console.log(`  L${node.startPosition.row + 1} juxt name=${JSON.stringify(nameNode?.text)} args=${JSON.stringify(args?.text)} guard=${verdict}`)
    // print named siblings around it
    const parent = node.parent
    if (parent) {
      const kids: string[] = []
      for (let i = 0; i < parent.namedChildCount; i++) { const c = parent.namedChild(i); if (c) kids.push(`${c.type}${c.id === node.id ? "*" : ""}`) }
      console.log(`      parent=${parent.type} kids=${kids.join(",")}`)
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) walk(c, depth + 1) }
}
walk(tree.rootNode, 0)
