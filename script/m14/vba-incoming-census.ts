import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const file = resolve("validation/m14/fixtures/vba/representative.bas")
const result = await ASTEngine.parseFile(file, readFileSync(file, "utf8"))
const declared = new Set(result.symbols.map((symbol) => symbol.name.toLowerCase()))
const rows = new Map<string, { total: number; resolved: number; incoming: number }>()

for (const relationship of result.relationships) {
  const target = String(relationship.target ?? "")
  const row = rows.get(relationship.type ?? "unknown") ?? { total: 0, resolved: 0, incoming: 0 }
  row.total++
  if (declared.has(target.toLowerCase())) row.resolved++
  if (relationship.source && declared.has(String(relationship.source).toLowerCase())) row.incoming++
  rows.set(relationship.type ?? "unknown", row)
}

console.log(JSON.stringify({
  language: "vba",
  file,
  declaredSymbols: result.symbols.length,
  relationships: Object.fromEntries(rows),
  ruledGaps: result.metadata?.vbaGaps ?? {},
}, null, 2))
