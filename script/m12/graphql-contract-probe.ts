import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const checks: { name: string; passed: boolean; detail?: string }[] = []
const check = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail })

async function read(file: string) {
  const path = `validation/m12/fixtures/graphql/${file}`
  return ASTEngine.parseFile(path, readFileSync(path, "utf8"))
}

const schema = await read("Schema.graphql")
const symbols = schema.symbols as any[]
const relationships = schema.relationships as any[]

// Schema + root operation types
check("schema is a namespace", symbols.some((s) => s.name === "schema" && s.kind === "namespace"))
check("root query type is a property", symbols.some((s) => s.name === "query" && s.kind === "property" && s.ownerName === "schema"))
check("root query references Query type", relationships.some((r) => r.type === "uses" && r.source === "schema.query" && r.target === "Query"))

// Type kind mapping
check("object type is a class", symbols.some((s) => s.name === "User" && s.kind === "class"))
check("interface is an interface", symbols.some((s) => s.name === "Node" && s.kind === "interface"))
check("union is a type", symbols.some((s) => s.name === "SearchResult" && s.kind === "type"))
check("enum is an enum", symbols.some((s) => s.name === "Role" && s.kind === "enum"))
check("scalar is a type", symbols.some((s) => s.name === "DateTime" && s.kind === "type"))
check("input type is a class", symbols.some((s) => s.name === "CreateUserInput" && s.kind === "class"))
check("directive definition is a function with @ prefix", symbols.some((s) => s.name === "@deprecated" && s.kind === "function"))
check("enum value is an enum_member", symbols.some((s) => s.name === "ADMIN" && s.kind === "enum_member" && s.ownerName === "Role"))

// Field owner chain + docstring
const userField = symbols.find((s) => s.name === "id" && s.ownerName === "User")
check("field is a property owned by its type", userField?.kind === "property" && userField?.scope === "User")
check("type description is captured", symbols.some((s) => s.name === "User" && (s.docstring ?? "").includes("user in the system")))

// Contains + type references
check("type contains field", relationships.some((r) => r.type === "contains" && r.source === "User" && r.target === "User.id"))
check("field return type is a uses edge", relationships.some((r) => r.type === "uses" && r.source === "User.id" && r.target === "ID"))
check("field argument type is a uses edge", relationships.some((r) => r.type === "uses" && r.source === "User.friends" && r.target === "Int"))
check("list return type resolves to base named type", relationships.some((r) => r.type === "uses" && r.source === "Query.search" && r.target === "SearchResult"))
check("non-null arg type resolves to base named type", relationships.some((r) => r.type === "uses" && r.source === "Query.user" && r.target === "ID"))
check("input field type is a uses edge", relationships.some((r) => r.type === "uses" && r.source === "CreateUserInput.name" && r.target === "String"))
check("union member is a uses edge", relationships.some((r) => r.type === "uses" && r.source === "SearchResult" && r.target === "User"))
check("enum contains value", relationships.some((r) => r.type === "contains" && r.source === "Role" && r.target === "Role.ADMIN"))

// implements
check("object implements interface", relationships.some((r) => r.type === "implements" && r.source === "User" && r.target === "Node"))
check("second object implements interface", relationships.some((r) => r.type === "implements" && r.source === "Product" && r.target === "Node"))

// Directive definition parameters
const directive = symbols.find((s) => s.name === "@deprecated")
check("directive definition captures parameters", Array.isArray(directive?.parameters) && directive.parameters.some((p: any) => p.name === "reason"))

// No field-selection noise in SDL (SDL fields are declarations, not executable)
check("SDL field has no executable selection edge", !relationships.some((r) => r.metadata?.relationshipRole === "field_selection"))

// Executable fixture
const query = await read("Query.graphql")
const qSymbols = query.symbols as any[]
const qRels = query.relationships as any[]
check("query operation is a method", qSymbols.some((s) => s.name === "GetUser" && s.kind === "method"))
check("mutation operation is a method", qSymbols.some((s) => s.name === "CreateUser" && s.kind === "method"))
check("fragment is a method", qSymbols.some((s) => s.name === "UserFields" && s.kind === "method"))
check("variable is owned by its operation", qSymbols.some((s) => s.name === "$id" && s.ownerName === "GetUser" && s.kind === "variable"))
check("fragment spread is a uses edge", qRels.some((r) => r.type === "uses" && r.source === "GetUser" && r.target === "UserFields"))
check("inline fragment type condition is a uses edge", qRels.some((r) => r.type === "uses" && r.source === "GetUser" && r.target === "Actor"))
check("field selection is a uses edge", qRels.some((r) => r.type === "uses" && r.source === "GetUser" && r.target === "user"))
check("fragment type condition is a uses edge", qRels.some((r) => r.type === "uses" && r.source === "UserFields" && r.target === "User"))

// Negative fixture: engine-owned error + graceful recovery
const negative = await read("Negative.graphql")
check("malformed GraphQL reports a syntax error", (negative.errors?.length ?? 0) > 0)
check("valid symbols still extracted from negative file", (negative.symbols as any[]).some((s) => s.name === "Product"))
check("missing-type field emits no bogus type reference", !(negative.relationships as any[]).some((r) => r.source === "Query.broken" && r.type === "uses"))

// No regex in the analyzer
const source = readFileSync("src/ast/real-graphql-analyzer.ts", "utf8")
check("analyzer uses no regex literals or match/replace/split", !/(\.match\(|\.replace\(|\.test\(|RegExp\s*\(|\/\^|\\\.\*\/)/.test(source))

const result = {
  analyzer: "graphql",
  checks,
  passed: checks.every((item) => item.passed),
  count: checks.length,
  passedCount: checks.filter((item) => item.passed).length,
}
writeFileSync("validation/m12/results/graphql-contract.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
