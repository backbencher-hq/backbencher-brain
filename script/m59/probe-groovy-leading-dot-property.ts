// M59 finding check: in the pinned groovy grammar, `this\n .label` (a continued
// PROPERTY access, no parentheses) is shaped as `leading_dot_call`, and the
// leading_dot_call branch emits a `calls` edge. The same access written on one
// line is a `field_access` and emits `uses`. If both are true, a multi-line
// property read fabricates a CALL to a property name.
import * as path from "path"

const ROOT = "$HOME/mcp/backbencher-brain"

const SAME_LINE = `class A {
    String label
    void f() {
        def m = this.label
        helper(m)
    }
}
`

const CONTINUED = `class A {
    String label
    void f() {
        def m = this
                .label
        helper(m)
    }
}
`

async function dump(name: string, src: string): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(`/tmp/ld-${name}.groovy`, src)
  const lines = src.split("\n")
  console.log(`\n=== ${name} ===`)
  for (const r of res.relationships ?? []) {
    const t = String(r.type)
    if (t !== "calls" && t !== "uses") continue
    const ln = r.line_number
    console.log(`  ${t.padEnd(6)} ${(r.metadata?.relationshipType ?? r.metadata?.isFieldAccess ? "field_access" : "").padEnd(18)} ${String(r.source).padEnd(6)} -> ${String(r.target).padEnd(8)} line=${ln} :: ${(lines[(ln ?? 1) - 1] ?? "").trim()}`)
  }
}

async function main(): Promise<void> {
  await dump("same-line", SAME_LINE)
  await dump("continued", CONTINUED)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
