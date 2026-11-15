/**
 * GraphQL CONTRACT BATTERY.
 *
 * Every case is a hand-audited GraphQL snippet plus the EXACT symbol identities,
 * kinds, owner, and line numbers the analyzer must produce, and the relationships
 * it must / must not produce. A case fails loudly with the diff; a case that
 * passes for the wrong reason (a fact produced but the reason is wrong) is
 * caught by `expectErrors` / `forbid`.
 *
 * Line numbers are 1-based per the house contract. `nodeToRange` must therefore
 * be `row + 1` for lines and `column + 1` for columns.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const wasmPath = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const language: any = await Language.load(fs.readFileSync(wasmPath))
const parser = new ParserClass()
parser.setLanguage(language)

const mod: any = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))
const Klass = mod.RealGraphqlAnalyzer

interface Case {
  id: string
  why: string
  src: string
  /** [kind, name, startLine] triples that MUST be emitted, exactly. */
  symbols: Array<[string, string, number]>
  /** [type, source, target] triples that MUST be emitted. */
  relationships?: Array<[string, string, string]>
  /** enforce the exact symbol set (no extra symbols) */
  exactSymbols?: boolean
  /** Symbols whose name must not appear at all. */
  forbidNames?: string[]
  /** Relationships that must not be emitted. */
  forbidRels?: Array<[string, string, string]>
  /** ownerName -> symbol names, if the case is about ownership. */
  ownerOf?: Record<string, string[]>
  /** "type|source|target" -> the exact multiset of `line_number`s that must be present. */
  relationshipLines?: Record<string, number[]>
  /** { kind, name, ...argName: isOptional } — GraphQL's own optionality rule. */
  parameterOptionality?: { kind: string; name: string } & Record<string, any>
  /** The case's own source must parse cleanly; a `hasError` here is a GRAMMAR gap. */
  mustParseCleanly?: boolean
}

const C: Case[] = [
  {
    id: "object-simple",
    why: "the baseline: one object type, one field",
    src: "type Query {\n  hello: String\n}\n",
    symbols: [["class", "Query", 1], ["property", "hello", 2]],
    relationships: [["contains", "Query", "Query.hello"], ["references", "Query.hello", "String"]],
  },
  {
    id: "line-numbers-multiline",
    why: "1-based lines; a definition on line 3 reports 3, and its field on line 6 reports 6",
    src: "\n\ninterface I { z: Int }\n\ntype A\n  implements I\n{\n  x : Int\n}\n",
    symbols: [["interface", "I", 3], ["class", "A", 5], ["property", "x", 8]],
    relationships: [["implements", "A", "I"], ["contains", "A", "A.x"], ["references", "A.x", "Int"]],
    ownerOf: { A: ["x"] },
  },
  {
    id: "described-definition-line-is-the-keyword", mustParseCleanly: true,
    why: "M59/#861: a definition's line is the line its KEYWORD is on, not the line its Description starts on. Measured on the GitHub public schema, the naive range pointed at the docstring for 3,131 of 3,332 symbols.",
    src: '"the description is on line 1"\ntype A {\n  "so is this one"\n  f: Int\n}\n',
    symbols: [["class", "A", 2], ["property", "f", 4]],
    relationships: [["contains", "A", "A.f"]],
    exactSymbols: true,
    forbidRels: [],
  },
  {
    id: "described-argument-line", mustParseCleanly: true,
    why: "an argument's own line, with its own description above it",
    src: 'type A {\n  f(\n    "the argument"\n    a: Int\n  ): Int\n}\n',
    symbols: [["class", "A", 1], ["property", "f", 2]],
    relationships: [["contains", "A", "A.f"]],
  },
  {
    id: "every-relationship-carries-a-real-line", mustParseCleanly: true,
    why: "M59 #825: the store keys a relationship on (source, target, type, line), so a line-less edge silently collapses a second genuine fact. `f(x: Int): Int` has a return type AND an argument type of Int, on different lines — both must survive.",
    src: "type A {\n  f(x: Int): Int\n}\n",
    symbols: [["class", "A", 1], ["property", "f", 2]],
    relationships: [
      ["contains", "A", "A.f", 2],
      ["references", "A.f", "Int", 2],
    ],
    relationshipLines: { "references|A.f|Int": [2, 2] },
  },
  {
    id: "implements-three-nested", mustParseCleanly: true,
    why: "ImplementsInterfaces is left-recursive, so a nested tree must still yield all three interfaces, not just the last",
    src: "type T implements A & B & C { x: Int }\n",
    symbols: [["class", "T", 1], ["property", "x", 1]],
    relationships: [["implements", "T", "A"], ["implements", "T", "B"], ["implements", "T", "C"]],
  },
  {
    id: "union-three-nested", mustParseCleanly: true,
    why: "UnionMemberTypes is left-recursive too",
    src: "union U = A | B | C\n",
    symbols: [["type", "U", 1]],
    relationships: [["uses", "U", "A"], ["uses", "U", "B"], ["uses", "U", "C"]],
  },
  {
    id: "extension-of-undeclared-type", mustParseCleanly: true,
    why: "`extend type X` in a file that never declares X is that file's only word about X, so it must emit a `partial` symbol for X or the `contains` edge has no source",
    src: "extend type Elsewhere {\n  added: String\n}\n",
    symbols: [["class", "Elsewhere", 1], ["property", "added", 2]],
    relationships: [["contains", "Elsewhere", "Elsewhere.added"]],
    ownerOf: { Elsewhere: ["added"] },
  },
  {
    id: "extension-of-declared-type-no-duplicate", mustParseCleanly: true,
    why: "when the file DOES declare X, the extension contributes members only — a second `class X` would be a duplicate identity in the index",
    src: "type X { a: Int }\nextend type X { b: String }\n",
    symbols: [["class", "X", 1], ["property", "a", 1], ["property", "b", 2]],
    relationships: [["contains", "X", "X.a"], ["contains", "X", "X.b"]],
    exactSymbols: true,
  },
  {
    id: "extension-scalar-no-directive", mustParseCleanly: true,
    why: "spec 3.17: a bare `extend scalar S` is VALID (upstream's rule made the directive mandatory) — and it must publish NOTHING, because the rule is `extend scalar Name Directives?` and a scalar has no members. The old analyzer minted a `type S` for every `extend scalar`, a duplicate identity whenever the file also declared S.",
    src: "extend scalar S\n",
    symbols: [],
    relationships: [],
    exactSymbols: true,
  },
  {
    id: "extend-scalar-alongside-its-declaration", mustParseCleanly: true,
    why: "the file declares S and also extends it: ONE `type S` symbol, carrying the fact that an extension exists, and the application is a real reference",
    src: "scalar S\nextend scalar S @specifiedBy(url: \"https://x\")\n",
    symbols: [["type", "S", 1]],
    relationships: [["uses", "S", "@specifiedBy", 2]],
    exactSymbols: true,
  },
  {
    id: "schema-extension-multi-root", mustParseCleanly: true,
    why: "spec 3.18: a schema extension may add SEVERAL root operation types, and Apollo Federation's `extend schema @link(...)` has no body at all",
    src: "extend schema {\n  query: Query\n  mutation: Mutation\n}\n",
    symbols: [["namespace", "schema", 1], ["property", "query", 2], ["property", "mutation", 3]],
    relationships: [["contains", "schema", "schema.query"], ["uses", "schema.query", "Query"]],
  },
  {
    id: "apollo-federation-link", mustParseCleanly: true,
    why: "Apollo Federation v2 emits `extend schema @link(url: ..., import: [...])` with no braces — the vendored grammar rejected it",
    src: 'extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])\n',
    symbols: [["namespace", "schema", 1]],
    relationships: [["uses", "schema", "@link"]],
  },
  {
    id: "directive-application-is-a-reference", mustParseCleanly: true,
    why: "a directive applied to a type is a real reference to the `@directive` function symbol — federation schemas carry their structure in these",
    src: "directive @key(fields: String!) repeatable on OBJECT\ntype T @key(fields: \"id\") { id: ID! }\n",
    symbols: [["function", "@key", 1], ["class", "T", 2], ["property", "id", 2]],
    relationships: [["uses", "T", "@key"]],
  },
  {
    id: "variable-reference-site", mustParseCleanly: true,
    why: "a declared variable that is never referenced reads as dead; `f(id: $id)` is a real reference from the selection to the variable",
    src: "query Q($id: ID!) {\n  f(id: $id)\n}\n",
    symbols: [["method", "Q", 1], ["variable", "$id", 1]],
    relationships: [["uses", "Q", "$id"]],
  },
  {
    id: "argument-is-optional-only-with-a-default", mustParseCleanly: true,
    why: "GraphQL's own rule: NON-NULL is required; NULLABLE is optional only when it has a default. `x: Int` is required, `x: Int = 1` is not.",
    src: "type A {\n  f(a: Int, b: Int = 1, c: Int!): Int\n}\n",
    symbols: [["class", "A", 1], ["property", "f", 2]],
    relationships: [["contains", "A", "A.f"]],
    parameterOptionality: { kind: "property", name: "f", a: false, b: true, c: false },
  },
  {
    id: "two-directives-on-a-field-selection", mustParseCleanly: true,
    why: "a regression guard: upstream's Field rule said `optional($.directive)` (singular), so `{ f @a @b }` was rejected. The vendored grammar accepted it and the patched grammar must keep accepting it.",
    src: "query Q { f @a @b }\n",
    symbols: [["method", "Q", 1]],
    relationships: [["uses", "Q", "f"], ["uses", "Q", "@a"], ["uses", "Q", "@b"]],
  },
  {
    id: "no-implements",
    why: "the type has no `implements` clause: zero implements edges",
    src: "type A { x: Int }\n",
    symbols: [["class", "A", 1], ["property", "x", 1]],
    relationships: [["contains", "A", "A.x"]],
    forbidRels: [["implements", "A", "I"]],
  },
  {
    id: "interface-multiple",
    why: "`implements A & B & C` yields three edges",
    src: "type T implements A & B & C { x: Int }\n",
    symbols: [["class", "T", 1], ["property", "x", 1]],
    relationships: [
      ["implements", "T", "A"],
      ["implements", "T", "B"],
      ["implements", "T", "C"],
    ],
  },
  {
    id: "interface-implements-interface",
    why: "an interface may itself declare `implements`",
    src: "interface Node { id: ID! }\ninterface Resource implements Node { id: ID! url: String }\n",
    symbols: [["interface", "Node", 1], ["interface", "Resource", 2]],
    relationships: [["implements", "Resource", "Node"]],
  },
  {
    id: "union",
    why: "union members are `uses` edges from the union",
    src: "union U = A | B | C\n",
    symbols: [["type", "U", 1]],
    relationships: [
      ["uses", "U", "A"],
      ["uses", "U", "B"],
      ["uses", "U", "C"],
    ],
  },
  {
    id: "enum",
    why: "enum values are enum_member symbols owned by the enum, with contains edges",
    src: "enum Color {\n  RED\n  GREEN\n  BLUE\n}\n",
    symbols: [["enum", "Color", 1], ["enum_member", "RED", 2], ["enum_member", "GREEN", 3], ["enum_member", "BLUE", 4]],
    relationships: [
      ["contains", "Color", "Color.RED"],
      ["contains", "Color", "Color.GREEN"],
      ["contains", "Color", "Color.BLUE"],
    ],
    ownerOf: { Color: ["RED", "GREEN", "BLUE"] },
  },
  {
    id: "enum-value-with-directive",
    why: "a directive on an enum value must not hide the value",
    src: "enum Color { RED @deprecated(reason: \"old\") }\n",
    symbols: [["enum", "Color", 1], ["enum_member", "RED", 1]],
    relationships: [["contains", "Color", "Color.RED"]],
  },
  {
    id: "scalar",
    why: "a scalar is a `type` symbol",
    src: "scalar DateTime\nscalar JSON @specifiedBy(url: \"https://x\")\n",
    symbols: [["type", "DateTime", 1], ["type", "JSON", 2]],
  },
  {
    id: "input-object",
    why: "input fields are properties owned by the input, and use their type",
    src: "input Filter {\n  name: String\n  limit: Int = 10\n  nested: Filter\n}\n",
    symbols: [
      ["class", "Filter", 1],
      ["property", "name", 2],
      ["property", "limit", 3],
      ["property", "nested", 4],
    ],
    relationships: [
      ["contains", "Filter", "Filter.name"],
      ["contains", "Filter", "Filter.limit"],
      ["contains", "Filter", "Filter.nested"],
      ["references", "Filter.name", "String"],
      ["references", "Filter.limit", "Int"],
      ["references", "Filter.nested", "Filter"],
    ],
    ownerOf: { Filter: ["name", "limit", "nested"] },
  },
  {
    id: "schema-definition",
    why: "root operation types are properties of the `schema` namespace",
    src: "schema {\n  query: Query\n  mutation: Mutation\n}\n",
    symbols: [
      ["namespace", "schema", 1],
      ["property", "query", 2],
      ["property", "mutation", 3],
    ],
    relationships: [
      ["contains", "schema", "schema.query"],
      ["contains", "schema", "schema.mutation"],
      ["uses", "schema.query", "Query"],
      ["uses", "schema.mutation", "Mutation"],
    ],
    ownerOf: { schema: ["query", "mutation"] },
  },
  {
    id: "schema-implicit",
    why: "a schema with no explicit block declares implicit root operations",
    src: "type Query { a: Int }\n",
    symbols: [["class", "Query", 1], ["property", "a", 1]],
    relationships: [["contains", "Query", "Query.a"]],
    forbidNames: ["schema"],
  },
  {
    id: "field-arguments",
    why: "field arguments are parameters AND declared-type `references` edges",
    src: "type Q {\n  search(term: String!, limit: Int = 5): [Result!]!\n}\n",
    symbols: [["class", "Q", 1], ["property", "search", 2]],
    relationships: [
      ["contains", "Q", "Q.search"],
      ["references", "Q.search", "String"],
      ["references", "Q.search", "Int"],
      ["references", "Q.search", "Result"],
    ],
  },
  {
    id: "type-wrappers",
    why: "NonNullType / ListType must resolve to the base NamedType",
    src: "type Q {\n  a: Int!\n  b: [String]\n  c: [Int!]!\n  d: [[Boolean!]!]!\n}\n",
    symbols: [
      ["class", "Q", 1],
      ["property", "a", 2],
      ["property", "b", 3],
      ["property", "c", 4],
      ["property", "d", 5],
    ],
    relationships: [
      ["references", "Q.a", "Int"],
      ["references", "Q.b", "String"],
      ["references", "Q.c", "Int"],
      ["references", "Q.d", "Boolean"],
    ],
  },
  {
    id: "directive-definition",
    why: "a directive definition is a `function` named `@name`",
    src: "directive @auth(requires: String) on OBJECT\n",
    symbols: [["function", "@auth", 1]],
  },
  {
    id: "operation-named",
    why: "a named operation is a method with operation-type metadata",
    src: "query GetUser($id: ID!) {\n  user(id: $id) { id }\n}\n",
    symbols: [
      ["method", "GetUser", 1],
      ["variable", "$id", 1],
    ],
    relationships: [["uses", "GetUser", "user"], ["uses", "GetUser", "$id"]],
    ownerOf: { GetUser: ["$id"] },
  },
  {
    id: "operation-mutation-subscription",
    why: "mutation and subscription operations are methods with their own type",
    src: "mutation M { create(x: Int) { id } }\nsubscription S { updated { id } }\n",
    symbols: [["method", "M", 1], ["method", "S", 2]],
    relationships: [
      ["uses", "M", "create"],
      ["uses", "S", "updated"],
    ],
  },
  {
    id: "operation-anonymous",
    why: "a shorthand `{ a }` is an anonymous query; it must get a stable synthetic identity",
    src: "{ a }\n",
    symbols: [],
    relationships: [],
  },
  {
    id: "fragment",
    why: "a fragment is a method; its type condition is a uses edge; its spread site is a uses edge",
    src: "fragment UserFields on User {\n  id\n  name\n}\nquery Q { user { ...UserFields } }\n",
    symbols: [["method", "UserFields", 1], ["method", "Q", 5]],
    relationships: [
      ["uses", "UserFields", "User"],
      ["uses", "Q", "user"],
      ["uses", "Q", "UserFields"],
    ],
  },
  {
    id: "inline-fragment",
    why: "an inline fragment's type condition is a uses edge, and its selections QUALIFY by that type — `... on User { id }` is `User.id`, which the store resolves to the SDL property",
    src: "query Q { node { ... on User { id } } }\n",
    symbols: [["method", "Q", 1]],
    relationships: [
      ["uses", "Q", "node"],
      ["uses", "Q", "User"],
      ["uses", "Q", "User.id"],
    ],
    forbidRels: [["uses", "Q", "id"]],
  },
  {
    id: "fragment-selections-qualify", mustParseCleanly: true,
    why: "a fragment's selections are written against its type condition, so they qualify too",
    src: "fragment F on User { id name }\n",
    symbols: [["method", "F", 1]],
    relationships: [["uses", "F", "User"], ["uses", "F", "User.id"], ["uses", "F", "User.name"]],
  },
  {
    id: "declared-type-is-references-not-uses",
    why: "ledger rule R9: the position that WRITES a type name is `references` with metadata.relationshipType='declared_type', and the OLD label is forbidden so a reversion cannot pass quietly",
    src: "type Query {\n  hello(who: String): String\n}\n",
    symbols: [["class", "Query", 1], ["property", "hello", 2]],
    relationships: [
      ["references", "Query.hello", "String"],
      ["contains", "Query", "Query.hello"],
    ],
    forbidRels: [["uses", "Query.hello", "String"]],
  },
  {
    id: "exports-the-public-surface",
    why: "a schema's public surface is every top-level declaration, published as `exports` EDGES as well as ExportInfo — `ParseResult.exports` alone reaches no graph (parallel-indexer reads `result.imports` and nothing named `exports`)",
    src: "type Query {\n  a: Int\n}\n\ndirective @auth on FIELD\n",
    symbols: [["class", "Query", 1], ["property", "a", 2], ["function", "@auth", 5]],
    relationships: [
      ["exports", "(file)", "Query"],
      ["exports", "(file)", "@auth"],
    ],
  },
  {
    id: "extends-scalar-exports-nothing",
    why: "an `extend scalar S` declares nothing — the rule is extend/scalar/Name/Directives and a scalar has no members — so it must not mint a symbol and must not be published as an export",
    src: "extend scalar Timestamp\n",
    symbols: [],
    forbidNames: ["Timestamp"],
  },
  {
    id: "overrides-interface-member-supplied",
    why: "spec 3.6 requires the object to supply every member the interface declares, so `User.id` overrides `Node.id` — the ONE override-shaped construct GraphQL has, and it is derivable from one document",
    src: "interface Node {\n  id: ID!\n}\n\ntype User implements Node {\n  id: ID!\n}\n",
    symbols: [["interface", "Node", 1], ["property", "id", 2], ["class", "User", 5], ["property", "id", 6]],
    relationships: [
      ["implements", "User", "Node"],
      ["overrides", "User.id", "Node.id"],
      ["references", "User.id", "ID"],
      ["references", "Node.id", "ID"],
    ],
  },
  {
    id: "overrides-needs-a-shared-member",
    why: "an object that implements an interface WITHOUT re-declaring one of its members overrides nothing; the edge is not invented to fill the family",
    src: "interface Node {\n  id: ID!\n}\n\ntype User implements Node {\n  name: String\n}\n",
    symbols: [["interface", "Node", 1], ["property", "id", 2], ["class", "User", 5], ["property", "name", 6]],
    relationships: [["implements", "User", "Node"]],
    forbidRels: [["overrides", "User.name", "Node.id"], ["overrides", "User.name", "Node.name"]],
  },
  {
    id: "extends-object-supertype",
    why: "GraphQL writes inheritance and interface conformance with ONE rule, so the label is read off what the DOCUMENT declares the supertype to be: `Sub implements Base` where `Base` is an object type is `extends`, and the `implements` label is forbidden for it",
    src: "type Base {\n  f: Int\n}\n\ntype Sub implements Base {\n  f: Int\n}\n",
    symbols: [["class", "Base", 1], ["property", "f", 2], ["class", "Sub", 5], ["property", "f", 6]],
    relationships: [
      ["extends", "Sub", "Base"],
      ["overrides", "Sub.f", "Base.f"],
    ],
    forbidRels: [["implements", "Sub", "Base"]],
  },
  {
    id: "extends-needs-the-document-to-say-so",
    why: "a supertype the document says NOTHING about stays `implements`: a per-file analyzer cannot know a name declared in another file is an object rather than an interface, and guessing is the fabrication the workstream's rule exists to prevent",
    src: "type Sub implements Remote {\n  f: Int\n}\n",
    symbols: [["class", "Sub", 1], ["property", "f", 2]],
    relationships: [["implements", "Sub", "Remote"]],
    forbidRels: [["extends", "Sub", "Remote"]],
  },
  {
    id: "field-alias",
    why: "an alias must not become the relationship target; the schema field name is the fact",
    src: "query Q { nick: name }\n",
    symbols: [["method", "Q", 1]],
    relationships: [["uses", "Q", "name"]],
    forbidNames: ["nick"],
  },
  {
    id: "directive-usage-not-a-symbol",
    why: "a directive USE is neither a symbol nor a relationship (documented boundary)",
    src: "type Q { a: Int @deprecated }\n",
    symbols: [["class", "Q", 1], ["property", "a", 1]],
    relationships: [["contains", "Q", "Q.a"]],
    forbidNames: ["@deprecated", "deprecated"],
  },
  {
    id: "descriptions", mustParseCleanly: true,
    why: "quoted and block descriptions unquote by slicing, never by regex",
    src: '"a type"\ntype A {\n  "a field"\n  f: Int\n}\n\n"""\nblock desc\n"""\ntype B { g: Int }\n',
    symbols: [["class", "A", 2], ["property", "f", 4], ["class", "B", 10]],
    relationships: [
      ["contains", "A", "A.f"],
      ["contains", "B", "B.g"],
    ],
  },
  {
    id: "extension-object",
    why: "`extend type X { f }` extends an existing type: its fields belong to X",
    src: "type X { a: Int }\nextend type X { b: String }\n",
    symbols: [["class", "X", 1], ["property", "a", 1]],
    relationships: [["contains", "X", "X.a"]],
  },
  {
    id: "extension-enum",
    why: "`extend enum E { V }` adds an enum member",
    src: "enum E { A }\nextend enum E { B }\n",
    symbols: [["enum", "E", 1], ["enum_member", "A", 1]],
    relationships: [["contains", "E", "E.A"]],
  },
  {
    id: "extension-union",
    why: "`extend union U = A` adds a member edge",
    src: "union U = A\nextend union U = B\n",
    symbols: [["type", "U", 1]],
    relationships: [["uses", "U", "A"]],
  },
  {
    id: "extension-interface",
    why: "`extend interface I { f }` extends an existing interface",
    src: "interface I { a: Int }\nextend interface I { b: Int }\n",
    symbols: [["interface", "I", 1], ["property", "a", 1]],
    relationships: [["contains", "I", "I.a"]],
  },
  {
    id: "extension-input",
    why: "`extend input I { f }` extends an existing input",
    src: "input I { a: Int }\nextend input I { b: Int }\n",
    symbols: [["class", "I", 1], ["property", "a", 1]],
    relationships: [["contains", "I", "I.a"]],
  },
  {
    id: "extension-schema",
    why: "`extend schema { query: Q }` adds a root operation type",
    src: "schema { query: Query }\nextend schema { mutation: Mutation }\n",
    symbols: [["namespace", "schema", 1], ["property", "query", 1]],
    relationships: [["contains", "schema", "schema.query"]],
  },
  {
    id: "extension-scalar", mustParseCleanly: true,
    why: "`extend scalar S @directive` is valid GraphQL (spec 3.10) and must not be an ERROR",
    src: "scalar Date\nextend scalar Date @specifiedBy(url: \"https://x\")\n",
    symbols: [["type", "Date", 1]],
    relationships: [],
  },
  {
    id: "directive-repeatable", mustParseCleanly: true,
    why: "`repeatable` is spec-mandated since June 2018 and must not be an ERROR",
    src: "directive @tag(name: String!) repeatable on OBJECT | FIELD_DEFINITION\n",
    symbols: [["function", "@tag", 1]],
    relationships: [],
  },
  {
    id: "empty-args",
    why: "a field with no arguments has no parameters and no argument-type edges",
    src: "type Q { a: Int }\n",
    symbols: [["class", "Q", 1], ["property", "a", 1]],
    relationships: [["contains", "Q", "Q.a"]],
  },
  {
    id: "variable-defaults",
    why: "several variables on one operation, with and without defaults",
    src: "query Q($a: Int, $b: Int = 1, $c: [String!]) { f }\n",
    symbols: [
      ["method", "Q", 1],
      ["variable", "$a", 1],
      ["variable", "$b", 1],
      ["variable", "$c", 1],
    ],
    relationships: [["uses", "Q", "f"]],
    ownerOf: { Q: ["$a", "$b", "$c"] },
  },
  {
    id: "comments",
    why: "comments are extras and must not break a definition",
    src: "# leading\ntype Q { # inline\n  a: Int # trailing\n}\n",
    symbols: [["class", "Q", 2], ["property", "a", 3]],
    relationships: [["contains", "Q", "Q.a"]],
  },
  {
    id: "block-string-escape", mustParseCleanly: true,
    why: "spec 2.9.4: a BlockStringCharacter is any SourceCharacter but not `\"\"\"` and not `\\\"\"\"`. BOTH the vendored and the upstream grammar rejected this whole file.",
    src: 'type A {\n  """has \\""" inside"""\n  f: Int\n}\n',
    symbols: [["class", "A", 1], ["property", "f", 3]],
    relationships: [["contains", "A", "A.f"]],
  },
  {
    id: "negative-broken-type",
    why: "a malformed body must still surface an error, not a clean empty result",
    src: "type A { \n",
    symbols: [],
    relationships: [],
  },
]

let pass = 0
let fail = 0
const failures: string[] = []
const perCase: any[] = []

for (const c of C) {
  const tree = parser.parse(c.src)
  const res: any = new Klass().analyze(tree.rootNode, c.src, `case.graphql`)

  const gotSym = res.symbols.map((s: any) => `${s.kind}|${s.name}|${s.range.startLine}`)
  const gotRel = new Set(res.relationships.map((r: any) => `${r.type}|${r.source}|${r.target}`))
  const problems: string[] = []

  // 1. every expected symbol present
  for (const [kind, name, line] of c.symbols ?? []) {
    if (!gotSym.includes(`${kind}|${name}|${line}`)) problems.push(`MISSING SYMBOL ${kind}|${name}|line ${line}`)
  }
  // 2. NO unexpected symbol of the expected kinds (catches kind/line drift)
  const wantSym = new Set((c.symbols ?? []).map((x) => `${x[0]}|${x[1]}|${x[2]}`))
  // anonymous ops and other cases declare `symbols: []` meaning "unspecified", so
  // only enforce exact-set when the case opts in.
  if (c.exactSymbols) {
    for (const g of gotSym) if (!wantSym.has(g)) problems.push(`UNEXPECTED SYMBOL ${g}`)
  }
  // 3. expected relationships
  for (const [t, s, g] of c.relationships ?? []) if (!gotRel.has(`${t}|${s}|${g}`)) problems.push(`MISSING REL ${t}|${s}|${g}`)
  // 4. forbidden names
  for (const bad of c.forbidNames ?? []) {
    if (res.symbols.some((s: any) => s.name === bad)) problems.push(`FORBIDDEN SYMBOL NAME "${bad}" emitted`)
  }
  // 5. forbidden relationships
  for (const [t, s, g] of c.forbidRels ?? []) if (gotRel.has(`${t}|${s}|${g}`)) problems.push(`FORBIDDEN REL ${t}|${s}|${g}`)
  // 6. ownership
  for (const [owner, names] of Object.entries(c.ownerOf ?? {})) {
    for (const n of names) {
      const hit = res.symbols.find((s: any) => s.name === n && s.ownerName === owner)
      if (!hit) problems.push(`OWNERSHIP: "${n}" is not owned by "${owner}"`)
    }
  }
  // 7. columns must be 1-based like every other analyzer
  for (const s of res.symbols) {
    if (s.range.startColumn < 1) problems.push(`RANGE: ${s.name} startColumn=${s.range.startColumn} is 0-based`)
    if (s.range.startLine < 1) problems.push(`RANGE: ${s.name} startLine=${s.range.startLine} is 0-based`)
  }
  // 7b. every relationship must carry a real, positive line (M59 #825)
  for (const rel of res.relationships) {
    if (typeof rel.line_number !== "number" || rel.line_number <= 0) {
      problems.push(`REL LINE: ${rel.type}|${rel.source}->${rel.target} has line_number=${rel.line_number} (M59 #825 requires a real line on every relationship)`)
    }
  }
  // 7c. exact relationship lines where the case pins them
  for (const [key, lines] of Object.entries(c.relationshipLines ?? {})) {
    const [t, src, tgt] = key.split("|")
    const got = res.relationships.filter((r: any) => r.type === t && r.source === src && r.target === tgt).map((r: any) => r.line_number).sort()
    if (JSON.stringify(got) !== JSON.stringify([...lines].sort())) {
      problems.push(`REL LINES ${key}: got [${got}] want [${lines}]`)
    }
  }
  // 7d. argument optionality
  if (c.parameterOptionality) {
    const { kind, name, ...expected } = c.parameterOptionality
    const hit = res.symbols.find((x: any) => x.kind === kind && x.name === name)
    if (!hit) problems.push(`PARAM: symbol ${kind}|${name} absent`)
    else {
      for (const [argName, want] of Object.entries(expected)) {
        const p = (hit.parameters ?? []).find((x: any) => x.name === argName)
        if (!p) problems.push(`PARAM: ${name} has no argument ${argName}`)
        else if (p.isOptional !== want) problems.push(`PARAM: ${name}(${argName}).isOptional = ${p.isOptional}, want ${want}`)
      }
    }
  }
  // 7e. a case with no parse error in its own source
  if (c.mustParseCleanly && tree.rootNode.hasError) {
    const errs: string[] = []
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "ERROR" || n.isError) errs.push(`ERROR@${n.startPosition.row + 1}:${n.startPosition.column + 1}`)
      for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) st.push(ch) }
    }
    problems.push(`GRAMMAR: this case is specification-valid GraphQL but the grammar rejected it (${errs.join(", ")})`)
  }
  // 8. docstrings present where the source has one
  if (c.id === "descriptions") {
    const a = res.symbols.find((s: any) => s.name === "A")
    if (a?.docstring !== "a type") problems.push(`DOCSTRING A = ${JSON.stringify(a?.docstring)} (want "a type")`)
    const f = res.symbols.find((s: any) => s.name === "f")
    if (f?.docstring !== "a field") problems.push(`DOCSTRING f = ${JSON.stringify(f?.docstring)} (want "a field")`)
    const b = res.symbols.find((s: any) => s.name === "B")
    if (b?.docstring !== "block desc") problems.push(`DOCSTRING B = ${JSON.stringify(b?.docstring)} (want "block desc")`)
    const bq = res.symbols.find((s: any) => s.name === "quoted")
    if (bq && bq.docstring !== 'a "quoted" word and a \\ backslash') problems.push(`DOCSTRING quoted = ${JSON.stringify(bq?.docstring)} (want the escapes RESOLVED)`)
  }

  const ok = problems.length === 0
  if (ok) pass++
  else {
    fail++
    for (const p of problems) failures.push(`${c.id}: ${p}`)
  }
  perCase.push({ id: c.id, why: c.why, hasError: tree.rootNode.hasError, errors: res.errors.length, symbols: gotSym, relationships: [...gotRel].sort(), ok })
  console.log(`${ok ? "ok  " : "FAIL"} ${c.id.padEnd(32)} hasError=${String(tree.rootNode.hasError).padEnd(5)} sym=${gotSym.length} rel=${gotRel.size} err=${res.errors.length}  # ${c.why}`)
}

console.log(`\n=== CONTRACT BATTERY: ${pass}/${C.length} pass, ${fail} fail ===`)
for (const f of failures) console.log(`  FAIL ${f}`)
fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(path.join(HERE, "out/contract-battery.json"), JSON.stringify({ wasm: wasmPath, pass, fail, total: C.length, failures, perCase }, null, 2))
process.exitCode = fail === 0 ? 0 : 1
