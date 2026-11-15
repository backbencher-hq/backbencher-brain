/**
 * GraphQL GRAMMAR A/B — vendored wasm vs a candidate wasm, over the same inputs.
 *
 * Reports, per input: hasError, ERROR node count, MISSING node count, distinct
 * node types, and the SET DIFFERENCE of node types. A grammar swap is only
 * allowed to move these in a direction that is argued for case by case, so the
 * probe exists to make every movement a measurement.
 *
 *   tsx grammar-ab.mts                       # vendored vs the built HEAD grammar
 *   tsx grammar-ab.mts --corpus <dir>        # add a real-corpus sweep
 *   tsx grammar-ab.mts --verbose
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const VENDORED = path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const CANDIDATE = process.env.GQL_CANDIDATE ?? path.join(HERE, "grammar-rebuild/tree-sitter-graphql-ported.wasm")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const verbose = process.argv.includes("--verbose")
const corpusArg = process.argv.indexOf("--corpus")
const corpusDir = corpusArg >= 0 ? process.argv[corpusArg + 1] : undefined

const vendLang = await Language.load(fs.readFileSync(VENDORED))
const candLang = await Language.load(fs.readFileSync(CANDIDATE))
const pVend = new ParserClass()
pVend.setLanguage(vendLang)
const pCand = new ParserClass()
pCand.setLanguage(candLang)

interface Stat {
  hasError: boolean
  errors: number
  missing: number
  types: Set<string>
  errorText: string[]
  rootType: string
}
function stat(parser: any, src: string): Stat {
  const tree = parser.parse(src)
  const types = new Set<string>()
  const errorText: string[] = []
  let errors = 0
  let missing = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    types.add(n.type)
    if (n.type === "ERROR" || n.isError) {
      errors++
      errorText.push(`ERROR@${n.startPosition.row + 1}:${n.startPosition.column + 1} ${JSON.stringify(src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 60)))}`)
    }
    if (n.isMissing) {
      missing++
      errorText.push(`MISSING ${n.type}@${n.startPosition.row + 1}:${n.startPosition.column + 1}`)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return { hasError: tree.rootNode.hasError, errors, missing, types, errorText, rootType: tree.rootNode.type }
}

// ------------------------------------------------------------------- battery
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
  extensions: `
extend type Query @key(fields: "id") { a: Int }
extend interface Node { z: String }
extend union U = A | B
extend enum E { X }
extend input In { y: Int }
extend scalar Date @specifiedBy(url: "https://x")
extend schema { mutation: Mutation }
`,
  directive_defs: `
directive @auth(requires: Role = ADMIN) on OBJECT
directive @tag(name: String!) repeatable on FIELD_DEFINITION | OBJECT
directive @oneOf on INPUT_OBJECT
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
  values: `
input V {
  a: Int = 1
  b: Float = 1.5
  c: String = "s"
  d: Boolean = true
  e: [Int] = [1, 2]
  f: Status = RED
  g: Int = null
  h: ID = 1
  i: String = """
  block
  """
  j: In = { x: 1 }
  k: Int = -3
  l: Float = 1e10
  m: Int = 0x1F
  n: String = "esc \\" quote"
}
enum Status { RED GREEN }
`,
  kitchen_sink: `# comment
query Q($v: Int = 1) @d { a b { c } ...F ... @include(if: true) { d } }
fragment F on T { e }
type T implements I & J { f: [G!]! @d(x: {y: 1}) }
interface I { f: Int }
input J { g: H = {i: "}"} }
enum G { H }
union Z = T
scalar S
schema { query: T }
directive @d(a: Int) on FIELD
`,
}

const inputs: Array<[string, string]> = Object.entries(BATTERY)

// ------------------------------------------------------------- corpus inputs
if (corpusDir) {
  const walk = (d: string, out: string[] = [], depth = 0): string[] => {
    if (depth > 12) return out
    let es: fs.Dirent[]
    try {
      es = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of es) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, out, depth + 1)
      else if (/\.(graphql|graphqls|gql)$/i.test(e.name)) out.push(p)
    }
    return out
  }
  const files = walk(corpusDir).sort()
  console.error(`corpus ${corpusDir}: ${files.length} files`)
  for (const f of files.slice(0, 4000)) inputs.push([path.relative(corpusDir, f), fs.readFileSync(f, "utf8")])
}

// --------------------------------------------------------------------- report
const rows: any[] = []
const typeGain = new Map<string, number>()
const typeLoss = new Map<string, number>()
let vErrFiles = 0
let cErrFiles = 0
let vErrNodes = 0
let cErrNodes = 0
let fixed: string[] = []
let broke: string[] = []
let changed: string[] = []

for (const [label, src] of inputs) {
  const v = stat(pVend, src)
  const c = stat(pCand, src)
  if (v.hasError) vErrFiles++
  if (c.hasError) cErrFiles++
  vErrNodes += v.errors
  cErrNodes += c.errors
  if (v.hasError && !c.hasError) fixed.push(label)
  if (!v.hasError && c.hasError) broke.push(label)
  else if (v.hasError && c.hasError && v.errors !== c.errors) changed.push(label)
  for (const t of c.types) if (!v.types.has(t)) typeGain.set(t, (typeGain.get(t) ?? 0) + 1)
  for (const t of v.types) if (!c.types.has(t)) typeLoss.set(t, (typeLoss.get(t) ?? 0) + 1)
  rows.push({
    label,
    vendored: { hasError: v.hasError, errors: v.errors, missing: v.missing, types: v.types.size, root: v.rootType },
    candidate: { hasError: c.hasError, errors: c.errors, missing: c.missing, types: c.types.size, root: c.rootType },
    typeDelta: {
      gained: [...c.types].filter((t) => !v.types.has(t)).sort(),
      lost: [...v.types].filter((t) => !c.types.has(t)).sort(),
    },
    ...(verbose ? { vendoredErrors: v.errorText, candidateErrors: c.errorText } : {}),
  })
}

console.log(`files=${rows.length}  vendored: errorFiles=${vErrFiles} errorNodes=${vErrNodes}   candidate: errorFiles=${cErrFiles} errorNodes=${cErrNodes}`)
console.log(`\nFIXED (vendored error -> candidate clean): ${fixed.length}`)
for (const f of fixed) console.log(`  + ${f}`)
console.log(`\nBROKE (vendored clean -> candidate error): ${broke.length}`)
for (const f of broke) {
  console.log(`  - ${f}`)
  const r = rows.find((x) => x.label === f)!
  if (verbose) for (const e of stat(pCand, inputs.find(([l]) => l === f)![1]).errorText) console.log(`      ${e}`)
}
console.log(`\nCHANGED (both error, node count moved): ${changed.length}`)
for (const f of changed) {
  const r = rows.find((x) => x.label === f)!
  console.log(`  ~ ${f}  vendored=${r.vendored.errors} candidate=${r.candidate.errors}`)
}
console.log(`\nnode types GAINED by candidate (${typeGain.size}):`)
console.log(`  ${[...typeGain.keys()].sort().join(" ")}`)
console.log(`node types LOST by candidate (${typeLoss.size}):`)
console.log(`  ${[...typeLoss.keys()].sort().join(" ")}`)

fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(
  path.join(HERE, "out/grammar-ab.json"),
  JSON.stringify({ vendored: VENDORED, candidate: CANDIDATE, files: rows.length, vendoredErrorFiles: vErrFiles, candidateErrorFiles: cErrFiles, vendoredErrorNodes: vErrNodes, candidateErrorNodes: cErrNodes, fixed, broke, changed, typeGain: Object.fromEntries([...typeGain].sort()), typeLoss: Object.fromEntries([...typeLoss].sort()), rows }, null, 2),
)
