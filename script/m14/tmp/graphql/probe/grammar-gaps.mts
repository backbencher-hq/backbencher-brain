/**
 * GraphQL GRAMMAR GAP BATTERY.
 *
 * One entry per construct the GraphQL specification (October 2021) defines or
 * that real-world dialects (Apollo Federation, Relay, Hasura, neo4j) emit. Each
 * entry records whether the construct is VALID GraphQL, so a failure can be
 * classified as a GRAMMAR GAP (valid but rejected) or as CORRECT REJECTION
 * (invalid, and the grammar is right to say so).
 *
 * A grammar that rejects a construct the spec defines is a defect the ANALYZER
 * cannot fix: the symbol simply does not exist in the tree. Those are the rows
 * that justify a grammar port.
 */
import * as fs from "fs"
import * as path from "path"
import { HERE, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const vendored: any = await Language.load(fs.readFileSync(process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")))
const pV = new ParserClass()
pV.setLanguage(vendored)
const LABEL_A = process.env.GQL_LABEL_A ?? "A"
const LABEL_B = process.env.GQL_LABEL_B ?? "B"

let candidate: any = null
try {
  candidate = await Language.load(fs.readFileSync(path.join(HERE, "grammar-rebuild/tree-sitter-graphql-head.wasm")))
} catch {
  /* optional */
}
const pC = candidate ? new ParserClass() : null
if (pC && candidate) pC.setLanguage(candidate)

interface G {
  id: string
  spec: string
  valid: boolean
  src: string
}

const GAPS: G[] = [
  // ---- spec: type system -------------------------------------------------
  { id: "object-minimal", spec: "3.6", valid: true, src: "type T\n" },
  { id: "object-no-body", spec: "3.6 FieldsDefinition optional", valid: true, src: "type T @dir\n" },
  { id: "object-fields", spec: "3.6", valid: true, src: "type T { a: Int }\n" },
  { id: "interface-minimal", spec: "3.7", valid: true, src: "interface I\n" },
  { id: "interface-implements", spec: "3.7 (June 2018: interfaces may implement interfaces)", valid: true, src: "interface I implements J { a: Int }\n" },
  { id: "interface-implements-multi", spec: "3.7", valid: true, src: "interface I implements A & B { a: Int }\n" },
  { id: "interface-implements-leading-amp", spec: "3.7", valid: true, src: "interface I implements & A { a: Int }\n" },
  { id: "union-minimal", spec: "3.10", valid: true, src: "union U\n" },
  { id: "union-members", spec: "3.10", valid: true, src: "union U = A | B\n" },
  { id: "union-leading-pipe", spec: "3.10 (leading `|` is legal)", valid: true, src: "union U = | A | B\n" },
  { id: "enum-minimal", spec: "3.9", valid: true, src: "enum E\n" },
  { id: "enum-values", spec: "3.9", valid: true, src: "enum E { A B }\n" },
  { id: "enum-leading-comma", spec: "3.9", valid: true, src: "enum E { A, B }\n" },
  { id: "scalar-minimal", spec: "3.5", valid: true, src: "scalar S\n" },
  { id: "input-minimal", spec: "3.10", valid: true, src: "input I\n" },
  { id: "input-fields", spec: "3.10", valid: true, src: "input I { a: Int }\n" },
  { id: "schema-full", spec: "3.2.1", valid: true, src: "schema { query: Q mutation: M subscription: S }\n" },
  { id: "schema-query-only", spec: "3.2.1", valid: true, src: "schema { query: Q }\n" },
  { id: "directive-def", spec: "3.13", valid: true, src: "directive @a on FIELD\n" },
  { id: "directive-def-args", spec: "3.13", valid: true, src: "directive @a(x: Int = 1, y: [String!]! = [\"a\"]) on FIELD\n" },
  { id: "directive-def-repeatable", spec: "3.13 (June 2018)", valid: true, src: "directive @a repeatable on FIELD\n" },
  { id: "directive-def-multi-location", spec: "3.13", valid: true, src: "directive @a on FIELD | OBJECT | QUERY\n" },
  { id: "directive-def-leading-pipe", spec: "3.13", valid: true, src: "directive @a on | FIELD | OBJECT\n" },
  { id: "directive-def-all-locations", spec: "3.13 (all 18 locations)", valid: true, src: "directive @a on QUERY | MUTATION | SUBSCRIPTION | FIELD | FRAGMENT_DEFINITION | FRAGMENT_SPREAD | INLINE_FRAGMENT | VARIABLE_DEFINITION | SCHEMA | SCALAR | OBJECT | FIELD_DEFINITION | ARGUMENT_DEFINITION | INTERFACE | UNION | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION\n" },
  // ---- spec: extensions --------------------------------------------------
  { id: "ext-schema-one", spec: "3.18", valid: true, src: "extend schema { query: Q }\n" },
  { id: "ext-schema-multi", spec: "3.18 (a schema extension may add several root types)", valid: true, src: "extend schema { query: Q mutation: M }\n" },
  { id: "ext-schema-directives-only", spec: "3.18", valid: true, src: "extend schema @dir\n" },
  { id: "ext-type-fields", spec: "3.17", valid: true, src: "extend type T { a: Int }\n" },
  { id: "ext-type-implements", spec: "3.17", valid: true, src: "extend type T implements A & B { a: Int }\n" },
  { id: "ext-type-no-body", spec: "3.17", valid: true, src: "extend type T @dir\n" },
  { id: "ext-interface", spec: "3.17", valid: true, src: "extend interface I { a: Int }\n" },
  { id: "ext-interface-implements", spec: "3.17", valid: true, src: "extend interface I implements J { a: Int }\n" },
  { id: "ext-union", spec: "3.17", valid: true, src: "extend union U = A\n" },
  { id: "ext-union-no-members", spec: "3.17", valid: true, src: "extend union U @dir\n" },
  { id: "ext-enum", spec: "3.17", valid: true, src: "extend enum E { A }\n" },
  { id: "ext-enum-no-values", spec: "3.17", valid: true, src: "extend enum E @dir\n" },
  { id: "ext-input", spec: "3.17", valid: true, src: "extend input I { a: Int }\n" },
  { id: "ext-input-no-fields", spec: "3.17", valid: true, src: "extend input I @dir\n" },
  { id: "ext-scalar", spec: "3.17 (extend scalar exists since June 2018)", valid: true, src: "extend scalar S\n" },
  { id: "ext-scalar-directive", spec: "3.17", valid: true, src: "extend scalar S @specifiedBy(url: \"https://x\")\n" },
  // ---- spec: descriptions ------------------------------------------------
  { id: "desc-on-type", spec: "3.1", valid: true, src: "\"d\"\ntype T { a: Int }\n" },
  { id: "desc-on-field", spec: "3.1", valid: true, src: "type T {\n  \"d\"\n  a: Int\n}\n" },
  { id: "desc-block", spec: "2.9.4", valid: true, src: "\"\"\"\nd\n\"\"\"\ntype T { a: Int }\n" },
  { id: "desc-on-arg", spec: "3.1", valid: true, src: "type T { f(\"d\" a: Int): Int }\n" },
  { id: "desc-on-input-field", spec: "3.1", valid: true, src: "input I { \"d\" a: Int }\n" },
  { id: "desc-on-enum-value", spec: "3.1", valid: true, src: "enum E { \"d\" A }\n" },
  { id: "desc-on-directive-def", spec: "3.1", valid: true, src: "\"d\"\ndirective @a on FIELD\n" },
  { id: "desc-on-schema", spec: "3.1", valid: true, src: "\"d\"\nschema { query: Q }\n" },
  { id: "desc-block-escaped-triple", spec: '2.9.4 (BlockString allows an escaped \\""")', valid: true, src: '"""has \\""" inside"""\ntype T { a: Int }\n' },
  // ---- spec: types -------------------------------------------------------
  { id: "type-nonnull", spec: "3.4", valid: true, src: "type T { a: Int! }\n" },
  { id: "type-list", spec: "3.4", valid: true, src: "type T { a: [Int] }\n" },
  { id: "type-list-nonnull", spec: "3.4", valid: true, src: "type T { a: [Int!]! }\n" },
  { id: "type-nested-list", spec: "3.4", valid: true, src: "type T { a: [[Int!]!]! }\n" },
  { id: "type-default-int", spec: "3.10.1", valid: true, src: "input I { a: Int = 1 }\n" },
  { id: "type-default-neg-int", spec: "3.5.1", valid: true, src: "input I { a: Int = -1 }\n" },
  { id: "type-default-float", spec: "3.5.1", valid: true, src: "input I { a: Float = 1.5 }\n" },
  { id: "type-default-float-exp", spec: "3.5.1", valid: true, src: "input I { a: Float = 1e10 }\n" },
  { id: "type-default-string", spec: "3.5.1", valid: true, src: "input I { a: String = \"s\" }\n" },
  { id: "type-default-bool", spec: "3.5.1", valid: true, src: "input I { a: Boolean = true }\n" },
  { id: "type-default-null", spec: "3.5.1", valid: true, src: "input I { a: Int = null }\n" },
  { id: "type-default-enum", spec: "3.5.1", valid: true, src: "enum E { A }\ninput I { a: E = A }\n" },
  { id: "type-default-list", spec: "3.5.1", valid: true, src: "input I { a: [Int] = [1, 2] }\n" },
  { id: "type-default-list-empty", spec: "3.5.1", valid: true, src: "input I { a: [Int] = [] }\n" },
  { id: "type-default-object", spec: "3.5.1", valid: true, src: "input J { x: Int }\ninput I { a: J = {x: 1} }\n" },
  { id: "type-default-object-block-string", spec: "3.5.1", valid: true, src: "input I { a: String = \"\"\"\n  blk\n  \"\"\" }\n" },
  { id: "type-default-in-arg", spec: "3.5.1: an argument may carry a default", valid: true, src: "type T { f(a: Int = 1): Int }\n" },
  // ---- spec: executable --------------------------------------------------
  { id: "op-named", spec: "3.2", valid: true, src: "query Q { a }\n" },
  { id: "op-anonymous-shorthand", spec: "3.2.1 (shorthand)", valid: true, src: "{ a }\n" },
  { id: "op-anonymous-keyword", spec: "3.2.1", valid: true, src: "query { a }\n" },
  { id: "op-mutation", spec: "3.2", valid: true, src: "mutation M { a }\n" },
  { id: "op-subscription", spec: "3.2", valid: true, src: "subscription S { a }\n" },
  { id: "op-vars", spec: "3.2", valid: true, src: "query Q($a: Int, $b: String! = \"x\") { f }\n" },
  { id: "op-var-list", spec: "3.2", valid: true, src: "query Q($a: [Int!]! = [1]) { f }\n" },
  { id: "op-var-directive", spec: "3.2 (a variable definition may carry directives)", valid: true, src: "query Q($a: Int @dir) { f }\n" },
  { id: "op-trailing-comma-in-vars", spec: "3.2 (commas are insignificant)", valid: true, src: "query Q($a: Int, $b: Int,) { f }\n" },
  { id: "op-directives", spec: "3.2", valid: true, src: "query Q @a @b { f }\n" },
  { id: "field-alias", spec: "3.3", valid: true, src: "{ nick: name }\n" },
  { id: "field-args", spec: "3.3", valid: true, src: "{ f(a: 1, b: \"s\", c: true, d: null, e: ENUM, g: [1,2], h: {i: 1}, j: $v) }\n" },
  { id: "field-args-trailing-comma", spec: "3.3 (commas are insignificant)", valid: true, src: "{ f(a: 1,) }\n" },
  { id: "field-arg-var", spec: "3.3", valid: true, src: "query Q($v: Int) { f(a: $v) }\n" },
  { id: "field-one-directive", spec: "3.3", valid: true, src: "{ f @a }\n" },
  { id: "field-two-directives", spec: "3.3 (directives are repeatable at any position)", valid: true, src: "{ f @a @b }\n" },
  { id: "field-nested", spec: "3.3", valid: true, src: "{ a { b { c } } }\n" },
  { id: "field-comma-separated", spec: "3.3 (commas are insignificant)", valid: true, src: "{ a, b, c }\n" },
  { id: "frag-spread", spec: "3.5", valid: true, src: "query Q { ...F }\nfragment F on T { a }\n" },
  { id: "frag-spread-with-dir", spec: "3.5", valid: true, src: "query Q { ...F @include(if: true) }\nfragment F on T { a }\n" },
  { id: "frag-inline", spec: "3.5", valid: true, src: "{ ... on T { a } }\n" },
  { id: "frag-inline-no-type", spec: "3.5 (type condition is optional)", valid: true, src: "{ ... @skip(if: true) { a } }\n" },
  { id: "frag-inline-two-dirs", spec: "3.5", valid: true, src: "{ ... on T @a @b { a } }\n" },
  { id: "typename", spec: "2.3", valid: true, src: "{ __typename }\n" },
  { id: "multi-doc-one-file", spec: "concatenated documents", valid: true, src: "query A { a }\nquery B { b }\nfragment C on T { c }\n" },
  // ---- real-world dialects ----------------------------------------------
  { id: "apollo-key", spec: "Apollo Federation", valid: true, src: "type T @key(fields: \"id\") { id: ID! }\n" },
  { id: "apollo-external", spec: "Apollo Federation", valid: true, src: "type T @external { a: Int }\n" },
  { id: "apollo-requires", spec: "Apollo Federation", valid: true, src: "type T @requires(fields: \"a\") { a: Int @external }\n" },
  { id: "apollo-provides", spec: "Apollo Federation", valid: true, src: "type T @provides(fields: \"a\") { a: Int }\n" },
  { id: "apollo-inherits", spec: "Apollo Federation", valid: true, src: "type T @inherits(field: \"x\") { x: Int }\n" },
  { id: "apollo-shareable", spec: "Apollo Federation v2", valid: true, src: "type T @shareable { a: Int }\n" },
  { id: "apollo-link", spec: "Apollo Federation v2", valid: true, src: "extend schema @link(url: \"https://specs.apollo.dev/federation/v2.0\", import: [\"@key\"])\n" },
  { id: "relay-connection", spec: "Relay", valid: true, src: "type Q { things(first: Int, after: String): ThingConnection }\ntype ThingConnection { edges: [ThingEdge] pageInfo: PageInfo! }\n" },
  { id: "neo4j-cypher-directive", spec: "neo4j/graphql", valid: true, src: "type Movie @node(label: \"Movie\") { title: String @cypher(statement: \"RETURN m.title\") }\n" },
  { id: "hasura-column", spec: "Hasura", valid: true, src: "type User @table { id: uuid! @column(name: \"user_id\") }\n" },
  { id: "commas-everywhere", spec: "commas are insignificant", valid: true, src: "type T { a: Int, b: String, }\ninput I { x: Int, y: Int, }\nenum E { A, B, }\nunion U = A | B\n" },
  { id: "bom-and-crlf", spec: "whitespace forms", valid: true, src: "﻿type T {\r\n  a: Int\r\n}\r\n" },
  // ---- INVALID: the grammar MUST reject these ---------------------------
  { id: "INVALID-empty-object", spec: "3.6 (FieldsDefinition is +)", valid: false, src: "type T {}\n" },
  { id: "INVALID-empty-input", spec: "3.10", valid: false, src: "input I {}\n" },
  { id: "INVALID-empty-enum", spec: "3.9", valid: false, src: "enum E {}\n" },
  { id: "INVALID-empty-schema", spec: "3.2.1", valid: false, src: "schema {}\n" },
  { id: "INVALID-hex-int", spec: "3.5.1 IntValue is -?(0|[1-9][0-9]*)", valid: false, src: "input I { a: Int = 0x1F }\n" },
  { id: "INVALID-leading-zero", spec: "3.5.1", valid: false, src: "input I { a: Int = 01 }\n" },
  { id: "INVALID-unclosed-brace", spec: "syntax", valid: false, src: "type T {\n" },
  { id: "INVALID-missing-colon", spec: "3.6", valid: false, src: "type T { a Int }\n" },
  { id: "INVALID-dup-name", spec: "3.6 (parser cannot see; validator-only)", valid: true, src: "type T { a: Int a: String }\n" },
  { id: "INVALID-reserved-type-name", spec: "3.6 (validator-only)", valid: true, src: "type String { a: Int }\n" },
]

function errCount(parser: any, src: string) {
  const tree = parser.parse(src)
  let e = 0
  const st: any[] = [tree.rootNode]
  while (st.length) {
    const n = st.pop()
    if (n.type === "ERROR" || n.isError) e++
    if (n.isMissing) e++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) st.push(c)
    }
  }
  return { hasError: tree.rootNode.hasError, e }
}

const rows: any[] = []
let gap = 0
let wrongAccept = 0
let wrongReject = 0
for (const g of GAPS) {
  const v = errCount(pV, g.src)
  const c = pC ? errCount(pC, g.src) : null
  const rejected = v.hasError
  let verdict: string
  if (g.valid && rejected) {
    verdict = "GRAMMAR GAP (valid GraphQL rejected)"
    gap++
  } else if (!g.valid && !rejected) {
    verdict = "ACCEPTS INVALID (spec says reject; validator's job — noted, not a gap)"
    wrongAccept++
  } else if (!g.valid && rejected) {
    verdict = "correct rejection"
  } else {
    verdict = "ok"
  }
  // is the construct still REACHABLE even though the file errors? (partial parse)
  rows.push({ ...g, vendoredRejects: rejected, vendoredErrorNodes: v.e, candidateRejects: c ? c.hasError : null, verdict })
}

const gapRows = rows.filter((r) => r.valid && r.vendoredRejects)
const noGapRows = rows.filter((r) => r.candidateRejects === false)
console.log(`A=${LABEL_A}  B=${LABEL_B}`)
console.log(`constructs=${rows.length}  validGraphQLRejectedBy${LABEL_A}=${gap.length}  acceptsInvalid=${wrongAccept}  correctRejections=${rows.filter((r) => !r.valid && r.vendoredRejects).length}`)
console.log(`\n=== GRAMMAR GAPS: valid GraphQL ${LABEL_A} rejects (${gapRows.length}) ===`)
for (const r of gapRows) {
  const cf = r.candidateRejects === null ? "n/a" : r.candidateRejects ? `${LABEL_B}: STILL ERR` : `${LABEL_B}: accepts`
  console.log(`  ${r.id.padEnd(34)} spec ${r.spec.padEnd(48)} ${cf}`)
}
const reg = rows.filter((r) => !r.valid && !r.vendoredRejects)
if (reg.length) {
  console.log(`\n=== accepted although the spec says reject (${reg.length}) — validator territory, recorded not hidden ===`)
  for (const r of reg) console.log(`  ${r.id.padEnd(34)} ${r.spec}`)
}
const candGaps = rows.filter((r) => r.valid && r.candidateRejects)
if (candGaps.length) {
  console.log(`\n=== gaps ${LABEL_B} still has (${candGaps.length}) ===`)
  for (const r of candGaps) console.log(`  ${r.id.padEnd(34)} spec ${r.spec}`)
}
const candBreaks = rows.filter((r) => r.vendoredRejects === false && r.candidateRejects === true)
if (candBreaks.length) {
  console.log(`\n=== ${LABEL_A} accepts and ${LABEL_B} rejects (${candBreaks.length}) ===`)
  for (const r of candBreaks) console.log(`  ${r.id.padEnd(34)} spec ${r.spec}`)
}
fs.mkdirSync(path.join(HERE, "out"), { recursive: true })
fs.writeFileSync(path.join(HERE, "out/grammar-gaps.json"), JSON.stringify({ constructs: rows.length, validRejectedByVendored: gap.length, acceptsInvalid: wrongAccept, gaps: gapRows, rows }, null, 2))
process.exitCode = 0
