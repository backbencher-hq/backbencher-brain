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
 * does not have, and Clean has no inheritance keyword: 0 of 24 probed words
 * (`extends`, `implements`, `inherit`, `superclass`, …) is among the pinned wasm's 290
 * declared node types, and none of its 30 declared FIELD names is a supertype slot.
 *
 * But a bare instrument-A ruling for Clean would be hiding the strongest counter-argument
 * rather than answering it. Clean HAS a `class` declaration carrying a `class_context`, and
 * `class_context` is the node a reader will point at: `class Ord a | Eq a` names another
 * class inside a class declaration, and `instance Ord Int with Eq Int` does the same on an
 * instance. `class_declaration` and `class_context` are both among the 8 node types the
 * pinned grammar declares whose name contains "class", so a table that listed them would be
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
 * base type. Every one of those 1,817 `class_context` sites is already published as
 * `references` by the analyzer — the label the construct actually earns. Re-labelling them
 * `extends` would assert a subtyping relationship the language never writes, and that is the
 * one edge in this table the project must not fabricate.
 *
 * ## The measurements
 *
 * Over the 2,181-file corpus (`script/m14/clean-wide-manifest.txt`, content-deduplicated;
 * `git ls-files` alone admits 312):
 *
 *   A. grammar inventory   199 distinct node types PRODUCED across 3,107,897 nodes; 0 of
 *                          the 16 inheritance-shaped names present. Grammar's own table:
 *                          290 declared node types, 30 declared field names, 0 supertype.
 *   B. parse-tree count    3,572 declarations (423 class, 2,539 instance, 610 derive) and
 *                          1,995 class_context nodes; 0 children UNCLASSIFIED.
 *
 * Evidence, both instruments: `validation/m14/fixtures/clean/extends-construct-probe.json`,
 * regenerable with `npx tsx validation/m14/fixtures/clean/extends-construct-probe.mts`.
 * Written reasons: `docs/analyzers/real-clean-analyzer.md` §"`extends` — RULED, with both
 * instruments".
 */
export type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

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

export const CLEAN_RULED: Ruled[] = [
  {
    type: "extends",
    instrument: "B:parse-tree-count",
    countOnTree: countCleanExtendsConstruct,
    describe:
      "a SUPERTYPE relation — a declaration that names another type as its base, from which it inherits members. MEASURED, instrument B (parse-tree position census, THIS probe, over the 2,181-file content-deduplicated corpus; evidence validation/m14/fixtures/clean/extends-construct-probe.json): 3,572 declarations walked — 423 class_declaration, 2,539 instance_declaration, 610 derive_declaration — plus 1,995 class_context nodes, and **0 direct named children UNCLASSIFIED**. Every slot those nodes expose is accounted for by role: name (class_name, instance_class, constructor, identifier, class_method_name), member (class_member, instance_member), context (class_context), parameter (type_variable, type_function, type_paren, type_application, list_type, tuple_type, array_type, dotted_type, fixity_annotation, generic_kind_type, uniqueness_star), body (code_expression), comment (line_comment, block_comment), parse-error (ERROR, reported apart and not counted as a construct). UNCLASSIFIED is the only bucket a supertype clause could occupy, and it is empty. The 11 dotted_type children of class_declaration are kind annotations on a type parameter (`class List .l e` → `.(a .e)`), measured by reading all 11 sites, not inferred from the node name. CORROBORATED by instrument A: the grammar produced 199 distinct node types across 3,107,897 nodes and 0 of the 22 probed supertype node types is among them; the pinned wasm's OWN tables declare 290 node types and 30 field names, 23 of 24 probed Clean keywords present as declared types (`class`, `instance`, `where`, `with`, `derive`, `import`, `definition`, `implementation`, `infix`, `special`, `generic`, `if`, `case`, `let`, `export`, `qualified`, `as`, `from`, `module`, `of`, `export`, `::`, `|` — only `deriving` absent, the tree-sitter-clean spelling of the keyword) and 0 of the 30 field names is a supertype slot, so the negative is a property of the grammar and not of the corpus. WHAT THIS IS NOT: Clean does relate one class to another — `class Ord a | Eq a` constrains a type parameter with another class, and `instance Ord Int with Eq Int` composes two — and all 1,817 such class_context sites are already published as `references`. The claim is not that the relation is absent, it is that it is a DICTIONARY REQUIREMENT and not a SUPERTYPE: `Ord` is not a kind of `Eq`, and `a` is merely required to have both dictionaries. The pinned grammar does not record the difference between `| Eq a` and `with Eq Int` — same `class_context` node, same fields — which is why this ruling rests on the absence of a supertype SLOT rather than on the presence of a constraint. OVERTURN (satisfiable by a correct implementation, which is what makes it falsifiable): this probe pushing a single hit, i.e. any class_declaration / instance_declaration / derive_declaration / class_context carrying a named child outside the measured slots above — which is what a grammar that added a supertype clause would produce on the first file that used it; OR a tree-sitter-clean release that declares a node type or field name among the 22 and 30 probed above; OR a corpus file in which a class names another class in a position that is not class_context. `extends` was measured 0 on both instruments at 2,181 files and 0 through production `parseFile` on the arbiter's 312 admitted files.",
  },
]
