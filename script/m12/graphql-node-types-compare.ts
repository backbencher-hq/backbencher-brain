import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

// Every tree-sitter-graphql node type the analyzer dispatches on (via
// `type === "..."` / `n.type === "..."`). A stale or misspelled entry would
// silently route a real construct through the wrong branch, so each must be
// observed in at least one real input.
const refs = new Set<string>([
  "SchemaDefinition", "OperationTypeDefinition", "OperationType", "NamedType",
  "ObjectTypeDefinition", "InterfaceTypeDefinition", "InputObjectTypeDefinition",
  "ImplementsInterfaces", "UnionTypeDefinition", "UnionMemberTypes",
  "EnumTypeDefinition", "EnumValueDefinition", "EnumValue", "ScalarTypeDefinition",
  "DirectiveDefinition", "FieldDefinition", "Type", "ArgumentsDefinition",
  "InputValueDefinition", "InputFieldsDefinition", "Name", "VariableDefinitions",
  "VariableDefinition", "Variable", "FragmentDefinition", "FragmentName",
  "TypeCondition", "Field", "Selection", "SelectionSet", "FragmentSpread",
  "InlineFragment", "Description", "StringValue",
])

const parser = await ASTEngine.getParser("graphql")
const observed = new Set<string>()

const fixtureFiles = readdirSync("validation/m12/fixtures/graphql")
  .filter((file) => /\.(graphql|graphqls|gql)$/i.test(file))
  .sort()

const corpus = "$HOME/fixtures/repositories/graphql-js"
const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.graphql", "*.graphqls", "*.gql"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()

const inputs: string[] = fixtureFiles.map((file) => readFileSync(`validation/m12/fixtures/graphql/${file}`, "utf8"))
for (const file of corpusFiles) inputs.push(readFileSync(`${corpus}/${file}`, "utf8"))

for (const input of inputs) {
  const tree = parser.parse(input)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    observed.add(node.type)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}

const live = [...refs].filter((type) => observed.has(type)).sort()
const dead = [...refs].filter((type) => !observed.has(type)).sort()
const result = {
  analyzer: "graphql",
  grammar: "vendored wasm/tree-sitter-graphql.wasm",
  fixtureFiles,
  corpus: `graphql-js@${revision.slice(0, 7)}`,
  corpusFiles: corpusFiles.length,
  referencedNodeTypes: [...refs].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  passed: dead.length === 0 && live.length > 0,
}
writeFileSync("validation/m12/results/graphql-shape-safety.json", JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
