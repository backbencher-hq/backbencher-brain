import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const source = readFileSync("src/ast/real-sql-analyzer.ts", "utf8")
const refs = new Set<string>()
for (const match of source.matchAll(/case\s+"([a-z_]+)"|\.type\s*===\s*"([a-z_]+)"|\.type\s*===\s*"([a-z_]+)"/g)) {
  const value = match[1] || match[2] || match[3]
  if (value) refs.add(value)
}
const parser = await ASTEngine.getParser("sql" as any)
const observed = new Set<string>()
const fixtureDir = "validation/m12/fixtures/sql"
for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".sql")).sort()) {
  const tree = parser.parse(readFileSync(join(fixtureDir, file), "utf8"))
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()
    observed.add(node.type)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}
const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "sql",
  grammar: "@derekstride/tree-sitter-sql 0.3.11",
  fixtureFiles: readdirSync(fixtureDir).filter((f) => f.endsWith(".sql")).sort(),
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedFixtureNodeTypes: [...observed].sort(),
  passed: live.length > 0,
}
writeFileSync("validation/m12/results/sql-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
