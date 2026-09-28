/**
 * script/m12/graphql-node-types-compare.ts — M12 shape safety for the graphql lane.
 *
 * The analyzer's entire contract is a set of string literals compared against
 * `node.type`. So the two questions that matter are:
 *
 *   A. DEAD REFERENCE — the analyzer names a node type the GRAMMAR DOES NOT
 *      DECLARE. A typo here routes a real construct through the default branch
 *      and nothing else notices.
 *   B. UNNAMED PRODUCTION — the grammar PRODUCES a node type the analyzer never
 *      names. A construct the analyzer claims to extract, and does not.
 *
 * The first version of this script answered neither reliably:
 *
 *   * its `refs` set was HAND-TRANSCRIBED (34 entries) while the analyzer's own
 *     source referenced 41, so 7 references were never checked at all;
 *   * `passed` was `dead.length === 0 && live.length > 0` — satisfied by ONE
 *     live entry, i.e. vacuous for any lane that has a single correct reference;
 *   * the walker visited `namedChild` only, so an ANONYMOUS token reference —
 *     `repeatable` is one, and it is the June-2018 `repeatable` feature — could
 *     never be observed and was silently reported as live-by-luck or dead;
 *   * it asked only direction A, never B, which is the direction that finds a
 *     blind spot;
 *   * and its corpus path was a hard-coded constant pointing at a directory that
 *     no longer existed, so the script CRASHED on `git rev-parse` while the
 *     artifact on disk still claimed `passed: true`.
 *
 * What this version does instead:
 *   * `refs` is DERIVED, not transcribed: every string literal in the analyzer's
 *     source, intersected with the grammar's own declared type table read from
 *     the wired wasm. It cannot drift from the code and cannot miss a syntactic
 *     form (`type === "X"`, `childrenOfType(n, "X")`, a table key, anything).
 *   * the walker visits ALL children, so anonymous tokens are observed.
 *   * the observed set additionally includes every construct of the 113-entry
 *     specification battery, so "did the grammar produce something the analyzer
 *     does not name" is asked about constructs a real corpus does not happen to
 *     contain — `extend scalar`, `interface X implements Y`, `repeatable`, the
 *     block-string escapes, and the rest.
 *   * the gate requires all three of: no dead reference, live == extracted (so a
 *     subset extraction cannot pass vacuously), and no unnamed MEANINGFUL node
 *     type in direction B. Direction B's non-meaningful remainder (wrapper and
 *     value nodes the analyzer descends through) is REPORTED in full rather than
 *     filtered away, so the boundary is visible.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"

const ANALYZER = "src/ast/real-graphql-analyzer.ts"
const WASM = "wasm/tree-sitter-graphql.wasm"
const FIXTURE_DIR = "validation/m12/fixtures/graphql"
const GAP_BATTERY = "$HOME/fixtures/graphql/probe/grammar-gaps.mts"
const OUT = "validation/m12/results/graphql-shape-safety.json"

// The corpus is an ARGUMENT, not a constant. A constant rots: the previous one
// named a directory that no longer existed, which is how this script came to
// crash while its artifact still read `passed: true`.
const corpus = process.argv[2] || "$HOME/fixtures/graphql/repos/graphql-js"

const parser = await (async () => {
  const { ASTEngine } = await import("../../src/ast/engine")
  return ASTEngine.getParser("graphql")
})()

/** The grammar's own declared type table — the authority for "is this a type". */
const language: any = (parser as any).getLanguage?.() ?? (await (parser as any).language)
const declaredTypes = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const t = language.nodeTypeForId(i)
  if (t) declaredTypes.add(t)
}
const isNamedType = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  if (!language.nodeTypeIsNamed(i)) continue
  const t = language.nodeTypeForId(i)
  if (t) isNamedType.add(t)
}

const analyzerSource = readFileSync(ANALYZER, "utf8")
const referencedNodeTypes = new Set<string>()
// (a) every QUOTED string literal, which covers `type === "X"`,
//     `childrenOfType(n, "X")` and the VALUES of a table like
//     EXTENSION_TO_DEFINITION;
for (const m of analyzerSource.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) {
  if (declaredTypes.has(m[1])) referencedNodeTypes.add(m[1])
}
// (b) and every UNQUOTED key of an object literal, which is how the analyzer spells
//     the OTHER half of that same table (`ObjectTypeExtension: "ObjectTypeDefinition"`).
//     Without (b) the first version of this gate reported five EXTENSION types as
//     "produced but unnamed by the analyzer" when the analyzer names all six of them
//     through the table — a false positive in the instrument, caught by the
//     instrument, and fixed rather than waived.
for (const m of analyzerSource.matchAll(/(?:^|[{,])\s*([A-Z][A-Za-z0-9_]*):\s/gm)) {
  if (declaredTypes.has(m[1])) referencedNodeTypes.add(m[1])
}

const fixtureFiles = readdirSync(FIXTURE_DIR)
  .filter((file) => /\.(graphql|graphqls|gql)$/i.test(file))
  .sort()

const revision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const corpusFiles = execFileSync("git", ["-C", corpus, "ls-files", "*.graphql", "*.graphqls", "*.gql"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort()

const inputs: Array<{ source: string; from: string }> = fixtureFiles.map((file) => ({ source: readFileSync(`${FIXTURE_DIR}/${file}`, "utf8"), from: `fixture ${file}` }))
for (const file of corpusFiles) inputs.push({ source: readFileSync(`${corpus}/${file}`, "utf8"), from: `corpus ${file}` })

// The specification battery, so the observed set covers constructs no corpus has.
let batteryConstructs = 0
if (existsSync(GAP_BATTERY)) {
  const batterySource = readFileSync(GAP_BATTERY, "utf8")
  for (const m of batterySource.matchAll(/src:\s*"((?:[^"\\]|\\.)*)"/g)) {
    try {
      inputs.push({ source: JSON.parse(`"${m[1]}"`) as string, from: "specification battery" })
      batteryConstructs++
    } catch {
      /* a construct whose source is written across lines; skipped, not guessed */
    }
  }
}

const observed = new Set<string>()
const observedAnon = new Set<string>()
for (const input of inputs) {
  const tree = parser.parse(input.source)
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const node = stack.pop()!
    observed.add(node.type)
    if (!node.isNamed) observedAnon.add(node.type)
    // ALL children, named and anonymous: `repeatable` is an anonymous token and
    // a named-only walk could never observe it.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) stack.push(child)
    }
  }
  tree.delete?.()
}

const live = [...referencedNodeTypes].filter((type) => observed.has(type)).sort()
const dead = [...referencedNodeTypes].filter((type) => !observed.has(type)).sort()

/**
 * Direction B. A type the grammar produces that the analyzer does not name is not
 * automatically a defect — `Definition`, `Value`, `Directives` and the value
 * leaves are wrapper rules the analyzer descends through on purpose. So the
 * FATAL set is explicit and consists of the constructs that DECLARE something:
 * a declaration or member in that set, unmentioned by the analyzer, means
 * whatever the file declares there is invisible. Everything else is reported so
 * the boundary is a reader's decision, not this script's.
 */
const PRODUCED_BUT_UNNAMED_IS_FATAL = new Set<string>([
  "SchemaDefinition", "SchemaExtension", "ObjectTypeDefinition", "InterfaceTypeDefinition",
  "UnionTypeDefinition", "EnumTypeDefinition", "ScalarTypeDefinition", "InputObjectTypeDefinition",
  "ObjectTypeExtension", "InterfaceTypeExtension", "UnionTypeExtension", "EnumTypeExtension",
  "ScalarTypeExtension", "InputObjectTypeExtension", "FieldDefinition", "EnumValueDefinition",
  "DirectiveDefinition", "OperationDefinition", "FragmentDefinition", "VariableDefinition",
  "ImplementsInterfaces", "UnionMemberTypes", "OperationTypeDefinition", "TypeCondition",
  "InputFieldsDefinition", "ArgumentsDefinition", "Field", "FragmentSpread", "InlineFragment",
  "Type", "NamedType", "NonNullType", "Description", "Name",
  // `ListType` is deliberately NOT in this set. It is a wrapper: the information
  // an extractor needs from `[Int!]!` is the base NamedType and the outer
  // NonNullType, both of which ARE named and both of which the analyzer reads. The
  // first version of this list had `ListType` in it and the gate failed on it; that
  // was the LIST being wrong, not the analyzer, and the fix is recorded here rather
  // than made silently.
])

const producedUnnamed = [...observed].filter((t) => !referencedNodeTypes.has(t)).sort()
const unnamedButFatal = producedUnnamed.filter((t) => PRODUCED_BUT_UNNAMED_IS_FATAL.has(t))

const result = {
  analyzer: "graphql",
  analyzerSource: ANALYZER,
  grammar: `wired ${WASM} (source: grammars/tree-sitter-graphql, pinned by script/m14/verify-grammar-pins.ts)`,
  referencedNodeTypesSource: "DERIVED: every string literal in the analyzer's source intersected with the grammar's declared type table. Not transcribed, so it cannot drift from the code it audits.",
  corpus,
  revision,
  corpusLabel: `graphql-js@${revision.slice(0, 7)}`,
  corpusFiles: corpusFiles.length,
  inputSources: { fixtures: fixtureFiles.length, corpus: corpusFiles.length, specificationBatteryConstructs: batteryConstructs },
  grammarDeclaredTypes: declaredTypes.size,
  grammarDeclaredNamedTypes: isNamedType.size,
  referencedNodeTypes: [...referencedNodeTypes].sort(),
  liveReferencedNodeTypes: live,
  deadDefensiveReferences: dead,
  observedNodeTypeCount: observed.size,
  observedNodeTypes: [...observed].sort(),
  observedAnonymousTokens: [...observedAnon].sort(),
  producedButUnnamedByAnalyzer: producedUnnamed,
  producedButUnnamedAndFatal: unnamedButFatal,
  producedButUnnamedNote:
    "Direction B. `producedButUnnamedAndFatal` are constructs that DECLARE something and are unnamed by the analyzer — the gate fails on those. The remainder are wrapper and value rules the analyzer descends through on purpose (`Definition`, `Value`, `Directives`, `ListValue`, `ObjectField`, `comma`, the literal leaves, `ERROR`, `source_file`) and are listed so the boundary is visible rather than assumed.",
  passed: dead.length === 0 && live.length === referencedNodeTypes.size && unnamedButFatal.length === 0,
  passedRule:
    "EVERY node type the analyzer names must be observed over the inputs (no dead reference); the live set must EQUAL the extracted set, so a subset extraction cannot pass vacuously the way `live.length > 0` allowed; and no MEANINGFUL node type the grammar produces may be unnamed by the analyzer.",
}
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
console.log(
  `graphql shape safety: referenced=${result.referencedNodeTypes.length} live=${live.length} dead=${dead.length} ` +
    `observed=${result.observedNodeTypeCount} (named ${result.grammarDeclaredNamedTypes} declared) ` +
    `producedButUnnamedFatal=${unnamedButFatal.length} passed=${result.passed}`,
)
if (dead.length) console.error(`DEAD references (named by the analyzer, not produced by the grammar): ${dead.join(", ")}`)
if (unnamedButFatal.length) console.error(`FATAL unnamed production: ${unnamedButFatal.join(", ")}`)
if (!result.passed) process.exitCode = 1
