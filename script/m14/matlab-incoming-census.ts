import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const file = resolve("validation/m14/fixtures/matlab/class-and-methods.m")
const result = await ASTEngine.parseFile(file, readFileSync(file, "utf8"))
const declared = new Set(result.symbols.map((symbol) => symbol.name.toLowerCase()))
const rows = new Map<string, { total: number; resolved: number; incoming: number }>()

for (const relationship of result.relationships) {
  const type = relationship.type ?? "unknown"
  const row = rows.get(type) ?? { total: 0, resolved: 0, incoming: 0 }
  row.total++
  if (declared.has(String(relationship.target ?? "").toLowerCase())) row.resolved++
  if (relationship.source && declared.has(String(relationship.source).toLowerCase())) row.incoming++
  rows.set(type, row)
}

console.log(JSON.stringify({
  language: "matlab",
  file,
  declaredSymbols: result.symbols.length,
  relationships: Object.fromEntries(rows),
  ruledGaps: result.metadata?.matlabGaps ?? {},
}, null, 2))
