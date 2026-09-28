import { writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const file = "validation/m12/fixtures/json/api-contract.json"
const source = await Bun.file(file).text()
const parsed = await ASTEngine.parseFile(file, source)
const symbols = parsed.symbols ?? []
const byPath = new Map<string, any>()
for (const symbol of symbols) {
  if (symbol.metadata?.fullPath) byPath.set(symbol.metadata.fullPath, symbol)
}
const checks = [
  { id: "schema.properties.id.required", actual: byPath.get("schema.properties.id")?.metadata?.isRequired, expected: true },
  { id: "schema.properties.email.required", actual: byPath.get("schema.properties.email")?.metadata?.isRequired, expected: true },
  { id: "schema.properties.profile.properties.displayName.required", actual: byPath.get("schema.properties.profile.properties.displayName")?.metadata?.isRequired, expected: true },
  { id: "schema.$defs.Address.properties.city.required", actual: byPath.get("schema.$defs.Address.properties.city")?.metadata?.isRequired, expected: true },
  { id: "schema.properties.id.validation", actual: byPath.get("schema.properties.id")?.metadata?.hasValidation, expected: true },
  { id: "schema.properties.email.validation", actual: byPath.get("schema.properties.email")?.metadata?.hasValidation, expected: true },
  { id: "schema.$defs.Address.properties.city.validation", actual: byPath.get("schema.$defs.Address.properties.city")?.metadata?.hasValidation, expected: false },
  { id: "no anonymous value symbols", actual: symbols.some((symbol: any) => String(symbol.name).endsWith("_value")), expected: false },
  { id: "indexed array paths are unique", actual: new Set(symbols.map((symbol: any) => symbol.qualifiedName).filter(Boolean)).size === symbols.filter((symbol: any) => symbol.qualifiedName).length, expected: true },
]
const failed = checks.filter((check) => check.actual !== check.expected)
const result = {
  analyzer: "json",
  fixture: file,
  checks,
  passed: failed.length === 0 && (parsed.errors?.length ?? 0) === 0,
  parseErrors: parsed.errors?.length ?? 0,
}
writeFileSync("validation/m12/results/json-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
