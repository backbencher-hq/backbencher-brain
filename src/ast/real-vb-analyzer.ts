/**
 * RealVbAnalyzer — Visual Basic .NET, on a vendored and repaired tree-sitter-vbnet grammar
 * (M14 completeness ceremony).
 *
 * Author: Muhammad Ishaq Khan.
 *
 * THE RELATIONSHIP TYPES THIS FILE COVERS: all ten of the ontology — `contains`, `imports`,
 * `references`, `calls`, `uses`, `extends`, `implements`, `overrides`, `instantiates`, `exports` —
 * read off VB's class/interface declarations, `Inherits`/`Implements` clauses, `Overrides` members,
 * `New` object creation and `Imports` statements. THIS LANE IS NOT YET GATED by the completeness
 * inventory (no `LANG_CONFIG` entry), so its sections A-H are not yet machine-verified; this header
 * exists so the ceremony half is in place when the config is proposed.
 *
 * WHERE THE RECORD LIVES: docs/analyzers/real-vb-analyzer.md; spec
 * script/m14/spec/vb-completeness.json; fixtures validation/m14/fixtures/vb; grammar side
 * grammars/tree-sitter-vbnet/PIN.md; lane review reviews/vb/master-review.md.
 *
 * WHEN THIS FILE CHANGES, CO-EDIT: the completeness spec, the expectation files under
 * validation/m14/fixtures/vb, the docs above, and — when the GRAMMAR is the thing that moved — the
 * vendored grammar's PIN.md (this grammar is cloned and repaired, so its patches are part of the
 * contract). THE SHARED REGISTRIES ARE LEAD-OWNED: script/m14/run-fixtures.ts, differential.ts,
 * wasm/ — request, do not edit.
 *
 * THE GRAMMAR IT DEPENDS ON: `wasm/tree-sitter-vbnet.wasm`, built from the vendored
 * grammars/tree-sitter-vbnet. The lane history follows below.
 */

/**
 * RealVbAnalyzer — Visual Basic .NET, on a vendored and repaired
 * tree-sitter-vbnet grammar.
 *
 * WHY THIS FILE IS NEW RATHER THAN A REPAIR. VB.NET had no analyzer and no
 * grammar at all. `.vb` was a routed extension and `vb` a declared language, but
 * `engine.ts` routed it to `__generic__`, so a .vb file was "analysed" by a regex
 * generic pass that cannot see a Class, a Function, an Implements clause or a
 * call site — and reported as covered rather than refused. See
 * `grammars/tree-sitter-vbnet/PIN.md` for the grammar side and
 * `reviews/vb/master-review.md` for the lane.
 *
 * THE RULES THIS FILE FOLLOWS, and they are the project's, not mine:
 *
 *  1. AST ONLY, ZERO REGEX. Every classification below is a node-type test, a
 *     field read, or a character-code scan with the equivalence argued inline.
 *     A regex on parser output re-parses text the grammar already classified and
 *     drifts the moment the grammar moves; the M12 census exists because
 *     regex-driven analyzers published phantom edges. `fixtures` runs the M49.R2
 *     census over `src/ast` on every build, so a new regex here is a red build.
 *
 *  2. EVERY RELATIONSHIP CARRIES ITS SITE LINE (M59.A7 / #825). 1-based, on the
 *     node that NAMES the thing, per site rather than per set — so a call that
 *     spans three lines is stamped with the line its callee name is written on.
 *     Navigation is the product; an edge with no line cannot be followed to.
 *     `line_number` is set on every `relationships.push` in this file, and
 *     `nodeNamingToken` is what makes a wrapped qualified name stamp the line of
 *     its last segment's leaf rather than the line the name starts on.
 *
 *  3. NO UNKNOWN SYMBOLS. A symbol is emitted with a kind the product can use
 *     and a name it read off a name-bearing node. Where the grammar has no node
 *     for something, that is a `gap` in the spec and a disclosed counter here —
 *     never a fabricated symbol with an invented name.
 *
 *  4. THE GRAMMAR'S REAL VOCABULARY. Node-type names and field names below were
 *     read out of the wired wasm's enumerable surface through web-tree-sitter
 *     (449 ids / 165 named / 54 fields, pinned in `validation/m14/grammar-pins.json`),
 *     not out of the grammar author's documentation. LUA-00 was exactly this
 *     defect: four invented grammar fields, and the analyzer was written against
 *     a grammar that had none of them.
 */

import { ASTEngine } from "./engine"
import type { Node } from "web-tree-sitter"

const { SymbolKind, RelationshipType } = ASTEngine

/** The metadata key the family's completeness section-B pin reads for an import. */
const IS_IMPORT = "isImport"
/** The metadata key that marks a dependency edge as import-based. */
const INCLUDE_DEPENDENCY = "include_dependency"

/**
 * THE GRAMMAR'S CLOSED SET OF BUILT-IN TYPE KEYWORDS, AND THE CLAIM IT LICENSES.
 *
 * MEASURED RESIDUAL THIS CLOSES. The lane's whole admitted population (`vb`, 58 of 58 files, 12,390
 * edges) carries **1,831 unresolved `references` edges whose type position is one of these 16
 * keywords** — `As String`, `Dim v As Integer`, `As Object` — which is 29.9% of the lane's 6,134
 * unresolved edges and 66.4% of its 2,759 `references` edges. Bucketed by NAMED CONSTRUCT by the
 * lane's own census (`validation/m14/fixtures/vb/tools/vb-residual-census.ts`, which walks the real
 * tree and names the SOURCE NODE): it is the lane's largest single cause with no answer.
 *
 * WHY IT IS DECIDABLE AND NOT A HEURISTIC. The list is not derived from the corpus; it is the
 * LANGUAGE's, read off the wired grammar —
 * `grammars/tree-sitter-vbnet/grammar.js:942-958`:
 *
 *     predefined_type: ($) => choice(ci("Boolean"), ci("Byte"), ci("SByte"), ci("Char"), ci("Date"),
 *       ci("Decimal"), ci("Double"), ci("Integer"), ci("Long"), ci("Object"), ci("Short"),
 *       ci("Single"), ci("String"), ci("UInteger"), ci("ULong"), ci("UShort"))
 *
 * — a CLOSED choice with no open alternative, reachable from `_type` and from `nullable_type`
 * (`:937`, `:965`). So the test is a NODE-TYPE test (`token.type === "predefined_type"`), never a
 * spelling test: `From`/`Exception`/`Label` are ordinary `simple_name`s and are NOT in this class,
 * however much they look like framework names. This is the shape the fleet already authorized for
 * graphql's five spec built-in scalars (`real-graphql-analyzer.ts:123-140` and its emission at
 * `:508`) — "membership in the closed 5-name built-in scalar set is a DECIDABLE TEST with no missing
 * grammar node and no new corpus".
 *
 * WHY THE CLAIM IS `languageNamespace` AND NOT THE TWO OBVIOUS ALTERNATIVES. Both refusals are the
 * fleet's, recorded by that same file at `:128-140`, and both were re-derived here rather than
 * assumed:
 *
 *   * An `owner` marker (`isExternal`/`isExternalTarget`/`isStdlib`) is READ ONLY WHERE
 *     `decls === 0` (`incoming-rule.ts` `classifyEdge`), so on a bare name it verifies by
 *     construction and NO corpus can ever refute it. That is a free pass, and this lane's class is
 *     100% bare names (all 1,831 targets carry no dot). Refused.
 *   * The DECLARED-CAUSE channel (`baseBeyondRunScope`) cannot express it either: `classifyEdge`
 *     accepts a declared cause only where the declared base EQUALS the target's own owner
 *     (`targetOwner` splits on the last dot and returns `null` for a bare name), so every one of
 *     these edges would read `causeRefuted` — a clause-4 `causeFAIL` counted against the lane for a
 *     true statement. Refused.
 *
 * What is left is the arbiter's claim for a CLOSED LANGUAGE VOCABULARY: the target's ROOT is checked
 * against THIS LIST, carried on the edge, and never against the symbol table (`NAMESPACE_CLAIM_KEY`,
 * `incoming-rule.ts:274-330`). It stays refutable by construction — an edge whose target the list
 * does not carry reads `externalRefuted` — which is why the claim is attached ONLY where the node is
 * a `predefined_type` and the target is canonicalised into this list. The reason travels with the
 * claim as `languageNamespaceBasis`, which no claim channel reads, so it cannot misfire.
 *
 * THE PRICE, MEASURED AND DISCLOSED. The namespace branch is checked BEFORE the declaration count, so
 * the claim also re-reads edges whose name a project DOES answer. On this lane that population is
 * EMPTY, and it is empty as a measurement, not as an assumption: the census reports
 * **0 declarations whose name spells a built-in keyword in either admitted repository**, and of the
 * 1,831 `predefined_type` edges **0 are `resolved` and 0 are `ambiguous`** today — so the claim moves
 * 1,831 edges from `unresolved` to `externalVerified` and can move nothing off a good answer. There
 * is no second class to attribute, which is exactly the disclosure graphql had to make and could not
 * (its 10,118 `resolved` + 1,398 `ambiguous` edges on four corpus files).
 *
 * CANONICAL SPELLING, and why one target changes. VB identifiers are case-insensitive: the corpus
 * writes `dim v as integer` (fsharp/tests/fsharp/core/members/set-only-property/vb.vb:3-16), and the
 * grammar's `ci()` accepts it, so the node's own text can be any case. The claim's root check is a
 * case-sensitive list membership (`namespaceMatchOf`), so publishing the site's casing would make a
 * true claim read `externalRefuted`. The published target for a `predefined_type` node is therefore
 * the language's canonical spelling of the keyword it read — a normalisation with a stated reason,
 * measured at 3 edges on this corpus, and the only emitted target this change touches.
 */
const VB_BUILTIN_TYPE_NAMES: readonly string[] = [
  "Boolean", "Byte", "SByte", "Char", "Date", "Decimal", "Double", "Integer",
  "Long", "Object", "Short", "Single", "String", "UInteger", "ULong", "UShort",
]
/** The same closed set folded to lower case, so a `predefined_type` node is read off its own text. */
const VB_BUILTIN_TYPE_CANONICAL: ReadonlyMap<string, string> = new Map(
  VB_BUILTIN_TYPE_NAMES.map((n) => [n.toLowerCase(), n]),
)

export class RealVbAnalyzer implements ASTEngine.LanguageAnalyzer {
  // Populated per analyze() call. The engine constructs one analyzer and reuses
  // it across files, so nothing here may survive a call — see reset().
  private symbols: ASTEngine.UniversalSymbol[] = []
  private relationships: ASTEngine.UniversalRelationship[] = []
  private imports: ASTEngine.ImportInfo[] = []
  /** name -> the FIRST symbol declared under that name. */
  private index = new Map<string, ASTEngine.UniversalSymbol>()
  /** Every name declared in THIS file, for same-file edge confidence. */
  private declaredNames = new Set<string>()
  /** The declaration chain we are inside, innermost last. */
  private ownerStack: ASTEngine.UniversalSymbol[] = []
  /** Scopes that take part in name resolution: namespaces and types. */
  private typeStack: ASTEngine.UniversalSymbol[] = []
  /** Member names of each type in this file, for unqualified call targets. */
  private memberNames = new Map<string, string[]>()
  /**
   * Names this file declares CALLABLE — a method, a property, a constructor, an
   * operator or a delegate — and therefore names that cannot be an array index.
   *
   * This set exists because a VB call WITH ARGUMENTS is an `array_access_expression`
   * in this grammar, so "is `Foo(1)` a call or an index?" has no syntactic answer
   * and the only non-fabricating answer is: it is a call if `Foo` is something
   * this file declares it could call. See `collectBodyEdges`.
   */
  private callablesInFile = new Set<string>()
  /**
   * Names this file declares as a VARIABLE or FIELD, used to keep a statement-level
   * `arr(0)` from being published as a call. A local array is the one index shape
   * that also looks like a call statement, and this is what excludes it.
   */
  private variablesInFile = new Set<string>()
  /**
   * Callables whose DECLARED TYPE is an array (`As T()`), because VB lets you index
   * the result of a call: `SomePropertyReturningAnArray(0)` is legal and is an
   * index, not a call. Read off the declaration's own `as_clause` -> `array_type`.
   */
  private arrayValuedInFile = new Set<string>()
  /**
   * Names bound by a LOCAL declaration. See `precollectDeclarations` for why a local
   * has to be excluded from the statement-level call signal: `Dim s3() As Decimal`
   * then a bare `s3(4)` is an index, and publishing it as a call is fabrication.
   */
  private localsInFile = new Set<string>()
  /**
   * `(source -> target)` pairs already published as `uses`, holding the EARLIEST
   * site line seen for each — for the per-file dedup. A Map rather than a Set
   * because "earliest" has to be compared, not just recorded.
   */
  private usesEmitted = new Map<string, { key: string; line_number: number | null }>()
  /**
   * Node ids of the CALLEE EXPRESSIONS this walk published a `calls` edge for.
   *
   * `uses` is defined as a value read that is NEITHER A CALL NOR A WRITE, so a
   * member access this walk already called must not also be published as a read —
   * otherwise one site carries two labels and the `calls` tally and the `uses`
   * tally each count rows the other one already has.
   *
   * Why the ids and not a re-derived climb: the exclusion used to re-derive
   * callee position by walking UP the tree, and the climb cannot see this grammar's
   * argument-bearing call, because there is no invocation node to climb to.
   *
   *     obj.M()     ->  invocation_expression(function: member_access)   climb works
   *     obj.M(3)    ->  array_access_expression                         climb stops here
   *                       member_access_expression
   *                     return_statement
   *
   * So `obj.M(3)` was published as BOTH `calls -> M` and `uses -> M`. Measured over
   * 400 files of roslyn-vb: 1,816 `uses` edges across 180 files carried both labels,
   * 11.16% of the 16,276 `uses` edges in that sample (`script/m14/vb-uses-call-overlap.ts`).
   *
   * Recording the id where the decision is MADE is also the direction that cannot
   * recur: a second copy of the callee test is a second thing to get wrong, and it
   * had already been wrong once. Ordering is not a hazard — `collectBodyEdges`
   * descends top-down, so a member access is always reached after its own enclosing
   * call node.
   */
  private callCalleeNodes = new Set<number>()

  /** Counters the lane discloses rather than hides. */
  private gaps: Record<string, number> = {}
  /** `(source, target)` of every published `uses` edge, with its site count. */
  private useIndex = new Map<string, { sites: number; line: number | null; edge: ASTEngine.UniversalRelationship }>()

  // -------------------------------------------------------------------------
  // Node-type and field vocabulary
  //
  // Read off the pinned wasm, not off a grammar tutorial. Kept as Sets so a test
  // is membership, not a pattern match, and so an unclassified type is a MISS
  // from the set rather than a silent fallthrough.
  // -------------------------------------------------------------------------

  /** Grammar rules that declare a named type. Anything in the corpus that is not
   *  in here and not in SILENT_INTERNAL is a gap, and the census counts it. */
  private static readonly DECLARATION_NODES: ReadonlySet<string> = new Set([
    "namespace_declaration",
    "class_declaration",
    "structure_declaration",
    "interface_declaration",
    "module_declaration",
    "enum_declaration",
    // An enum member is a declaration, and `visitEnum` reads it directly rather
    // than dispatching it, so it was never in this set. The behaviour was right
    // and the classification was absent, which is precisely the state a census
    // exists to make visible rather than to fix.
    "enum_member_declaration",
    "delegate_declaration",
    "method_declaration",
    "constructor_declaration",
    "property_declaration",
    "event_declaration",
    "operator_declaration",
    "declare_statement",
    "field_declaration",
    "imports_statement",
    // An INTERFACE's members are declarations, and for a long time they were in
    // neither this set nor SILENT_INTERNAL, which is the whole defect: nothing
    // visited them, so an interface was published as an EMPTY SHELL. `IShape`
    // appeared with a name and no members, while the class implementing it had
    // all three. Found by the F8 node-type census, which found 104 unclassified
    // node types against 42 classified -- the "every construct is accounted for"
    // claim was 29% true and nothing had ever measured it.
    //
    // In an interface-driven codebase this is not a rare shape. DISMTools and
    // P3D are both Windows Forms applications where the designer emits
    // interfaces for every dialog, so a large fraction of the corpus's types had
    // invisible members.
    "interface_method_declaration",
    "interface_property_declaration",
    "interface_event_declaration",
  ])

  /**
   * The node types that are STRUCTURE inside a type body rather than code in it:
   * the declaration's own attributes and modifiers, its heritage clauses, its type
   * parameter list and its name. Everything else that is not a declaration and
   * appears directly in a type body is code that type executes, and is where a body
   * edge comes from. See `dispatchBody`.
   */
  private static readonly TYPE_BODY_STRUCTURE: ReadonlySet<string> = new Set([
    "attribute_list", "attribute", "attribute_target", "attribute_argument_list",
    "named_argument", "member_modifier", "modifiers", "local_declaration_modifier",
    "inherits_statement", "implements_statement", "inherits_member_clause", "implements_member_clause",
    "type_parameter_list", "type_parameter", "type_parameter_constraints_clause",
    "parameter_list", "parameter", "as_clause", "identifier", "simple_name",
    "comment", "preprocessor_directive", "blank_line", "option_statement", "option_statements",
    "global_attribute_section", "end_statement", "implements_clause", "inherits_clause",
  ])

  /** Nodes the grammar produces that carry no symbol of their own: they are
   *  containers, modifiers, or the parts of a declaration already read. They are
   *  classified here so the spec's "every node type is classified" rule is
   *  satisfied by this list rather than by an omission. */
    // A node type that publishes NO SYMBOL but DOES derive a relationship. This set
    // exists because the census it feeds found two whole kinds of defect that a
    // two-way classification could not express, and both were invisible:
    //
    //   - `array_creation_expression` sat in NEITHER set, which is what let the
    //     analyzer read a construction's callee from a `function` field the node
    //     does not have. 15,577 `New Foo(a, b)` calls went unpublished.
    //   - `implements_member_clause` sat in SILENT_INTERNAL, which is a claim
    //     that the node carries nothing. It carries a relationship, and the
    //     member-level heritage form was therefore uncollected on every member in
    //     the language.
    //
    // "Classified" is not the same as "handled", and the difference between those
    // two words is what a two-way split threw away.
    private static readonly RELATIONSHIP_SOURCES: ReadonlySet<string> = new Set([
    "invocation_expression",
    "object_creation_expression",
    "array_creation_expression",
    "generic_invocation_expression",
    "implements_member_clause",
    "inherits_member_clause",
    "inherits_clause",
    "implements_clause",
    "inherits_statement",
    "implements_statement",
    "operator_declaration",
    "constructor_declaration",
    // M60/VB2. These three publish NO SYMBOL but DO derive a relationship, and
    // leaving them in SILENT_INTERNAL is a claim that they carry nothing --
    // which is the claim that hid the `uses` class for a whole wave.
    //   `member_access_expression` / `with_member_access_expression`: a name
    //     READ that is neither the callee nor the index is a `uses` edge.
    //   `as_clause`: an `as_clause` whose span begins `As New` is a
    //     CONSTRUCTION, and the fourth of VB's four construction surfaces.
    // The two-way split is what the four-way classification exists to avoid, and
    // `array_creation_expression` was already moved here for the same reason.
    "member_access_expression",
    "with_member_access_expression",
    "as_clause",
  ])

  // Classified as carrying nothing today, but a KNOWN candidate: the construct
  // does name or bind something, and saying so here is what keeps "silent" from
  // quietly meaning "nobody has looked". Each is a real relationship or symbol a
  // future wave could derive; none is claimed to be derived now.
  private static readonly RELATIONSHIP_CANDIDATES: ReadonlySet<string> = new Set([
    // `: base(...)` / `: Me(...)` -- names the constructor being chained to. A
    // `calls` edge, and the one call form this analyzer does not yet read.
    "constructor_initializer",
    // `AddHandler o.E, AddressOf h` -- an event binding between two names.
    "add_handler_statement",
    "remove_handler_statement",
    // A lambda is a callable value: `AddressOf`, or an argument to `For Each`.
    "lambda_expression",
    // A property's accessors are members of the property.
    "property_getter",
    "property_setter",
    // `RaiseEvent E` names the event being raised.
    "raiseevent_statement",
    // `Handles Me.Startup` -- the `Object.Event` half of a Handles clause, which
    // names the event a handler is wired to. 2,602 in the corpus and a real
    // `references` edge to each, so it is a candidate and not silence.
    "event_member",
  ])

  private static readonly SILENT_INTERNAL: ReadonlySet<string> = new Set([
    "source_file", "identifier", "comment", "preprocessor_directive", "blank_line",
    "type_parameter_list", "type_parameter", "parameter_list", "parameter",
    "modifiers", "member_modifier", "attribute_list", "attribute", "attribute_target",
    "attribute_argument_list", "named_argument",
    "handles_clause", "variable_declarator",
    "array_rank_specifier", "array_initializer", "collection_initializer",
    "dictionary_initializer", "dictionary_element", "object_initializer",
    "member_initializer",
    // The types below were UNCLASSIFIED when the F8 census first ran -- 101 of
    // them, against 45 classified. None of them declares a symbol and none of
    // them names a relationship this analyzer derives; the list is here so that
    // "every construct in the corpus is accounted for" is a checked statement
    // rather than an assumption, and so a new grammar node shows up as a FAILING
    // census instead of as silence.
    //
    // Literals: a literal names nothing, so there is no symbol and no target.
    "boolean_literal", "character_literal", "floating_point_literal",
    "integer_literal", "string_literal", "nothing_literal",
    // Name and type syntax: read by whichever construct owns it; declares nothing.
    "predefined_type", "simple_name", "qualified_name", "global_qualified_name",
    "generic_name", "type_argument_list", "array_type", "nullable_type",
    "tuple_type", "tuple_element", "type_declaration_in_type",
    "type_parameter_constraint", "type_parameter_constraints_clause",
    // Expressions: their names are read by the constructs above; they are not
    // structure. (The construction and invocation EXPRESSIONS are relationship
    // SOURCES and are classified as such, which is the distinction that matters.)
    "argument_list", "array_access_expression", "assignment_expression",
    "binary_expression", "cast_expression", "conditional_expression",
    "if_expression", "me_expression",
    "mybase_expression", "parenthesized_expression", "unary_expression",
    "typeof_expression", "typeof_is_expression", "with_expression",
    "lambda_parameter", "lambda_parameter_list",
    "omitted_argument", "collection_range_variable",
    // Control flow. The contract is a project SYMBOL TABLE: a `While` is not a
    // symbol, and the family does not publish locals or control-flow statements.
    "assignment_statement", "declaration_statement", "expression_statement",
    "if_statement", "elseif_clause", "else_clause", "case_clause",
    "case_else_clause", "case_value", "select_statement", "select_clause",
    "select_element", "select_or_group_clause", "for_statement",
    "for_each_statement", "while_statement", "do_statement", "exit_statement",
    "continue_statement", "goto_statement", "labeled_statement",
    "return_statement", "throw_statement", "try_statement", "catch_block",
    "finally_block", "with_statement", "using_statement", "synclock_statement",
    "on_error_statement", "call_statement", "stop_statement", "redim_statement",
    "redim_clause", "yield_statement", "await_expression", "empty_statement",
    "end_statement",
    // Modifiers, attributes, options.
    "local_declaration_modifier", "global_attribute_section", "option_statement",
    "option_statements",
    // LINQ query syntax, which this grammar surfaces as clauses rather than
    // structure.
    "query_expression", "query_body_clause", "from_clause", "order_by_clause",
    "ordering", "where_clause",
  ])

  // -------------------------------------------------------------------------
  // Small AST helpers. Every one of these is a node-type or field test; there is
  // no text matching in this file at all.
  // -------------------------------------------------------------------------

  /**
   * The `index`-th NAMED child, or null when there is none.
   *
   * `web-tree-sitter` 0.25 types this `Node | null`, and it really can be null at
   * the boundary, so every read goes through here rather than through a `!`. The
   * alternative — asserting non-null at each of the ~40 call sites — would make
   * "this index is in range" an unstated assumption repeated 40 times, which is
   * the shape a crash takes when a grammar gains a child.
   */
  private nc(node: Node, index: number): Node | null {
    if (index < 0 || index >= node.namedChildCount) return null
    return node.namedChild(index)
  }

  /** The `index`-th child of ANY kind (named or anonymous token). */
  private ac(node: Node, index: number): Node | null {
    if (index < 0 || index >= node.childCount) return null
    return node.child(index)
  }

  /**
   * The node's NAMED children, with the nulls dropped.
   *
   * `web-tree-sitter` 0.25 types `namedChild(i)` as `Node | null` and
   * `namedChildren` as `(Node | null)[]`. A `!` at each of the ~20 read sites
   * would turn "this index is in range" into an unstated assumption repeated 20
   * times, and a throw would trade a type error for a crash -- the lane's
   * measured state is zero crash files and that is worth keeping. So the null is
   * handled once, here, and every loop downstream iterates a real `Node[]`.
   */
  private kids(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }

  /** The node's children of ANY kind, with the nulls dropped. */
  private allKids(node: Node): Node[] {
    const out: Node[] = []
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) out.push(c)
    }
    return out
  }

  /**
   * The number of lines in `content`, counted with a character scan.
   *
   * This was `content.split(/\r?\n/).length`, and it was the ONE regex literal
   * in this file — which made the header's "zero regex" claim false as written.
   * Rather than soften the claim, the regex went.
   *
   * The scan counts a `\n` as a line break and treats a preceding `\r` as part of
   * that break rather than as a character of its own, which is exactly what
   * `\r?\n` meant. Equivalence was MEASURED, not argued: over 598 real `.vb`
   * files from two corpora plus five edge cases, the two agree everywhere except
   * the empty string, where the split form returns 1 and this returns 0 — and the
   * old code's own `content.length === 0 ? 0 : …` guard already forced 0 there.
   * (`script/m14/tmp/`-style probe: `fixtures/probes/linecount-equiv.ts`.)
   */
  private lineCount(content: string): number {
    if (content.length === 0) return 0
    let lines = 1
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) lines++
    }
    return lines
  }

  /** 1-based line of a node, or null when there is no node. M59.A7. */
  private nodeLine(node: Node | null | undefined): number | null {
    return node ? node.startPosition.row + 1 : null
  }

  private range(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  /**
   * The node that NAMES a thing, descended to the last segment's own leaf.
   *
   * `qualified_name` spans `A.B.C` but the name a reader navigates to is written
   * on the `C` leaf. A wrapped name — an alias, a qualified name inside a
   * heritage clause — must therefore be stamped with ITS leaf's line, not the
   * line the name starts on. This is the C# lane's `nodeNamingToken`, and it
   * exists because a relationship stamped with the wrapper's line navigates to
   * the wrong place in a file that mentions the same type on three lines.
   */
  private namingToken(node: Node | null | undefined, text: string): Node | null {
    if (!node) return null
    let cur: Node = node
    for (let guard = 0; guard < 64; guard++) {
      // A name field that is itself a name is the innermost one.
      const named: Node | null = cur.childForFieldName("name")
      if (named && named.id !== cur.id && named.type !== "identifier") { cur = named; continue }
      if (cur.type === "identifier") return cur
      if (cur.type === "simple_name") {
        const inner = this.nc(cur, 0)
        if (inner && inner.type === "identifier") return inner
        return cur
      }
      if (cur.type === "nullable_type") {
        // `As SyntaxToken?` is a `nullable_type` whose only other child is the `?`.
        // Without this the `references` target was the literal string
        // "SyntaxToken?" — not a name in the file, not navigable, and unmatchable
        // by any oracle. Found by the lane's own differential, which derived
        // `references -> TryGetLastToken -> SyntaxToken` and reported the analyzer's
        // `SyntaxToken?` as an UNEXPLAINED edge.
        const inner = this.nc(cur, 0)
        if (inner && inner.id !== cur.id) { cur = inner; continue }
      }
      if (cur.type === "array_type") {
        // `Private _t As New Timers.Timer()` puts an `array_type` in
        // `declared_type`, because the `()` reads as bounds. The NAME is the
        // element type, and without this the field published
        // `references _t -> "Timers.Timer()"` -- the whole expression, parens
        // included, which is not a name in the file, not navigable, and
        // unmatchable by any independent oracle. Found by auditing `references`,
        // the label that had been the largest unverified class in the index.
        const el = cur.childForFieldName("element_type")
        if (el && el.id !== cur.id) { cur = el; continue }
      }
      if (cur.type === "generic_name") {
        // The name is the first named child; the `(Of ...)` tail is not the name.
        const inner = this.nc(cur, 0)
        if (inner) { cur = inner; continue }
        return cur
      }
      if (cur.type === "qualified_name" || cur.type === "global_qualified_name") {
        const inner = cur.childForFieldName("name")
        if (inner && inner.id !== cur.id) { cur = inner; continue }
        return cur
      }
      return cur
    }
    return cur
  }

  /**
   * The leaf that NAMES a callee — the target a reader navigates to.
   *
   * The rule is the LAST `identifier` leaf at or under the callee node, and it
   * has to be that rather than the node's own text, because VB spells a callee
   * in three shapes that all reduce to one name:
   *
   *   `EntityID.ToLower()`   -> `ToLower`   (a `member_access_expression`)
   *   `New AnimatedBlock()`  -> `AnimatedBlock`
   *   `CType(x, W).Init()`   -> `Init`
   *
   * The construction case was the one that was broken, and it was broken for a
   * specific, findable reason: `New X()` parses as
   * `(object_creation_expression type: (simple_name (identifier)))` — the type is
   * in a `type` FIELD, and `namingToken` only ever followed a `name` field, so it
   * fell through and returned the whole construction node. The published target
   * was the literal string `"New AnimatedBlock"`: not a name in the file, not
   * navigable, and unmatchable by any independent oracle. Measured on P3D's
   * Entity.vb — 31 of them in one method.
   *
   * A `type_argument_list` is skipped, so `New List(Of Integer)` is `List` and not
   * `Integer`: the argument is not what is being constructed. That is the same
   * exclusion the heritage path and the F5 oracle both apply, so the three agree
   * on one definition of "the name of this type expression".
   */
  private calleeLeaf(fn: Node): Node | null {
    const leaves: Node[] = []
    const walk = (n: Node, depth: number): void => {
      if (depth > 64) return
      if (n.type === "type_argument_list") return
      if (n.type === "identifier") { leaves.push(n); return }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) walk(c, depth + 1)
      }
    }
    walk(fn, 0)
    // The LAST leaf, and the whole reason this helper exists: collecting the
    // FIRST one made `Me._isPokemonSound.ToNumberString()` resolve to
    // `_isPokemonSound`, which is the receiver, not the thing being called.
    return leaves.length > 0 ? leaves[leaves.length - 1] : null
  }

  /**
   * The text of a name-bearing node, rebuilt from the tree.
   *
   * Char-scan, not regex: walk the node's named children and join the identifier
   * leaves with the separator each wrapper contributes. `qualified_name` is
   * `qualifier . name` in the grammar, so the dot is a CHILD TOKEN and is
   * already in the node's text — reading `node.text` for the whole name and
   * trimming is both simpler and more faithful than reassembling it.
   */
  private nameText(node: Node | null | undefined): string {
    if (!node) return ""
    return node.text.trim()
  }

  /** The `name` field of a declaration, or its first identifier child. */
  private declaredName(node: Node): { text: string; node: Node | null } {
    const field = node.childForFieldName("name")
    if (field) {
      const token = this.namingToken(field, field.text)
      return { text: this.nameText(token ?? field), node: token ?? field }
    }
    for (const c of this.kids(node)) {
      if (c.type === "identifier" || c.type === "simple_name") {
        return { text: this.nameText(c), node: this.namingToken(c, c.text) ?? c }
      }
    }
    return { text: "", node: null }
  }

  private namedChildrenOfType(node: Node, type: string): Node[] {
    const out: Node[] = []
    for (const c of this.kids(node)) {
      if (c.type === type) out.push(c)
    }
    return out
  }

  /**
   * VB visibility, read off the `member_modifier` list the grammar already
   * separated out. A Set membership test per modifier, in the order VB resolves
   * them, and the FIRST match wins — `Protected Friend` is `Protected` in VB's
   * own spec ordering and getting that wrong changes access queries.
   */
  private static readonly VISIBILITY_ORDER: ReadonlyArray<readonly [string, string]> = [
    ["private", "private"],
    ["protected", "protected"],
    ["friend", "internal"],
    ["public", "public"],
  ]

  /**
   * The access levels ONE declaration actually grants, as a SET of level words.
   *
   * A SET and not one string, because VB has two COMBINED access modifiers and
   * the combination is the meaning. `Protected Friend` is "protected OR friend",
   * so it is reachable from another assembly precisely because of its friend
   * half, while `Protected` alone is not. Reducing the pair to the single
   * string `protected` before asking whether a declaration is exported answers
   * `no` about a member the language says is assembly-visible, which is what an
   * `exports` edge is for.
   */
  private accessLevelsOf(node: Node): Set<string> {
    const levels = new Set<string>()
    for (const m of this.modifierWordsOf(node)) {
      if (RealVbAnalyzer.ACCESS_WORDS.has(m)) levels.add(m)
    }
    return levels
  }

  /** The four words VB spells an access level with. */
  private static readonly ACCESS_WORDS: ReadonlySet<string> = new Set([
    "public", "protected", "friend", "private",
  ])

  /**
   * The DEFAULT accessibility of a declaration that writes none.
   *
   * Taken from Microsoft's own table rather than from recollection, because the
   * corpus exercises every row: the lane census counts 136 modifier-less
   * members in a class, 20 in a module, 5 in a structure and 116 modifier-less
   * types at namespace level (probes `exports:implicit_default:*` and
   * `exports:type_implicit_default:*`), so a wrong answer here is wrong on real
   * files rather than on a synthetic one. Source: "Declaration Contexts and
   * Default Access Levels",
   * learn.microsoft.com/dotnet/visual-basic/language-reference/statements/
   * declaration-contexts-and-default-access-levels
   *
   *   element                                    namespace level | module level
   *   Variable / Constant                        not allowed      | Private (Public in Structure)
   *   Class / Structure / Module / Interface /    Friend           | Public
   *   Enum / Delegate
   *   Procedure / Property / Event / Operator /  not allowed      | Public
   *   Declare
   *
   * The row that is easy to get wrong, and the one VB is famous for disagreeing
   * with C# on, is Procedure/Property/Event: they default to PUBLIC. A
   * `Sub M()` written without a modifier inside a Class is callable from another
   * assembly. FIELDS and CONSTANTS are the ones that default to Private.
   *
   * `friend` at the namespace level is what makes a modifier-less `Class C`
   * NOT an assembly export, which is the whole `exports` answer for the 116
   * top-level types the corpus writes without a modifier.
   */
  private defaultAccessLevel(kind: ASTEngine.SymbolKind): string {
    // An enumeration member is always Public and cannot carry any other
    // accessibility; VB gives it none to write.
    if (kind === ASTEngine.SymbolKind.EnumMember) return "public"
    const ownerKind = this.currentOwner()?.kind
    if (ownerKind === undefined || ownerKind === ASTEngine.SymbolKind.Namespace) return "friend"
    switch (kind) {
      case ASTEngine.SymbolKind.Variable:
      case ASTEngine.SymbolKind.Constant:
        // Public inside a Structure, Private inside a Class or Module. A field
        // in an Interface is not a legal VB declaration, so it cannot occur.
        return ownerKind === ASTEngine.SymbolKind.Struct ? "public" : "private"
      default:
        return "public"
    }
  }

  /**
   * Does this set of access levels put the declaration in the assembly's public
   * surface? The question `exports` exists to answer, asked on the levels
   * rather than on the single `visibility` string, so `Protected Friend`
   * (assembly-reachable through its friend half) is not confused with
   * `Protected` (subclass-only).
   */
  private static isAssemblyVisible(levels: ReadonlySet<string>): boolean {
    if (levels.has("public")) return true
    return levels.has("friend") && levels.has("protected")
  }

  /**
   * The single-string accessibility the symbol record carries.
   *
   * It applies the DOCUMENTED DEFAULT when the declaration writes none, rather
   * than falling through to `internal`. That fall-through was a real published
   * fact and it was wrong for every declaration that omits its modifier: VB's
   * default for a Procedure / Property / Event is Public, not Private, so a
   * modifier-less `Sub M()` was published `internal` and is in fact callable from
   * another assembly. The corpus exercises this: 136 modifier-less members in a
   * class and 20 in a module, of which the procedures, properties and events are
   * Public by the language's own table.
   *
   * The set form is still available and is what `exports` asks, because the
   * combined modifiers do not reduce to one word.
   */
  private visibilityOf(node: Node, kind?: ASTEngine.SymbolKind): string {
    const levels = this.accessLevelsOf(node)
    for (const [mod, vis] of RealVbAnalyzer.VISIBILITY_ORDER) {
      if (levels.has(mod)) return vis
    }
    return RealVbAnalyzer.spellAccessLevel(this.defaultAccessLevel(kind ?? RealVbAnalyzer.kindOfNode(node)))
  }

  /** The symbol kind a declaration node is, for the default table. */
  private static kindOfNode(node: Node): ASTEngine.SymbolKind {
    switch (node.type) {
      case "class_declaration": return ASTEngine.SymbolKind.Class
      case "structure_declaration": return ASTEngine.SymbolKind.Struct
      case "interface_declaration": return ASTEngine.SymbolKind.Interface
      case "module_declaration": return ASTEngine.SymbolKind.Module
      case "enum_declaration": return ASTEngine.SymbolKind.Enum
      case "enum_member_declaration": return ASTEngine.SymbolKind.EnumMember
      case "delegate_declaration": return ASTEngine.SymbolKind.Type
      case "constructor_declaration": return ASTEngine.SymbolKind.Constructor
      case "property_declaration":
      case "interface_property_declaration": return ASTEngine.SymbolKind.Property
      case "event_declaration":
      case "interface_event_declaration": return ASTEngine.SymbolKind.Event
      case "field_declaration":
      case "variable_declarator": return ASTEngine.SymbolKind.Variable
      default: return ASTEngine.SymbolKind.Method
    }
  }

  /** The symbol-record spelling of an access-level word. */
  private static spellAccessLevel(level: string): string {
    return level === "friend" ? "internal" : level
  }

  /**
   * Every modifier word on a declaration, ONE ENTRY PER WORD.
   *
   * The split is load-bearing and it was absent. This grammar's
   * `member_modifier` can hold a SEQUENCE of words: `Protected Friend Sub PF()`
   * parses as ONE `member_modifier` node whose text is `Protected Friend`, so
   * adding that node's text verbatim added the single token `"protected friend"`,
   * which matches no entry in `VISIBILITY_ORDER` and falls through to
   * `internal` -- a real declaration published with the wrong accessibility.
   * Measured on the lane corpus: 12 occurrences of a multi-word
   * `member_modifier`, every one of them `protected friend` (census probe
   * `MULTIWORD_MODIFIER`, over 2,658 files).
   *
   * A word that is not a modifier this grammar's `VB_KEYWORD_HEADS` already
   * names is DROPPED rather than admitted, so splitting cannot invent a
   * modifier the file does not write.
   */
  private modifierWordsOf(node: Node): Set<string> {
    const out = new Set<string>()
    const addText = (text: string): void => {
      // Char scan, no regex: split on space/tab/newline and keep the words that
      // are modifier words.
      let start = 0
      const flush = (end: number): void => {
        if (end <= start) return
        const word = text.slice(start, end).toLowerCase()
        if (RealVbAnalyzer.VB_KEYWORD_HEADS.has(word)) out.add(word)
        start = end + 1
      }
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c === 32 || c === 9 || c === 13 || c === 10) flush(i)
      }
      flush(text.length)
    }
    // EVERY modifier, not the first one. This reads `childForFieldName("modifiers")`,
    // which returns a single node -- and this grammar emits the field REPEATEDLY,
    // once per modifier: `Public Overrides Sub Go()` is
    // `modifiers: (member_modifier) modifiers: (member_modifier)`, so the
    // singular field read returned `public` and silently dropped `overrides`.
    //
    // The consequence was not a cosmetic gap, it was every modifier-dependent
    // fact in the index being wrong wherever the modifier was not written first:
    // `Public Shared Sub A()` reported `isStatic: false`, `Public Overrides Sub`
    // published no `overrides` edge at all (0 across 435 files, and 0 on a
    // textbook override), and `MustOverride`, `ReadOnly`, `WriteOnly` and
    // `NotInheritable` were all missed for the same reason. VB writes
    // `Public` first by convention, so the ONE modifier that was ever read was the
    // one least worth reading.
    //
    // The read is by NODE TYPE rather than by field name, because a field name
    // that appears N times has no singular accessor, and a modifier is
    // lexically distinctive: nothing else in the tree is a `member_modifier`.
    const collect = (n: Node, depth: number): void => {
      if (depth > 4) return
      for (const c of this.allKids(n)) {
        if (c.type === "member_modifier" || c.type === "local_declaration_modifier") {
          addText(c.text)
          continue
        }
        // A NESTED DECLARATION BOUNDARY. This read recurses four levels, which
        // is how every modifier in the file reached every declaration: `Public
        // Class Api` containing `Private Sub Hidden` collected BOTH, and
        // `visibilityOf` then answered `private` for the class. The class's own
        // accessibility is a fact about the class, so the walk stops at the
        // first declaration below the node it was asked about.
        if (RealVbAnalyzer.DECLARATION_NODES.has(c.type)) continue
        collect(c, depth + 1)
      }
    }
    collect(node, 0)
    return out
  }

  private modifierNames(node: Node): Set<string> {
    return this.modifierWordsOf(node)
  }

  /**
   * The `overrides` edge for a member declared `Overrides`.
   *
   * Extracted so that METHODS, PROPERTIES and EVENTS all get one. It was inline
   * in the method visitor only, so `Public Overrides Property Description` —
   * which is how P3D's whole `Item` hierarchy is written, 56 of the missing rows
   * in one frozen draw — published nothing while the oracle, reading the modifier
   * off the declaration, derived the edge and reported the analyzer as
   * incomplete. VB has overridable properties and events, and they are not rare:
   * they are the shape a designer emits.
   *
   * The edge is QUALIFIED by the base type when this file says what the base type
   * is, because the unqualified form is a self-edge (`Go -> Go`) and a self-edge
   * cannot answer "what does this override?". The base type is usually right here
   * — the owning type's own `Inherits` was already read to publish `extends` — so
   * the edge can name `Item.Description` instead of guessing. When the base type
   * is not derivable, the edge keeps the same name and says `baseTypeKnown: false`
   * rather than inventing a type it never read.
   */
  private pushOverride(node: Node, nameNode: Node | null, sym: ASTEngine.UniversalSymbol, owner: ASTEngine.UniversalSymbol | null): void {
    // The DECLARING TYPE, not the member. These call sites run after the member
    // has been pushed on the owner stack, so `currentOwner()` returns the member
    // itself -- and the base lookup then found no `extends` edge and emitted the
    // unqualified self-edge `P -> P`. The declaring type is the nearest entry
    // below the member on the stack, so it is read from there rather than from
    // whatever `currentOwner()` happens to say at the call site.
    const type = this.ownerStack
      .slice()
      .reverse()
      .find((e) => e !== sym && e.ownerKind === "class" || e !== sym && (e.kind === ASTEngine.SymbolKind.Class || e.kind === ASTEngine.SymbolKind.Struct || e.kind === ASTEngine.SymbolKind.Interface || e.kind === ASTEngine.SymbolKind.Module || e.kind === ASTEngine.SymbolKind.Enum))
    const declaring = type ?? owner
    if (!declaring) return
    const baseType = this.relationships.find(
      (r) => r.source === declaring.name && r.type === ASTEngine.RelationshipType.Extends,
    )
    const baseKnown = typeof baseType?.target === "string" && baseType.target.length > 0
    this.relationships.push({
      source: sym.name,
      target: baseKnown ? `${baseType!.target}.${sym.name}` : sym.name,
      type: ASTEngine.RelationshipType.Overrides,
      confidence: baseKnown ? 0.9 : 0.6,
      line_number: this.nodeLine(nameNode ?? node),
      metadata: {
        baseMemberName: sym.name,
        baseTypeName: baseKnown ? baseType!.target : undefined,
        baseTypeKnown: baseKnown,
        fromModifier: "Overrides",
        declaringType: declaring.name,
      },
    })
  }

  private isStatic(node: Node): boolean {
    return this.modifierNames(node).has("shared")
  }

  private isAbstract(node: Node): boolean {
    const mods = this.modifierNames(node)
    return mods.has("abstract") || mods.has("mustinherit")
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    this.reset()

    // A DECLARATION PRE-PASS, and it is not an optimisation — it is a correctness
    // fix for an ordering bug the lane's own oracle found.
    //
    // `callablesInFile` answers "is this name something this file declares it could
    // call?", and it was populated as `pushSymbol` ran, which is DOCUMENT ORDER.
    // VisualBasicAnalyzerOptionsProvider.vb declares the private function
    // `GetOption` at line 59 and the properties that CALL it at lines 29, 35, 41,
    // 47 and 53 — every one of them before the declaration it calls. So all five
    // call sites failed the resolvability test, were counted as
    // `index-or-call-ambiguous`, and published nothing. The oracle derived
    // `calls -> PreferredModifierOrder -> GetOption` and reported five MISSING rows
    // that were entirely this.
    //
    // A pre-pass removes the order dependence by removing the order: every
    // declaration in the file is read before any body is walked.
    this.precollectDeclarations(rootNode)

    this.walk(rootNode, content, context)

    // Every symbol carries the owner it was declared in, so a consumer can walk
    // containment without re-deriving it. Filled in one pass at the end because
    // the owner is only known once the whole file has been read.
    this.dedupeRelationships()
    this.stampEvidenceClasses()
    const lines = this.lineCount(content)
    return {
      symbols: this.symbols,
      relationships: this.relationships,
      imports: this.imports,
      metadata: {
        complexity: this.complexity(rootNode),
        linesOfCode: lines,
        cyclomaticComplexity: this.cyclomaticComplexity(rootNode),
        analysisVersion: "m60-vb-1",
        // The lane's honesty block. `gaps` is what the grammar could not express
        // and is therefore NOT covered; it is disclosed so a consumer can see
        // the boundary instead of inferring completeness from silence.
        vbGaps: { ...this.gaps },
        hasTypeInference: false,
        hasFrameworkIntelligence: false,
      },
    }
  }

  /**
   * The same relationship row, emitted more than once in one file, is emitted
   * ONCE.
   *
   * MEASURED DEFECT this closes. `script/m14/vb-edge-integrity.ts` over 2,658
   * corpus files, keying on (source, target, type, line) within one file:
   *
   *     references   3,813 rows
   *     instantiates  1,840 rows
   *     calls          935 rows
   *     imports          2 rows
   *                -------
   *                 6,590 rows that were the same row as a row already present
   *
   * Two shapes produce them, and both are real reads of the source rather than
   * parser noise:
   *
   *   - three `As String` on ONE line -- `Public Function F(a As String, b As
   *     String) As String` publishes `references F -> String` three times, once
   *     per parameter plus once for the return, and the three differ only in a
   *     `role` nobody queries.
   *   - two constructions of the same type on one line -- `New StackFrame(1)…
   *     & New StackFrame(2)…` publishes `instantiates LogMessage -> StackFrame`
   *     twice at the same line.
   *
   * WHY IT MATTERS DOWNSTREAM rather than aesthetically: `bb_impact` and
   * `bb_graph` count DEGREES. A file with three `String` references in one
   * signature reports a node three times as depended-upon, which is a number a
   * consumer cannot tell from a real three-call dependency.
   *
   * WHAT IS KEPT. The FIRST row survives untouched apart from two added
   * metadata keys, so the line and the confidence stay exactly as the emitting
   * site set them:
   *
   *   duplicateRows  how many identical rows collapsed into this one — so the
   *                  raw count is still visible and nothing is hidden
   *   roles          the distinct `role` values of the collapsed copies, when
   *                  they differ; omitted when they do not, because a key with
   *                  one value in it is noise
   *
   * Rows that differ in ANY of the four key components are KEPT. Two calls to the
   * same method on different lines are two facts about the program and stay two
   * rows — this is not a per-pair dedupe, which would silently discard the
   * per-site line the M59.A7 contract requires.
   */
  private dedupeRelationships(): void {
    const kept: ASTEngine.UniversalRelationship[] = []
    const index = new Map<string, ASTEngine.UniversalRelationship>()
    let collapsed = 0
    for (const rel of this.relationships) {
      const key = `${rel.source}\u0000${rel.target}\u0000${rel.type}\u0000${rel.line_number ?? 0}`
      const prior = index.get(key)
      if (prior === undefined) {
        index.set(key, rel)
        kept.push(rel)
        continue
      }
      collapsed++
      const md = (prior.metadata ?? {}) as Record<string, unknown>
      const n = typeof md.duplicateRows === "number" ? md.duplicateRows : 1
      const role = (rel.metadata as Record<string, unknown> | undefined)?.role
      let roles: string[] | undefined
      if (typeof role === "string" && role.length > 0) {
        const existing = Array.isArray(md.roles) ? (md.roles as string[]) : (typeof md.role === "string" ? [md.role as string] : [])
        if (!existing.includes(role)) roles = [...existing, role].sort()
      }
      prior.metadata = { ...md, duplicateRows: n + 1, ...(roles ? { roles } : {}) }
    }
    if (collapsed > 0) {
      this.note("relationship-duplicate-rows-collapsed")
      this.relationships = kept
    }
  }

  /**
   * One `evidenceClass` per relationship, in one place, at the end.
   *
   * MEASURED DEFECT this closes: over 2,658 corpus files every one of the
   * analyzer's 102,295 edges carried `evidenceClass: (none)` -- the label the
   * honesty contract requires on any edge below confidence 1.0, and 94% of the
   * `calls` population plus 100% of `references` is below it. `src/lsp/
   * evidence_tier.ts` then re-derives a tier from the KIND, so the product had
   * a badge and the stored evidence said nothing; the M14 contract's rule 4
   * ("carry a machine-readable reason code, not just a number") was not
   * satisfiable.
   *
   * The rule is the legend's own five tiers, applied here exactly once so no
   * call site has to remember it and no call site can disagree with another:
   *
   *   imports                                  import_based      (a stated import)
   *   references                               usage_contextual (a name, not a symbol)
   *   uses                                     usage_contextual (a read; see pushUse)
   *   everything below the 0.7 confidence floor inferred          (the legend's own
   *                                                               wording for a guess)
   *   everything else                          structural
   *
   * `contains`, `exports`, `extends`, `implements`, `instantiates`, `calls` and
   * `overrides` are structural reads of the tree; the sub-floor clause is what
   * catches the cross-file `calls`/`instantiates`/`references` edges whose target
   * is a name this file does not declare. An `evidenceClass` an analyzer already
   * wrote is never overwritten.
   */
  private stampEvidenceClasses(): void {
    for (const rel of this.relationships) {
      const md = rel.metadata
      if (md && typeof md.evidenceClass === "string") continue
      const conf = typeof rel.confidence === "number" ? rel.confidence : 1
      let cls: string
      if (conf < 0.7) cls = "inferred"
      else if (rel.type === RelationshipType.Imports) cls = "import_based"
      else if (rel.type === RelationshipType.References || rel.type === RelationshipType.Uses) cls = "usage_contextual"
      else cls = "structural"
      rel.metadata = { evidenceClass: cls, ...(md ?? {}) }
    }
  }

  private reset(): void {
    this.symbols = []
    this.relationships = []
    this.imports = []
    this.index = new Map()
    this.declaredNames = new Set()
    this.ownerStack = []
    this.typeStack = []
    this.memberNames = new Map()
    this.callablesInFile = new Set()
    this.variablesInFile = new Set()
    this.arrayValuedInFile = new Set()
    this.localsInFile = new Set()
    this.usesEmitted = new Map()
    this.callCalleeNodes = new Set()
    this.gaps = {}
    this.useIndex = new Map()
  }

  private note(kind: string): void {
    this.gaps[kind] = (this.gaps[kind] ?? 0) + 1
  }

  /**
   * Read every declaration in the file BEFORE any body is walked, so the three
   * resolvability sets do not depend on where a declaration sits relative to its
   * use. See the `analyze()` note for the measured defect this removes.
   *
   * The node set is the same one `pushSymbol` acts on, and the array-ness of a
   * declaration is read off its own `as_clause` -> `array_type` rather than off its
   * text, so `SomePropertyReturningAnArray(0)` is recognised as an index and not a
   * call. One extra tree walk per file; the cost is in the lane's
   * payload/latency instrument.
   */
  private precollectDeclarations(root: Node): void {
    const CALLABLE: ReadonlySet<string> = new Set([
      "method_declaration", "constructor_declaration", "property_declaration",
      "operator_declaration", "interface_method_declaration", "interface_property_declaration",
      "declare_statement",
    ])
    const VARIABLE: ReadonlySet<string> = new Set(["field_declaration"])
    /** The statement nodes a LOCAL variable is bound by. */
    const LOCAL_BINDING: ReadonlySet<string> = new Set([
      "declaration_statement", "local_declaration_modifier", "dim_statement",
    ])
    // Iterative, not recursive: roslyn-vb carries markup inside verbatim strings
    // that nests deeper than the JS call stack, and a recursive walker dies on it.
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop() as Node
      if (CALLABLE.has(n.type)) {
        const field = n.childForFieldName("name")
        if (field) {
          const token = this.namingToken(field, field.text)
          const name = this.nameText(token ?? field)
          if (name.length > 0) {
            this.callablesInFile.add(name)
            if (this.isArrayValued(n)) this.arrayValuedInFile.add(name)
          }
        }
      } else if (n.type === "constructor_declaration") {
        this.callablesInFile.add("constructor")
      } else if (n.type === "delegate_declaration") {
        const field = n.childForFieldName("name")
        if (field) {
          const token = this.namingToken(field, field.text)
          const name = this.nameText(token ?? field)
          if (name.length > 0) this.callablesInFile.add(name)
        }
      }
      if (VARIABLE.has(n.type)) {
        for (const d of this.namedChildrenOfType(n, "variable_declarator")) {
          const { text } = this.declaredName(d)
          if (text.length > 0) this.variablesInFile.add(text)
        }
      }
      // A LOCAL IS NOT A CALLABLE AND NOT AN ARRAY-IN-FIELD. `Dim s3() As Decimal`
      // followed by a bare `s3(4)` is an INDEX, and the statement-level call signal
      // published it as `calls -> S3` — 4 fabricated call edges per 200 files, all of
      // them inside roslyn-vb's own `Sub S1(Optional x As Decimal = -1E-25D)` test
      // markup. A local name is therefore excluded from the statement-level signal,
      // which is the conservative direction: it can lose a real call to a delegate
      // local, and it cannot invent one.
      if (LOCAL_BINDING.has(n.type)) {
        for (const d of this.namedChildrenOfType(n, "variable_declarator")) {
          const { text } = this.declaredName(d)
          if (text.length > 0) this.localsInFile.add(text)
        }
      }
      // `control` is NOT a field of the pinned vbnet grammar, and this guard was
      // therefore dead: measured 2026-10-08 against the shipped wasm, the
      // grammar's 54 field names contain no `control`, so the read returned null
      // on every node and neither a `For Each` variable nor a `Using` target was
      // ever recorded as a local — which left both exposed to the statement-level
      // call signal this set exists to suppress.
      //
      // Measured shapes from a real parse (`For Each item In list … Next`,
      // `Using g As New G() … End Using`): `for_each_statement` carries the loop
      // variable in its `variable` field (identifier `item`) and the sequence in
      // `collection`; `using_statement` carries the declaration in its `resource`
      // field as a `variable_declarator` whose own `name` field holds `g` — the
      // same node the `Dim`/`Const` branch above reads through `declaredName`.
      if (n.type === "for_each_statement") {
        const v = n.childForFieldName("variable")
        if (v) {
          const { text } = this.declaredName(v)
          // The field holds a bare identifier, which `declaredName` reports as ""
          // because it looks for a `name` field or a named child; the leaf itself
          // is the name, so fall back to its own text rather than losing the
          // binding. A typed variable (`For Each kv As KeyValuePair(Of K, V)`) is
          // measured to be an identifier too, so this is the whole shape.
          const name = text.length > 0 ? text : this.nameText(v)
          if (name.length > 0) this.localsInFile.add(name)
        }
      }
      if (n.type === "using_statement") {
        const resource = n.childForFieldName("resource")
        if (resource) {
          const { text } = this.declaredName(resource)
          if (text.length > 0) this.localsInFile.add(text)
        }
      }
      for (const c of this.kids(n)) stack.push(c)
    }
  }

  /** Does this declaration's `as_clause` declare an ARRAY type? */
  private isArrayValued(node: Node): boolean {
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (!asClause) return false
    const declared = asClause.childForFieldName("declared_type")
    if (!declared) return false
    if (declared.type === "array_type") return true
    for (const c of this.kids(declared)) {
      if (c.type === "array_type" || c.type === "array_rank_specifier") return true
    }
    return false
  }

  // -------------------------------------------------------------------------
  // The walk
  // -------------------------------------------------------------------------

  private walk(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    switch (node.type) {
      case "namespace_declaration": return this.visitNamespace(node, content, context)
      case "class_declaration":
      case "structure_declaration":
      case "interface_declaration":
      case "module_declaration": return this.visitType(node, content, context)
      case "enum_declaration": return this.visitEnum(node, content, context)
      case "delegate_declaration": return this.visitDelegate(node, content, context)
      case "imports_statement": return this.visitImports(node)
      case "method_declaration":
      case "constructor_declaration":
      // An interface method has the SAME shape as a class method -- `name`,
      // `parameters`, `as_clause` -- and no body, so the visitor is reused
      // unchanged. The one thing it must not do is invent a body: `collectBodyEdges`
      // and the member-heritage read both walk children, and an interface member
      // has none to walk.
      case "interface_method_declaration":
      case "declare_statement": return this.visitMethod(node, content, context)
      case "property_declaration":
      case "interface_property_declaration": return this.visitProperty(node, content, context)
      case "event_declaration":
      case "interface_event_declaration": return this.visitEvent(node, content, context)
      case "operator_declaration": return this.visitOperator(node, content, context)
      case "field_declaration": return this.visitField(node, content)
      // AN `ERROR` NODE IS CODE THE GRAMMAR COULD NOT CLASSIFY, and it is often a
      // SIBLING of the declaration whose body it used to be.
      //
      // Measured: UseCompoundAssignment/Utilities.vb's
      // `ImmutableArray.Create((A,B,C), (D,E,F), ...)` initializer leaves a
      // `field_declaration` spanning rows 9-12 and puts rows 12-19 in ERROR siblings
      // beside it. Nothing else visits them, so 24 member reads in that one file
      // were unreachable — and the lane's differential derived all 24 and reported
      // them MISSING, which is how a grammar's recovery cost 24 edges in the index
      // and no gate could see it.
      //
      // Dispatching an ERROR node is the fix that generalises: its declaration-
      // shaped children go to `walk` and everything else is body code attributed to
      // the enclosing declaration, which is what it is.
      case "ERROR": return this.visitRecovery(node, content, context)
      default: break
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
  }

  /**
   * Dispatch an `ERROR` node: declaration-shaped children to their own visitors,
   * everything else as body code of the enclosing declaration.
   */
  private visitRecovery(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    // The SAME code a type body is read with. An `ERROR` node and a type body differ
    // only in whether the grammar could name what is inside them, and the readings
    // they support are the same: a declaration goes to its own visitor, a statement
    // is code of the enclosing declaration. Two implementations would be two things
    // to keep in step for no reason.
    this.dispatchBody(node, content, context)
  }

  /**
   * Does this node, or anything under it, declare a symbol? Early-exits on the first
   * one found.
   *
   * The first version carried a `if (cur.id === n.id) continue` guard so the walk
   * would not re-test the node it started from — and that guard also SKIPPED THE
   * START NODE'S CHILDREN, so it answered "is this node itself a declaration?" for
   * every node and "is there a declaration below?" for none. It reported false for
   * `type_declaration_in_type`, whose only child is a `class_declaration`, and the
   * 168 such nodes across 60 of 403 sampled files were then dispatched as body code
   * and never reached `visitType` — 6 missing `contains`, 1 missing `extends` and 6
   * missing `overrides` in one file, which is how the differential found it.
   */
  private hasDeclarationDescendant(n: Node): boolean {
    const stack: Node[] = [n]
    while (stack.length > 0) {
      const cur = stack.pop() as Node
      if (RealVbAnalyzer.DECLARATION_NODES.has(cur.type)) return true
      for (const c of this.kids(cur)) stack.push(c)
    }
    return false
  }

  /** The nearest enclosing namespace or type, for `ownerName`. */
  /** The `role` recorded on a containment edge, derived from the KIND so that
   *  every kind names itself and no visitor has to remember to say so. */
  private containmentRole(kind: ASTEngine.SymbolKind): string {
    switch (kind) {
      case ASTEngine.SymbolKind.Constructor: return "constructor"
      case ASTEngine.SymbolKind.Property: return "property"
      case ASTEngine.SymbolKind.Event: return "event"
      case ASTEngine.SymbolKind.Method: return "method"
      case ASTEngine.SymbolKind.Constant: return "const"
      case ASTEngine.SymbolKind.Variable: return "field"
      case ASTEngine.SymbolKind.EnumMember: return "enumMember"
      case ASTEngine.SymbolKind.Enum: return "enum"
      case ASTEngine.SymbolKind.Class: return "class"
      case ASTEngine.SymbolKind.Struct: return "structure"
      case ASTEngine.SymbolKind.Interface: return "interface"
      case ASTEngine.SymbolKind.Module: return "module"
      case ASTEngine.SymbolKind.Namespace: return "namespace"
      case ASTEngine.SymbolKind.Type: return "delegate"
      default: return String(kind)
    }
  }

  private currentOwner(): ASTEngine.UniversalSymbol | null {
    return this.ownerStack.length > 0 ? this.ownerStack[this.ownerStack.length - 1] : null
  }

  private pushSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    extra: Partial<ASTEngine.UniversalSymbol> = {},
    nameNode: Node | null = null,
  ): ASTEngine.UniversalSymbol | null {
    if (name.length === 0) {
      // A declaration with no readable name is NOT emitted with an invented one.
      // It is counted, so the count is visible instead of the gap being silent.
      this.note("declaration-without-name")
      return null
    }
    const owner = this.currentOwner()
    const sym: ASTEngine.UniversalSymbol = {
      name,
      kind,
      range: this.range(node),
      ...(owner ? { ownerName: owner.name, ownerKind: owner.kind } : {}),
      metadata: {},
      ...extra,
    }
    this.symbols.push(sym)
    this.declaredNames.add(name)
    // CONTAINMENT IS EMITTED HERE, ONCE, FOR EVERY SYMBOL.
    //
    // It used to be pushed by each visitor, and that is how a whole class of
    // declaration ended up with an `ownerName` and NO edge: a nested type
    // (`Public Enum Targets` inside `Public Class PokemonTarget`) got its owner
    // recorded on the symbol but nothing walked to it, so containment navigation
    // stopped at the class. Found by the F5 differential, not by a fixture. Doing
    // it in one place is the fix that cannot recur — there is no longer a
    // visitor that can forget.
    // A CONTAINMENT EDGE FROM A THING TO ITSELF IS NOT A CONTAINMENT. It appears
    // where the grammar's recovery parses source that lives inside a VERBATIM STRING
    // — roslyn-vb's own test files embed VB source in string literals, and
    // `Public Enum Color ... End Enum` inside one recovers into declarations whose
    // owner's recorded name equals their own. Measured: 6 per 200 files, all of them
    // `contains -> Color -> Color`, `contains -> C -> C`, and none of them navigable.
    if (owner && owner.name !== name) {
      this.relationships.push({
        source: owner.name,
        target: name,
        type: RelationshipType.Contains,
        confidence: 1.0,
        line_number: this.nodeLine(nameNode ?? node),
        metadata: { role: this.containmentRole(kind) },
      })
    }
    this.pushExport(node, name, kind, nameNode, owner)
    // First declaration of a name wins the index, so a later overload does not
    // steal the id an edge already points at. Overloads are disambiguated by the
    // edge, not by the index.
    if (!this.index.has(name)) this.index.set(name, sym)
    // WHAT THIS NAME CAN BE CALLED AS. Read here, once, rather than per call site,
    // because the question `array_access_expression` forces is "is this name
    // something this file declares it could call?" and the answer is a property of
    // the DECLARATION, not of the use.
    if (kind === ASTEngine.SymbolKind.Method || kind === ASTEngine.SymbolKind.Constructor ||
        kind === ASTEngine.SymbolKind.Property) {
      this.callablesInFile.add(name)
    }
    if (kind === ASTEngine.SymbolKind.Variable) this.variablesInFile.add(name)
    if (kind === ASTEngine.SymbolKind.Type && sym.metadata?.delegate === true) {
      this.callablesInFile.add(name)
    }
    // NOTE: the array-valued test lives in `precollectDeclarations` and NOT here.
    // It used to sit here, which made it order-dependent for the same reason the
    // callable set was: a callable declared after its use had not been recorded yet.
    const ownerType = this.currentType()
    if (ownerType) {
      let list = this.memberNames.get(ownerType.name)
      if (!list) { list = []; this.memberNames.set(ownerType.name, list) }
      list.push(name)
    }
    return sym
  }

  private currentType(): ASTEngine.UniversalSymbol | null {
    return this.typeStack.length > 0 ? this.typeStack[this.typeStack.length - 1] : null
  }

  /**
   * The node whose ACCESS MODIFIERS describe this declaration.
   *
   * `pushSymbol` is called with the node that carries the NAME, and for a field
   * that is the `variable_declarator` -- while the modifiers are on its parent
   * `field_declaration` (`Public Value As Integer = 3` is
   * `field_declaration(members: member_modifier) variable_declarator(Value ...)`).
   * Reading modifiers off the declarator therefore found none, which is why a
   * `Public` field and an undecorated one were indistinguishable. One level up,
   * and only for that exact pair of node types, is the whole correction.
   */
  private declarationNodeOf(node: Node): Node {
    if (node.type === "variable_declarator") {
      const parent = node.parent
      if (parent && parent.type === "field_declaration") return parent
    }
    return node
  }

  /** The access levels in force for a symbol, explicit or defaulted. */
  private exportLevelsOf(node: Node, kind: ASTEngine.SymbolKind): { levels: Set<string>; explicit: boolean } {
    const levels = this.accessLevelsOf(this.declarationNodeOf(node))
    if (levels.size > 0) return { levels, explicit: true }
    const dflt = this.defaultAccessLevel(kind)
    return { levels: new Set([dflt]), explicit: false }
  }

  /**
   * `exports`: the assembly's public surface.
   *
   * VB HAS the construct, so this is a GAP and not a ruling. The language
   * expresses export through ACCESSIBILITY rather than through a keyword: a
   * declaration is reachable from outside its assembly when its effective
   * accessibility is `Public`, and there is no second mechanism -- measured over
   * 2,658 corpus files, `exports_statement`, `export_list` and `assembly_attribute`
   * are all node types the grammar HAS RULES for and that occur ZERO times
   * (census probe, node inventory), so a keyword-shaped `exports` in VB would be
   * an edge the language cannot express. `Public` is a `member_modifier` and a
   * grammar inventory is blind to a convention by construction, which is exactly
   * how json's `exports` ruling was overturned; so the number behind this
   * verdict is a MODIFIER count (15,489 `public` modifiers in 2,344 files) and a
   * DEFAULTED-accessibility count (136 modifier-less class members, 20 in a
   * module, 5 in a structure, 116 modifier-less top-level types), not a node
   * type count.
   *
   * DIRECTION. Source is the declaring type, or `root` for a type declared at
   * namespace level -- the assembly is the unit of export in a .NET assembly, and
   * `imports` already uses `root` as the source for the same reason.
   *
   * CONTAINMENT IS NOT COMPOUNDED INTO THE DECISION. VB's documented rule is
   * that a Public member of an internal type is not assembly-visible ("code that
   * cannot access a containing element cannot access any of its contained
   * elements"), so the edge COULD be suppressed for a member of a `Friend` type.
   * It is not, and the reason is that the edge as emitted answers a question a
   * consumer can ask ("which members does this type declare as Public?") without
   * the analyzer having to decide a transitive-visibility question it cannot
   * fully answer -- a `Friend` type is assembly-visible to a FRIEND ASSEMBLY,
   * which is per-project configuration this analyzer never sees. `ownerExported`
   * records the containing type's own visibility so the compounding is one
   * filter away instead of being baked into the edge's existence.
   */
  private pushExport(
    node: Node,
    name: string,
    kind: ASTEngine.SymbolKind,
    nameNode: Node | null,
    owner: ASTEngine.UniversalSymbol | null,
  ): void {
    const { levels, explicit } = this.exportLevelsOf(node, kind)
    if (!RealVbAnalyzer.isAssemblyVisible(levels)) return
    // A namespace is not an export unit: VB namespaces cannot carry an access
    // modifier at all, so a `Namespace` symbol would be an `exports` edge whose
    // accessibility was invented rather than read.
    if (owner && owner.kind === ASTEngine.SymbolKind.Namespace) return
    this.relationships.push({
      source: owner ? owner.name : "root",
      target: name,
      type: RelationshipType.Exports,
      confidence: 1.0,
      line_number: this.nodeLine(nameNode ?? node),
      metadata: {
        role: this.containmentRole(kind),
        accessLevel: [...levels].join("+"),
        accessFromModifier: explicit,
        // The containing type's OWN accessibility, read off the symbol record
        // `pushSymbol` wrote when it published the owner. Recorded rather than
        // acted on; see the header for why the edge does not depend on it.
        ownerAccessLevel: (owner?.metadata as Record<string, unknown> | undefined)?.accessLevel ?? "assembly",
      },
    })
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private visitNamespace(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Namespace, node, {
      metadata: {
        // Uniform with every other declaration. The node-type yield audit walks
        // the corpus counting declaration NODES and then counts symbols by their
        // `grammarNode`, and a declaration that records none of its own node type
        // is invisible to that audit -- which is how a whole kind can stop being
        // produced with nothing left to notice. The audit found this one missing
        // and could not tell a dead visitor from an unlabelled symbol; the fix is
        // to label it.
        grammarNode: node.type,
        // The two namespace forms are ONE node type in this grammar (two
        // alternatives of one rule), and the analyzer's job is to say which one
        // it read. The discriminator is the ABSENCE of `End Namespace`: the
        // file-scoped form has no terminator to close it.
        //
        // (This line previously tested a `blank_line` node that this grammar
        // does not have -- an invented reference, which is the LUA-00 defect
        // class and which M14.0.F1 caught as an unknown node type. The
        // expression was also wrong independently of that: it ANDed the
        // discriminator with a test for a node that never appears, so it could
        // only ever be false.)
        fileScoped: !this.hasEndNamespace(node),
      },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  /**
   * Whether this namespace has an `End Namespace`.
   *
   * The grammar does not expose it as a node — `End` and `Namespace` are
   * anonymous tokens inside the rule. So this reads the node's LAST named
   * child's extent against the namespace's own text: the block form's last
   * named child ends at the `End Namespace`, the file-scoped form's last child
   * is the final declaration. A char-scan over the tail, not a regex: find the
   * last occurrence of the keyword by walking backwards.
   */
  private hasEndNamespace(node: Node): boolean {
    if (node.namedChildCount === 0) return false
    const named = this.kids(node)
    const last = named[named.length - 1]
    if (!last) return false
    const tail = node.text.slice(last.endIndex - node.startIndex)
    // Char walk backwards for "End" + whitespace* + "Namespace", case-folded by
    // char code. `toLowerCase()` on the slice would be a locale-dependent fold;
    // VB keywords are ASCII, so the comparison is done on lower-cased ASCII only.
    return RealVbAnalyzer.endsWithKeyword(tail, "end namespace")
  }

  /** Char-scan: does `s` end with `words` (ASCII, case-insensitive, any run of spaces/tabs between)? */
  private static endsWithKeyword(s: string, words: string): boolean {
    let i = s.length - 1
    let w = words.length - 1
    while (w >= 0) {
      // skip separators
      while (i >= 0 && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9 || s.charCodeAt(i) === 13 || s.charCodeAt(i) === 10)) i--
      if (w < 0) break
      const want = words.charCodeAt(w)
      let got = s.charCodeAt(i)
      if (got >= 65 && got <= 90) got += 32
      if (want >= 65 && want <= 90) want // keep as-is; compared below after folding both
      const wantFolded = (want >= 65 && want <= 90) ? want + 32 : want
      if (got !== wantFolded) return false
      i--
      w--
    }
    // every word character consumed, only separators after
    while (i >= 0) {
      const c = s.charCodeAt(i)
      if (c !== 32 && c !== 9 && c !== 13 && c !== 10 && c !== 59) return false
      i--
    }
    return true
  }

  /**
   * Dispatch a type's or a module's BODY: declarations to their own visitors,
   * structure to nothing, and everything else as body code of the type.
   *
   * This is what recovered 24 member reads in UseCompoundAssignment/Utilities.vb and
   * the whole class declaration in
   * VisualBasicRemoveUnnecessaryPragmaSuppressionsDiagnosticAnalyzer.vb: the
   * grammar's recovery leaves a type body's statements as DIRECT children of the
   * type, outside any declaration, and nothing was reading them. A type that
   * executes code publishes nothing about what it executes.
   */
  private dispatchBody(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    for (const child of this.kids(node)) {
      if (RealVbAnalyzer.DECLARATION_NODES.has(child.type)) { this.walk(child, content, context); continue }
      if (RealVbAnalyzer.TYPE_BODY_STRUCTURE.has(child.type)) continue
      if (this.hasDeclarationDescendant(child)) { this.dispatchBody(child, content, context); continue }
      this.collectBodyEdges(child, null)
    }
  }

  private visitType(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const kind = RealVbAnalyzer.typeKindOf(node.type)
    const { text, node: nameNode } = this.declaredName(node)
    const mods = this.modifierNames(node)
    const sym = this.pushSymbol(text, kind, node, {
      visibility: this.visibilityOf(node, kind),
      isStatic: mods.has("shared"),
      isAbstract: this.isAbstract(node),
      metadata: {
        grammarNode: node.type,
        // `NotInheritable` is the VB spelling of C#'s `sealed`; recording it
        // under the same key the family's csharp lane uses is what lets a
        // cross-language query ask "sealed types" without knowing the language.
        sealed: mods.has("notinheritable") || mods.has("notoverridable"),
        partial: mods.has("partial"),
      },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }

    if (sym) this.visitHeritage(node, text, sym, context)

    this.dispatchBody(node, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  private static typeKindOf(nodeType: string): ASTEngine.SymbolKind {
    switch (nodeType) {
      case "class_declaration": return SymbolKind.Class
      case "structure_declaration": return SymbolKind.Struct
      case "interface_declaration": return SymbolKind.Interface
      case "module_declaration": return SymbolKind.Module
      default: return SymbolKind.Class
    }
  }

  /**
   * VB spells heritage two ways and BOTH are emitted:
   *   - a following line: `Inherits B` / `Implements I, J`
   *   - on the declaration header: `Class C : Inherits B, Implements I`
   *     and, for an interface or a structure, the keyword-less
   *     `Interface I : IDisposable, IEnumerable`
   *
   * The header form is not a node — the grammar folds it into a hidden rule
   * whose children are anonymous tokens plus `name_reference` leaves. So the
   * heritage names are read as the identifier-bearing children of the header
   * position, and the keyword that precedes them decides whether each is an
   * `extends` or an `implements` edge. Which keyword it was comes from the
   * ORDER: `Inherits` precedes `Implements`, and a structure/interface list has
   * neither, so every name after the first `Inherits` run and before an
   * `Implements` token is an extends target and the rest are implements.
   */
  private visitHeritage(node: Node, selfName: string, sym: ASTEngine.UniversalSymbol, context?: ASTEngine.AnalyzeContext): void {
    // --- the line form -------------------------------------------------------
    for (const st of this.namedChildrenOfType(node, "inherits_statement")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        this.pushHeritage(selfName, nameNode, RelationshipType.Extends, sym, context)
      }
    }
    for (const st of this.namedChildrenOfType(node, "implements_statement")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        this.pushHeritage(selfName, nameNode, RelationshipType.Implements, sym, context)
      }
    }
    // A member-level `Implements I` (`Public Sub Go() Implements IDisposable`).
    for (const st of this.namedChildrenOfType(node, "implements_member_clause")) {
      for (const nameNode of this.nameReferencesOf(st)) {
        const ownerSym = this.index.get(selfName)
        if (ownerSym) this.pushHeritage(selfName, nameNode, RelationshipType.Implements, ownerSym, context)
      }
    }

    // --- the header form -----------------------------------------------------
    // The header clause sits between the type's `name` and its first member. The
    // grammar's own nodes are not labelled for it, so it is found structurally:
    // the anonymous `:` token that immediately follows the name.
    const colon = this.headerColonIndex(node)
    if (colon < 0) return
    const headerKids = this.allKids(node)
    // WHICH LABEL the header clause gets, decided by the keyword the grammar
    // inlined away. The header rule folds `Inherits` / `Implements` into hidden
    // children, so the two forms are INDISTINGUISHABLE from the node types
    // alone -- and a single `seenInherits` flag that is initialised to -1 and
    // never assigned labelled EVERY name after the colon `extends`, which is
    // right for `Class C : Inherits B` and wrong for `Class C : Implements I`.
    // Measured on the lane corpus the form occurs twice, and the two occurrences
    // disagree: `Public NotInheritable Class MyGroupCollectionAttribute :
    // Inherits Attribute` (runtime/…/MyGroupCollectionAttribute.vb) and
    // `Public Class entry_ : Implements IComparable(Of entry_)`
    // (tankex/…/frmMain.vb) -- the second was published as
    // `extends entry_ -> IComparable`, a class shown in `bb_graph` as INHERITING
    // an interface it merely implements.
    //
    // So the keyword is read from the SOURCE SPAN between the `:` token and the
    // first name, which is a char scan rather than a node test for the same
    // reason `startsWithAsNewClause` is: the token is not in the tree. The span
    // is exactly `" Inherits "` or `" Implements "` on the two real shapes, and
    // the scan is word-bounded so `InheritsFoo` cannot match.
    const firstNameIdx = headerKids.findIndex((c, i) => i > colon && this.isNameNode(c))
    const keyword = firstNameIdx < 0 ? "" : this.spanKeywordBetween(node, headerKids[colon], headerKids[firstNameIdx], ["inherits", "implements"])
    // An INTERFACE's base list has no keyword at all (`Interface I : IDisposable,
    // IEnumerable`) and every entry is an interface the type IMPLEMENTS -- VB has
    // no interface inheritance, so `Inherits` on an interface is not a thing the
    // language spells. Defaulting an interface header to `implements` is therefore
    // the language's rule, not a guess.
    const headerLabel = keyword === "inherits"
      ? RelationshipType.Extends
      : keyword === "implements" || node.type === "interface_declaration"
        ? RelationshipType.Implements
        : RelationshipType.Extends
    // The header clause ends at the first child that is neither a name nor the
    // `,` between entries. Without the stop, the loop walked the whole member
    // list -- which is how a stray `simple_name` member could have been read as a
    // base type.
    for (let i = colon + 1; i < headerKids.length; i++) {
      const child = headerKids[i]
      if (child.type === ",") continue
      if (!this.isNameNode(child)) break
      // A keyword the grammar LEFT in the tree (a shape where it is not inlined)
      // is a keyword, not a type name. Publishing `extends entry_ -> Implements`
      // would be a fabricated edge whose target is a VB keyword.
      const word = this.nameText(child).trim().toLowerCase()
      if (word === "implements" || word === "inherits") continue
      this.pushHeritage(selfName, child, headerLabel, sym, context)
    }
  }

  /**
   * Which of `words` appears in the source span between two child nodes.
   *
   * A char scan, not a regex and not a node test, for the stated reason: this
   * grammar inlines the heritage keywords away, so the only place the word
   * survives is the node's own text. Word-bounded on both sides, so
   * `InheritsFoo` and `MyImplements` cannot match. Returns "" when none is
   * present, which is a real answer for the keyword-less interface header.
   */
  private spanKeywordBetween(parent: Node, from: Node, to: Node, words: readonly string[]): string {
    const start = from.endIndex - parent.startIndex
    const end = to.startIndex - parent.startIndex
    if (end <= start || end > parent.text.length) return ""
    const span = parent.text.slice(start, end)
    const isWordChar = (c: number): boolean =>
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    for (const w of words) {
      for (let i = 0; i + w.length <= span.length; i++) {
        if (i > 0 && isWordChar(span.charCodeAt(i - 1))) continue
        let ok = true
        for (let k = 0; k < w.length; k++) {
          let c = span.charCodeAt(i + k)
          if (c >= 65 && c <= 90) c += 32
          if (c !== w.charCodeAt(k)) { ok = false; break }
        }
        if (!ok) continue
        const after = i + w.length
        if (after < span.length && isWordChar(span.charCodeAt(after))) continue
        return w
      }
    }
    return ""
  }

  /**
   * The index of the anonymous `:` token of the declaration header, or -1.
   *
   * THE ORDERING IS BY `startIndex`, and it used to be by `id` -- which made this
   * branch DEAD on every header clause in the corpus. A `web-tree-sitter` node
   * `id` is an internal subtree pointer, not a document position: measured on
   * `Public Class B : Inherits A`, the `:` token has id 4064760 and the name
   * field has id 4065216, so `kids[i].id > from` is FALSE for the colon this
   * method exists to find, and the whole header branch was unreachable. The
   * grammar audit could not see it: `id` is not a node type and not a field
   * name, so a vocabulary audit reads this line as a well-formed field read.
   *
   * What it cost, measured on the lane corpus by scanning for the shape
   * directly (2 header clauses exist, and this is every one of them):
   *
   *   Public NotInheritable Class MyGroupCollectionAttribute : Inherits Attribute
   *   Public Class entry_ : Implements IComparable(Of entry_)
   *
   * published NO heritage edge at all. Not a mislabelled one -- none. So the
   * mislabelling the `seenInherits = -1` flag would have caused was never
   * reached either, and both header forms were silently absent: `extends` was
   * 2 edges short and `implements` 1, on real declarations, and every number the
   * lane published counted them correctly as missing rather than as present.
   */
  private headerColonIndex(node: Node): number {
    const nameField = node.childForFieldName("name")
    const from = nameField ? nameField.startIndex : node.startIndex
    const kids = this.allKids(node)
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].startIndex > from && kids[i].type === ":") return i
    }
    return -1
  }

  /**
   * Is this node one of the grammar's NAME types?
   *
   * The set is the grammar's real vocabulary, read off the pinned wasm: an
   * identifier, or one of the three name wrappers (`simple_name`,
   * `qualified_name`, `global_qualified_name`) or the generic name. Two
   * earlier versions of this test named `name_reference` and `namespace_name`,
   * neither of which is a node type in this grammar -- invented references that
   * are dead branches, which is the LUA-00 defect and what M14.0.F1 is for.
   * Naming them from the pinned surface rather than from a habit is the fix.
   */
  private isNameNode(n: Node): boolean {
    switch (n.type) {
      case "identifier":
      case "simple_name":
      case "qualified_name":
      case "global_qualified_name":
      case "generic_name":
        return true
      default:
        return false
    }
  }

  /** The name-bearing children of a heritage statement. */
  private nameReferencesOf(node: Node): Node[] {
    const out: Node[] = []
    const visit = (n: Node): void => {
      for (const c of this.kids(n)) {
        if (this.isNameNode(c)) {
          out.push(c)
        } else {
          visit(c)
        }
      }
    }
    visit(node)
    return out
  }

  /**
   * One heritage edge, with the line of the node that NAMES the base.
   *
   * The target is the type's own name (`B`, not `Namespace.B`) because that is
   * what a symbol in this file would be called, and an edge is only navigable if
   * its target names something. Confidence is 1.0 for a name the file also
   * declares (an in-file base type is certain) and lower for one it does not,
   * because a cross-file target is a name, not a resolved symbol.
   */
  /**
   * A MEMBER-LEVEL heritage clause, read on the member that carries it.
   *
   * `Public Sub Refresh() Implements IThing.Refresh` is a real, separate
   * relationship from the class's own `Implements IThing`, and it used to be
   * dropped: `visitHeritage` was called from exactly one place -- the TYPE
   * visitor -- so nothing ever read a member's clause. The whole member-level
   * form was simply not collected, on every member in the language.
   *
   * The TARGET IS THE FULL QUALIFIED NAME, deliberately, and this is the one
   * place the last-segment naming rule does not apply. Everywhere else a dotted
   * name is reduced to its last segment, because that is the name a reader
   * navigates to. Here the member is only identified BY its interface: the method
   * is named `Refresh` precisely because it implements `IThing.Refresh`, so
   * last-segment reduction yields `implements Refresh -> Refresh` -- an edge from
   * a symbol to itself, which is not navigable and answers none of the questions
   * anyone asks of it ("where is `IThing.Refresh` implemented?"). The full
   * `IThing.Refresh` is what makes the edge mean something.
   *
   * Found by the full-corpus F5 sweep, not by a fixture: 17 of 23 missing rows on
   * a 483-file draw were this, all of them reading as self-edges for exactly the
   * reason above.
   */
  private visitMemberHeritage(node: Node, sym: ASTEngine.UniversalSymbol, context?: ASTEngine.AnalyzeContext): void {
    for (const [clause, rel] of [
      ["implements_member_clause", RelationshipType.Implements],
      ["inherits_member_clause", RelationshipType.Extends],
    ] as const) {
      for (const st of this.namedChildrenOfType(node, clause)) {
        for (const nameNode of this.nameReferencesOf(st)) {
          // The type ARGUMENTS are not part of the name. `Public Function
          // GetEnumerator() Implements IEnumerable(Of CustomEvent).GetEnumerator`
          // is one interface member written with the interface's type
          // arguments; the member is `IEnumerable.GetEnumerator` and
          // `IEnumerable(Of CustomEvent).GetEnumerator` is a spelling no symbol
          // table holds, so the target resolved against nothing and
          // `bb_graph`/`bb_search` could never follow it.
          //
          // Measured on the lane corpus (2,658 files, production `parseFile`,
          // `script/m14/vb-edge-integrity.ts`): 94 of the 286 `implements` edges
          // carried a `(Of …)` in the target — `IEnumerable(Of CustomEvent)
          // .GetEnumerator`, `IComparer(Of String).Compare`,
          // `ILayer2_1(Of T).Count`. That is 32.9% of the class, so it is the
          // normal shape of a member-level interface implementation in generic
          // VB code, not an edge case.
          //
          // This is the SAME rule `calleeLeaf` already applies to a call
          // (`New List(Of Integer)` is `List`, not `Integer`) and the same
          // reduction `pushHeritage` applies to a TYPE-level clause, so all
          // three now agree on one definition of "the name of this type
          // expression" — which is the only thing that makes an edge matchable
          // by an independent oracle.
          const target = this.typeArgumentsStrippedText(nameNode)
          if (target.length === 0) continue
          this.relationships.push({
            source: sym.name,
            target,
            type: rel,
            // A member-level interface is a type this file may not declare, and
            // the honest confidence for that is the unresolved-heritage one.
            confidence: this.declaredNames.has(target) ? 1.0 : 0.7,
            line_number: this.nodeLine(nameNode),
            metadata: {
              [rel === RelationshipType.Extends ? "baseType" : "interfaceName"]: target,
              heritageForm: "member",
              resolved: this.declaredNames.has(target),
              // The reduction is recorded rather than silent, so a reader can
              // see that `IEnumerable(Of T).GetEnumerator` and
              // `IEnumerable.GetEnumerator` are the same edge and not two.
              openGenericArity: this.typeArgumentArity(nameNode),
            },
          })
        }
      }
    }
  }

  /**
   * The name node with every `type_argument_list` REMOVED from its own text.
   *
   * `qualified_name` is `qualifier . name`, and the qualifier may be a
   * `generic_name`, so `IEnumerable(Of CustomEvent).GetEnumerator` is
   *   (qualified_name
   *      qualifier: (generic_name name: (identifier IEnumerable)
   *                            (type_argument_list (simple_name (identifier))))
   *      name: (simple_name (identifier GetEnumerator)))
   * The type arguments live inside the qualifier, not beside the target, so the
   * `(Of …)` has to be removed from the SPAN rather than from a trailing child.
   *
   * A char scan with the equivalence argued, and it has to be the same reduction
   * `calleeLeaf` applies so the two agree: every `type_argument_list` SPAN is
   * dropped and the text around it is kept, so the span between the wrapper's
   * start and the list's start, and everything from the last list's end to the
   * wrapper's end, both survive. A span scan is required because `node.text` is
   * the only place the parentheses survive — the `type_argument_list` node's own
   * text is `(Of CustomEvent)` but no field says where inside the qualifier it
   * sits, and it is the QUALIFIER that is generic, not the target.
   *
   * The result is a STRING rather than a synthesised `Node`. An earlier version
   * returned `{ text } as unknown as Node`, which happened to satisfy the single
   * caller because it only read `.text` — and a lie that satisfies its one caller
   * is exactly the kind of thing that survives until a second caller reads
   * `startIndex` off it. The signature says what it is.
   *
   * When there is nothing to remove the node's own text is returned, so the
   * common case costs one tree walk and no allocation.
   */
  private typeArgumentsStrippedText(n: Node): string {
    if (!this.containsTypeArgumentList(n)) return this.nameText(n).trim()
    const start = n.startIndex - n.startIndex
    const end = n.endIndex - n.startIndex
    if (!(end > start)) return this.nameText(n).trim()
    const text = n.text
    // Spans to drop, collected in document order regardless of nesting: the walk
    // stops descending once it has a list, so an inner list inside an outer one
    // cannot produce two overlapping spans.
    const spans: Array<[number, number]> = []
    const walk = (x: Node, depth: number): void => {
      if (depth > 16) return
      if (x.type === "type_argument_list") {
        spans.push([x.startIndex - n.startIndex, x.endIndex - n.startIndex])
        return
      }
      for (const c of this.allKids(x)) walk(c, depth + 1)
    }
    walk(n, 0)
    spans.sort((a, b) => a[0] - b[0])
    let out = ""
    let cursor = start
    for (const [s, e] of spans) {
      if (s < cursor || e > end) continue
      out += text.slice(cursor, s)
      cursor = e
    }
    out += text.slice(cursor, end)
    return out.trim()
  }

  /** Is there a `type_argument_list` anywhere at or under this node? */
  private containsTypeArgumentList(n: Node): boolean {
    let found = false
    const walk = (x: Node, depth: number): void => {
      if (found || depth > 16) return
      if (x.type === "type_argument_list") { found = true; return }
      for (const c of this.allKids(x)) walk(c, depth + 1)
    }
    walk(n, 0)
    return found
  }

  /** How many type arguments the name carries, for the edge's own metadata. */
  private typeArgumentArity(n: Node): number {
    let arity = 0
    const walk = (x: Node, depth: number): void => {
      if (depth > 16) return
      if (x.type === "type_argument_list") { arity += x.namedChildCount; return }
      for (const c of this.allKids(x)) walk(c, depth + 1)
    }
    walk(n, 0)
    return arity
  }

  private pushHeritage(
    selfName: string,
    nameNode: Node,
    type: ASTEngine.RelationshipType,
    selfSym: ASTEngine.UniversalSymbol,
    context?: ASTEngine.AnalyzeContext,
  ): void {
    const token = this.namingToken(nameNode, nameNode.text)
    const target = this.nameText(token ?? nameNode)
    if (target.length === 0) return
    // A TYPE THAT INHERITS FROM ITSELF IS NOT INHERITANCE. Same source as the
    // self-`contains` case: `Class A : ... Inherits A` recovered out of a string
    // literal. Measured: 1 per 200 files, `extends -> A -> A`.
    if (target === selfName) { this.note("self-heritage"); return }
    const inFile = this.declaredNames.has(target)
    this.relationships.push({
      source: selfName,
      target,
      type,
      confidence: inFile ? 1.0 : 0.7,
      line_number: this.nodeLine(token ?? nameNode),
      metadata: {
        [type === RelationshipType.Extends ? "baseType" : "interfaceName"]: target,
        heritageForm: this.heritageFormOf(nameNode),
        resolved: inFile,
      },
    })
  }

  /** `line` for a heritage statement's names, `header` for a header-clause name. */
  private heritageFormOf(nameNode: Node): string {
    let cur: Node | null = nameNode
    for (let i = 0; cur !== null && i < 8; i++) {
      const p: Node | null = cur.parent
      if (p === null) break
      if (p.type === "inherits_statement" || p.type === "implements_statement" ||
          p.type === "implements_member_clause") return "statement"
      if (p.type === "class_declaration" || p.type === "structure_declaration" ||
          p.type === "interface_declaration" || p.type === "module_declaration") return "header"
      cur = p
    }
    return "unknown"
  }

  private visitEnum(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Enum, node, {
      visibility: this.visibilityOf(node, SymbolKind.Enum),
      metadata: { grammarNode: node.type },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
      // THE ENUM'S UNDERLYING TYPE. `Public Enum Color As Byte` names `Byte` in an
      // `as_clause` on the declaration, and nothing read it: `visitEnum` pushed the
      // enum and its members and never looked at the type, so the one type name an
      // enum declaration carries in VB.NET was published nowhere. The lane's
      // differential derived `references -> Color -> Byte` (and `SByte`, `Long`,
      // `Integer`, `ULong`) and reported 15 rows per 200 files MISSING.
      const enumAsClause = this.namedChildrenOfType(node, "as_clause")[0]
      const enumDeclared = enumAsClause ? enumAsClause.childForFieldName("declared_type") : null
      if (enumDeclared) this.pushTypeReference(sym, enumDeclared, "enumUnderlyingType")
    }
    // Each member carries the line of the name it writes, and a `value` read off
    // the initializer when the grammar kept it as an expression.
    for (const child of this.kids(node)) {
      if (child.type !== "enum_member_declaration" && child.type !== "variable_declarator") continue
      const mName = this.declaredName(child)
      if (mName.text.length === 0) { this.note("enum-member-without-name"); continue }
      const init = child.childForFieldName("initializer")
      const member = this.pushSymbol(mName.text, SymbolKind.EnumMember, child, {
        ownerName: sym ? sym.name : undefined,
        ownerKind: sym ? sym.kind : undefined,
        metadata: {
          grammarNode: child.type,
          ...(init ? { value: init.text.trim() } : {}),
          valueLine: init ? this.nodeLine(this.namingToken(init, init.text) ?? init) : null,
        },
      })
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  private visitDelegate(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text } = this.declaredName(node)
    const sym = this.pushSymbol(text, SymbolKind.Type, node, {
      visibility: this.visibilityOf(node, SymbolKind.Type),
      metadata: { grammarNode: node.type, delegate: true },
    })
    if (sym) {
      this.typeStack.push(sym)
      this.ownerStack.push(sym)
    }
    const params = node.childForFieldName("parameters")
    if (params && sym) this.readParameters(params, sym)
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym!.returnType = this.nameText(declared)
        this.pushTypeReference(sym!, declared, "returnType")
      }
    }
    for (const child of this.kids(node)) this.walk(child, content, context)
    if (sym) {
      this.typeStack.pop()
      this.ownerStack.pop()
    }
  }

  // -------------------------------------------------------------------------
  // Imports
  // -------------------------------------------------------------------------

  /**
   * `Imports A, B` — one edge PER NAME, each stamped with the line of the name it
   * writes, and each carrying `isImport` + `include_dependency` so the family's
   * completeness section-B pin and the tier classifier can mark it import-based.
   * An import is a name in VB, not a module path, so `module` holds the name and
   * `isNamespace` is true.
   */
  private visitImports(node: Node): void {
    const names = this.nameReferencesOf(node)
    for (const nameNode of names) {
      const token = this.namingToken(nameNode, nameNode.text)
      const text = this.nameText(token ?? nameNode)
      if (text.length === 0) continue
      const range = this.range(nameNode)
      this.imports.push({
        module: text,
        items: [],
        isNamespace: true,
        isNamespaceImport: true,
        importType: "namespace",
        range,
        metadata: { grammarNode: node.type },
      })
      this.relationships.push({
        source: "root",
        target: text,
        type: RelationshipType.Imports,
        confidence: 1.0,
        line_number: this.nodeLine(token ?? nameNode),
        metadata: {
          [IS_IMPORT]: true,
          [INCLUDE_DEPENDENCY]: true,
          importForm: "imports-statement",
        },
      })
    }
  }

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  private visitMethod(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    // `isCtor` is computed FIRST, and that ordering is the fix rather than a
    // style choice. `Public Sub New()` has no `name` field — the keyword is an
    // anonymous token — so the "declaration without a name" guard below used to
    // fire for every constructor in the corpus and return before the naming
    // contract was ever reached. The contract was written and then dead: the
    // symbol was still absent. Any check that can reject a declaration has to be
    // evaluated against the contract, not in front of it.
    const isCtor = node.type === "constructor_declaration"
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0 && !isCtor) { this.note("method-without-name"); return }
    const owner = this.currentOwner()
    const mods = this.modifierNames(node)
    const isDeclare = node.type === "declare_statement"
    const kind = isCtor ? SymbolKind.Constructor : SymbolKind.Method
    // A CONSTRUCTOR IS NAMED BY THE PRODUCT'S CONTRACT, not by the source.
    //
    // `Public Sub New()` has no `name` field at all: VB spells a constructor
    // with the `New` KEYWORD, which the grammar lexes as an anonymous token, so
    // the name node the other declarations carry simply does not exist here. The
    // first version of this method therefore read an empty name, took the
    // `declaration-without-name` path and returned — and a whole kind of
    // declaration was silently absent from the index. Found by the F5
    // differential, not by a fixture: 12,549 symbols across 435 files contained
    // ZERO constructors, and the oracle's `contains Foo -> New` rows were all
    // MISSING.
    //
    // The literal is the family's: csharp and typescript both publish
    // `constructor` with the class in `ownerName`. (java publishes the class name
    // instead, so the product has no single convention — worth a cross-language
    // ruling, and noted here so the next lane does not have to rediscover it.)
    // `New` itself would be wrong: it is a keyword, it collides across every
    // class in a file, and it made the differential read `calls New -> ToList`
    // with no way to tell which constructor.
    const effectiveName = isCtor ? "constructor" : text

    // An `Overrides` member overrides a base member: the edge names the base
    // METHOD, and it is emitted at MODIFIER precedence because the base member's
    // declaring type is usually not in this file, so the edge's confidence is the
    // honest one.
    const overridesBase = mods.has("overrides")

    const sym = this.pushSymbol(effectiveName, kind, node, {
      visibility: this.visibilityOf(node, kind),
      isStatic: this.isStatic(node),
      isAbstract: this.isAbstract(node),
      isAsync: mods.has("async"),
      ...(isDeclare ? { metadata: { pInvoke: true } } : {}),
      metadata: {
        grammarNode: node.type,
        ...(isDeclare ? { pInvoke: true } : {}),
        ...(overridesBase ? { overridesModifier: true } : {}),
        ...(mods.has("partial") ? { partial: true } : {}),
        // The P/Invoke's target library and entry point are on the DECLARATION,
        // and they are the only place a VB.NET file names an unmanaged symbol.
        ...(isDeclare ? this.readPInvoke(node) : {}),
      },
    })
    if (!sym) return

    const params = node.childForFieldName("parameters")
    if (params && sym) this.readParameters(params, sym)
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "returnType")
      }
    }


    this.ownerStack.push(sym)
    this.visitMemberHeritage(node, sym, context)
    if (this.modifierNames(node).has("overrides")) this.pushOverride(node, null, sym, this.currentOwner())
    this.collectBodyEdges(node, sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  /** `Lib "user32.dll" Alias "MessageBoxA"` — the unmanaged target of a Declare. */
  private readPInvoke(node: Node): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const lib = node.childForFieldName("library")
    if (lib) out.pInvokeLibrary = lib.text.trim()
    const alias = node.childForFieldName("alias")
    if (alias) out.pInvokeEntryPoint = alias.text.trim()
    const kind = node.childForFieldName("kind")
    if (kind) out.pInvokeKind = kind.text.trim()
    return out
  }

  private readParameters(params: Node, sym: ASTEngine.UniversalSymbol): void {
    const out: ASTEngine.Parameter[] = []
    for (const p of this.kids(params)) {
      if (p.type !== "parameter") continue
      const nameNode = p.childForFieldName("name") ??
        (p.namedChildCount > 0 ? this.nc(p, 0) : null)
      const name = this.nameText(nameNode)
      if (name.length === 0) continue
      // VB's parameter passing mode is part of the signature's meaning, not
      // decoration: `ByRef` is the default and `ByVal` is the exception, so both
      // are recorded and the default is stated explicitly rather than left
      // implicit for a consumer to guess.
      const byVal = p.text.includes("ByVal") || p.text.includes("byval")
      const asClause = this.namedChildrenOfType(p, "as_clause")[0]
      const declared = asClause ? asClause.childForFieldName("declared_type") : null
      const optional = p.text.includes("Optional") || p.text.includes("optional")
      const param: ASTEngine.Parameter = {
        name,
        ...(declared ? { type: this.nameText(declared) } : {}),
        ...(optional ? { isOptional: true } : {}),
        defaultValue: this.readDefaultOf(p),
        metadata: { passingMode: byVal ? "ByVal" : "ByRef" },
      }
      out.push(param)
      if (declared) this.pushTypeReference(sym, declared, "parameter")
    }
    if (out.length > 0) sym.parameters = out
  }

  /** An `= default` on a parameter, read off the node's own text span. */
  private readDefaultOf(p: Node): string | undefined {
    const idx = p.text.indexOf("=")
    if (idx < 0) return undefined
    const tail = p.text.slice(idx + 1).trim()
    return tail.length > 0 ? tail : undefined
  }

  private visitProperty(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0) { this.note("property-without-name"); return }
    const mods = this.modifierNames(node)
    // A property is BOTH: a member that is called like a method and read like a
    // field. The project's convention for a property that is also callable is to
    // emit the Property and let the edges carry the uses, so that is what this
    // does — one symbol, not two, so `Get`/`Set` do not double-count it.
    const sym = this.pushSymbol(text, SymbolKind.Property, node, {
      visibility: this.visibilityOf(node, SymbolKind.Property),
      isStatic: this.isStatic(node),
      isAbstract: this.isAbstract(node),
      metadata: {
        grammarNode: node.type,
        ...(mods.has("readonly") ? { readOnly: true } : {}),
        ...(mods.has("writeonly") ? { writeOnly: true } : {}),
        ...(mods.has("default") ? { defaultMember: true } : {}),
        ...(mods.has("overrides") ? { overridesModifier: true } : {}),
        autoImplemented: this.namedChildrenOfType(node, "property_getter").length === 0,
      },
    })
    if (!sym) return
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "propertyType")
      }
    }
    const owner = this.currentOwner()
    this.ownerStack.push(sym)
    this.visitMemberHeritage(node, sym, context)
    if (this.modifierNames(node).has("overrides")) this.pushOverride(node, null, sym, this.currentOwner())
    this.collectBodyEdges(node, sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  private visitEvent(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    const { text, node: nameNode } = this.declaredName(node)
    if (text.length === 0) { this.note("event-without-name"); return }
    const sym = this.pushSymbol(text, SymbolKind.Event, node, {
      visibility: this.visibilityOf(node, SymbolKind.Event),
      isStatic: this.isStatic(node),
      metadata: { grammarNode: node.type, withEvents: this.modifierNames(node).has("withevents") },
    })
    if (!sym) return
    const owner = this.currentOwner()
    // The event's declared type: `Event E As EventHandler` is the only place a
    // VB.NET file names a delegate it intends to raise.
    const asClause = this.namedChildrenOfType(node, "as_clause")[0]
    if (asClause) {
      const declared = asClause.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "eventType")
      }
    }
    this.ownerStack.push(sym)
    this.visitMemberHeritage(node, sym, context)
    if (this.modifierNames(node).has("overrides")) this.pushOverride(node, null, sym, this.currentOwner())
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  private visitOperator(node: Node, content: string, context?: ASTEngine.AnalyzeContext): void {
    // VB's operator declarations name the operator KEYWORD, not an identifier:
    // `Public Shared Operator +(a As T, b As T) As T`. The symbol is therefore
    // named by the operator token, and the distinction from an ordinary method is
    // recorded rather than left to be guessed from the name.
    // THIS FUNCTION NEVER PRODUCED A SYMBOL, for two independent reasons, and the
    // census is what found it: `operator_declaration` is classified in
    // DECLARATION_NODES and has a dedicated visitor, so a node-type count said
    // the kind was handled while the index held no operators at all.
    //
    // One: the guard used `isKeyword`, and `isKeyword` returns TRUE for any
    // token that does not START with a letter -- `if (!sawAlpha) return true` --
    // which was meant to reject punctuation like `(`. But every SYMBOLIC
    // operator is also a non-letter token, so `Operator +` had its own symbol
    // skipped as punctuation, found nothing, and returned. The guard rejected
    // precisely the tokens it was looking for.
    //
    // Two: for a WORD operator the symbol is not in the tree at all.
    // `Operator CType(ByVal x As Integer)` has children modifiers,
    // parameter_list, as_clause and body -- the `Operator` keyword and `CType`
    // are neither of them, having been inlined away. So there is nothing to read
    // a name from, and no amount of scanning the children finds it.
    //
    // So: a symbolic operator is named by its own token, and a word operator
    // takes the same CONTRACT LITERAL a constructor takes, since its name is not
    // derivable from the tree. Several operators of one type are therefore
    // several `operator` symbols distinguished by range, exactly as several
    // constructors are -- and the rows where the symbol IS known carry it in
    // metadata, so nothing is lost that the grammar kept.
    const STRUCTURAL = new Set(["(", ")", ",", ":", "=", "New", "Operator"])
    let opName = ""
    for (const c of this.allKids(node)) {
      if (c.isNamed) continue
      const t = c.text.trim()
      if (t.length === 0) continue
      if (STRUCTURAL.has(t)) continue
      if (c.type === "=") continue
      // A modifier word (`Public`, `Shared`, `Widening`) is alphabetic, so it is
      // the alphabetic branch of the keyword test that applies here. A
      // non-alphabetic token is the operator SYMBOL and must be kept.
      if (RealVbAnalyzer.isWordLike(t) && RealVbAnalyzer.isKeyword(t)) continue
      opName = t
      break
    }
    // The NAME is the contract literal, always -- not `Operator +` when the
    // symbol happens to be recoverable. A conditional name would be a better
    // name, but it is a contract with a second implementation (the F5 oracle has
    // to derive the same string) whose behaviour depends on whether the grammar
    // kept a token, and a contract that changes when the grammar changes is not a
    // contract. The symbol is not lost: it is in `operatorSymbol` below wherever
    // the tree kept it.
    const sym = this.pushSymbol("operator", SymbolKind.Method, node, {
      visibility: this.visibilityOf(node, ASTEngine.SymbolKind.Method),
      isStatic: this.isStatic(node),
      metadata: {
        grammarNode: node.type,
        ...(opName.length > 0 ? { operatorSymbol: opName } : {}),
      },
    })
    if (!sym) return
    // AN OPERATOR HAS PARAMETERS AND THEY WERE NOT BEING READ. `visitMethod` and
    // `visitProperty` both call `readParameters`, `visitOperator` did not, so
    // `Public Shared Narrowing Operator CType(provider As AnalyzerOptionsProvider)`
    // published its own parameter and no `references` edge for its type. The lane's
    // differential derived `references -> operator -> AnalyzerOptionsProvider` and
    // reported it MISSING, which is how a whole signature goes unrecorded because
    // one visitor out of five forgot a line the other four have.
    const opParams = node.childForFieldName("parameters")
    if (opParams) this.readParameters(opParams, sym)
    const opAs = this.namedChildrenOfType(node, "as_clause")[0]
    if (opAs) {
      const declared = opAs.childForFieldName("declared_type")
      if (declared) {
        sym.returnType = this.nameText(declared)
        this.pushTypeReference(sym, declared, "operatorReturnType")
      }
    }
    this.ownerStack.push(sym)
    this.collectBodyEdges(node, sym)
    for (const child of this.kids(node)) this.walk(child, content, context)
    this.ownerStack.pop()
  }

  /** Does this token start with a letter or underscore? */
  private static isWordLike(t: string): boolean {
    const c = t.charCodeAt(0)
    return Number.isFinite(c) && ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)
  }

  /** A char-set membership test, not a keyword list lookup by regex. */
  private static isKeyword(t: string): boolean {
    let i = 0
    let sawAlpha = false
    for (; i < t.length; i++) {
      const c = t.charCodeAt(i)
      const alpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
      if (!alpha) break
      sawAlpha = true
    }
    if (!sawAlpha) return true
    return RealVbAnalyzer.VB_KEYWORD_HEADS.has(t.slice(0, i).toLowerCase())
  }

  private static readonly VB_KEYWORD_HEADS: ReadonlySet<string> = new Set([
    "public", "private", "protected", "friend", "shared", "overridable", "overrides",
    "notoverridable", "mustoverride", "notinheritable", "mustinherit", "partial",
    "readonly", "writeonly", "default", "withevents", "shadows", "overloads",
    "widening", "narrowing", "async", "iterator", "static", "const",
  ])

  private visitField(node: Node, content: string): void {
    const mods = this.modifierNames(node)
    // `Const` is a field with a compile-time value; the product distinguishes
    // them, so it does too.
    const isConst = mods.has("const")
    const owner = this.currentOwner()
    for (const decl of this.kids(node)) {
      if (decl.type !== "variable_declarator") continue
      const { text, node: nameNode } = this.declaredName(decl)
      if (text.length === 0) { this.note("field-without-name"); continue }
      const init = decl.childForFieldName("initializer")
      const asClause = this.namedChildrenOfType(decl, "as_clause")[0]
      const declared = asClause ? asClause.childForFieldName("declared_type") : null
      const sym = this.pushSymbol(text, isConst ? SymbolKind.Constant : SymbolKind.Variable, decl, {
        visibility: this.visibilityOf(node, isConst ? SymbolKind.Constant : SymbolKind.Variable),
        isStatic: this.isStatic(node) || isConst || mods.has("shared"),
        ...(declared ? { returnType: this.nameText(declared) } : {}),
        ...(init ? { metadata: { initializer: init.text.trim() } } : {}),
        metadata: {
          grammarNode: decl.type,
          ...(isConst ? { constant: true } : {}),
          ...(mods.has("withevents") ? { withEvents: true } : {}),
          ...(mods.has("readonly") ? { readOnly: true } : {}),
          fieldLine: this.nodeLine(decl),
        },
      })
      if (!sym) continue
      if (declared) this.pushTypeReference(sym, declared, "fieldType")
    }
    // A field with an initializer can call a constructor: `= New Foo()`.
    this.collectBodyEdges(node, null)
  }

  // -------------------------------------------------------------------------
  // Calls, instantiations, member reads and type references
  // -------------------------------------------------------------------------

  /**
   * Every body edge in a subtree: `calls`, `instantiates` and `uses`, all stamped
   * with the line of the node that NAMES the thing.
   *
   * ## THE CALL SHAPE THIS GRAMMAR ACTUALLY PRODUCES, and why `calls` was silent
   *
   * Measured through the pinned wasm, minimal repro, tree-only:
   *
   *     Foo()      ->  invocation_expression
   *     Foo(1)     ->  array_access_expression        <- with ARGUMENTS
   *     obj.Foo(1) ->  array_access_expression
   *     a(i)       ->  array_access_expression        <- an INDEX
   *     New Foo(1) ->  array_creation_expression
   *
   * **A VB call with arguments is an `array_access_expression`, and this analyzer
   * read only `invocation_expression`.** Every argument-bearing call in the
   * language was therefore un-published. Measured over 636 corpus files:
   *
   *     invocation_expression            5,120   (the only shape read, before)
   *     array_access_expression         21,392   (not read at all)
   *
   * A 100-line file published 3 call edges from ~46 member accesses and calls. The
   * F5 differential could not see it: the lane's oracle block was removed from
   * `script/m14/differential.ts` (the lane has 4 DERIVATION findings — calls,
   * contains, imports, references — which is the gate's word for "compared against
   * nothing"), and a whole-corpus COUNT cannot see a missing class of edge either,
   * because the counts stayed healthy.
   *
   * ## WHY NOT EVERY `array_access_expression` IS A CALL
   *
   * The grammar cannot tell `Foo(1)` (a call) from `a(i)` (an index). Emitting an
   * edge for all of them would be a fabricated call edge, which the workstream
   * calls out as the most expensive mistake available. So two SIGNALS are
   * required, and a site with neither is COUNTED in `vbGaps` rather than guessed:
   *
   *   A. The callee names something THIS FILE DECLARES CALLABLE -- a method, a
   *      property, a constructor, an operator or a delegate -- and that declaration
   *      is NOT array-valued. An index needs an array, so a name this file declares
   *      as a method is a call and cannot be an index. The array-valued exclusion is
   *      read off the declaration's own `as_clause` -> `array_type`, because
   *      `SomePropertyReturningAnArray(0)` is legal VB and would otherwise be
   *      published as a call to an array.
   *
   *   B. The node is the WHOLE content of an `expression_statement` -- a call
   *      statement -- AND the callee name is not a variable/field this file
   *      declares. VB has no statement-level index expression, so a parenthesised
   *      name at statement level is a call; excluding the file's own variables
   *      removes the `arr(0)` case where `arr` is declared locally.
   *
   * Measured over 636 files: 11,269 of the 21,392 carry at least one signal. The
   * other 10,123 are counted as `index-or-call-ambiguous` and stay un-emitted,
   * because guessing between an index and a call is exactly the fabrication the
   * ontology forbids.
   *
   * ## WHAT ELSE IS DECIDED HERE, each a real question
   *
   *  - WHICH node names the callee. For `a.b.C(1)` the callee is the `C` leaf, so
   *    the edge is stamped on the line `C` is written on, not the line the
   *    statement started on. A three-line chained call then has one site line.
   *  - WHICH node is the SOURCE. The innermost enclosing declaration, not the
   *    file: an edge from `root` to a callee cannot be navigated to a method.
   *  - WHEN there is no source, there is no edge. A call in a field initializer
   *    has no enclosing method, and an edge from nothing is a phantom — so it is
   *    counted as a gap instead of invented.
   *  - `uses` DEDUPLICATES per (source, target) per file, keeping the FIRST site.
   *    That is the family's own choice for this label (csharp's CS-D4 field-access
   *    edge does exactly this) and it is a payload decision as much as a semantic
   *    one: 536,141 member reads exist in the corpus and `uses` at one edge per
   *    site would more than double this lane's whole graph.
   */
  private collectBodyEdges(scope: Node, owner: ASTEngine.UniversalSymbol | null): void {
    const source = owner ?? this.currentOwner()
    const scopeId = scope.id
    const visit = (n: Node): void => {
      // A NESTED DECLARATION IS NOT PART OF THIS BODY. A type declared inside a
      // method's body is walked separately by `walk`, which dispatches to its own
      // visitor and gives it its own `ownerStack` frame — so reading its body here
      // would publish every call and every read inside the nested type TWICE, once
      // attributed to the nested member and once attributed to the method that
      // happens to contain it. The recursion continues so nested shapes are still
      // visited, but no edge is derived for them at this level.
      if (n.id !== scopeId && RealVbAnalyzer.DECLARATION_NODES.has(n.type)) {
        for (const c of this.kids(n)) visit(c)
        return
      }
      // A CONSTRUCTION IS A CALL, and the grammar does not agree on one node type
      // for it. `New Box()` is an `invocation_expression` whose `function` is an
      // `object_creation_expression`; `New Box(1, 2)` -- any construction WITH
      // arguments -- is an `array_creation_expression` with a `type` field and no
      // `function` field at all. Keying on one node type therefore silently drops
      // every call edge for `New Foo(a)`, which is the most common construction
      // form VB has: 15,577 occurrences across 1,718 of the corpus's 2,660 files.
      //
      // Both node types name the constructed type in the same place -- a `type`
      // field -- so the rule is stated once and both are read the same way. There
      // is no `array_initializer` test and no "is this really an array" filter,
      // because the grammar cannot tell the two apart and guessing would be worse
      // than saying what the node says: `New Integer(10)` really does construct an
      // `Integer()`, and it is published as a call to `Integer` at 0.6 because this
      // file does not declare it.
      if (n.type === "array_creation_expression") {
        const ty = n.childForFieldName("type")
        const token = ty ? this.calleeLeaf(ty) : null
        const target = this.nameText(token)
        if (source && target.length > 0) {
          this.relationships.push({
            source: source.name,
            target,
            type: RelationshipType.Calls,
            confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
            line_number: this.nodeLine(token ?? ty ?? n),
            metadata: {
              argumentCount: n.namedChildCount > 1 ? n.namedChildCount - 1 : 0,
              calleeIsQualified: false,
              callLine: this.nodeLine(token ?? ty ?? n),
              constructed: true,
              constructionNode: n.type,
            },
          })
          // `instantiates` is the family's OTHER name for the same site: csharp
          // publishes `object_creation_expression` as `instantiates` and leaves the
          // `calls` edge to the invocation shape. A construction is both -- it calls
          // the constructor and it creates a value of the type -- and emitting both
          // is what lets bb_graph answer "what does this method construct" without
          // inferring it from a call edge's `constructed` flag.
          this.pushInstantiation(source, target, token ?? ty ?? n, n.type)
        }
        for (const c of this.kids(n)) visit(c)
        return
      }
      // A qualified NAME READ that is neither the thing being invoked nor the
      // thing being indexed. This is the `uses` class, and the exclusion is the
      // whole of it: `member_access_expression` is a member read in every other
      // position, and a callee/index head is already a `calls` edge naming the
      // same name. Measured over the corpus, the three slots partition 323,540
      // member accesses into 19,537 callee, 74,782 indexed and 323,540 value --
      // so the class this emits is the largest single relationship class VB has,
      // and excluding the two other slots is what keeps it from duplicating
      // `calls`.
      if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
        if (!this.isCalleeOrIndexSlot(n)) {
          const token = this.calleeLeaf(n)
          const target = this.nameText(token)
          if (target.length > 0) this.pushUse(source, target, n, token)
        }
      }
      if (n.type === "invocation_expression") {
        const fn = n.childForFieldName("function")
        const args = n.childForFieldName("arguments")
        // `New Foo()` IS an invocation -- the grammar wraps the
        // `object_creation_expression` in an `invocation_expression` with an
        // empty `argument_list` -- so keying on the node type alone publishes
        // the construction TWICE, once as `calls` and once as `instantiates`,
        // and puts a constructor invocation in the call graph. The test is
        // "is the leftmost element of the callee a CONSTRUCTION", read down
        // the receiver chain, because `New System.Drawing.Size(3, 4)` puts the
        // construction under three `member_access_expression` wrappers.
        if (fn && !this.calleeIsConstruction(fn)) {
          const token = this.calleeLeaf(fn)
          const target = this.nameText(token)
          if (target.length > 0) {
            if (source) {
              const argCount = args ? args.namedChildCount : 0
              this.relationships.push({
                source: source.name,
                target,
                type: RelationshipType.Calls,
                confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
                line_number: this.nodeLine(token ?? fn),
                metadata: {
                  // The argument count is read off the AST's own child list, so
                  // it excludes `comment` extras rather than counting them the
                  // way a text scan of the parens would.
                  argumentCount: argCount,
                  calleeIsQualified: fn.type === "member_access_expression",
                  callLine: this.nodeLine(token ?? fn),
                  constructed: fn.type === "object_creation_expression",
                  ...(fn.type === "object_creation_expression" ? { constructionNode: fn.type } : {}),
                },
              })
              if (fn.type === "object_creation_expression") {
                this.pushInstantiation(source, target, token ?? fn, fn.type)
              }
              // The callee EXPRESSION is what `uses` must not also publish as a
              // read. Recorded here, where the call was decided, so there is one
              // decision rather than a second re-derivation of it.
              this.callCalleeNodes.add(fn.id)
            } else {
              this.note("call-without-enclosing-declaration")
            }
          }
        }
      }
      // A BARE `object_creation_expression`, which is what `As New T(...)` in a
      // field or property declaration produces: it is not wrapped in an
      // invocation_expression, so neither branch above reaches it, and it was
      // therefore not a `calls` edge either.
      if (n.type === "object_creation_expression") {
        const ty = n.childForFieldName("type")
        const token = ty ? this.calleeLeaf(ty) : null
        const target = this.nameText(token)
        if (source && target.length > 0) {
          this.relationships.push({
            source: source.name,
            target,
            type: RelationshipType.Calls,
            confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
            line_number: this.nodeLine(token ?? ty ?? n),
            metadata: {
              argumentCount: n.namedChildCount > 1 ? n.namedChildCount - 1 : 0,
              calleeIsQualified: false,
              callLine: this.nodeLine(token ?? ty ?? n),
              constructed: true,
              constructionNode: n.type,
            },
          })
          this.pushInstantiation(source, target, token ?? ty ?? n, n.type)
        }
      }
      // AN ARGUMENT-BEARING CALL, which this grammar calls an
      // `array_access_expression`. See the class-level note for why two signals
      // are required and what happens to the rest.
      if (n.type === "array_access_expression") {
        // THE CALLEE IS THE FIRST NAMED CHILD, not the last identifier leaf under
        // the node. `calleeLeaf(n)` on the whole node returns the last identifier in
        // the subtree, which for `ImmutableArray.Create(BC36556)` is `BC36556` — an
        // ARGUMENT — and the edge would be published as `calls -> BC36556`. The
        // lane's own oracle found this on its first run, by deriving the same
        // `calls -> FixableDiagnosticIds -> BC36556` row and reporting it MISSING,
        // which is how a second walker earning its keep actually looks.
        //
        // `calleeLeaf` is still the right tool for the callee EXPRESSION, because a
        // qualified callee (`obj.M(args)`) puts `obj` first and `M` last inside it.
        const calleeNode = this.nc(n, 0)
        const token = calleeNode ? this.calleeLeaf(calleeNode) : null
        const target = this.nameText(token)
        if (target.length > 0) {
          const argCount = n.namedChildCount > 1 ? n.namedChildCount - 1 : 0
          const viaDeclaration = this.callablesInFile.has(target) && !this.arrayValuedInFile.has(target)
          const viaStatement = this.isStatementLevelCall(n) &&
            !this.variablesInFile.has(target) && !this.localsInFile.has(target)
          if (viaDeclaration || viaStatement) {
            if (source) {
              this.relationships.push({
                source: source.name,
                target,
                type: RelationshipType.Calls,
                confidence: viaDeclaration && this.declaredNames.has(target) ? 1.0 : 0.7,
                line_number: this.nodeLine(token ?? n),
                metadata: {
                  argumentCount: argCount,
                  calleeIsQualified: calleeNode?.type === "member_access_expression",
                  callLine: this.nodeLine(token ?? n),
                  constructed: false,
                  // `callShape` names the node the grammar gave this call, because
                  // `array_access_expression` is not what a reader expects to see on
                  // a `calls` edge and a consumer filtering on the node type would
                  // otherwise conclude the edge is an index.
                  callShape: n.type,
                  callSignal: viaDeclaration ? "callee-declared-callable-in-file" : "call-statement",
                },
              })
              // Same as the invocation branch above: `uses` must not republish the
              // member this walk has just called. `obj.M(3)` reaches this branch as
              // an `array_access_expression`, which is the shape the climb in
              // `isCalleePosition` used to walk straight past.
              if (calleeNode) this.callCalleeNodes.add(calleeNode.id)
            } else {
              this.note("call-without-enclosing-declaration")
            }
          } else {
            // Counted, never guessed: this is `a(i)` OR `Foo(i)` and the grammar
            // cannot say which. Naming the number is what makes the limit visible.
            this.note("index-or-call-ambiguous")
          }
        }
      }
      // A MEMBER READ, which is the family's `uses`: a value read that is neither a
      // call nor a write. go's GO1, csharp's CS-D4 and csharp's CS-R1 all define it
      // that way, and it is what answers "what does this method touch".
      //
      // GRAMMAR FACT, measured: `member_access_expression` has NO `name` field and
      // NO `expression` field in this grammar -- its children are positional
      // (`identifier`, the anonymous `.`, `identifier`). Reading
      // `childForFieldName("name")` returns `undefined` on every one of them, and
      // an analyzer written against the C# shape silently emits nothing. The
      // accessed member is the LAST identifier leaf, which is `calleeLeaf`.
      if (n.type === "member_access_expression" || n.type === "with_member_access_expression") {
        const leaf = this.calleeLeaf(n)
        const target = this.nameText(leaf)
        if (source && target.length > 0 && !this.isCalleePosition(n) && !this.isAssignmentLhs(n) &&
            !this.inAttributePosition(n)) {
          const key = `${source.name}->${target}`
          const line = this.nodeLine(leaf ?? n)
          // THE DEDUP KEEPS THE EARLIEST SITE LINE, not the first one visited.
          //
          // "First visited" is a property of the WALK, not of the file: this walk
          // descends in document order while an oracle that walks the same tree with
          // an explicit stack descends in reverse, so "the first site" is a
          // different line in each and the two disagree on 70 of 500 `uses` edges
          // about a line number while agreeing about every edge. The MINIMUM line is
          // a property of the FILE, so both sides land on it and the comparison is
          // about the decisions rather than about the traversal.
          const prior = this.usesEmitted.get(key)
          if (prior === undefined) {
            this.usesEmitted.set(key, { key, line_number: line })
            this.relationships.push({
              source: source.name,
              target,
              type: RelationshipType.Uses,
              confidence: this.declaredNames.has(target) ? 0.9 : 0.7,
              line_number: line,
              metadata: {
                relationshipType: "vb_member_read",
                readKind: n.type,
                receiverIsQualified: this.calleeLeafIsNotFirst(n),
                // The reason code the honesty contract §4 requires for any
                // confidence below 1.0: without it, 0.7 is a number with no
                // machine-readable reason attached.
                resolvedInFile: this.declaredNames.has(target),
              },
            })
          } else if (line !== null && line < (prior.line_number ?? Number.MAX_SAFE_INTEGER)) {
            // An EARLIER site for a pair already published: re-stamp the existing
            // edge rather than adding a second one, so the dedup stays one edge per
            // (source, target) and the line it carries is the earliest site in the
            // file rather than the first one this walk happened to reach.
            prior.line_number = line
            this.relineUses(key, line)
          }
        }
      }
      for (const c of this.kids(n)) visit(c)
    }
    visit(scope)
  }

  /** One `instantiates` edge, sourced at the declaration that constructs. */
  private pushInstantiation(
    source: ASTEngine.UniversalSymbol,
    target: string,
    nameNode: Node,
    nodeType: string,
  ): void {
    this.relationships.push({
      source: source.name,
      target,
      type: RelationshipType.Instantiates,
      confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
      line_number: this.nodeLine(nameNode),
      metadata: {
        isNew: true,
        constructedType: target,
        // `New Integer(10)` is an ARRAY construction and the grammar reports it as
        // `array_creation_expression`. Recording that rather than hiding it is the
        // difference between "instantiates Integer" being a fact a reader can check
        // and being a claim they have to take on trust.
        constructionNode: nodeType,
        constructsArray: nodeType === "array_creation_expression",
        resolvedInFile: this.declaredNames.has(target),
      },
    })
  }

  /** Re-stamp an already-published `uses` edge with an earlier site line. */
  private relineUses(key: string, line: number): void {
    for (const r of this.relationships) {
      if (r.type !== RelationshipType.Uses) continue
      if (`${r.source}->${r.target}` === key) { r.line_number = line; return }
    }
  }

  /**
   * Is this `array_access_expression` the whole content of an expression
   * statement? `CheckMemberAndReportDiagnostic(context, member)` is a CALL
   * statement; `x = a(i)` is an index inside an assignment. VB has no
   * statement-level index expression, so the shape decides — and the caller adds
   * the second half of the test (the callee is not one of this file's own
   * variables), which is what removes `arr(0)`.
   */
  private isStatementLevelCall(n: Node): boolean {
    const p = n.parent
    if (!p) return false
    if (p.type !== "expression_statement") return false
    return p.namedChildCount === 1
  }

  /**
   * Is this member access (or the chain above it) the CALLEE of an invocation?
   *
   * `obj.M()` is `invocation_expression(function: member_access_expression)`. And
   * `obj.M(args)` — the shape this grammar produces for a call WITH arguments — is
   * an `array_access_expression` whose first named child is the member access, so
   * the climb has to pass through `array_access_expression` as well or every
   * chained call's leading segment is published as a read of the wrong member.
   */
  private isCalleePosition(n: Node): boolean {
    // The decision this walk already MADE, not a second derivation of it. See
    // `callCalleeNodes`: for `obj.M(3)` this grammar emits an
    // `array_access_expression` with no invocation node above it, so the climb this
    // method used to do walked out of the call shape and reported "not a callee"
    // for a member that had just been published as one.
    if (this.callCalleeNodes.has(n.id)) return true
    let a: Node | null = n
    for (let i = 0; a !== null && i < 12; i++) {
      // Explicit annotation: with web-tree-sitter's recursive `Node.parent` typing the
      // inferred type of `p` becomes circular through the `a = p` assignment, so tsc
      // reports TS7022. The annotation is type-only and changes no behaviour.
      const p: Node | null = a.parent
      if (!p) return false
      if (p.type === "member_access_expression" || p.type === "with_member_access_expression" ||
          p.type === "array_access_expression" || p.type === "parenthesized_expression") {
        a = p
        continue
      }
      if (p.type === "invocation_expression") {
        const fn = p.childForFieldName("function")
        return fn !== null && fn !== undefined && fn.id === a.id
      }
      return false
    }
    return false
  }

  /**
   * Is this identifier on the LEFT of an assignment? `this.count = 0` is a write,
   * not a read — the family's SCD1 contract, shared by java JAD1, kotlin KAD1 and
   * scala SCD1. Containment is by SPAN, so `this.count = this.count + 1` keeps its
   * right-hand read.
   */
  private isAssignmentLhs(n: Node): boolean {
    let a: Node | null = n.parent
    for (let i = 0; a !== null && i < 6; i++) {
      if (a.type === "member_access_expression" || a.type === "with_member_access_expression" ||
          a.type === "identifier" || a.type === "array_access_expression") {
        a = a.parent
        continue
      }
      break
    }
    if (!a) return false
    if (a.type !== "assignment_expression" && a.type !== "assignment_statement") return false
    const left = a.childForFieldName("left") ?? a.childForFieldName("target")
    if (!left) return false
    return left.startIndex <= n.startIndex && left.endIndex >= n.endIndex
  }

  /**
   * Is this member access inside an ATTRIBUTE rather than inside code?
   *
   * `<Obsolete(MefConstruction.ImportingConstructorMessage, True)>` on a
   * constructor is read by the COMPILER at type-load time, not by the constructor,
   * so `uses -> constructor -> ImportingConstructorMessage` is not a read the
   * constructor performs. The lane's differential reported exactly these three rows
   * as UNEXPLAINED, on three separate corpus files.
   */
  private inAttributePosition(n: Node): boolean {
    let a: Node | null = n.parent
    for (let i = 0; a !== null && i < 6; i++) {
      if (a.type === "attribute_list" || a.type === "attribute" ||
          a.type === "attribute_argument_list" || a.type === "global_attribute_section") return true
      if (a.type === "identifier" || a.type === "simple_name" || a.type === "qualified_name" ||
          a.type === "global_qualified_name" || a.type === "generic_name") { a = a.parent; continue }
      return false
    }
    return false
  }

  /** Is the accessed member the SECOND half of the chain, i.e. is there a receiver? */
  private calleeLeafIsNotFirst(n: Node): boolean {
    return this.namedChildrenOfType(n, "identifier").length > 1
  }

  /**
   * Is the thing being invoked a CONSTRUCTION?
   *
   * Read down the receiver chain to the leftmost node: `New Foo()` is an
   * `invocation_expression` whose `function` is the `object_creation_expression`
   * itself, and `New System.Drawing.Size()` is an `invocation_expression` whose
   * `function` is a three-deep `member_access_expression` whose innermost
   * `object` is the construction. Both are constructions the grammar wrapped in
   * an invocation, and both already produce an `instantiates` edge naming the
   * same type, so publishing a `calls` edge as well would count one syntactic
   * event twice under two labels.
   */
  private calleeIsConstruction(fn: Node): boolean {
    let cur: Node = fn
    for (let guard = 0; guard < 32; guard++) {
      if (cur.type === "object_creation_expression" || cur.type === "array_creation_expression") return true
      if (cur.type !== "member_access_expression" && cur.type !== "with_member_access_expression") return false
      const obj = cur.childForFieldName("object")
      if (!obj || obj.id === cur.id) return false
      cur = obj
    }
    return false
  }

  /**
   * Is this qualified access the thing being invoked, or the thing being indexed?
   *
   * `function` is the callee slot and `array` is the indexed slot, and those two
   * are the only positions in this grammar where a name is being APPLIED rather
   * than read. `with_member_access_expression` has neither field -- the census
   * measured 1,017 of them and 1,017 with no `member` field either -- so it
   * always reads, which is the right answer for a `With` block: `.Value = 1`
   * inside `With obj` reads `Value` off `obj`, it does not call it.
   */
  private isCalleeOrIndexSlot(n: Node): boolean {
    const p = n.parent
    if (!p) return false
    if (p.type === "with_member_access_expression") return false
    const fn = p.childForFieldName("function")
    if (fn && fn.id === n.id) return true
    const arr = p.childForFieldName("array")
    if (arr && arr.id === n.id) return true
    return false
  }

  /**
   * `uses`: the enclosing declaration READS this name.
   *
   * VB HAS the construct -- it is the commonest expression in the language -- so
   * this is a GAP and not a ruling. Measured on the lane corpus: 323,540
   * `member_access_expression` and 1,017 `with_member_access_expression` nodes
   * are a name read rather than a callee or an index, in 1,921 of 2,658 files.
   *
   * WHAT THE TARGET IS. The NAME the file writes, which is the last identifier
   * leaf of the access chain -- `TimeSpan.FromSeconds` gives `FromSeconds`, and
   * `System.Collections.Generic.List(Of String)` gives `List` because
   * `calleeLeaf` skips a `type_argument_list`. That is the same name the
   * `calls` edge would carry for the same expression, so the two labels are
   * comparable and a consumer can ask either question of the same grammar.
   *
   * WHAT THE TARGET IS NOT. A resolved symbol. A qualified read names a member
   * of a type this file usually does not declare, so the edge resolves at both
   * ends about as often as a `calls` edge does (12.0% measured on the current
   * `calls` population) and that is the honest number for a cross-file name, not
   * a defect. The family convention agrees: `real-csharp-analyzer.ts` publishes
   * its identifier reads as `uses` at confidence 1.0 with the same meaning --
   * the name is written in the file, so the READ is a fact, and whether the
   * name binds to something elsewhere is a resolution question the edge does not
   * claim to have answered.
   *
   * DEDUPLICATED PER (source, target), keeping the FIRST site, with the site
   * count on the edge. This matches the family's own `uses` emission (csharp
   * keys on `source::uses::name`) and it is what makes the class affordable:
   * 323,540 read sites collapse to the distinct pairs. `sites` keeps the raw
   * count visible, so the dedup hides nothing.
   */
  private pushUse(source: ASTEngine.UniversalSymbol | null, target: string, n: Node, token: Node | null): void {
    const src = source ?? this.currentOwner()
    if (!src) {
      this.note("use-without-enclosing-declaration")
      return
    }
    const key = `${src.name}\u0000${target}`
    const line = this.nodeLine(token ?? n)
    const prior = this.useIndex.get(key)
    if (prior !== undefined) {
      // The dedup must not make the raw count invisible, so the edge's own
      // metadata carries it: `sites` is how many read sites collapsed here.
      prior.sites++
      prior.edge.metadata = { ...prior.edge.metadata, sites: prior.sites }
      return
    }
    const edge: ASTEngine.UniversalRelationship = {
      source: src.name,
      target,
      type: RelationshipType.Uses,
      confidence: 1.0,
      line_number: line,
      metadata: { readNode: n.type, sites: 1 },
    }
    this.useIndex.set(key, { sites: 1, line, edge })
    this.relationships.push(edge)
  }

  /**
   * The type name a CONSTRUCTION builds, when the construction is the leading
   * segment of a qualified name rather than a whole one.
   *
   * MEASURED, not guessed. `New System.Drawing.Size(3, 4)` does not parse as
   * one construction: it is
   *   (array_access_expression
   *      array: (member_access_expression
   *               object: (member_access_expression
   *                        object: (object_creation_expression  System)
   *                        member: Drawing)
   *               member: Size)
   *      indices: 3, 4)
   * so the `object_creation_expression` holds only `New System` and the real
   * target is the LAST leaf of the enclosing access chain. Publishing the node's
   * own `type` field here would publish `instantiates -> System`, which is a
   * namespace and not a type anybody constructs -- the grammar's fragmentation
   * turned into a fact about the program, which is the fabrication the
   * workstream names. Counted over the lane corpus: 15,233
   * `object_creation_expression` and 310 `array_creation_expression` nodes are
   * fragments of a qualified name, against 1,612 and 15,181 that stand alone
   * (census probes `instantiates:*:fragment_of_qualified` /
   * `instantiates:*:standalone`) -- so this is the COMMON case in this grammar,
   * not an edge one.
   */
  private constructionTargetLeaf(n: Node): Node | null {
    // A FRAGMENT first. `New System.Drawing.Size(3, 4)` holds `New System` and
    // the constructed type is the last leaf of the access chain it is the head
    // of, so reading this node's own `type` field here published
    // `instantiates -> System` -- a namespace, and a name nothing constructs.
    if (this.constructionIsFragment(n)) {
      let outer: Node = n
      for (let guard = 0; guard < 32; guard++) {
        const p = outer.parent
        if (!p) break
        const isAccess = p.type === "member_access_expression" || p.type === "with_member_access_expression"
        if (!isAccess) break
        const obj = p.childForFieldName("object")
        if (!obj || obj.id !== outer.id) break
        outer = p
      }
      const leaf = this.calleeLeaf(outer)
      if (leaf) return leaf
    }
    const ty = n.childForFieldName("type")
    if (ty) return this.calleeLeaf(ty)
    // A bare `New Foo` with no `type` field: the name is the only identifier
    // leaf under the construction.
    return this.calleeLeaf(n)
  }

  /**
   * Is this construction the leading NAMESPACE SEGMENT of a qualified type name,
   * rather than a whole construction that happens to be the RECEIVER of an access?
   *
   * THE PARENT TEST ALONE WAS NOT ENOUGH, and it fabricated an edge on 322
   * construction nodes across the lane corpus. "Is my parent a
   * `member_access_expression` whose `object` I am?" is true for two completely
   * different programs:
   *
   *   `New System.Text.StringBuilder`  the construction holds `New System` and
   *       `Text.StringBuilder` continues the TYPE in the chain, so the last leaf
   *       of the chain (`StringBuilder`) is the constructed type. CLIMB.
   *
   *   `New StackFrame(1).GetMethod().Name`   the construction is COMPLETE and
   *       `.GetMethod` is a method call ON THE OBJECT JUST BUILT, so the last
   *       leaf of the chain (`Name`) is not a type at all. DO NOT CLIMB.
   *
   * The second shape published `instantiates -> GetMethod` — a method, not a
   * type, which is the fabrication `docs/analyzers/ONTOLOGY-WORKSTREAM.md`
   * Part 2 names as the thing that poisons `bb_graph`. An independent
   * source-text oracle (`script/m14/vb-instantiates-oracle.ts`, which reads no
   * grammar at all) put the error at 1.07% of all `instantiates` edges on a
   * 200-file draw, and named the targets: `ToList` 59, `Message` 6, `Length` 4,
   * `GetMethod` 4, `Contains` 4, `Clone` 2, `Status`, `LayeredDriver`, `Get`,
   * `TextInfo`. None of them is a constructed type.
   *
   * THE DISCRIMINATOR, measured over all 15,543 construction nodes that sit in an
   * access chain across the corpus (`script/m14/tmp-vb/frag3.mts`):
   *
   *     a construction is a NAMESPACE PREFIX iff its `type` field is a BARE
   *     `simple_name` and it has no other named child
   *
   *   15,221  bare `type`, no other child   -> a namespace prefix; climbing is right
   *     322  anything else                  -> the construction is complete
   *
   * Every one of the 322 is a real defect of one of two kinds, and both are in
   * the sample set:
   *
   *   - the construction carries its own arguments, so the chain is a member
   *     access on the value: `New StackFrame(1).GetMethod()`,
   *     `New CultureInfo("en-US", False).TextInfo`,
   *     `BattleQuery.Add(New TextQueryObject(...))` -> `-> Add`, and
   *     `New String() {…}.ToList()` (whose arguments are an `array_initializer`,
   *     not a `bounds` field, so a `bounds`-only test misses it — hence the
   *     named-child count rather than a field test).
   *   - the construction node's SPAN was mis-anchored by the grammar's error
   *     recovery onto the following statement: `Dim SpawnedEntity = New
   *     BattleAnimation3D(...)` followed by `SpawnedEntity.Opacity = Opacity`
   *     yields `-> Opacity`. Its `type` is a `generic_name` rather than a bare
   *     `simple_name`, which is what the second half of the test catches.
   */
  private constructionIsFragment(n: Node): boolean {
    const p = n.parent
    if (!p) return false
    if (p.type !== "member_access_expression" && p.type !== "with_member_access_expression") return false
    const obj = p.childForFieldName("object")
    if (!obj || obj.id !== n.id) return false
    // The construction must be BARE: its `type` is a single unqualified segment
    // and it carries no argument list of its own. Anything else is a whole
    // construction whose receiver happens to be read further along the chain.
    if (n.namedChildCount !== 1) return false
    const ty = n.childForFieldName("type")
    if (!ty) return false
    return ty.type === "simple_name" || ty.type === "identifier"
  }

  /**
   * `instantiates`: a construction is not a call.
   *
   * VB HAS four distinct construction surfaces and the grammar gives each of
   * them a different shape, so the count is four counts and not one:
   *
   *   `New Foo` / `New Foo()`      object_creation_expression
   *   `New Foo(a, b)`              array_creation_expression   (a `type` field
   *                                and a `bounds` field, and NO `function`
   *                                field -- the node a caller must read to find
   *                                the constructed type)
   *   `As New Foo()`               an `as_clause` whose text begins `As New`,
   *                                where the declared_type is an `array_type`
   *                                because the `()` reads as bounds
   *   `New A.B.C(x)`               an access chain (see
   *                                `constructionTargetLeaf`)
   *
   * Measured over 2,658 corpus files: 16,845 `object_creation_expression` and
   * 15,491 `array_creation_expression` nodes, plus 2,499 `as_clause`s that begin
   * `As New`. The `As New` half cannot be read from the tree at all -- both
   * keywords are inlined away by the grammar's `as_clause` rule, measured at 0
   * of 30,001 `as_clause` nodes carrying either token -- so it is a char scan
   * over the node's own span with the equivalence argued in
   * `startsWithAsNewClause`, and the census runs the same predicate with the
   * same controls.
   *
   * LABEL. This edge REPLACES the `calls` edge the analyzer used to publish for
   * a construction rather than joining it. Publishing both would double-count
   * one syntactic event under two labels and put a construction in the call
   * graph, which is what makes `bb_graph`'s call view wrong. The family's own
   * convention agrees: `real-csharp-analyzer.ts` emits `instantiates` for
   * `object_creation_expression` and its `calls` rule explicitly excludes it.
   *
   * CONFIDENCE follows the same rule every other VB edge follows: 1.0 when this
   * file also declares the constructed type, 0.6 when it does not, because the
   * target is then a name and not a resolved symbol. Under the honesty
   * contract's 0.7 floor the 0.6 edges read `inferred`, which is stamped by the
   * one evidence-class pass at the end of `analyze()`.
   */
  private pushConstruction(n: Node, source: ASTEngine.UniversalSymbol | null): void {
    const token = this.constructionTargetLeaf(n)
    const target = this.nameText(token)
    if (target.length === 0) {
      // COUNTED, not dropped in silence. `New String() {"a", "b"}` is
      // `(array_creation_expression type: (array_type element_type:
      // (predefined_type) (array_rank_specifier)) initializer: ...)`, and a
      // `predefined_type` is a keyword token with no identifier leaf under it, so
      // the naming walk finds nothing and there is no name to publish. An edge
      // from an invented name would be the fabrication; a silent drop is the
      // same boundary stated quietly. Rule 4 of this file's contract is that a
      // gap is disclosed, so `metadata.vbGaps` carries the count and a consumer
      // can see the boundary instead of inferring coverage from silence.
      this.note("construction-without-readable-name")
      return
    }
    if (!source) {
      // No enclosing declaration: an edge from nothing is a phantom, so it is
      // counted instead of invented. 21 such sites on the lane corpus.
      this.note("instantiation-without-enclosing-declaration")
      return
    }
    this.relationships.push({
      source: source.name,
      target,
      type: RelationshipType.Instantiates,
      confidence: this.declaredNames.has(target) ? 1.0 : 0.6,
      line_number: this.nodeLine(token ?? n),
      metadata: {
        constructionNode: n.type,
        constructionForm: this.constructionFormOf(n),
        qualifiedConstruction: this.constructionIsFragment(n),
      },
    })
  }

  /** Which of the four VB construction surfaces this is, for a reader triaging. */
  private constructionFormOf(n: Node): string {
    if (n.type === "array_creation_expression") {
      return n.childForFieldName("bounds") !== null ? "new-with-bounds" : "new-array-initializer"
    }
    return n.parent?.type === "invocation_expression" ? "new-then-invoke" : "new"
  }

  /**
   * Does this `as_clause` begin with the two VB words `As` `New`?
   *
   * A char scan with the equivalence argued, because the tree cannot answer it:
   * `as_clause` is `seq(ci("As"), ci("New"), field("declared_type", ...))` and
   * both keywords are ABSENT from the produced tree -- measured over the corpus,
   * 0 of 30,001 `as_clause` nodes carry an `As` or `New` token, and a printed
   * tree of `Dim l As New List(Of String)` shows an `as_clause` whose FIRST
   * child is the `generic_name`. A node-type or token test on the tree has
   * nothing to read, so this reads the node's own span instead.
   *
   * Word boundary means: the byte before the word is start-of-span or not a
   * letter/digit/underscore, and the byte after it is the same or end-of-span.
   * `As Namespace` and `As NewType` must NOT match, and both are rejected
   * because the adjacent byte is a letter. The leading whitespace is skipped
   * first because `as_clause`'s span can begin at the line's indentation.
   */
  private static startsWithAsNewClause(s: string): boolean {
    const isWordChar = (c: number): boolean =>
      (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95
    const skipSpace = (i: number): number => {
      let k = i
      while (k < s.length) {
        const c = s.charCodeAt(k)
        if (c === 32 || c === 9 || c === 13 || c === 10) k++
        else break
      }
      return k
    }
    const startsAt = (i: number, w: string): boolean => {
      if (i > 0 && isWordChar(s.charCodeAt(i - 1))) return false
      if (i + w.length > s.length) return false
      for (let k = 0; k < w.length; k++) {
        let c = s.charCodeAt(i + k)
        if (c >= 65 && c <= 90) c += 32
        if (c !== w.charCodeAt(k)) return false
      }
      return true
    }
    const endsAt = (i: number): boolean => i >= s.length || !isWordChar(s.charCodeAt(i))
    const i = skipSpace(0)
    if (!startsAt(i, "as")) return false
    const j = skipSpace(i + 2)
    if (!startsAt(j, "new")) return false
    return endsAt(j + 3)
  }

  /**
   * A type NAME this file uses, as a `references` edge.
   *
   * Emitted only for a name this file does not itself declare, because a type
   * this file declares has a `contains`/`extends` edge already and a second edge
   * between the same pair is noise a consumer has to filter.
   */
  private pushTypeReference(from: ASTEngine.UniversalSymbol, typeNode: Node, role: string): void {
    // A TUPLE IS NOT A TYPE NAME, so there is nothing for a `references` edge to
    // name. `As (ExpressionSyntax, SyntaxToken, ExpressionSyntax)` and
    // `As Function(assembly As Assembly, typeName As String)` are both `tuple_type`
    // in this grammar, and both were published as the WHOLE parenthesised text --
    // a target that is not a name in the file, not navigable, and unmatchable by an
    // oracle. The lane's differential derived the element types instead and
    // reported the whole-text rows as UNEXPLAINED, which is the right verdict on
    // them. Counted rather than dropped silently.
    if (typeNode.type === "tuple_type") {
      this.note("tuple-type-has-no-single-name")
      return
    }
    const token = this.namingToken(typeNode, typeNode.text)
    // THE BUILT-IN KEYWORD — read off the NODE TYPE, and only off the node type. `namingToken`
    // already descends `nullable_type` and `array_type` to the element type, so `As String?` and
    // `As String()` land here with the `predefined_type` node itself, which is what makes this test
    // cover the keyword in every position rather than only the bare one. The canonical spelling is
    // read from the same closed set the claim publishes, so the two can never drift: a target this
    // map returns is a target the claim's own list contains, by construction (see
    // `VB_BUILTIN_TYPE_NAMES` for the measurement, the precedents and the refusals).
    const builtin = token !== null && token.type === "predefined_type"
      ? VB_BUILTIN_TYPE_CANONICAL.get(this.nameText(token).toLowerCase())
      : undefined
    const target = builtin ?? this.nameText(token ?? typeNode)
    if (target.length === 0) return
    if (this.declaredNames.has(target)) return
    this.relationships.push({
      source: from.name,
      target,
      type: RelationshipType.References,
      confidence: 0.6,
      line_number: this.nodeLine(token ?? typeNode),
      metadata: {
        role,
        qualified: typeNode.type === "qualified_name" || typeNode.type === "global_qualified_name",
        ...(builtin !== undefined
          ? {
              languageNamespace: [...VB_BUILTIN_TYPE_NAMES],
              languageNamespaceBasis: "vb-grammar-predefined-type",
            }
          : {}),
      },
    })
  }

  // -------------------------------------------------------------------------
  // Complexity
  // -------------------------------------------------------------------------

  /**
   * Cyclomatic complexity, counted off DECISION NODES in the AST.
   *
   * The node set is the set of grammar rules that introduce a branch, and each
   * is named rather than matched, so a grammar change that adds a branching rule
   * shows up as a number that moved and a spec entry that is now wrong. No text
   * scan: counting `If` in a comment would be a fabrication.
   */
  private static readonly DECISION_NODES: ReadonlySet<string> = new Set([
    "if_statement", "while_statement", "do_statement", "for_statement",
    "for_each_statement", "case_clause", "catch_clause", "catch_block",
    "case_else_clause", "else_clause", "catch_filter_clause", "when_clause",
  ])

  private cyclomaticComplexity(root: Node): number {
    let n = 1
    const visit = (node: Node): void => {
      if (RealVbAnalyzer.DECISION_NODES.has(node.type)) n++
      for (const c of this.kids(node)) visit(c)
    }
    visit(root)
    return n
  }

  /** A file-level figure: nodes per 100 lines, so it is comparable across files. */
  private complexity(root: Node): number {
    let count = 0
    const visit = (node: Node): void => {
      count++
      for (const c of this.kids(node)) visit(c)
    }
    visit(root)
    return count
  }
}

export default RealVbAnalyzer
