/**
 * GraphQL GRAMMAR CENSUS.
 *
 * The analyzer's whole contract is a set of string literals compared against
 * `node.type`. A literal that the grammar never produces is dead code; a node
 * type the grammar does produce that the analyzer never names is a blind spot.
 * This probe measures BOTH directions from the vendored wasm, plus every field
 * name the grammar actually assigns, so no accessor is assumed.
 *
 *   node types declared by the grammar   (language.nodeTypeForId)
 *   field names declared by the grammar   (language.fieldNameForId)
 *   node types / field pairs OBSERVED     (walked over a dialect battery)
 *   analyzer string literals              (classified against the two tables)
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

// ---------------------------------------------------------------- declared side
const declaredTypes = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (n) declaredTypes.add(n)
}
const declaredFields = new Set<string>()
for (let i = 1; i <= language.fieldCount; i++) {
  const f = language.fieldNameForId(i)
  if (f) declaredFields.add(f)
}

// --------------------------------------------------------------- observed side
// A battery that covers every construct the GraphQL spec (Oct 2021) defines,
// plus the shapes real schemas actually contain. Every shape is a separate
// file so a parse failure is attributable to one construct.
const BATTERY: Record<string, string> = {
  sdl_full: `
"""Root"""
schema { query: Query, mutation: Mutation, subscription: Subscription }

"a user"
type Query implements Node & Timestamped @key(fields: "id") {
  "the id"
  id: ID!
  name: String
  tags: [String!]!
  friends(first: Int = 10, after: String): [User!]!
  me: User
}

interface Node { id: ID! }
interface Timestamped @key(fields: "id") { createdAt: String! }

type User implements Node & Timestamped @key(fields: "id") {
  id: ID!
  createdAt: String!
  role: Role!
  status: Status
}

union SearchResult = User | Post | Comment

enum Role { ADMIN USER GUEST @deprecated(reason: "no") }

scalar DateTime @specifiedBy(url: "https://scalars.graphql.org/andimarek/date-time")

input UserFilter {
  "name filter"
  name: String
  nested: UserFilter
  limit: Int = 10
  required: Boolean!
}

directive @auth(requires: Role = ADMIN, message: String) repeatable on OBJECT | FIELD_DEFINITION

extend type Query { extra: String }
extend schema @link(url: "https://specs.apollo.dev/federation/v2.0")
`,
  executable_full: `
query GetUser($id: ID!, $withFriends: Boolean = true, $tags: [String!]!) @cached {
  user(id: $id) {
    ...UserFields
    ... on Admin { level }
    nickname: name
    friends(first: 5) @include(if: $withFriends) { edges { node { id } } }
  }
}

mutation CreateUser($input: UserInput!) {
  createUser(input: $input) { id errors { field message } }
}

subscription OnUserUpdated { userUpdated { id } }

{ __typename }

query { a b c }
`,
  fragments: `
fragment UserFields on User {
  id
  name
  ...ProfileFields
  ... @skip(if: true) { x }
}
fragment ProfileFields on User @client { bio }
`,
  descriptions: `
"A regular quoted description"
type A { "field desc" f: Int }

"""
Block description
with lines
"""
type B { """
  field block
""" g: Int }
`,
  edge_shapes: `
schema @directive { query: Query }
type Q { a: Int = 3, b: String }
extend scalar Date
extend union U = A | B
extend enum E { X }
extend input In { y: Int }
extend interface I { z: Int }
type Deep { x: [[Int!]!]! }
`,
}

const typeCounts = new Map<string, number>()
const fieldPairs = new Map<string, number>()
const anonTokens = new Map<string, number>()
const perShape: Record<string, any> = {}
let totalNodes = 0

for (const [shape, src] of Object.entries(BATTERY)) {
  const tree: any = parser.parse(src)
  let errNodes = 0
  let missingNodes = 0
  const seen = new Set<string>()
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    totalNodes++
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
    seen.add(n.type)
    if (n.type === "ERROR" || n.isError) errNodes++
    if (n.isMissing) missingNodes++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (!c.isNamed) anonTokens.set(c.type, (anonTokens.get(c.type) ?? 0) + 1)
      else {
        const fld = n.fieldNameForNamedChild(i)
        if (fld) {
          const k = `${n.type} .${fld} -> ${c.type}`
          fieldPairs.set(k, (fieldPairs.get(k) ?? 0) + 1)
        }
      }
      stack.push(c)
    }
  }
  perShape[shape] = { hasError: tree.rootNode.hasError, errorNodes: errNodes, missingNodes, distinctTypes: [...seen].sort() }
  console.error(`${shape.padEnd(14)} hasError=${tree.rootNode.hasError} errNodes=${errNodes} missing=${missingNodes} types=${seen.size}`)
}

// ---------------------------------------------------------- analyzer literals
const src = fs.readFileSync(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"), "utf8")
const literals = new Set<string>()
for (const m of src.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) literals.add(m[1])
for (const m of src.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) literals.add(m[1])
const asNodeType = [...literals].filter((l) => declaredTypes.has(l)).sort()
const asField = [...literals].filter((l) => declaredFields.has(l)).sort()
const neither = [...literals].filter((l) => !declaredTypes.has(l) && !declaredFields.has(l)).sort()

const out = {
  generatedAt: new Date().toISOString(),
  wasm: "wasm/tree-sitter-graphql.wasm",
  abiVersion: language.abiVersion ?? language.version,
  grammarDeclaredTypes: [...declaredTypes].sort(),
  grammarDeclaredTypeCount: declaredTypes.size,
  grammarDeclaredFields: [...declaredFields].sort(),
  observedTypes: Object.fromEntries([...typeCounts].sort((a, b) => b[1] - a[1])),
  observedTypeCount: typeCounts.size,
  observedFieldPairs: Object.fromEntries([...fieldPairs].sort((a, b) => b[1] - a[1])),
  observedAnonymousTokens: Object.fromEntries([...anonTokens].sort((a, b) => b[1] - a[1])),
  totalNodes,
  perShape,
  analyzerLiteralsThatAreNodeTypes: asNodeType,
  analyzerLiteralsThatAreFields: asField,
  analyzerLiteralsThatAreNeither: neither,
  declaredButNeverProduced: [...declaredTypes].filter((t) => !typeCounts.has(t)).sort(),
  producedButNeverNamedByAnalyzer: [...typeCounts.keys()].filter((t) => !literals.has(t)).sort(),
}
fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(path.join(HERE, "out/grammar-census.json"), JSON.stringify(out, null, 2))

console.error("")
console.error(`declared types=${declaredTypes.size} fields=${declaredFields.size}`)
console.error(`observed nodes=${totalNodes} distinct types=${typeCounts.size}`)
console.error(`field pairs=${fieldPairs.size}`)
console.error(`analyzer literals -> nodeTypes=${asNodeType.length} fields=${asField.length} neither=${neither.length}`)
console.error(`NEITHER: ${neither.join(" ")}`)
console.error(`produced but never named by analyzer (${out.producedButNeverNamedByAnalyzer.length}): ${out.producedButNeverNamedByAnalyzer.join(" ")}`)
