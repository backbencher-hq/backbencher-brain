import * as fs from "fs"
import * as path from "path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIX = process.argv[2] ?? "validation/m14/fixtures/groovy/reserved-key-map-items-850.groovy"

async function main(): Promise<void> {
  const p = path.join(ROOT, FIX)
  const content = fs.readFileSync(p, "utf8")
  const res: any = await ASTEngine.parseFile(p, content)
  console.log("=== SYMBOLS ===")
  for (const s of res.symbols ?? []) {
    console.log(`${String(s.kind).padEnd(12)} ${s.name}${s.ownerName ? `  owner=${s.ownerName}` : ""}  line=${s.range?.start?.line ?? s.startLine ?? "?"}`)
  }
  console.log("\n=== RELATIONSHIPS ===")
  for (const r of res.relationships ?? []) {
    console.log(`${String(r.type ?? r.relationshipType).padEnd(12)} ${String(r.source).padEnd(24)} -> ${String(r.target).padEnd(28)} line=${r.line_number}`)
  }
  console.log(`\nsymbols=${(res.symbols ?? []).length} rels=${(res.relationships ?? []).length}`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
