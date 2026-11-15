// Dumps the yaml tree's node types and FIELD names, so a site counter can be written against the
// wired grammar rather than against the grammar a YAML user assumes.
import { readFileSync } from "node:fs"
import { getParser } from "../../../../src/ast/engine.ts"
const f = process.argv[2] ?? "validation/m14/fixtures/yaml/workflow-call-role.yaml"
const content = readFileSync(f, "utf8")
const parser = await getParser("yaml")
const pr = await parser.parse(content, f)
const seen = new Map<string, number>()
const stack: any[] = [pr.rootNode]
const lines: string[] = []
const walk = (n: any, d = 0) => {
  seen.set(n.type, (seen.get(n.type) || 0) + 1)
  if (d <= 6) {
    // report which children are reachable by field name
    const named: string[] = []
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      const fk = ["key", "value"].find((k) => { const t = n.childForFieldName?.(k); return t && t.startIndex === c.startIndex && t.endIndex === c.endIndex })
      named.push(`${c.type}${fk ? `(${fk})` : ""}${c.isNamed ? "" : "*"}`)
    }
    lines.push("  ".repeat(d) + n.type + (n.isNamed ? "" : " [anon]") + "  -> " + named.join(" "))
  }
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
}
walk(pr.rootNode)
console.log(lines.slice(0, 60).join("\n"))
console.log("\ndistinct node types:", JSON.stringify([...seen].sort((a, b) => b[1] - a[1])))
