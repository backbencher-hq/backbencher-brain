// Read the live shape of the java phantom-containment fixture: phantom symbols,
// their owners, and the line each containment edge carries. Authored from
// emission, never from memory.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIX = "validation/m14/fixtures/java/phantom-contains-lines.java"

async function main(): Promise<void> {
  const arg = process.argv[2]
  const rel = arg ?? FIX
  const file = rel.startsWith("/") ? rel : path.join(ROOT, rel)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(file, "utf8")
  const res: any = await ASTEngine.parseFile(file, src)
  console.log("=== phantom symbols ===")
  for (const s of res.symbols ?? []) {
    if (s.metadata?.isPhantom !== true) continue
    console.log(`  ${String(s.name).padEnd(14)} kind=${String(s.kind).padEnd(10)} owner=${String(s.ownerName ?? "-").padEnd(14)} line=${String(s.range?.startLine ?? "(none)")}`)
  }
  console.log("=== relationships ===")
  for (const r of res.relationships ?? []) {
    console.log(`  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(18)} -> ${String(r.target).padEnd(16)} line=${String(r.line_number ?? "(none)")}`)
  }
  console.log("=== frameworks ===", JSON.stringify(res.metadata?.detectedFrameworks ?? []))
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
