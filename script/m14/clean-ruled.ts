/**
 * CLEAN RULING TABLE — the one type `src/ast/real-clean-analyzer.ts` does not emit.
 *
 * ## Why this file exists and is not in the gate
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery (§8). Its
 * `RULED_BY_LANG` is a literal with no extension point, so run against `clean` it can
 * only reach `script/m14/spec/clean-completeness.json`. The supervisor's permanent change
 * is two lines, and they are the same two lines every other lane needed:
 *
 *   import { CLEAN_RULED } from "./clean-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { …, clean: CLEAN_RULED }
 *
 * `Ruled` is restated here rather than imported because the gate does not export it and
 * the gate is not this lane's to change. If the supervisor exports the type, the
 * restatement below is the only thing that becomes redundant.
 *
 * ## The verdict
 *
 *   extends   RULED   instrument B (parse-tree-count), corroborated by instrument A
 *
 * The other nine types (`calls`, `uses`, `contains`, `imports`, `references`, `exports`,
 * `implements`, `overrides`, `instantiates`) are EMITTED — the arbiter counts them from
 * production `parseFile` on 312 admitted corpus files — so they take no row here. A table
 * entry for a type that IS emitted would be dead configuration.
 *
 * ## Why instrument B and not A
 *
 * Instrument A is the right instrument for a construct that needs a node type the grammar
 * does not have, and Clean has no inheritance keyword: 0 of the 39 probed names (22
 * node-type names — `extends_clause`, `superclass`, `mixin`, … — and 17 bare words —
 * `extends`, `implements`, `inherit`, `superclass`, …) is among the pinned wasm's 290
 * declared node types, and none of its 29 declared FIELD names is a supertype slot.
 *
 * But a bare instrument-A ruling for Clean would be hiding the strongest counter-argument
 * rather than answering it. Clean HAS a `class` declaration carrying a `class_context`, and
 * `class_context` is the node a reader will point at: `class Ord a | Eq a` names another
 * class inside a class declaration, and `instance Ord Int with Eq Int` does the same on an
 * instance. `class_declaration` and `class_context` are both among the 7 declared node
 * types whose name contains "class" (`class`, `class_method_name`, `class_context`,
 * `class_declaration`, `class_name`, `class_member`, `instance_class` — read off
 * `grammar.types`), so a table that listed them would be
 * falsified by the arbiter and a table that omitted them without saying why would be
 * decoration. This table therefore rules on B, and states the position measurement that
 * decides the question A cannot:
 *
 *   **the direct named children of all 3,572 class/instance/derive declarations are
 *   exhaustively accounted for, 0 unclassified** (`extends-construct-probe.json`).
 *
 * `UNCLASSIFIED` is the only bucket a supertype clause could occupy, because every slot the
 * grammar gives these declarations is a name, a member, a context, a type-parameter
 * annotation, a body or a comment — the probe names each one and counts it.
 *
 * ## What the ruling is NOT claiming
 *
 * It does not claim Clean has no way to relate one class to another. It claims the language
 * has no SUPERTYPE relation: `Ord` is not a kind of `Eq`, `a` is merely required to have
 * both dictionaries, and `with` composes dictionaries rather than inheriting members from a
 * base type. Those `class_context` sites are already published as `references` by the
 * analyzer — the label the construct actually earns. At the PROD population (312 files,
 * `clean-ontology-census.ts`) 436 `references` edges carry the `class_context`
 * discriminator; the 20 class contexts the analyzer does not read are named under
 * [Q5](#q5--resolved-both-endpoints-bind-to-a-real-symbol) and are a `references` GAP, not
 * a supertype edge. Re-labelling any of them `extends` would assert a subtyping
 * relationship the language never writes, and that is the one edge in this table the
 * project must not fabricate.
 *
 * ## The measurements
 *
 * Over the 2,181-file corpus (`script/m14/clean-wide-manifest.txt`, content-deduplicated;
 * `git ls-files` alone admits 312):
 *
 *   A. grammar inventory   199 distinct node types PRODUCED across 3,107,897 nodes; 0 of
 *                          the 39 probed inheritance-shaped names present (22 node-type
 *                          names + 17 words). Grammar's own table:
 *                          290 declared node types, 29 declared field names, 0 supertype.
 *                          22 of the 23 probed Clean keywords are present as declared
 *                          types; only `deriving` is absent (the tree-sitter-clean
 *                          spelling of the keyword).
 *   B. parse-tree count    3,572 declarations (423 class, 2,539 instance, 610 derive) and
 *                          1,995 class_context nodes; 0 children UNCLASSIFIED.
 *
 * Evidence, both instruments: `validation/m14/fixtures/clean/extends-construct-probe.json`,
 * regenerable with `npx tsx validation/m14/fixtures/clean/extends-construct-probe.mts`.
 * Written reasons: `docs/analyzers/clean.md` §"`extends` — RULED, with both
 * instruments".
 */
export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  /**
   * Which probe spaces this lane enumerated. The ontology gate declares the same
   * union; entries here state it explicitly (the shape is shared data, not a
   * second definition — the gate imports CLEAN_RULED and validates the values).
   */
  spacesProbed?: Array<"node-types" | "block-types" | "attribute-keys" | "corpus-count">
  describe: string
}
type Type =
  | "calls"
  | "uses"
  | "contains"
  | "imports"
  | "references"
  | "exports"
  | "extends"
  | "implements"
  | "overrides"
  | "instantiates"
  // the four EXTENDED values: ruled on 2026-10-28 after the census
  | "decorates"
  | "part_of"
  | "renders"
  | "mixes_in"

// ───────────────────────────────────────────────────────────────────── the probe (B)

/**
 * The four declaration nodes whose children are exhaustively inventoried. A supertype
 * clause, if the language had one, would be a child of one of these and of no other node.
 *
 * `class_context` is in the set on purpose. It is the node a reader will name as Clean's
 * inheritance slot, so its own children are inventoried too — otherwise the ruling would
 * have an unexamined hole exactly where the objection lives.
 */
export const CLEAN_DECLARATION_NODES = ["class_declaration", "instance_declaration", "derive_declaration", "class_context"] as const

/**
 * Every named child slot the corpus observes on those four nodes, by ROLE. Measured over
 * 2,181 files (`extends-construct-probe.json` → `slotsByRole`); this table is the
 * measurement, not a guess at it. A named child outside it is UNCLASSIFIED and is the only
 * thing the probe reports.
 *
 * The roles are mutually exclusive and every slot has one:
 *   name        the declared name — `class Foo a`, `instance Foo Int`, `deriving [Eq]`
 *   member      a member the declaration owns — a class method, an instance implementation
 *   context     a dictionary requirement or composition — `| Eq a`, `with Eq Int`
 *   parameter   a type parameter or its kind — `.a`, `.(a .e)`, `*` uniqueness
 *   body        the member bodies of an instance or a generic class
 *   comment     a comment node, which is not code
 *   parse-error an `ERROR` child, which is the parser failing, counted and reported apart
 */
export const CLEAN_DECLARATION_SLOTS: Record<string, string> = {
  // name — the declared name, in every spelling the grammar gives it
  class_name: "name",
  instance_class: "name",
  constructor: "name",
  class_method_name: "name",
  identifier: "name",
  // An operator token is ALSO a class name in Clean: the corpus writes
  // `instance == (StrictList a) | == a` (clean-ide/Util/StrictList.icl:9), so `==` is
  // a class and `| == a` is a constraint on it. 4 of these 14 are corpus-observed
  // (`operator` 5, `operator_mul` 406, `operator_compare` 161, `operator_add` 29);
  // the other 10 are declared by the pinned grammar and never occur in this corpus.
  // They are listed anyway, and the reason is that whitelisting one CANNOT hide a
  // supertype: in a class_context an operator token is the constraint's NAME, exactly
  // the role `constructor` (1,501 occurrences) plays for `| Eq a`, so no spelling of
  // it becomes a base type. Listing only the 4 observed would mean a corpus that
  // constrained on `&&` or `<` was reported as carrying a supertype clause, which is
  // a false conviction of a correct ruling.
  //
  // `operator_definition` is deliberately NOT here: `name :: type` is a member
  // definition, not a bare class-name token.
  parenthesized_operator: "name",
  backtick_operator: "name",
  range_operator: "name",
  operator: "name",
  operator_add: "name",
  operator_and: "name",
  operator_compare: "name",
  operator_cons: "name",
  operator_cons_strict: "name",
  operator_dot: "name",
  operator_exp: "name",
  operator_mul: "name",
  operator_or: "name",
  operator_pipe: "name",
  // member
  class_member: "member",
  instance_member: "member",
  // context
  class_context: "context",
  // parameter / kind annotation
  type_variable: "parameter",
  type_function: "parameter",
  type_paren: "parameter",
  type_application: "parameter",
  list_type: "parameter",
  tuple_type: "parameter",
  array_type: "parameter",
  dotted_type: "parameter",
  fixity_annotation: "parameter",
  generic_kind_type: "parameter",
  uniqueness_star: "parameter",
  // `? a`, `?^ a`, `?# a` and `()` are Clean's question-type and unit TYPE EXPRESSIONS,
  // so an instance target carrying one (`instance Foo ? a`) is annotating a parameter.
  // 9 and 6 occurrences respectively across the corpus; read as types, not as supertypes.
  question_type: "parameter",
  unit_type: "parameter",
  // body
  code_expression: "body",
  // comment
  line_comment: "comment",
  block_comment: "comment",
  // parse failure, NOT a supertype slot and NOT counted as one
  ERROR: "parse-error",
}

export type CleanDeclarationCensus = {
  declarations: number
  byNodeType: Record<string, number>
  unclassified: { file: string; line: number; nodeType: string; childType: string; text: string }[]
  unclassifiedByChildType: Record<string, number>
  slotsByRole: Record<string, number>
  slotTypesByRole: Record<string, string[]>
  /** `${declarationNodeType} > ${childType}` -> count. The auditable form of the whitelist. */
  childInventory: Record<string, number>
}

/**
 * The `extends` probe: walk every Clean declaration, name each of its direct named
 * children, and report the ones no measured slot accounts for.
 *
 * Three things it deliberately does NOT do, each because the alternative has already
 * convicted a correct ruling somewhere in this repository:
 *
 * 1. **NO TEXT REGEX.** The gate's own header records what a regex costs on this question:
 *    a probe for `extends` once matched `class voice` inside a telnet IAC word list, and a
 *    probe for `instantiates` matched `new Map(` inside JavaScript embedded in a bash
 *    heredoc. Every rule here reads node types. `fileLabel` is used for the hit message
 *    only, so no file-path convention can stand in for a construct.
 * 2. **NO SUPERCLASS-ROLE WHITELIST BY NAME.** The walk does not ask "is this child called
 *    something like a base class" — it asks "is this child a slot the corpus accounts for",
 *    and the accounting is derived from the corpus. A grammar that grew a supertype slot
 *    would produce a child type absent from `CLEAN_DECLARATION_SLOTS` and be reported here
 *    without anybody editing this file.
 * 3. **NO `class_context` EXEMPTION.** The context slot is inventoried like every other,
 *    so the objection "a class_context names a class, so it IS inheritance" is answered by
 *    the shape rather than by a decision: a class_context's children are constraints
 *    (a `constructor`/`identifier`/`operator_*`) plus type variables, and there is no field
 *    on any of them that marks a constraint as a base type.
 *
 * One reading is NOT available here and is stated rather than implied: this probe cannot
 * distinguish a dictionary requirement `| Eq a` from a composition `with Eq Int`, because the
 * pinned grammar gives both the same `class_context` node with the same fields. That is why
 * the ruling rests on the ABSENCE of a supertype slot rather than on the presence of a
 * constraint — a difference the grammar itself declines to record.
 */
export function countCleanExtendsConstruct(root: any, fileLabel: string, hits: string[]): void {
  censusCleanDeclarations(root).unclassified.forEach((u) => {
    hits.push(`${fileLabel}:${u.line} ${u.nodeType} carries an unclassified child \`${u.childType}\` — ${u.text.slice(0, 60)}`)
  })
}

/**
 * The whole census behind the ruling, so the evidence file and the arbiter read ONE
 * implementation. `countCleanExtendsConstruct` is this function narrowed to the hits the
 * gate prints; nothing else is duplicated.
 */
export function censusCleanDeclarations(root: any): CleanDeclarationCensus {
  const out: CleanDeclarationCensus = {
    declarations: 0,
    byNodeType: {},
    unclassified: [],
    unclassifiedByChildType: {},
    slotsByRole: {},
    slotTypesByRole: {},
    childInventory: {},
  }
  const targets = new Set<string>(CLEAN_DECLARATION_NODES)
  const visit = (n: any) => {
    if (targets.has(n.type)) {
      out.declarations++
      out.byNodeType[n.type] = (out.byNodeType[n.type] ?? 0) + 1
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        const role = CLEAN_DECLARATION_SLOTS[c.type]
        const invKey = `${n.type} > ${c.type}`
        out.childInventory[invKey] = (out.childInventory[invKey] ?? 0) + 1
        if (role === undefined) {
          out.unclassifiedByChildType[c.type] = (out.unclassifiedByChildType[c.type] ?? 0) + 1
          out.unclassified.push({
            file: "",
            line: Number(c.startPosition?.row ?? 0) + 1,
            nodeType: n.type,
            childType: c.type,
            text: String(c.text ?? ""),
          })
          continue
        }
        out.slotsByRole[role] = (out.slotsByRole[role] ?? 0) + 1
        const list = out.slotTypesByRole[role] ?? (out.slotTypesByRole[role] = [])
        if (!list.includes(c.type)) list.push(c.type)
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}

// ───────────────────────────────────────────────────────────────────────── the ruling

/**
 * Vocabulary that would express inheritance IF the grammar had a rule for it. Deliberately
 * NOT listed: `class_declaration`, `class_context`, `class_member`, `class_name`,
 * `instance_class`, `instance_member`, `class_method_name` — all seven EXIST and are
 * produced by this corpus, so listing any of them would have the arbiter report FALSIFIED,
 * correctly, on a type declaration rather than on a supertype clause. That is the same
 * distinction the zig table records, and it is the reason this row is instrument B: the
 * grammar inventory cannot separate "a type declaration" from "a supertype clause", and the
 * position census below can.
 *
 * The names here are the ones a supertype clause would have to be called to be recognisable
 * at all. All are absent from the pinned wasm's 290 declared node types AND from the 199 the
 * corpus produces.
 */
export const CLEAN_SUPERTYPE_NODE_TYPES = [
  "extends_clause",
  "extend_clause",
  "implements_clause",
  "inheritance_specifier",
  "inheritance_clause",
  "superclass",
  "superclass_clause",
  "super_class",
  "base_class",
  "base_class_clause",
  "base_type",
  "parent_class",
  "subclass",
  "sub_type",
  "sub_type_declaration",
  "interface_declaration",
  "interface_body",
  "trait_declaration",
  "mixin_declaration",
  "mixin",
  "derives_clause",
  "extends_type",
]

/**
 * The names a supertype clause could carry, checked against the grammar's OWN tables rather
 * than only against corpus output. A grammar that declared an inheritance rule nobody
 * happens to use would be invisible to a corpus census, so the declared table is the wider
 * net and it is measured too (`extends-construct-probe.json` → `declaredTypes`,
 * `declaredFields`).
 */
export const CLEAN_SUPERTYPE_WORDS = [
  "extends",
  "extend",
  "implements",
  "implements_clause",
  "inherit",
  "inheritance",
  "superclass",
  "super",
  "base_class",
  "parent_class",
  "override",
  "overrides",
  "mixin",
  "interface_declaration",
  "trait",
  "subclass",
  "sub_type",
]

// ────────────────────────────────────────────── the four EXTENDED types: shared probes
//
// `decorates`, `part_of`, `renders` and `mixes_in` are the vocabulary's four extended values.
// Each is ruled only against a probe that can FIRE, and each probe is exported so the census
// (`validation/m14/fixtures/clean/extended-census.ts`) runs the SAME function the arbiter runs —
// a control that exercises a re-implementation tests the re-implementation.
//
// The shape of every hit is "the tree carries the construct", never "the text mentions a word":
// this repository has already been convicted twice by lexical probes (a bash `extends` matched
// `class voice` in a telnet word list; an `instantiates` probe matched `new Map(` inside embedded
// JavaScript), so nothing below reads `node.text` except to report WHICH node fired.

/**
 * The node types that DECLARE something — the only shapes a decorator could be applied to.
 * A `macro_definition` whose child is one of these would be a macro applied to a declaration
 * (the `decorates` contract); a `with_block` whose child is one of these would be a scope that
 * DEFINES members (the `mixes_in` contract).
 */
const CLEAN_DECLARATION_TYPES: ReadonlySet<string> = new Set([
  "function_declaration",
  "operator_definition",
  "type_signature",
  "type_definition",
  "record_definition",
  "class_declaration",
  "instance_declaration",
  "generic_declaration",
  "derive_declaration",
  "macro_definition",
  "foreign_export",
  "module_declaration",
])

/** Iterative pre-order walk: a 3M-node corpus file overflows the JS recursion budget. */
function walkCleanNodes(root: any, visit: (n: any) => void): void {
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    visit(n)
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

/** `file:line` for a hit message — presentation only; no rule reads it. */
const cleanAt = (fileLabel: string, n: any): string =>
  `${fileLabel}:${Number(n.startPosition?.row ?? 0) + 1}`

/**
 * `decorates` — a macro APPLIED TO a declaration.
 *
 * Clean's `name :== expr` is a macro definition (the grammar's `macro_definition`, 583 corpus
 * sites, published as `macro` symbols), and a macro is a compile-time VALUE: the corpus's 583
 * sites are all `Name :== <expression>`. The probe fires if any `macro_definition` carries a
 * DECLARATION as a named child — the only tree shape in which a macro is applied to a
 * declaration — or if the served build declares a node type that names the construct.
 */
export function countCleanDecoratesConstruct(root: any, fileLabel: string, hits: string[]): void {
  walkCleanNodes(root, (n) => {
    if (/^(decorator|decorates|annotation|annotation_clause)$/.test(n.type)) {
      hits.push(`${cleanAt(fileLabel, n)} node type \`${n.type}\` expresses a decorator`)
      return
    }
    if (n.type !== "macro_definition") return
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && CLEAN_DECLARATION_TYPES.has(c.type)) {
        hits.push(`${cleanAt(fileLabel, n)} macro_definition carries a ${c.type} — a macro applied to a declaration`)
        return
      }
    }
  })
}

/**
 * `part_of` — a textual FILE INCLUSION whose content shares the including unit's scope.
 *
 * Clean has no include directive: `import` names a MODULE and imports its symbols into a new
 * scope, which is `imports` and already published 1,917 edges. The probe fires on a node type
 * that names an inclusion, or on a module path that is a FILE (`StdEnv.icl`) rather than a
 * module identifier — the two shapes a file-inclusion construct would have to take.
 */
export function countCleanPartOfConstruct(root: any, fileLabel: string, hits: string[]): void {
  walkCleanNodes(root, (n) => {
    if (/(^|_)(include|incbin|part_of|partof)($|_)/i.test(n.type)) {
      hits.push(`${cleanAt(fileLabel, n)} node type \`${n.type}\` expresses a file inclusion`)
      return
    }
    if (n.type !== "module_identifier" && n.type !== "qualified_identifier") return
    const t = String(n.text ?? "").trim()
    if (/\.(icl|dcl)$/i.test(t)) hits.push(`${cleanAt(fileLabel, n)} module path names a FILE (\`${t}\`) — an inclusion, not an import`)
  })
}

/**
 * `renders` — a component element that CONSTRUCTS another component.
 *
 * Clean has no element/component syntax; Clyde builds HTML through ordinary functions. The
 * probe fires on a node type that names a component, or on the only tree shape that could
 * stand in for an element: a CONSTRUCTOR applied to a string literal whose text opens an HTML
 * tag (`Tag "<div>"`). A string is not an element, which is exactly the distinction the
 * falsifier records — this probe asks for the shape, not the word.
 */
export function countCleanRendersConstruct(root: any, fileLabel: string, hits: string[]): void {
  walkCleanNodes(root, (n) => {
    if (/^(jsx_element|jsx_self_closing|element|component|component_element|vnode|fragment|slot)$/.test(n.type)) {
      hits.push(`${cleanAt(fileLabel, n)} node type \`${n.type}\` expresses a component element`)
      return
    }
    if (n.type !== "application") return
    const callee = n.namedChild(0)
    if (!callee || callee.type !== "constructor") return
    for (let i = 1; i < n.namedChildCount; i++) {
      const a = n.namedChild(i)
      if (a && a.type === "string" && String(a.text ?? "").trim().replace(/^"|"$/g, "").startsWith("<")) {
        hits.push(`${cleanAt(fileLabel, n)} constructor \`${callee.text}\` applied to an element string — a component element`)
        return
      }
    }
  })
}

/**
 * `mixes_in` — a type COMPOSES another type's member set into its own supertype chain.
 *
 * The corpus's `with` is a scoping construct (`with (ys,zs) = span p xs`, a let-like binding)
 * and `class_context` composes DICTIONARIES (`instance Ord Int with Eq Int`), which is already
 * published as `references`/`implements`. The probe fires if a `with_block` or a
 * `class_context` carries a DECLARATION as a named child — a member set defined in place — or
 * if the served build declares a mixin node type.
 */
export function countCleanMixesInConstruct(root: any, fileLabel: string, hits: string[]): void {
  walkCleanNodes(root, (n) => {
    if (/^(mixin_declaration|mixin|trait_declaration|trait_use|embedding_clause|embedding)$/.test(n.type)) {
      hits.push(`${cleanAt(fileLabel, n)} node type \`${n.type}\` expresses a member-set composition`)
      return
    }
    if (n.type !== "with_block" && n.type !== "class_context") return
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && CLEAN_DECLARATION_TYPES.has(c.type)) {
        hits.push(`${cleanAt(fileLabel, n)} ${n.type} carries a ${c.type} — a composed member set`)
        return
      }
    }
  })
}

export const CLEAN_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "B:parse-tree-count",
    countOnTree: countCleanExtendsConstruct,
    describe:
      "a SUPERTYPE relation — a declaration that names another type as its base, from which it inherits members. MEASURED, instrument B (parse-tree position census, THIS probe, over the 2,181-file content-deduplicated corpus; evidence validation/m14/fixtures/clean/extends-construct-probe.json): 3,572 declarations walked — 423 class_declaration, 2,539 instance_declaration, 610 derive_declaration — plus 1,995 class_context nodes, and **0 direct named children UNCLASSIFIED**. Every slot those nodes expose is accounted for by role: name (class_name, instance_class, constructor, identifier, class_method_name), member (class_member, instance_member), context (class_context), parameter (type_variable, type_function, type_paren, type_application, list_type, tuple_type, array_type, dotted_type, fixity_annotation, generic_kind_type, uniqueness_star), body (code_expression), comment (line_comment, block_comment), parse-error (ERROR, reported apart and not counted as a construct). UNCLASSIFIED is the only bucket a supertype clause could occupy, and it is empty. The 11 dotted_type children of class_declaration are kind annotations on a type parameter (`class List .l e` → `.(a .e)`), measured by reading all 11 sites, not inferred from the node name. CORROBORATED by instrument A: the grammar produced 199 distinct node types across 3,107,897 nodes and 0 of the 22 probed supertype node types is among them; the pinned wasm's OWN tables declare 290 node types and 29 field names, 22 of the 23 probed Clean keywords present as declared types (`class`, `instance`, `where`, `with`, `derive`, `import`, `definition`, `implementation`, `infix`, `special`, `generic`, `if`, `case`, `let`, `export`, `qualified`, `as`, `from`, `module`, `of`, `::`, `|`; only `deriving` is absent — the tree-sitter-clean spelling of the keyword) and 0 of the 29 field names is a supertype slot, so the negative is a property of the grammar and not of the corpus. WHAT THIS IS NOT: Clean does relate one class to another — `class Ord a | Eq a` constrains a type parameter with another class, and `instance Ord Int with Eq Int` composes two — and 436 such class_context sites are already published as `references` at the PROD population (312 files). The claim is not that the relation is absent, it is that it is a DICTIONARY REQUIREMENT and not a SUPERTYPE: `Ord` is not a kind of `Eq`, and `a` is merely required to have both dictionaries. The pinned grammar does not record the difference between `| Eq a` and `with Eq Int` — same `class_context` node, same fields — which is why this ruling rests on the absence of a supertype SLOT rather than on the presence of a constraint. OVERTURN (satisfiable by a correct implementation, which is what makes it falsifiable): this probe pushing a single hit, i.e. any class_declaration / instance_declaration / derive_declaration / class_context carrying a named child outside the measured slots above — which is what a grammar that added a supertype clause would produce on the first file that used it; OR a tree-sitter-clean release that declares a node type or field name among the 22 node-type names and 17 words probed above, or any of the grammar's 29 declared field names; OR a corpus file in which a class names another class in a position that is not class_context. `extends` was measured 0 on both instruments at 2,181 files and 0 through production `parseFile` on the arbiter's 312 admitted files.",
  },
  {
    type: "decorates",
    instrument: "B:parse-tree-count",
    spacesProbed: ["node-types", "block-types", "attribute-keys"],
    countOnTree: countCleanDecoratesConstruct,
    describe:
      "a MACRO APPLIED TO A DECLARATION. MEASURED, instrument B (the arbiter's own probe, whole admitted population, 312 files, 312 parsed, 0 failed; evidence validation/m14/measurements/clean-extended-census-2026-10-28.json): 583 `macro_definition` sites — Clean's `name :== expr` — and **0 of them carry a DECLARATION as a named child**. The three synthetic shapes show what the grammar builds: `NSViewCloseButton :== 0` is `macro_definition > constructor > :== > number`, `sizeOfInt :== 4 + 4` is `macro_definition > identifier > :== > binary_expression`, and `apply :== \\f x -> f x` is `macro_definition > identifier > :== > lambda_expression`, all with 0 ERROR nodes. A macro is therefore a compile-time VALUE bound to a name, not an operator applied to syntax, and there is no tree shape in which one decorates a declaration. INSTRUMENT A, the served build's own tables (143 declared named types of 290 ids, digest 001361f63df7): of the probed stems, `decorat` 0, `macro_apply` 0, `macro_call` 0, `pragma` 0, `attribute` 0 — and the ONE stem hit is `annotat` → `fixity_annotation`, which is the `infix` part of a fixity DECLARATION (`infixl 2 +`), not an application to a declaration; the lane already publishes fixity declarations separately, so that node is accounted for and is not the construct. CONTROLS: the same scanner finds class_declaration, instance_declaration, import_declaration, macro_definition, with_block and index_access (6/6), and the corpus produces all five node families counted above, so the zero is the grammar's and not the scanner's. OVERTURN: this probe pushing one hit — any `macro_definition` carrying a function/type/class/instance/generic/derive/module declaration as a named child, or a served build that declares a decorator/annotation node type — i.e. a corpus file in which a macro is applied to a declaration.",
  },
  {
    type: "part_of",
    instrument: "B:parse-tree-count",
    spacesProbed: ["node-types", "block-types", "attribute-keys"],
    countOnTree: countCleanPartOfConstruct,
    describe:
      "a TEXTUAL FILE INCLUSION whose content shares the including unit's scope. MEASURED, instrument B (whole admitted population, 312 files, 312 parsed, 0 failed): 1,328 `import_declaration` sites, and **0 module paths that name a FILE** (`StdEnv.icl`, `StdEnv.dcl`) — every one names a MODULE identifier, which is what `imports` publishes (1,917 edges). The synthetic shapes show the two spellings both landing on `import_declaration > module_name > module_identifier`: `import StdEnv` and `from StdEnv import length`. INSTRUMENT A (143 declared named types of 290 ids): of `include`, `incbin`, `part_of`, `partof`, `inline_file`, `paste` — **0 hits**, while the same scan finds import_declaration and the five other control families. Clean has no preprocessor and no textual paste: a module is compiled from its own `.icl`/`.dcl` and imports another module's EXPORTED symbols into a new scope, so the imported text never shares the importing unit's scope — the defining property of `part_of`. OVERTURN: this probe pushing one hit — a node type naming an inclusion, or an import whose module path is a file — i.e. a corpus site where a file's contents are included into the including unit rather than imported as a module.",
  },
  {
    type: "renders",
    instrument: "B:parse-tree-count",
    spacesProbed: ["node-types", "block-types", "attribute-keys"],
    countOnTree: countCleanRendersConstruct,
    describe:
      "a COMPONENT ELEMENT that constructs another component. MEASURED, instrument B (whole admitted population, 312 files, 312 parsed, 0 failed): **0 detector hits**, against 0 render-ish calls (`toHtml`/`render`/`html`/`HTML` as a callee: 0), 4 HTML-looking STRING literals and 0 constructor+elements sites. The nearest construct is counted rather than dismissed: Clyde builds HTML through ordinary functions over ordinary data, and a string literal containing `<…>` is a value, not an element — it has no tag that names a declared component and no child-component construction, which is the contract's shape (`src/ast/types.ts`, Renders: target = the rendered COMPONENT). INSTRUMENT A (143 declared named types of 290 ids): of `render`, `component`, `element`, `jsx`, `vnode`, `fragment`, `slot`, `template` — **0 hits**, while class/instance/import/macro/with/index families are found (controls 6/6). THE PROBE'S OWN CONTROL FIRES: the synthetic `Tag \"<div>\"` is caught by the same detector (`constructor applied to an element string`), which is exactly the shape the ruling says is NOT a component element — a constructor applied to a STRING has no declared component as its tag, so this is the falsifier firing on the nearest miss and being read correctly, not a hit on the corpus (0 such sites in 312 files). OVERTURN: this probe pushing a hit on the CORPUS, or a served build that declares a component/element node type.",
  },
  {
    type: "mixes_in",
    instrument: "B:parse-tree-count",
    spacesProbed: ["node-types", "block-types", "attribute-keys"],
    countOnTree: countCleanMixesInConstruct,
    describe:
      "a type COMPOSES another type's member set into its own supertype chain. MEASURED, instrument B (whole admitted population, 312 files, 312 parsed, 0 failed): **0 detector hits**, against 20 `with_block` sites (**0 carrying a DECLARATION as a named child**) and 473 `class_context` sites (**0 carrying a DECLARATION**). Both nearest constructs are read, not waved away: `with` is a DEFINING SCOPE — the synthetic `f x = y with y = x + 1` parses with 0 errors as `function_declaration > … > with_block`, a let-like block that binds values for the result expression; and `class_context` composes DICTIONARIES (`class Ord a | Eq a`, `instance Ord Int with Eq Int`), which the lane already publishes as `references` (436 `class_context` edges at this population) and `implements`. The extends ruling's position census is the corroborating measurement that no slot of a class/instance/derive declaration composes a member set (3,572 declarations, 0 UNCLASSIFIED children). INSTRUMENT A (143 declared named types of 290 ids): of `mixin`, `trait`, `embed`, `compose`, `with_clause`, `member_set` — **0 hits**, while the control families are all found (6/6). OVERTURN: this probe pushing a hit — a `with_block` or `class_context` carrying a declaration, or a served build that declares a mixin/trait/embedding node type — i.e. a corpus site where one type's members are copied into another.",
  },
]
