// #841 round 14: is the shadowed typed closure parameter the cause?
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

function degraded(src: string): boolean {
  const tree = parser.parse(src)
  const kids: string[] = []
  for (const c of tree.rootNode.children) if (c) kids.push(c.type)
  return kids.includes("ERROR") && kids.includes("class")
}

const CANDIDATES: Record<string, string> = {
  "shadow-typed": `
class C {
    void apply(Project project) {
        rootProject.allprojects { Project project ->
            project.tasks.withType(Test).each { Test task ->
                candidateTasks.add(task)
            }
        }
    }
}
`,
  "no-shadow": `
class C {
    void apply(Project outer) {
        rootProject.allprojects { Project inner ->
            inner.tasks.withType(Test).each { Test task ->
                candidateTasks.add(task)
            }
        }
    }
}
`,
  "shadow-only": `
class C {
    void apply(Project project) {
        rootProject.allprojects { Project project -> }
    }
}
`,
  "nested-two-typed": `
class C {
    void apply(Project project) {
        rootProject.allprojects { Project x ->
            x.tasks.withType(Test).each { Test task -> }
        }
    }
}
`,
  "nested-sort-after": `
class C {
    void apply(Project project) {
        rootProject.allprojects { Project x ->
            x.tasks.withType(Test).each { Test task ->
                candidateTasks.add(task)
            }
        }
        candidateTasks.toList().sort { Test left, Test right -> }
    }
}
`,
}

for (const [name, src] of Object.entries(CANDIDATES)) {
  console.log(`${name}: degraded=${degraded(src)}`)
}
