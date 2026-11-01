import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const file = resolve("validation/m14/fixtures/matlab/class-and-methods.m")
const result = await ASTEngine.parseFile(file, readFileSync(file, "utf8"))
const allowed = new Set(["contains", "references", "calls", "uses", "extends"])
const failures: string[] = []
const symbolKinds = new Set(Object.values(ASTEngine.SymbolKind))

for (const symbol of result.symbols) {
  if (!symbol.name) failures.push("empty symbol name")
  if (!symbolKinds.has(symbol.kind)) failures.push(`unknown symbol kind ${symbol.kind}`)
}
for (const relationship of result.relationships) {
  if (!relationship.type || !allowed.has(relationship.type)) failures.push(`uncontracted relationship ${relationship.type}`)
  if (!Number.isInteger(relationship.line_number) || relationship.line_number < 1) failures.push(`unlined ${relationship.type ?? "relationship"}`)
}
if (result.symbols.length === 0) failures.push("fixture produced no symbols")
if (!result.relationships.some((relationship) => relationship.type === "extends")) failures.push("fixture produced no extends relationship")
if (!result.relationships.some((relationship) => relationship.type === "contains")) failures.push("fixture produced no contains relationship")

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(`matlab differential: symbols=${result.symbols.length} relationships=${result.relationships.length} failures=0`)
