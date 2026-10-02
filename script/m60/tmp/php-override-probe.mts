import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, "utf8")
  const res: any = await ASTEngine.parseFile(f, src)
  const ov = res.relationships.filter((r: any) => r.type === "overrides")
  const ex = res.relationships.filter((r: any) => r.type === "extends")
  const syms = res.symbols.filter((s: any) => s.kind === "class" || s.kind === "method")
  console.log(`\n### ${path.basename(f)}`)
  console.log(`  classes: ${syms.filter((s: any) => s.kind === "class").map((s: any) => `${s.name}{base=${s.metadata?.baseClass}}`).join(", ")}`)
  console.log(`  methods: ${syms.filter((s: any) => s.kind === "method").map((s: any) => `${s.ownerName}.${s.name}`).join(", ")}`)
  console.log(`  extends: ${ex.map((e: any) => `${e.source}->${e.target}`).join(", ")}`)
  console.log(`  overrides: ${ov.length} ${ov.map((e: any) => `${e.source}->${e.target}@${e.confidence}/L${e.line_number}`).join(", ")}`)
}
process.exit(0)
