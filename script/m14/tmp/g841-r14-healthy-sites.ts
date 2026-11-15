// #841 round 14: which minimal healthy source actually misparses?
import path from "node:path"
const ROOT = process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ?? "/tmp/bb-base"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

const CANDIDATES: Record<string, string> = {
  "register-single": `class X {
    void m() {
        registry.register(NAME) { Task task ->
            task.x = 1
        }
    }
}
`,
  "sort-two": `class X {
    void m() {
        names.toList().sort { Test left, Test right ->
            left.name <=> right.name
        }
    }
}
`,
  "each-two": `class X {
    void m() {
        items.each { String key, Object value ->
            register(key, value)
        }
    }
}
`,
  "configureEach-single": `class X {
    void m() {
        project.tasks.withType(Jar).configureEach { Jar jar ->
            jar.x = 1
        }
    }
}
`,
  "each-single": `class X {
    void m() {
        rootProject.allprojects.each { Project project ->
            project.tasks.withType(Test).each { Test task ->
                candidateTasks.add(task)
            }
        }
    }
}
`,
  "collect-two": `class X {
    void m() {
        candidates.findAll { Test task -> task.ok }.collect { Test task -> task.path }.sort()
    }
}
`,
}

for (const [name, src] of Object.entries(CANDIDATES)) {
  const tree = parser.parse(src)
  const juxts: string[] = []
  const walk = (n: any) => {
    if (n.type === "juxt_function_call") {
      const nm = n.childForFieldName("name")
      const ar = n.childForFieldName("args")
      juxts.push(`L${n.startPosition.row + 1}:${nm?.text}|${ar?.text}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
  const res: any = await ASTEngine.parseFile("/tmp/x.groovy", src)
  const fab = (res.relationships ?? []).filter((r: any) => r.type === "calls" && /^[A-Z]/.test(String(typeof r.target === "object" ? r.target?.name : r.target)))
  console.log(`\n== ${name}  (${ROOT === "/tmp/bb-base" ? "BASELINE" : "repo"})`)
  console.log(`   juxts: ${juxts.join("  ") || "(none)"}`)
  console.log(`   fabricated calls: ${fab.map((r: any) => `${typeof r.target === "object" ? r.target?.name : r.target}@${r.line_number}`).join(",") || "(none)"}`)
  console.log(`   classes: ${(res.symbols ?? []).filter((s: any) => s.kind === "class").length} contains: ${(res.relationships ?? []).filter((r: any) => r.type === "contains").length}`)
}
