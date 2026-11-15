// Dump the C923 fixture's published edges + symbols, so the expectation file is authored from a
// measurement rather than from the fixture's intent.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const target = process.argv[2] ?? "validation/m14/fixtures/csharp/interface-member-implementation.cs"
const file = path.join(ROOT, target)
const src = fs.readFileSync(file, "utf8")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const res: any = await ASTEngine.parseFile(file, src)
console.log(`symbols (${res.symbols.length}):`)
for (const s of res.symbols) console.log(`  ${String(s.kind).padEnd(10)} ${s.name}${s.ownerName ? ` [owner=${s.ownerName}]` : ""}`)
console.log(`\nrelationships (${res.relationships.length}):`)
for (const r of res.relationships) {
  const tag = r.metadata?.relationshipType ?? ""
  console.log(`  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(26)} -> ${String(r.target).padEnd(26)} line=${r.line_number ?? "-"} ${tag ? `(${tag})` : ""}`)
}
