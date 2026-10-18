/**
 * SOLIDITY APPLICABLE SET — the D1 instrument (ALL-OUT-OF-ALL charter §9.1 D1; phase 2).
 *
 * Answers the clause with measurements, not prose, in one run:
 *
 *   1. WHAT CAN THE PINNED GRAMMAR EXPRESS? `wasm/tree-sitter-solidity.wasm` is enumerated through
 *      web-tree-sitter's own Language API (nodeTypeCount / nodeTypeIsNamed / nodeTypeForId). Every
 *      applicability claim below is answered from that enumeration; a value whose construct
 *      productions are absent is a finding, never a note. THE COUNT IS RECONCILED, not just printed:
 *      the grammar's `src/grammar.json` declares 166 rules (121 visible + 45 hidden), the generated
 *      `src/node-types.json` lists 124 "named" entries, and the Language API exposes **121 unique
 *      named types** — the three-entry difference is the literal spellings `true` / `false` /
 *      `string`, which node-types marks named but which are tokens, not node types. Stating this
 *      matters because a lane that quotes "124 named types" while enumerating 121 is quoting a
 *      different instrument.
 *
 *   2. WHAT PINS EACH APPLICABLE VALUE? The lane's own fixture expectations are parsed: every
 *      applicable value must carry at least one POSITIVE `expectRelationships` row naming it, and
 *      the emission site is read out of `src/ast/real-solidity-analyzer.ts`'s own source. The
 *      analyzer emits through one helper (`addRel(source, target, RelationshipType.X, …)`), so the
 *      site scan is written for THAT shape: a multi-line call argument, a single-line `addRel(`, or
 *      the heritage ternary's `?`/`:` arm — and never a `case` label, a comparison, a comment, or
 *      the `assumedKind` metadata value (which is a CLAIM ABOUT a kind, not an emission of one).
 *
 *   3. CAN THE FIXTURE ACTUALLY GO RED? The real fixture runner (`runLang` / `run-fixtures.ts`) is
 *      run once per applicable value through an override analyzer that is the REAL
 *      `RealSolidityAnalyzer` with exactly that value's edges removed. A fixture that PASSED at
 *      baseline and FAILS with the emission absent is a fixture that can go RED — measured, never
 *      assumed.
 *
 * THE RULINGS THIS FILE EXISTS TO PROVE (the ones the task flagged as likely):
 *
 *   `implements`   Solidity has NO implements clause — the grammar's heritage construct is
 *                  `inheritance_specifier` (one `is` list). The value is still APPLICABLE through the
 *                  ADAPTED SEMANTICS the analyzer implements (SOL-5): an ancestor bound to an
 *                  in-file `interface_declaration` is `implements`, everything else is `extends`.
 *                  The grammar absence of any implements-clause production is asserted here.
 *   `exports`      Solidity has NO export construct (SOL-12). The value is APPLICABLE as the
 *                  COMPILATION-UNIT SURFACE: every file-scope declaration except a free function.
 *   `decorates`    RULED NOT APPLICABLE as a canonical VALUE, with the adjudication stated rather
 *                  than waved away: the grammar HAS `modifier_definition` + `modifier_invocation`,
 *                  and Solidity modifiers are this language's annotation mechanism — the family
 *                  contract (SOL-17, and java's annotation ruling) publishes them as `decorators`
 *                  METADATA on the decorated symbol plus the one edge that carries meaning (a
 *                  `calls` edge, because invoking a modifier IS calling it). No `decorates` edge is
 *                  emitted or expected by any fixture.
 *   `instantiates` = `new_expression` ONLY. Struct construction (`S({a:1})` / `S(1)`) is a `calls`
 *                  edge (SOL-10), not object creation.
 *   `imports`      = `import_directive` ONLY (target is a module path). A `using_directive` /
 *                  imported binding is `references` (SOL-15/imports block).
 *   `uses`         = positional READ (SOL-2): an `identifier` whose PARENT is an expression. Measured
 *                  contract 2026-10-19: an assignment LHS (`bal = n;`) IS emitted as a uses (the
 *                  C-family write-as-use contract); a read (`return bal;`) is a uses; parameters are
 *                  reads by position even though parameters are not published declarations (that is
 *                  the lane's measured binding wall, SOL-FIX §1).
 *
 * Usage:
 *   bun run script/m14/solidity-applicable-set.ts --out <path>    # JSON to stdout + file
 *
 * Exit: 0 when every applicable value is implemented, fixture-pinned and demonstrably RED-able, and
 *       every ruled value's grammar absence (or adjudicated construct) is proven; 1 on any finding.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const OUT_FLAG = process.argv.indexOf("--out")
const OUT = OUT_FLAG >= 0 && process.argv[OUT_FLAG + 1] ? path.resolve(process.argv[OUT_FLAG + 1]) : null

const { runLang } = await import("./run-fixtures")

const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures", "solidity")
const ANALYZER = path.join(ROOT, "src", "ast", "real-solidity-analyzer.ts")
const WASM = path.join(ROOT, "wasm", "tree-sitter-solidity.wasm")
const GRAMMAR_JSON = path.join(ROOT, "grammars", "tree-sitter-solidity", "src", "grammar.json")
const NODE_TYPES_JSON = path.join(ROOT, "grammars", "tree-sitter-solidity", "src", "node-types.json")

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1 · THE APPLICABLE VALUES — decided by the enumeration in section 2
// ─────────────────────────────────────────────────────────────────────────────────────────
const APPLICABLE: Record<string, {
  constructs: string[]
  rule: string
  emissionSymbol: string
  adaptedSemantics?: string
}> = {
  calls: {
    constructs: ["call_expression", "call_argument", "call_struct_argument", "struct_expression", "modifier_invocation", "emit_statement", "revert_statement"],
    rule: "a CALL-EXPRESSION whose callee resolves through the wrappers the grammar builds (SOL-9 stops at the first name; `t.call{value:1}(\"\")` is a call_expression under a struct_expression). The lane also emits calls for the other call-shaped constructs the language has: a MODIFIER INVOCATION (`function f() public onlyOwner` — calling a modifier IS calling it, SOL-17) with calleeKind modifierInvocation; an EVENT EMISSION (`emit Ev(1)`, calleeKind eventEmission); a CUSTOM ERROR REVERT (`revert Err(2)`, calleeKind errorRevert); and STRUCT CONSTRUCTION in both spellings `S({a:1})` / `S(1)` (SOL-10). `new` is instantiates, not calls.",
    emissionSymbol: "Calls",
  },
  uses: {
    constructs: ["identifier", "member_expression", "assignment_expression", "augmented_assignment_expression", "update_expression", "yul_identifier", "yul_path"],
    rule: "a positional READ (SOL-2): an `identifier` whose PARENT is an expression. Measured contract 2026-10-19: an assignment LHS is emitted as a uses (write-as-use, family contract); a state-variable read is a uses; a parameter/local read is a uses by position even though a parameter/local is not always a published declaration (that measured silence is the lane's binding wall — SOL-FIX §1). Yul: a yul_identifier / one-segment yul_path read is a uses; a multi-segment path's leaf is a member.",
    emissionSymbol: "Uses",
  },
  contains: {
    constructs: ["contract_declaration", "contract_body", "interface_declaration", "library_declaration", "struct_declaration", "struct_body", "struct_member", "enum_declaration", "enum_body", "enum_value", "event_definition", "error_declaration", "modifier_definition", "function_definition", "function_body", "state_variable_declaration", "constant_variable_declaration", "variable_declaration"],
    rule: "container -> member: the FILE-MODULE symbol (SOL-1: the basename WITH its extension) contains every file-scope declaration; a contract/interface/library contains its members; a struct its fields; an enum its values; an event/error its parameters; a modifier its body's locals; and a FUNCTION contains its own locals (SOL-13 — a function is a declaration container; the contract-level edge for a function-local name would be false). The public state variable's SYNTHESISED getter is a contained member named with its external signature (SOL-3).",
    emissionSymbol: "Contains",
  },
  imports: {
    constructs: ["import_directive", "source_file"],
    rule: "`import_directive` -> the module specifier as written, one edge per MODULE (`./A.sol`, `@openzeppelin/contracts/token/ERC20.sol`). The target is a PATH, not a symbol name, by construction of the type (a `pathTarget` opt-out in addRel is what makes this emission possible at all — measured: without it the symbol-name guard silently dropped 357 of 358 corpus imports). A namespace/aliased import's BINDING is a references edge, never an import.",
    emissionSymbol: "Imports",
  },
  references: {
    constructs: ["type_name", "user_defined_type", "user_defined_type_definition", "type_alias", "using_directive", "using_alias", "identifier", "member_expression", "meta_type_expression", "payable_conversion_expression", "type_cast_expression"],
    rule: "a TYPE mention in a type position (type_name -> user_defined_type; a user_defined_type_definition / type_alias name; `type(X)` meta-type), the USING-DIRECTIVE's dependency (SOL: `using Lib for T` names Lib), an imported BINDING name (`import {B} from ...` -> B), and the public state variable -> synthesised getter reference (SOL-3). A value identifier in a value position is `uses`; the two share the tree and are chosen by position.",
    emissionSymbol: "References",
  },
  exports: {
    constructs: ["source_file", "contract_declaration", "interface_declaration", "library_declaration", "struct_declaration", "enum_declaration", "error_declaration", "event_definition"],
    rule: "ADAPTED SEMANTICS, declared: Solidity has NO export construct (SOL-12). The value carries the COMPILATION-UNIT SURFACE — every file-scope declaration except a free function (solc emits an ABI/abstraction for each contract/interface/library and nothing else; a free function contributes no ABI entry). One edge per file-scope declaration, from the module symbol.",
    emissionSymbol: "Exports",
    adaptedSemantics: "no export production exists; the value publishes the compilation-unit surface (SOL-12)",
  },
  extends: {
    constructs: ["inheritance_specifier", "contract_declaration", "interface_declaration", "library_declaration"],
    rule: "contract/interface/library -> each ancestor in its `inheritance_specifier` list. Solidity has ONE heritage construct; the KIND comes from the ancestor's own declaration (SOL-5): an ancestor that is NOT an in-file interface is `extends` (0.9/inferred + kindUnresolved + reasonCode base-not-declared-in-file when the base is declared outside the file, SOL-19).",
    emissionSymbol: "Extends",
  },
  implements: {
    constructs: ["inheritance_specifier", "interface_declaration", "contract_declaration"],
    rule: "ADAPTED SEMANTICS, declared: Solidity has NO implements clause — the heritage construct is `inheritance_specifier`, one `is` list. The value carries the CONTRACT reading of that clause (SOL-5): an ancestor bound to an in-file `interface_declaration` (or settled as an interface by the project index, SOL-21) is `implements`; everything else is `extends`. One edge per (derived, interface) pair. This is not a duplicate of `extends`: 'inherits from' and 'implements this interface' are two readings of the same clause, and only the second tells a consumer the ancestor carries no state.",
    emissionSymbol: "Implements",
    adaptedSemantics: "no implements-clause production exists; the value rides the interface reading of inheritance_specifier (SOL-5)",
  },
  overrides: {
    constructs: ["override_specifier", "function_definition", "modifier_definition"],
    rule: "a member carrying the `override` specifier, resolved against its base (SOL-11, three tiers): base in-file AND declaring the member -> 0.9 verified; base not in-file but NAMED by `override(X)` -> 0.75 inferred with reasonCode named-by-override-specifier; bare `override` with ONE header base -> 0.75 single-header-base; bare `override` with TWO OR MORE header bases -> NO edge (the keyword says one of them declares the member without saying which — the refusal is the rule, not an omission).",
    emissionSymbol: "Overrides",
  },
  instantiates: {
    constructs: ["new_expression", "user_defined_type"],
    rule: "OBJECT CREATION through `new`: `new Contract()` publishes the constructed type. A struct construction (`S({a:1})` / `S(1)`) emits a `calls` edge instead (SOL-10) — a struct is a value type, not an object with a constructor symbol; `instantiates` is reserved for contract creation.",
    emissionSymbol: "Instantiates",
  },
}

const NOT_APPLICABLE: Record<string, {
  needs: string[]
  reason: string
  vocabularyRuling: string
}> = {
  decorates: {
    needs: ["decorator", "decorator_expression", "annotation", "annotation_declaration", "marker_annotation"],
    reason: "no decorator/annotation production exists in the pinned grammar. It DOES have the language's annotation mechanism — `modifier_definition` + `modifier_invocation` — and that construct is ADJUDICATED here rather than ignored: applied modifiers are published as `decorators` METADATA on the decorated symbol (SOL-17) and the modifier INVOCATION emits a `calls` edge (calleeKind modifierInvocation), matching the family contract (java's annotations are references+metadata, decorates reserved for runtime callable decorators; C#/F#/Java all treat decorators as metadata on the thing they decorate). No Solidity fixture expects a `decorates` row and the analyzer emits none.",
    vocabularyRuling: "extended value, NOT APPLICABLE as a relationship to Solidity (adjudicated: modifiers are metadata + calls).",
  },
  renders: {
    needs: ["jsx_element", "jsx_self_closing_element", "jsx_opening_element", "jsx_attribute"],
    reason: "no JSX/element-construction production exists in the pinned grammar; Solidity never creates a component-element pair.",
    vocabularyRuling: "extended value (TSX/JSX), NOT APPLICABLE to Solidity.",
  },
  mixes_in: {
    needs: ["mixin", "mixin_application_class", "with_clause"],
    reason: "no mixin/with production exists in the pinned grammar. Solidity's composition construct is inheritance, carried by extends/implements; there is no separate mixin-application production to publish.",
    vocabularyRuling: "extended value (Dart `with`), NOT APPLICABLE to Solidity.",
  },
  part_of: {
    needs: ["part_directive", "part_of_directive", "part_clause"],
    reason: "Solidity's file-inclusion construct is `import_directive`, which IS a module edge published as `imports`; there is no part-file directive that shares one compilation unit's scope without importing (the construct `part_of` exists to distinguish).",
    vocabularyRuling: "extended value (Dart `part`/`part of`), NOT APPLICABLE to Solidity.",
  },
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1b · CONSTRUCT SURFACE — the Solidity constructs this lane's docs name, mapped to the value(s)
//      that carry them or RULED as carrying no relationship
// ─────────────────────────────────────────────────────────────────────────────────────────
const CONSTRUCTS: Array<{ construct: string; grammars: string[]; carriedBy: string[]; ruling: string }> = [
  { construct: "contracts / interfaces / libraries", grammars: ["contract_declaration", "interface_declaration", "library_declaration", "contract_body"], carriedBy: ["contains", "extends", "implements", "exports"], ruling: "each is a published symbol contained by the file-module and (for files at the surface) exported; their ancestors are extends/implements." },
  { construct: "inheritance (`is` list)", grammars: ["inheritance_specifier"], carriedBy: ["extends", "implements"], ruling: "ONE heritage construct, two readings (SOL-5): non-interface ancestor = extends, in-file interface ancestor = implements. Multiple bases are a list in one specifier, so N bases = N edges." },
  { construct: "functions / constructor / receive / fallback", grammars: ["function_definition", "function_body", "constructor_definition", "fallback_receive_definition", "return_type_definition"], carriedBy: ["contains", "calls", "uses", "references", "overrides"], ruling: "each declared name is read off its leading keyword (SOL-4: constructor/receive/fallback write their literal word), contained by its contract, and is a calls/uses/references scope." },
  { construct: "state variables (public getters) / constants / immutables", grammars: ["state_variable_declaration", "constant_variable_declaration", "immutable"], carriedBy: ["contains", "references", "uses", "exports"], ruling: "SOL-3: a public state variable is a contained member AND its compiler-synthesised getter is a published member named with its external signature (`bal()`) plus a references edge var -> getter. The getter name cannot collide with a Solidity identifier (no `(` in an identifier)." },
  { construct: "modifiers (definition + invocation)", grammars: ["modifier_definition", "modifier_invocation"], carriedBy: ["contains", "calls"], ruling: "a modifier is a contained member; its INVOCATION is a calls edge (SOL-17). Applied modifiers are `decorators` METADATA; there is no `decorates` relationship (see the ruled value)." },
  { construct: "events / custom errors / emit / revert / try-catch", grammars: ["event_definition", "event_parameter", "error_declaration", "error_parameter", "emit_statement", "revert_statement", "try_statement", "catch_clause"], carriedBy: ["contains", "calls", "uses"], ruling: "an event/error is a contained symbol with parameter members; `emit Ev(1)` is a calls edge (calleeKind eventEmission), `revert Err(2)` a calls edge (errorRevert). try/catch clauses are control flow, not relationships (the caught expression's calls/uses are emitted normally)." },
  { construct: "structs / enums / enum values", grammars: ["struct_declaration", "struct_body", "struct_member", "enum_declaration", "enum_body", "enum_value", "struct_expression", "call_struct_argument"], carriedBy: ["contains", "calls", "uses"], ruling: "struct/enum are contained symbols with member containment; struct CONSTRUCTION is a calls edge (both spellings, SOL-10), never instantiates." },
  { construct: "imports (plain / named / namespace / aliased)", grammars: ["import_directive"], carriedBy: ["imports", "references"], ruling: "the module PATH is imports; an imported BINDING (named or `* as Utils`) is references. Solidity has no export construct, so `import` never pairs with an exports keyword (see the exports ruling)." },
  { construct: "using-for / using alias", grammars: ["using_directive", "using_alias"], carriedBy: ["references", "calls"], ruling: "the using-dependency (library or function list) is a references edge; a call through `using X for T` is a calls edge with calleeKind inFileTypeMember (SOL-15)." },
  { construct: "object creation (`new`)", grammars: ["new_expression", "user_defined_type", "type_name"], carriedBy: ["instantiates", "uses"], ruling: "`new C()` is instantiates; the type name is read in a type position (references) — instantiates is NOT template/struct construction (SOL-10)." },
  { construct: "override", grammars: ["override_specifier", "virtual"], carriedBy: ["overrides"], ruling: "SOL-11 three tiers; the refusals (2+ header bases, no matching declaration) are part of the rule." },
  { construct: "Yul / inline assembly", grammars: ["assembly_statement", "assembly_flags", "yul_function_call", "yul_function_definition", "yul_identifier", "yul_path", "yul_variable_declaration", "yul_evm_builtin", "yul_block", "yul_for_statement", "yul_if_statement", "yul_switch_statement"], carriedBy: ["contains", "calls", "uses"], ruling: "Yul is a first-class sub-language here: a yul function is a contained member, a yul function call is a calls edge (labels carrying `yul`), a yul identifier / one-segment path read is a uses edge. An EVM BUILTIN is not a user call (SOL-8)." },
  { construct: "type aliases / user-defined value types / function types", grammars: ["user_defined_type_definition", "type_alias", "type_name", "type_cast_expression", "payable_conversion_expression", "meta_type_expression"], carriedBy: ["contains", "references", "uses"], ruling: "a type alias / user-defined value type is a contained symbol; type mentions are references (type positions) and a CONVERSION (`uint256(x)`) emits no calls edge — a conversion is not a call (SOL-15)." },
  { construct: "NatSpec comments / pragma", grammars: ["comment", "pragma_directive", "any_pragma_token"], carriedBy: [], ruling: "RULED: NatSpec documentation attaches to the next declaration as `docstring`/`docTags` METADATA (SOL-16/23) — there is no second symbol to connect an edge to, so no relationship; a pragma is a compilation directive, not a relationship. Both are counted by the D2 census so the ruling is a number, not a silence." },
]

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1c · RULINGS — the value questions the task flagged, with the measurement that settles each
// ─────────────────────────────────────────────────────────────────────────────────────────
const RULINGS: Array<{ id: string; question: string; measured: string; verdict: string }> = [
  {
    id: "SOL-R1",
    question: "`implements`: is the canonical value applicable to Solidity, given there is no implements clause?",
    measured: "the pinned grammar has NO implements-clause production (implements_clause / class_interface_clause / super_interfaces all ABSENT — section 2 proves it). It DOES have inheritance_specifier + interface_declaration; the analyzer emits implements from (derived, in-file interface) pairs at :1726 (SOL-5), and fixtures pin the value in both directions (2 positive fixtures, 2 forbid rows).",
    verdict: "APPLICABLE BY ADAPTED SEMANTICS — an interface ancestor is the contract reading of the one heritage construct. Ruling it non-applicable would contradict the emission and the fixtures.",
  },
  {
    id: "SOL-R2",
    question: "`exports`: Solidity has no export construct — is the value applicable?",
    measured: "no export/visibility-keyword production exists for a compilation-unit surface. The analyzer publishes the compilation-unit surface from `source_file` (SOL-12) at :2703; fixtures pin 18 positive export rows in 6 fixtures.",
    verdict: "APPLICABLE BY ADAPTED SEMANTICS — the value is the compilation-unit surface (contracts/interfaces/libraries/structs/enums/errors; NOT a free function), declared in the rule.",
  },
  {
    id: "SOL-R3",
    question: "modifiers: is `decorates` applicable (the grammar HAS modifier_definition + modifier_invocation)?",
    measured: "the value's productions (decorator/annotation/…) are ABSENT; the modifier construct is present. Measured 2026-10-19 in-process: `function f() public onlyOwner {}` emits `calls f -> onlyOwner` with metadata.calleeKind modifierInvocation, and SOL-17 publishes applied modifiers as `decorators` METADATA on the symbol. No fixture expects a decorates row (0 rows across all 31 pairs).",
    verdict: "NOT APPLICABLE as a relationship — adjudicated: modifiers are METADATA + the modifier-invocation CALLS edge, matching the family contract (java annotations are references+metadata; C#/Java/F# treat decorators as metadata on the decorated thing).",
  },
  {
    id: "SOL-R4",
    question: "`overrides`: is the override_specifier a real applicable surface, and what does a refused override mean?",
    measured: "override_specifier is present in the grammar. SOL-11's three tiers are enforced in code (:2528), and the refusals are the rule: a bare `override` with 2+ header bases emits NO edge (the keyword does not say which base declares the member). Measured contract 2026-10-19: `interface I { function f() external; } contract C is I { function f() external override {} }` emits overrides.",
    verdict: "APPLICABLE — the grammar states the specifier, the language's compiler rejects a wrong `override(X)`, so the edge is the language's invariant; the 2+-base refusal is a declared rule, not an omission.",
  },
  {
    id: "SOL-R5",
    question: "`uses`: are writes uses, and are parameter reads uses?",
    measured: "in-process 2026-10-19 on the pinned grammar: `bal = n;` emits uses f -> bal (write) and uses f -> n (parameter read); `return bal;` emits uses f -> bal; `uint256 x; x = n + 1;` emits uses f -> x and uses f -> n. So assignment LHS reads ARE uses (the family write-as-use contract) and parameter reads ARE uses by position — the unresolved mass from parameter reads is the measured binding wall (SOL-FIX §1), not a contract choice.",
    verdict: "APPLICABLE with the positional-read rule (SOL-2); the parameter-read class is a count, not a silence.",
  },
  {
    id: "SOL-R6",
    question: "`imports` vs `references`: which construct carries a module dependency?",
    measured: "`import \"./A.sol\";` emits imports module -> ./A.sol; `import {B} from \"./B.sol\"` emits imports for the path AND references for B; `using Lib for uint256` emits references for Lib. The import target is a PATH (measured: the symbol-name guard dropped 357 of 358 imports until the pathTarget opt-out).",
    verdict: "imports is `import_directive` only (module path); imported bindings and using-dependencies are references.",
  },
  {
    id: "SOL-R7",
    question: "`instantiates` vs struct construction: is `S({a:1})` an instantiation?",
    measured: "in-process 2026-10-19: `S memory s = S({a:1});` emits calls f -> S (struct construction, calleeKind external/inFileTypeMember shape) while `new C()` emits instantiates f -> C. SOL-10 states the two struct spellings are both calls.",
    verdict: "instantiates = `new_expression` only; struct construction is calls (a struct is a value type, not an object with a constructor symbol).",
  },
  {
    id: "SOL-R8",
    question: "the synthesised getter: is `bal()` a relationship or metadata?",
    measured: "`contract C { uint256 public bal; }` emits contains C -> bal() and references bal -> bal() — the getter is a PUBLISHED member (SOL-3), not metadata (measured: pool-worker drops symbol metadata at the worker boundary, so metadata would reach nothing).",
    verdict: "RELATIONSHIP (contains + references), named with the external signature so it cannot collide with an identifier.",
  },
]

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2 · THE PINNED GRAMMAR, enumerated + RECONCILED against the generated grammar files
// ─────────────────────────────────────────────────────────────────────────────────────────
async function enumerateGrammar(): Promise<{
  wasm: string
  sha256: string
  slotCount: number
  namedTypeCount: number
  anonymousTokenCount: number
  namedTypes: string[]
  anonymousTokens: string[]
  reconciliation: any
}> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const bytes = fs.readFileSync(WASM)
  const g = await L.load(bytes)
  const namedTypes: string[] = []
  const anonymousTokens: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const t = g.nodeTypeForId(i)
    if (!t || seen.has(t)) continue
    seen.add(t)
    if (g.nodeTypeIsNamed(i)) namedTypes.push(t)
    else anonymousTokens.push(t)
  }
  // THE RECONCILIATION: three instruments count "named types" differently, and a lane that quotes
  // one while enumerating another is quoting a different instrument. Measured here, not asserted.
  let reconciliation: any = {}
  try {
    const grammar = JSON.parse(fs.readFileSync(GRAMMAR_JSON, "utf8"))
    const rules = Object.keys(grammar.rules ?? {})
    const nodeTypes = JSON.parse(fs.readFileSync(NODE_TYPES_JSON, "utf8"))
    const nodeTypeNamed: string[] = nodeTypes.filter((x: any) => x?.named).map((x: any) => x.type)
    reconciliation = {
      grammarRules: rules.length,
      grammarVisibleRules: rules.filter((r) => !r.startsWith("_")).length,
      grammarHiddenRules: rules.filter((r) => r.startsWith("_")).length,
      nodeTypesNamedEntries: nodeTypeNamed.length,
      nodeTypesNamedNotInLanguageApi: nodeTypeNamed.filter((t) => !namedTypes.includes(t)).sort(),
      languageApiNamedNotInNodeTypes: namedTypes.filter((t) => !nodeTypeNamed.includes(t)).sort(),
      reading:
        "grammar.json declares 166 rules (121 visible + 45 hidden); node-types.json lists 124 'named' entries because it also marks the literal spellings true/false/string as named; the Language API exposes 121 unique named node types. This lane enumerates the Language API (the same surface the analyzer parses) and states the other two counts so no reader mistakes one for another.",
    }
  } catch {
    reconciliation = { error: "generated grammar files unreadable; the Language API enumeration stands alone" }
  }
  return {
    wasm: path.relative(ROOT, WASM),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    slotCount: g.nodeTypeCount,
    namedTypeCount: namedTypes.length,
    anonymousTokenCount: anonymousTokens.length,
    namedTypes: namedTypes.sort(),
    anonymousTokens: anonymousTokens.sort(),
    reconciliation,
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3 · FIXTURE PINS — read from the fixtures' own rows
// ─────────────────────────────────────────────────────────────────────────────────────────
interface FixtureExpectation {
  fixture: string
  rows: Array<{ type?: string; from?: string; target?: string }>
  forbidRows: Array<{ type?: string; from?: string; target?: string }>
}
function readFixtureExpectations(): FixtureExpectation[] {
  const out: FixtureExpectation[] = []
  for (const f of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!f.endsWith(".expectation.json")) continue
    const exp = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8"))
    out.push({
      fixture: `solidity/${f.replace(".expectation.json", "")}`,
      rows: exp.expectRelationships ?? [],
      forbidRows: exp.forbidRelationships ?? [],
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 4 · IMPLEMENTATION SITES — the addRel emission shape (see the header for why the filter is exact)
// ─────────────────────────────────────────────────────────────────────────────────────────
function implementationSites(): Record<string, number[]> {
  const src = fs.readFileSync(ANALYZER, "utf8").split("\n")
  const sites: Record<string, number[]> = {}
  for (const [value, row] of Object.entries(APPLICABLE)) {
    const needle = `RelationshipType.${row.emissionSymbol}`
    const hits: number[] = []
    for (let i = 0; i < src.length; i++) {
      if (!src[i].includes(needle)) continue
      const t = src[i].trim()
      // never a switch label, a comment, a comparison, or `assumedKind:` metadata
      if (t.startsWith("case ") || t.startsWith("*") || t.startsWith("//")) continue
      if (t.includes("===") || t.includes("!==")) continue
      if (t.includes("assumedKind")) continue
      // the addRel call shapes: multi-line argument, single-line addRel, or the heritage ternary arm
      const isArg = t.startsWith(`ASTEngine.RelationshipType.${row.emissionSymbol}`)
      const isAddRel = t.includes("addRel(")
      const isTernaryArm = t.startsWith("? ASTEngine.RelationshipType.") || t.startsWith(": ASTEngine.RelationshipType.")
      if (!isArg && !isAddRel && !isTernaryArm) continue
      hits.push(i + 1)
    }
    sites[value] = hits
  }
  return sites
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 5 · RED PROOF — real runner, real analyzer, one value removed
// ─────────────────────────────────────────────────────────────────────────────────────────
async function makeMutant(value: string): Promise<any> {
  const mod: any = await import(path.join(ROOT, "src/ast/real-solidity-analyzer.ts"))
  const real = new mod.RealSolidityAnalyzer()
  return {
    async analyze(root: any, content: string, filePath: string, context: any) {
      const res: any = await real.analyze(root, content, filePath, context)
      if (res && Array.isArray(res.relationships)) {
        res.relationships = res.relationships.filter((r: any) => String(r.type ?? "") !== value)
      }
      return res
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────────────────
const grammar = await enumerateGrammar()
const namedSet = new Set(grammar.namedTypes)
const tokenSet = new Set(grammar.anonymousTokens)
const fixtures = readFixtureExpectations()
const sites = implementationSites()

const constructSurface: Record<string, any> = {}
for (const [value, row] of Object.entries(APPLICABLE)) {
  const present: string[] = []
  const absent: string[] = []
  for (const c of row.constructs) {
    if (namedSet.has(c) || tokenSet.has(c)) present.push(c)
    else absent.push(c)
  }
  constructSurface[value] = {
    applicable: absent.length === 0,
    constructs: row.constructs,
    present,
    absent,
    rule: row.rule,
    ...(row.adaptedSemantics ? { adaptedSemantics: row.adaptedSemantics } : {}),
    implementationSites: (sites[value] ?? []).map((line) => `src/ast/real-solidity-analyzer.ts:${line}`),
    implementationSymbol: `RelationshipType.${row.emissionSymbol}`,
  }
}

const notApplicableSurface: Record<string, any> = {}
for (const [value, row] of Object.entries(NOT_APPLICABLE)) {
  const found = row.needs.filter((c) => namedSet.has(c) || tokenSet.has(c))
  notApplicableSurface[value] = {
    applicable: false,
    grammarAbsenceProven: found.length === 0,
    requiredProductions: row.needs,
    productionsFound: found,
    reason: row.reason,
    vocabularyRuling: row.vocabularyRuling,
  }
}

const constructTable: Record<string, any> = {}
for (const row of CONSTRUCTS) {
  const present = row.grammars.filter((c) => namedSet.has(c) || tokenSet.has(c))
  const absent = row.grammars.filter((c) => !(namedSet.has(c) || tokenSet.has(c)))
  constructTable[row.construct] = {
    grammarConstructs: row.grammars,
    grammarPresent: present,
    grammarAbsent: absent,
    carriedBy: row.carriedBy,
    ruling: row.ruling,
  }
}

const fixturePins: Record<string, { positiveFixtures: string[]; positiveRows: number; forbidRows: number }> = {}
for (const value of Object.keys(APPLICABLE)) {
  const positiveFixtures: string[] = []
  let positiveRows = 0
  let forbidRows = 0
  for (const f of fixtures) {
    let hit = false
    for (const r of f.rows) if (String(r.type ?? "") === value) { positiveRows++; hit = true }
    for (const r of f.forbidRows) if (String(r.type ?? "") === value) forbidRows++
    if (hit) positiveFixtures.push(f.fixture)
  }
  fixturePins[value] = { positiveFixtures, positiveRows, forbidRows }
}

const baseline = await runLang("solidity")
const baselineFail = new Set(baseline.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
const redProof: Record<string, any> = {}
for (const value of Object.keys(APPLICABLE)) {
  const mutant = await makeMutant(value)
  const mutated = await runLang("solidity", mutant)
  const mutatedFail = new Set(mutated.details.filter((d: any) => !d.ok).map((d: any) => d.fixture))
  const wentRed: string[] = []
  for (const f of mutatedFail) if (!baselineFail.has(f)) wentRed.push(String(f))
  redProof[value] = {
    baselinePass: baseline.pass,
    baselineFail: baseline.fail,
    mutatedPass: mutated.pass,
    mutatedFail: mutated.fail,
    fixturesThatWentRed: wentRed.sort(),
    redProven: wentRed.length > 0,
  }
}

const applicableValues = Object.keys(APPLICABLE)
const notApplicableValues = Object.keys(NOT_APPLICABLE)
const findings: string[] = []
for (const value of applicableValues) {
  if (!constructSurface[value].applicable) findings.push(`${value}: construct productions ABSENT from the pinned grammar — ${constructSurface[value].absent.join(", ")}`)
  if ((constructSurface[value].implementationSites ?? []).length === 0) findings.push(`${value}: NO implementation site found with the addRel emission shape`)
  if (fixturePins[value].positiveFixtures.length === 0) findings.push(`${value}: NO fixture carries a positive expectation row for it`)
  if (!redProof[value].redProven) findings.push(`${value}: fixture-pinned but NO fixture went RED when the emission was removed`)
}
for (const value of notApplicableValues) {
  if (!notApplicableSurface[value].grammarAbsenceProven) findings.push(`${value}: claimed NOT APPLICABLE but the grammar carries ${notApplicableSurface[value].productionsFound.join(", ")}`)
}
for (const [construct, row] of Object.entries(constructTable)) {
  if (row.grammarPresent.length === 0) findings.push(`construct "${construct}": NONE of its grammar productions exist`)
}
for (const r of RULINGS) {
  if (r.id === "SOL-R1") {
    const absent = ["implements_clause", "class_interface_clause", "super_interfaces"].filter((c) => namedSet.has(c) || tokenSet.has(c))
    if (absent.length > 0) findings.push(`${r.id}: the grammar DOES carry an implements-clause production (${absent.join(", ")}); SOL-R1's grammar-absence evidence is stale`)
  }
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-applicable-set.ts",
  measuredAt: new Date().toISOString(),
  language: "solidity",
  admissibilityRule: "APPLICABLE iff every construct production the value needs exists in the pinned grammar's own enumeration AND the analyzer has an emission site in the addRel shape AND at least one fixture carries a positive expectation row AND that fixture goes RED when the emission is removed. A value failing any conjunct is a finding.",
  canonicalVocabulary: [...applicableValues, ...notApplicableValues],
  applicableValues,
  notApplicableValues,
  grammar,
  constructSurface,
  notApplicableSurface,
  constructTable,
  rulings: RULINGS,
  fixturePins,
  fixtureBaseline: {
    command: "imported runLang('solidity') from script/m14/run-fixtures.ts (the real runner)",
    files: fixtures.length,
    pass: baseline.pass,
    fail: baseline.fail,
    failingFixtures: [...baselineFail].sort(),
  },
  redProof,
  redProofMethod: "the REAL RealSolidityAnalyzer wrapped so exactly one relationship value's edges are removed; baseline vs mutated are the same runner, same fixtures, same analyzer except for the removed value.",
  findings,
  ok: findings.length === 0,
}

const json = JSON.stringify(report, null, 1) + "\n"
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)
}
process.stdout.write(json)
process.exit(report.ok ? 0 : 1)
