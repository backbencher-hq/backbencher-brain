// #841 round 14: find the minimal source that degrades the class (root-level
// ERROR + class fragments) so the fixture pins the recovery. Run once with
// --root=/tmp/bb-base (no recovery) and once against the working tree.
import path from "node:path"

const ROOT = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? "/home/ishaq2321/mcp/backbencher-brain"

const CANDIDATES: Record<string, string> = {
  "A-simple-register": `
class C {
    void m() {
        registry.register(NAME) { Task task -> task.x }
    }
}
`,
  "B-chained": `
class C {
    void m() {
        rootProject.tasks.register(SHARD) { Task task ->
            task.group = 'verification'
        }
    }
}
`,
  "C-real-shape": `
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
`,
  "D-two-typed-params": `
class C {
    void m() {
        pairs.sort { String key, Object value -> key <=> value }
    }
}
`,
  "E-with-implements": `
class C implements Plugin<Project> {
    void apply(Project project) {
        project.tasks.withType(Test) { Test task ->
            task.x = 1
        }
    }
}
`,
}

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

for (const [name, src] of Object.entries(CANDIDATES)) {
  const tree = parser.parse(src)
  const root = tree.rootNode
  const rootKids: string[] = []
  for (const c of root.children) if (c) rootKids.push(c.type)
  const res = await ASTEngine.parseFile(path.join(ROOT, "candidate.groovy"), src) as any
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  const classes = syms.filter((s: any) => s.kind === "class")
  const contains = rels.filter((r: any) => r.type === "contains")
  const fabricated = rels.filter((r: any) => r.type === "calls" && /^[A-Z]/.test(typeof r.target === "object" ? r.target?.name : r.target))
  console.log(`\n== ${name}  ROOT=${ROOT}`)
  console.log(`   rootError=${root.hasError}  hasChildError=${rootKids.includes("ERROR")}  rootKids=${rootKids.join(",")}`)
  console.log(`   classes=${classes.length} contains=${contains.length} fabricatedCalls=${fabricated.length}`)
  if (classes.length) console.log(`   class names: ${classes.map((c: any) => `${c.name}@${c.range?.startLine}`).join(", ")}`)
}
