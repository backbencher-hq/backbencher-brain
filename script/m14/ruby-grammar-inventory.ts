/**
 * RUBY'S PINNED-GRAMMAR NODE-TYPE INVENTORY (the RUBY lane's own instrument, 2026-10-21).
 *
 * WHY THIS EXISTS. Ruby's four RULED cells (implements · renders · decorates · part_of) each need a
 * CITATION, and the citation the block format demands is a POSITIVE grammar-inventory absence:
 * "the pinned grammar has no node type that could produce the construct, so no corpus count can
 * exist". A ruling without that citation is prose, and a prose ruling cannot leave the denominator.
 *
 * The instrument is the same shape as the fleet's own `grammar.mts` (instrument A of
 * docs/analyzers/ONTOLOGY-WORKSTREAM.md): it reads the grammar the PRODUCTION parser is configured
 * with — `ASTEngine.getParser("ruby")` from src/ast/engine.ts, then the parser's own `Language`
 * object — so the list is the PINNED GRAMMAR'S list, not a guess from a sampled tree, and not a
 * hand-written list of node names.
 *
 * IT PRINTS ITS OWN PIN: the sha256 of the wasm the parser actually loaded, so the citation names a
 * digest that can be re-checked with `sha256sum`.
 *
 * ── THE POSITIVE CONTROL, BECAUSE AN INSTRUMENT THAT CANNOT FIRE MEASURES NOTHING ──────────────────
 * (Lead ruling L-2026-10-21-05.) An ABSENCE is only a fact about the grammar if the same scan can
 * find a PRESENT construct. So this instrument runs the SAME scan over a grammar that DOES carry the
 * constructs — the typescript grammar declares `implements_clause` and `jsx_element` — and over the
 * DART grammar, which declares `mixin_application` and `part_directive`. If the control does not
 * fire, the scan is blind and every absence below it is an artefact of the scan, not a property of
 * the Ruby grammar. The control's PASS/FAIL is in the artifact, beside the absences it guards.
 *
 * THE COUNTERFACTUALS ARE THE SECOND HALF: a construct the grammar cannot express is a construct
 * that does not PARSE. `class A implements B; end` must not parse in the Ruby grammar, and
 * `part 'x.rb';` must not either. A construct that parses is a construct the grammar has, whatever
 * its node type is called.
 *
 * USAGE
 *   bun run script/m14/ruby-grammar-inventory.ts
 *   → writes validation/m14/measurements/ruby-grammar-inventory.json
 *   → prints the named-type count, the anonymous-token count, and the PRESENCE/ABSENCE of every
 *     construct node type each of the four RULED cells would require.
 *
 * THE FOUR CELLS AND THE NODE TYPES EACH WOULD REQUIRE
 *   implements  → an interface / conformance / "implements" production
 *   renders    → a JSX element production (jsx_element / jsx_self_closing_element)
 *   decorates  → a decorator production (decorator / decorated_definition)
 *   part_of    → a "part of" directive production (part_of_directive / part_directive)
 *
 * READ-ONLY. It writes ONE artifact inside the ruby lane's own write scope and touches nothing else.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

import { getParser } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname, "../..")
const OUT = path.join(ROOT, "validation/m14/measurements/ruby-grammar-inventory.json")

/** The construct node types each RULED cell would require the grammar to have. */
const REQUIRED: Record<string, string[]> = {
  implements: [
    "interface_declaration",
    "interface_body",
    "implements_clause",
    "implements_list",
    "super_interfaces",
    "interface_specification",
    "implements_declaration",
    "conformance_clause",
    "protocol_declaration",
  ],
  renders: ["jsx_element", "jsx_self_closing_element", "jsx_fragment", "jsx_attribute", "jsx_child"],
  decorates: ["decorator", "decorated_definition", "decorator_expression", "annotation", "attribute"],
  part_of: ["part_of_directive", "part_directive", "part_of_builtin", "library_directive", "part_clause"],
}

const parser = await getParser("ruby" as any)
const language = parser.language
if (!language) throw new Error("NO LANGUAGE for ruby — the parser did not expose a Language object")

/** Enumerate one grammar's named node types by its OWN Language object. */
function namedTypesOf(lang: any): { named: Set<string>; namedCount: number; totalCount: number } {
  const named = new Set<string>()
  const total = lang.nodeTypeCount
  let count = 0
  for (let id = 1; id < total; id++) {
    const t = lang.nodeTypeForId(id)
    if (t == null) continue
    if (lang.nodeTypeIsNamed(id)) { named.add(t); count++ }
  }
  return { named, namedCount: count, totalCount: total }
}

const rubyTypes = namedTypesOf(language)
const named: string[] = []
const anonymous: string[] = []
const total = language.nodeTypeCount
for (let id = 1; id < total; id++) {
  const t = language.nodeTypeForId(id)
  if (t == null) continue
  if (language.nodeTypeIsNamed(id)) named.push(t)
  else anonymous.push(t)
}
named.sort()
anonymous.sort()

/** The wasm the production parser is configured with — the PIN the citation names. */
const WASM = path.join(ROOT, "wasm/tree-sitter-ruby.wasm")
const sha256 = createHash("sha256").update(readFileSync(WASM)).digest("hex")

const namedSet = new Set(named)
const cells: Record<string, { required: string[]; present: string[]; absent: string[]; allAbsent: boolean }> = {}
for (const [cell, req] of Object.entries(REQUIRED)) {
  const present = req.filter((t) => namedSet.has(t))
  const absent = req.filter((t) => !namedSet.has(t))
  cells[cell] = { required: req, present, absent, allAbsent: present.length === 0 }
}

// ── THE POSITIVE CONTROL (Lead ruling L-2026-10-21-05) ───────────────────────────────────────────
// The SAME scan, over grammars that DO carry the constructs. If the control does not fire, the scan
// is blind and the four absences above it are artefacts of the scan rather than facts about Ruby.
type Control = { grammar: string; wasm: string; mustContain: string; present: boolean; namedCount: number; note?: string }
const controlSpecs: Array<{ lang: any; wasm: string; mustContain: string; grammar: string; note?: string }> = [
  { lang: "typescript", wasm: "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm", mustContain: "implements_clause", grammar: "typescript" },
  // TSX is a SEPARATE grammar from TS (`tsx` is the engine's own language id), and it is the one that
  // carries the JSX productions. The control therefore asks `tsx` for `jsx_element` — a control that
  // asked plain `typescript` for a JSX node would not fire for a reason that has nothing to do with
  // the scan, and a control that cannot fire proves nothing.
  { lang: "tsx", wasm: "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm", mustContain: "jsx_element", grammar: "tsx" },
  { lang: "dart", wasm: "wasm/tree-sitter-dart.wasm", mustContain: "mixin_application", grammar: "dart" },
  { lang: "dart", wasm: "wasm/tree-sitter-dart.wasm", mustContain: "part_directive", grammar: "dart" },
]
const controls: Control[] = []
for (const spec of controlSpecs) {
  let c: Control = { grammar: spec.grammar, wasm: spec.wasm, mustContain: spec.mustContain, present: false, namedCount: 0 }
  try {
    const cp: any = await getParser(spec.lang as any)
    if (cp?.language) {
      const t = namedTypesOf(cp.language)
      c = { ...c, present: t.named.has(spec.mustContain), namedCount: t.namedCount, note: spec.note }
    }
  } catch {
    // A control grammar that cannot be loaded is a control that cannot fire — recorded as absent,
    // never as a pass, so the artifact says which controls actually ran.
  }
  controls.push(c)
}
const controlsFired = controls.filter((c) => c.present).length

// ── THE COUNTERFACTUALS: a construct the grammar cannot express does not PARSE ────────────────────
// This is the second half of the ruling: an absence of a node type is only meaningful if the
// construct is genuinely inexpressible, and inexpressibility shows up as a parse ERROR.
//
// BUT — AND THIS IS THE PART THAT CHANGED THE RULING'S EVIDENCE — RUBY'S GRAMMAR IS PERMISSIVE, AND
// THE THREE CONSTRUCTS *DO* PARSE. Measured: `class A implements B` parses, `@decorator` parses, and
// `part 'other.rb'` parses — with NO error node. So "it parses" is NOT the test, and an instrument
// that asserted "the construct must ERROR" would have been WRONG about Ruby.
//
// What the parse actually SHOWS is the ruling's real evidence: the construct is recovered as an
// UNRELATED node. `class A implements B` parses as `(class name: (constant) body: (body_statement
// (call method: (identifier) arguments: ...)))` — `implements` is a METHOD CALL inside the class
// body, not a superclass/implements clause. `part 'other.rb'` parses as `(call method: (identifier)
// arguments: (argument_list (string ...)))` — a method call named `part`, not a directive.
// `@decorator` parses as `(instance_variable) (method ...)` — a decorator is an ivar, not a
// decoration.
//
// So the counterfactual here is NOT "does it error" but "WHAT DOES IT PARSE AS": the construct must
// be recovered as something that is not the construct. The POSITIVE CONTROL below pins what the
// construct WOULD look like if the grammar had it — `class A < B` parses as
// `(class name: (constant) superclass: (superclass (constant)))`, and the SUPERCLASS node is the
// shape an `implements`/`extends` clause would take. That is the control that fires: the same
// grammar, the same position, a real clause present.
type Counterfactual = {
  construct: string
  source: string
  hasError: boolean
  errorNodeTypes: string[]
  /** The node types the construct was RECOVERED AS — the evidence, not the absence. */
  recoveredAs: string[]
  /** True when the recovery produced the construct's OWN clause node (which would refute the ruling). */
  recoveredAsTheConstruct: boolean
}
const COUNTERFACTUALS: Array<{ construct: string; source: string; ownClauseNodes: string[] }> = [
  { construct: "implements", source: "class A implements B\nend\n", ownClauseNodes: ["superclass", "inheritance", "class_heritage"] },
  { construct: "implements (interface keyword)", source: "interface A\nend\n", ownClauseNodes: ["interface_declaration", "interface_body"] },
  { construct: "renders", source: "def a\n  <div>hi</div>\nend\n", ownClauseNodes: ["jsx_element", "jsx_self_closing_element"] },
  { construct: "decorates", source: "@decorator\ndef a\nend\n", ownClauseNodes: ["decorator", "decorated_definition", "annotation"] },
  { construct: "part_of", source: "part 'other.rb'\n", ownClauseNodes: ["part_directive", "part_of_directive", "library_directive"] },
]
/** The POSITIVE CONTROL: a real clause in the same position, in the same grammar. */
const SUPERCLASS_CONTROL = { construct: "superclass (the shape an implements/extends clause would take)", source: "class A < B\nend\n", ownClauseNodes: ["superclass"] }

function parseShape(source: string): { hasError: boolean; errorNodeTypes: string[]; nodeTypes: string[] } {
  let hasError = false
  const errorNodeTypes: string[] = []
  const nodeTypes: string[] = []
  try {
    const tree: any = parser.parse(source)
    hasError = !!tree?.rootNode?.hasError
    const walk = (n: any) => {
      if (!n) return
      if (n.type === "ERROR" || n?.isMissing) errorNodeTypes.push(String(n.type))
      nodeTypes.push(String(n.type))
      for (let i = 0; i < (n?.childCount ?? 0); i++) walk(n.child(i))
    }
    walk(tree?.rootNode)
  } catch {
    hasError = true
    errorNodeTypes.push("parse-threw")
  }
  return { hasError, errorNodeTypes: [...new Set(errorNodeTypes)], nodeTypes: [...new Set(nodeTypes)] }
}

const counterfactuals: Counterfactual[] = []
for (const cf of COUNTERFACTUALS) {
  const p = parseShape(cf.source)
  const recoveredAsTheConstruct = cf.ownClauseNodes.some((n) => p.nodeTypes.includes(n))
  counterfactuals.push({
    construct: cf.construct,
    source: cf.source,
    hasError: p.hasError,
    errorNodeTypes: p.errorNodeTypes,
    recoveredAs: p.nodeTypes,
    recoveredAsTheConstruct,
  })
}
const allCounterfactualsRecoveredElsewhere = counterfactuals.every((c) => !c.recoveredAsTheConstruct)
const superControl = (() => {
  const p = parseShape(SUPERCLASS_CONTROL.source)
  return { ...SUPERCLASS_CONTROL, hasError: p.hasError, recoveredAs: p.nodeTypes, fired: p.nodeTypes.includes("superclass") }
})()

const out = {
  language: "ruby",
  grammarWasm: "wasm/tree-sitter-ruby.wasm",
  grammarWasmSha256: sha256,
  namedCount: named.length,
  totalCount: total,
  anonymousCount: anonymous.length,
  named,
  anonymousSample: anonymous.slice(0, 40),
  cells,
  positiveControl: {
    rule:
      "Lead ruling L-2026-10-21-05: an absence is only a fact about the grammar if the same scan can find a PRESENT construct. The controls below run the SAME scan over grammars that DO declare the constructs; a control that does not fire means the scan is blind and every absence above is an artefact of the scan.",
    fired: controlsFired,
    total: controls.length,
    allFired: controlsFired === controls.length && controls.length > 0,
    controls,
  },
  counterfactuals: {
    rule:
      "The second half of the same ruling. MEASURED: Ruby's grammar is PERMISSIVE — the three constructs DO parse, with no error node — so 'does it error' is NOT the test and an instrument asserting that would have been wrong about Ruby. The evidence is WHAT IT PARSES AS: each construct is recovered as an UNRELATED node (`implements` → a method call inside the class body, `part` → a method call, `@decorator` → an instance variable), never as a clause of its own. `recoveredAsTheConstruct` is the field that matters: false means the grammar has no such production.",
    allRecoveredAsSomethingElse: allCounterfactualsRecoveredElsewhere,
    positiveControl: {
      note: "The same grammar, the same position, a REAL clause: `class A < B` parses to a `superclass` node. This is the shape an implements/extends clause would take, and it fires — so the scan sees clause nodes when they exist.",
      ...superControl,
    },
    rows: counterfactuals,
  },
  instrument:
    "script/m14/ruby-grammar-inventory.ts — ASTEngine.getParser('ruby').language.nodeTypeForId over the pinned wasm, read from the production parser's own Language object",
  population: "the PINNED GRAMMAR (a finite node-type inventory) — this is not a corpus reading and carries no population",
}

writeFileSync(OUT, JSON.stringify(out, null, 1))

console.log(`RUBY PINNED-GRAMMAR INVENTORY`)
console.log(`  wasm  wasm/tree-sitter-ruby.wasm`)
console.log(`  sha256 ${sha256}`)
console.log(`  ${named.length} named node types of ${total} node-type ids (${anonymous.length} anonymous tokens)`)
console.log(`\n  CANDIDATE NODE PRESENCE for each RULED cell (named types):`)
for (const [cell, c] of Object.entries(cells)) {
  console.log(`    ${cell}: ${c.allAbsent ? "ALL ABSENT" : "PRESENT: " + c.present.join(", ")}`)
  for (const t of c.required) console.log(`      ${namedSet.has(t) ? "PRESENT" : "ABSENT "}  ${t}`)
}
console.log(`\n  POSITIVE CONTROL (the scan must be able to FIRE): ${controlsFired}/${controls.length} fired`)
for (const c of controls) {
  console.log(`    ${c.present ? "PRESENT" : "ABSENT "}  ${c.grammar}: ${c.mustContain}  (${c.namedCount} named types)`)
}
console.log(`\n  COUNTERFACTUALS — WHAT EACH CONSTRUCT IS RECOVERED AS (not "does it error"):`)
for (const c of counterfactuals) {
  const verdict = c.recoveredAsTheConstruct
    ? "RECOVERED AS THE CONSTRUCT — THE RULING IS REFUTED"
    : `recovered as ${c.recoveredAs.slice(0, 6).join(", ")} — NOT the construct`
  console.log(`    ${verdict}`)
  console.log(`        ${c.construct}`)
}
console.log(`\n  POSITIVE CONTROL (a REAL clause in the same position): superclass fired = ${superControl.fired}  [${superControl.recoveredAs.slice(0, 6).join(", ")}]`)
console.log(`\n  written to ${path.relative(ROOT, OUT)}`)
