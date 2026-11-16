// Read the live shape of the kotlin/data-class-phantoms fixture: which symbols
// are phantoms and what line each containment edge carries. Authored from
// emission, never from memory.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIX = "validation/m14/fixtures/kotlin/data-class-phantoms.kt"

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(path.join(ROOT, FIX), "utf8")
  const res: any = await ASTEngine.parseFile(path.join(ROOT, FIX), src)
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) {
    console.log(
      `  ${String(s.name).padEnd(14)} kind=${String(s.kind).padEnd(10)} owner=${String(s.ownerName ?? "-").padEnd(10)} line=${String(s.range?.startLine ?? "(none)").padEnd(6)} phantom=${s.metadata?.isPhantom === true}`,
    )
  }
  console.log("=== relationships ===")
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "contains") continue
    console.log(`  contains ${String(r.source).padEnd(10)} -> ${String(r.target).padEnd(14)} line=${String(r.line_number ?? "(none)")}`)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
