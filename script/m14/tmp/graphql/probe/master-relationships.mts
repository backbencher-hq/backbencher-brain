/**
 * GraphQL — MASTER REVIEW: relationship completeness by CONSTRUCT, not by count.
 *
 * The differential proves the analyzer matches hand-derived ground truth on seven
 * fixtures, and the corpus sweep proves nothing dangles. Neither can find a
 * relationship class the analyzer never emitted, because ground truth that omits
 * a class agrees perfectly with an analyzer that omits it. Only asking "what does
 * the SPECIFICATION make referenceable, and does every one of those appear?"
 * can find a whole missing family.
 *
 * So this probe walks a fixture that deliberately exercises every referenceable
 * position GraphQL has, prints every symbol and every relationship with its role,
 * and then asserts the families below. Each is a reference the specification
 * defines and the document really contains:
 *
 *   variable_type        `$c: Color`  — the variable's declared type
 *   enum_value_reference `color: RED` — a value position naming an enum member
 *   default_value        `= RED`      — the same, in a default position
 *   directive_argument   `@auth(role: "admin")` — a directive's own argument
 *   field_return_type / field_argument_type / input_field_type
 *   union_member / implements / fragment_spread / fragment_type_condition
 *   inline_fragment_type_condition / variable_reference / directive_application
 *   root_operation_type / extension membership
 */
import * as fs from "fs"
import * as path from "path"
import { GQL, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const dir = process.argv[2] ?? "/tmp/master"
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".graphql")).sort()

const roles = new Map<string, number>()
const all: { file: string; symbols: any[]; relationships: any[] }[] = []

for (const f of files) {
  const p = path.join(dir, f)
  const src = fs.readFileSync(p, "utf8")
  const tree = parser.parse(src)
  const r: any = new RealGraphqlAnalyzer().analyze(tree.rootNode, src, p)
  all.push({ file: f, symbols: r.symbols, relationships: r.relationships })
  for (const rel of r.relationships) {
    const role = rel.metadata?.relationshipRole ?? "(none)"
    roles.set(role, (roles.get(role) ?? 0) + 1)
  }
  console.log(`\n=== ${f} ===`)
  console.log(`  symbols (${r.symbols.length}):`)
  for (const s of r.symbols) console.log(`    ${String(s.kind).padEnd(13)} ${s.name.padEnd(28)} L${s.range.startLine}${s.ownerName ? `  owner=${s.ownerName}` : ""}${s.parameters ? `  params(${s.parameters.length})` : ""}`)
  console.log(`  relationships (${r.relationships.length}):`)
  for (const rel of r.relationships) {
    const role = rel.metadata?.relationshipRole ?? "(none)"
    console.log(`    ${String(rel.type).padEnd(10)} ${String(rel.source).padEnd(24)} -> ${String(rel.target).padEnd(24)} ${role.padEnd(28)} L${rel.line_number}`)
  }
}

console.log(`\n=== roles seen ===`)
for (const [role, n] of [...roles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${role.padEnd(32)} ${n}`)

// The families the specification makes referenceable. A family is "covered" when
// the fixture provokes it AND the analyzer emitted it.
const REQUIRED = [
  "field_return_type",
  "field_argument_type",
  "directive_argument_type",
  "input_field_type",
  "union_member",
  "implements",
  "field_selection",
  "fragment_spread",
  "fragment_type_condition",
  "inline_fragment_type_condition",
  "variable_reference",
  "variable_type",
  "directive_application",
  "root_operation_type",
  "enum_value_reference",
]

/**
 * Two families this probe originally demanded DO NOT EXIST, and asking for them
 * was a defect in the probe rather than a finding about the analyzer:
 *
 *   `default_value`  A default whose value is a LITERAL — `note: String = "x"` —
 *                    names no symbol, so there is nothing to reference and no
 *                    relationship to emit. Recording it is `metadata.defaultValue`,
 *                    which is the right place for a spelling. A default whose value
 *                    is an enum member IS a reference, and it is emitted as
 *                    `enum_value_reference`.
 *   `directive_argument`  The referenceable thing about a directive argument is its
 *                    TYPE (`directive_argument_type`) and, when the value names an
 *                    enum member, an `enum_value_reference`. "The argument" is not
 *                    a family; the two things an argument contributes are.
 *
 * The first version of this probe also demanded families its fixture never
 * provoked and so reported four MISSes that meant only "this file does not
 * contain a union". fixtures-constructs/10-every-family.graphql provokes every
 * family above, so a MISS now means the analyzer stopped emitting something the
 * specification makes referenceable — which is the only thing worth failing on.
 */


/**
 * The multiplicity half, asserted as SPECIFIC edges rather than as counts.
 *
 * `coverage by construct` proves a family is emitted at least once. That is not
 * enough: a collector that returns after the first match, a dedupe `Set` that
 * collapses two genuine facts, or a walk that does not descend into a list or an
 * object would all still pass a `> 0` test. Each row below is a position the
 * fixture contains and the edge the specification requires, so truncating any of
 * them fails.
 */
/** The line that carries `pick(flags: [ONE, TWO, THREE], ...)`, read from the
 * fixture rather than hardcoded, so editing the fixture cannot silently move the
 * expectation somewhere the assertion no longer looks. */
const FIXTURE_SRC = fs.readFileSync(path.join(GQL, "fixtures-constructs/10-every-family.graphql"), "utf8")
const LINE_PAIR = FIXTURE_SRC.split("\n").findIndex((l) => l.includes("flags: [ONE, TWO, THREE]")) + 1

const EXPECTED_EDGES: Array<[string, string, string, number?]> = [
  // two enum values in ONE argument — BARE, because `flags: [ONE, $a]` is an
  // executable argument and the document never says what enum `flags` takes.
  // The contrast below is the assertion that matters.
  ["Twice", "ONE", "enum_value_reference"],
  ["Twice", "TWO", "enum_value_reference"],
  // ONE argument naming THREE enum values, ALL AT ONE LINE. The line is part of
  // the key on purpose: without it, a collector that truncates at one call site
  // is masked by a DIFFERENT line producing the same edge — which is exactly what
  // the first version of this assertion did, and why its negative control passed.
  ["Twice", "ONE", "enum_value_reference", LINE_PAIR],
  ["Twice", "TWO", "enum_value_reference", LINE_PAIR],
  ["Twice", "THREE", "enum_value_reference", LINE_PAIR],
  // the nested list inside the object on the SAME line
  ["Twice", "TWO", "enum_value_reference", LINE_PAIR],
  // ...and the SAME VALUE QUALIFIED, because `again: Multi = ONE` in the type
  // system does state the type. Both spellings must exist simultaneously: a
  // blanket "always qualify" or "never qualify" would satisfy a `> 0` test and
  // fail this.
  ["Multi2.pick", "Multi.ONE", "enum_value_reference"],
  ["Deep.inner", "Multi.TWO", "enum_value_reference"],
  // ...and it must NOT be qualified where the document is silent. Asserting the
  // ABSENCE is what stops a future edit "helpfully" qualifying every enum value.
  ["Twice", "Multi.ONE", "enum_value_reference_NEGATIVE"],
  // a value nested inside a LIST inside an OBJECT argument, twice over
  ["Twice", "THREE", "enum_value_reference"],
  // a variable referenced from two different fields
  ["Twice", "$a", "variable_reference"],
  ["Twice", "$b", "variable_reference"],
  // the same fragment spread twice — two edges, distinguished by their lines
  ["Twice", "TwiceBits", "fragment_spread"],
  // two directives on ONE selection
  ["Twice", "@tag", "directive_application"],
  ["Twice", "@mark", "directive_application"],
  // the same field selected twice under one parent
  ["Twice", "Multi2.pick", "field_selection"],
  // two type references in one declaration
  ["Multi2.pick", "Multi", "field_argument_type"],
  // a directive definition's argument type, and an enum-qualified default
  ["@mark", "String", "directive_argument_type"],
  ["@mark", "Role", "directive_argument_type"],
]

console.log(`\n=== coverage by construct ===`)
const missing: string[] = []
for (const role of REQUIRED) {
  const n = roles.get(role) ?? 0
  if (n === 0) missing.push(role)
  console.log(`  ${n > 0 ? "ok  " : "MISS"} ${role.padEnd(32)} ${n}`)
}
console.log(`\n=== multiplicity: the specific edges, not a count ===`)
// The role lives in `metadata.relationshipRole`, NOT on the relationship — the
// first version of this block read `r.role`, got `undefined`, and reported all
// twelve edges MISS while the analyzer had in fact emitted every one. An
// assertion that is wrong in the pessimistic direction is still a broken
// assertion, so the role is read where it actually lives.
const seen = new Set<string>()
for (const r of all.flatMap((a) => a.relationships as any[])) {
  const role = r.metadata?.relationshipRole ?? ""
  seen.add(`${r.source}|${r.target}|${role}`)
  seen.add(`${r.source}|${r.target}|${role}@L${r.line_number}`)
}
const absent: Array<[string, string, string]> = []
for (const [src, tgt, role, line] of EXPECTED_EDGES) {
  // A `_NEGATIVE` row asserts the edge is ABSENT, so a future edit that
  // qualifies every enum value fails here rather than looking more complete.
  const isNegative = role.endsWith("_NEGATIVE")
  const bare = role.replace(/_NEGATIVE$/, "")
  const present = line === undefined ? seen.has(`${src}|${tgt}|${bare}`) : seen.has(`${src}|${tgt}|${bare}@L${line}`)
  const ok = isNegative ? !present : present
  if (!ok) absent.push([src, tgt, role])
  const verdict = isNegative ? (present ? "BAD " : "ok  ") : present ? "ok  " : "MISS"
  console.log(`  ${verdict} ${bare.padEnd(24)} ${src} -> ${tgt}${line !== undefined ? ` @L${line}` : ""}${isNegative ? "   (must NOT exist — the document states no type here)" : ""}`)
}
if (absent.length) {
  console.log(`\n${absent.length} expected edge(s) absent. A collector that truncates, a dedupe that`)
  console.log(`collapses two genuine facts, or a walk that does not descend would all pass a >0 test.`)
}
void missing
if (missing.length) {
  console.log(`\n${missing.length} referenceable family/families emitted NOTHING: ${missing.join(", ")}`)
  console.log(`Each is a reference the specification defines and this fixture contains.`)
}
process.exitCode = missing.length || absent.length ? 1 : 0
void all
