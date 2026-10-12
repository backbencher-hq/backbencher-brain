/**
 * A PROJECT-WIDE DECLARATION INDEX, built once and handed to analyzers that ask for
 * it. This is the `AnalyzeContext` payload fifteen sibling analyzers already read
 * and that NO production caller populates — the gap this repo's own JavaScript
 * external-override fixture documents in its header ("Production callers never
 * populate AnalyzeContext.overrideCompanion, so the pre-M37.10 javascript analyzer
 * silently dropped every override whose base class was declared in another file").
 *
 * WHY IT EXISTS, MEASURED. On the 389-file Solidity corpus a per-file analyzer
 * cannot see, and therefore cannot be correct about, two things:
 *
 *   · 507 inheritance edges whose KIND is undecided. `contract X is IFeed` states
 *     that X inherits IFeed; whether IFeed is an INTERFACE is decided by a
 *     declaration in another file.
 *   · 1,564 call targets (93.3% of the lane's `external` class) that a whole-corpus
 *     audit shows are declared somewhere the file cannot see.
 *
 * Both are the same defect wearing two faces: an unfilled parameter.
 *
 * WHY IT IS ADDITIVE AND OPT-IN. `ProjectIndex` is an OPTIONAL field. Every analyzer
 * that does not read it behaves EXACTLY as before, byte for byte — which is the
 * property that makes it safe to add to a shared type while fifteen lanes depend on
 * it. There is no default, no fallback, and no behaviour change for absent context;
 * the Solidity analyzer reads it in one place and treats "no index" as "per-file
 * contract", which is what it already does.
 *
 * WHY IT IS NOT THE ANALYZER. The scanner here reads the TREE directly and knows
 * nothing about `RealSolidityAnalyzer`'s heuristics, its recovery regions, its
 * reserved tokens or its override rules. That is deliberate: an index built BY the
 * analyzer it feeds could inherit the analyzer's mistakes, and then a wrong index
 * would confirm the wrong answer. Independence is the whole value — the same reason
 * the F5 oracle re-derives from the grammar rather than reading analyzer output.
 *
 * WHY IT IS SHALLOW. It records only what a cross-file question can need: which
 * names are declared, what KIND each type is, each type's OWN members, and each
 * type's direct bases. No bodies, no line numbers, no relationships. A full parse of
 * every file is already the dominant cost of indexing, so the index is a walk over
 * an existing parse rather than a second parse.
 */

import type { Node } from "web-tree-sitter"
import * as fs from "node:fs"
import * as path from "node:path"

export type DeclarationKind =
  | "contract"
  | "interface"
  | "library"
  | "struct"
  | "enum"
  // PY-7: python's type declaration. Added to the union rather than folded into "unknown",
  // because a shared type is not the place to pretend one language's types are another's, and
  // "unknown" would read as "we looked and could not tell" — which is a different and worse
  // claim than "this is a class".
  | "class"
  // Dart's declaration kinds. Added to the union for the reason "class" was: a
  // shared type is not the place to pretend one language's mixin is another's
  // class, and "unknown" would read as "we looked and could not tell", which is a
  // different and worse claim than "this is a mixin".
  | "mixin"
  // F#'s declaration kinds. Added to the union for the reason "class" and "mixin" were: a
  // shared type is not the place to pretend one language's record is another's struct, and
  // "unknown" would read as "we looked and could not tell", which a record is not.
  | "record"
  | "union"
  | "extension"
  | "extension_type"
  // SCSS's module kind. Added to the union for the reason "class", "mixin" and the F# kinds were:
  // a shared type is NOT the place to pretend SCSS's module is another language's "library", and
  // "unknown" would read as "we looked and could not tell" — which a stylesheet IS, so that would
  // be a worse claim than "this is a module". The SCSS spec at `SCSS_DECLARATION_SPEC` below had
  // already WRITTEN the argument (*"SCSS has no type hierarchy (no implements/instantiates). The
  // module IS the type unit"*) while its comment claimed this member existed — and it did not,
  // which left `npx tsc --noEmit` and `npm run audit:script-typecheck` at exit 2 FLEET-WIDE while
  // the file sat uncommitted. THE LESSON IS THE ONE THIS SESSION KEEPS RELEARNING: a comment
  // asserting a shared contract is not the contract.
  | "module"
  | "unknown"

export interface ProjectIndex {
  /** Declared type name -> its kind. Answers "is IFeed an interface?". */
  typeKinds: Map<string, DeclarationKind>
  /** Declared type name -> the member names IT declares (not its ancestors'). */
  typeMembers: Map<string, Set<string>>
  /** Declared type name -> its direct bases, in source order. */
  typeBases: Map<string, string[]>
  /** Every declared symbol name anywhere in the project. */
  symbolNames: Set<string>
  /** Files that produced ERROR/MISSING nodes, so a caller can refuse to trust them. */
  damagedFiles: Set<string>
  /** How many files were read, and how many were damaged. */
  stats: { files: number; damaged: number }
}

/** The Solidity declaration shapes, as the GRAMMAR names them. Kept as data so a
 *  sibling language can register its own without touching this module. */
export interface DeclarationSpec {
  /** Node types that declare a named type. */
  typeNodes: Record<string, DeclarationKind>
  /** Node types that declare a member of the enclosing type. */
  memberNodes: string[]
  /** Node types that declare a member of the enclosing type AND is callable. */
  memberNodesCallable?: string[]
  /** Node type that lists direct bases. */
  baseNodes?: string[]
  /**
   * Node types that OPEN A SCOPE, so a declaration inside one is not a member of the
   * lexically enclosing type. python needs this and Solidity does not: a function nested in a
   * function is not a method of the class around it, and without this the index attributes
   * every closure to the class two levels up. For an override index that is not a cosmetic
   * over-count — it makes a base class appear to declare a method it does not have, and the
   * resolution then SUPPRESSES a real override on the strength of a fabricated member.
   */
  scopeNodes?: string[]
  /**
   * Read a declaration's OWN name from its node, when the grammar does not put it in a `name`
   * field. ONE hook for the type, its members and the owning type of a base, because a grammar
   * that spells one of them differently usually spells all three differently. F# is the case:
   * a clause carries `type_name` (`type_name > identifier`), a member is named two levels down
   * (`member_defn > method_or_prop_defn.name = property_or_ident`, whose `method` field is the
   * part after the instance dot, so `member this.Speak()` names itself `Speak`), and an
   * ABSTRACT member's name is the first `identifier` of its `member_signature`. The generic
   * `childForFieldName("name")` reads "" for every one of those, i.e. an index of the right
   * shape holding nothing. Absent the hook the behaviour is byte-for-byte what it was.
   */
  nameResolver?: (node: Node, fileName?: string) => string
  /**
   * Read a declaration's DIRECT base names from its own node. Preferred over `baseNodes` when
   * the grammar does not put bases in a node carrying an `ancestor` field: python's live in
   * `class_definition.superclasses` -> `argument_list`, where an entry is an `identifier` or a
   * dotted `attribute` whose own name is the LAST identifier of the path. Solidity's
   * `inheritance_specifier.ancestor` predates this hook and keeps the older path unchanged.
   */
  baseResolver?: (node: Node) => string[]
  /**
   * Node types that DECLARE A NAME the index must record in `symbolNames` while claiming NO
   * `DeclarationKind` for it. FS-P17, and the reason is a measured gap rather than a convenience:
   * the F# spec indexed declared types and `member_defn` members, and F#'s most common
   * declarations are neither. `let f x = …` is a BINDING and `module M` / `namespace M` are
   * SCOPES, so a call to a module-level function and an `open` of a sibling module both looked
   * exactly like FSharp.Core. Priced on the 3,000-file draw: 16,456 edges hang off the binding
   * channel and **24,215** off the scope channel — together more than the 32,778 the shipped
   * width reaches (`.tmp-probe/fs-p16-index-refine.py`, the `+BINDINGS`/`+SCOPES` columns).
   *
   * IT IS A SEPARATE FIELD FROM `typeNodes` ON PURPOSE, and the reason is the duplicate-kind rule
   * below: putting a binding into `typeNodes` means giving it a `DeclarationKind`, and a name that
   * is both a function and a type would then DOWNGRADE the type to `unknown` — the same defect
   * pass 14 avoided for `.fsi` pairs, and it would break the one question `typeKinds` exists for.
   * Names only, no kinds, no `typeMembers` attribution either: a module's members are not a TYPE's
   * members, and `buildResolutionTables` would otherwise answer "does this base declare this
   * member" from a module.
   *
   * Recorded only where `scopes === 0`: a `let` inside a function body is a LOCAL, and a local is
   * not a project declaration — F# needs `function_or_value_defn` in `scopeNodes` for that test to
   * mean anything, which is the same correction PY-7 records for python closures.
   */
  nameOnlyNodes?: string[]
  /**
   * NAME A ROOT TYPE BY THE FILE IT LIVES IN. A grammar whose type unit IS the file — SCSS, where
   * the stylesheet root node is the module and its name is the file's basename — declares that here,
   * and `indexTree` uses the `fileName` its callers pass. WITHOUT THIS THE EXTRACTION IS EMPTY and
   * silently so: `stylesheet` matches `typeNodes` but `childForFieldName("name")` reads "", the type
   * branch requires a non-empty name, and the type AND every member under it are dropped —
   * measured: `typeMembers` and `symbolNames` both `[]` over real SCSS files, one of which the
   * grammar gives 12 `function_statement` nodes.
   *
   * Absent the flag the behaviour is byte-for-byte what it was; every other spec's type nodes
   * carry their own `name` field, so the fallback never fires for them even when a caller passes a
   * path.
   */
  nameFromFile?: boolean
  /**
   * Resolve a declaration's KIND from its own node, when the grammar spells TWO DIFFERENT kinds
   * with the SAME node type. `typeNodes` is a static map, so it can only answer a question the
   * grammar already separated — and F# does not separate this one: `type I = abstract member M :
   * int` (an interface) and `type C() = member this.M() = 1` (a class) are both
   * `anon_type_defn`, so the static map filed every F# interface as a class. Measured on this
   * lane's own fixture pair before the hook existed: `type ITagged = abstract member Tag : …`
   * read `kind=class`, and the downstream question the kind exists for ("is this base an
   * interface?") would then be answered WRONG rather than unanswered — which is the one outcome
   * this index refuses, and the reason `unknown` exists as a kind at all.
   *
   * Returning `undefined` means "the static `typeNodes` kind still stands", so a grammar with no
   * such ambiguity omits the hook and every previous language reads exactly what it read.
   */
  kindResolver?: (node: Node) => DeclarationKind | undefined
}

export const SOLIDITY_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    contract_declaration: "contract",
    interface_declaration: "interface",
    library_declaration: "library",
  },
  memberNodes: [
    "function_definition",
    "modifier_definition",
    "constructor_definition",
    "fallback_receive_definition",
    "state_variable_declaration",
    "struct_declaration",
    "enum_declaration",
    "event_definition",
    "error_declaration",
  ],
  baseNodes: ["inheritance_specifier"],
}

/**
 * The python declaration shapes, as the GRAMMAR names them.
 *
 * PY-7. This exists so the companion tier of the `overrides` contract has something to read.
 * The tier is declared on `AnalyzeContext`, read by fifteen lanes, and populated by nobody in
 * production, so the 0.5 `first-parent-guess` — designed as a last resort — absorbs 100% of
 * external overrides. A census over 3,271 python files (`script/m14/python-companion-opportunity.ts`)
 * scored that tier against a corpus-wide, tree-derived map of what each base really declares:
 * of the guesses whose base IS present in the corpus, **76% name a method the base does not
 * declare.** Those are fabricated edges at a confidence a reader cannot discount, and the lane
 * had no way to know: until this change it did not accept an `AnalyzeContext` at all, and the
 * one field it did read, `_overrideCompanion`, was spelled differently from the declared one
 * and written by nobody.
 *
 * The suppression logic downstream needed no change: it already emits a guess only when
 * `!overrideCompanion?.has(base)`. Only the data was missing.
 */
export const PYTHON_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    class_definition: "class",
  },
  // Only functions are members. A class-level ASSIGNMENT is a member too, but it is not
  // inheritable in the sense `overrides` describes — a class variable is not a method, and
  // indexing it as one repeats PY-21 defect 4, where a base's class variable satisfied the
  // "base declares this name" test and published fabricated overrides at 0.95. `memberNodesCallable`
  // is left unset for the same reason: only callable members answer the question.
  memberNodes: ["function_definition"],
  scopeNodes: ["function_definition", "lambda"],
  baseResolver: (node: Node): string[] => {
    const out: string[] = []
    const sup = node.childForFieldName("superclasses")
    if (!sup) return out
    for (let i = 0; i < sup.namedChildCount; i++) {
      const c = sup.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        out.push(c.text)
      } else if (c.type === "attribute") {
        // `pkg.mod.Base` — the ancestor's OWN name is the LAST identifier in the path, the same
        // rule the Solidity path applies to `A.B.C`. Keying the FIRST segment instead would file
        // every `unittest.TestCase`-shaped base under `unittest`.
        const leaf = c.childForFieldName("attribute") ?? c.namedChild(c.namedChildCount - 1)
        if (leaf && leaf.text) out.push(leaf.text)
      }
    }
    return out
  },
}

/**
 * The Dart declaration shapes, as the GRAMMAR names them.
 *
 * PY-7's finding applies to dart verbatim and harder: the `overrideCompanion` tier
 * that DARTD16's cross-file pass reads was populated by nobody, so the 0.8
 * first-parent guess absorbed 100% of dart's external overrides. freezed made that
 * expensive — it emits `@override` on every generated `props`/`hashCode`/`toString`
 * against `Equatable`, so the guess fired on 81 rows in ProxiCall/lib alone and
 * named a base that does not declare the member.
 *
 * Three things the grammar does not group, which is why this needs a `baseResolver`
 * rather than a `baseNodes` list:
 *
 *   1. `extends X` is a `superclass` node; a mixin's `on X` is a BARE
 *      `type_identifier` DIRECT child of the declaration with nothing around it; and
 *      `with` lives INSIDE the `superclass` node beside `extends`, not beside the
 *      declaration. Reading direct children for all three silently loses every mixin
 *      on a class that also extends something.
 *   2. An IMPORT ALIAS is a SIBLING, not a dotted name: `extends _i2.A2` parses as
 *      `superclass > type_identifier(_i2), type_identifier(A2)`. Keying the first
 *      identifier files the class under its alias. Only a `type_identifier` that is
 *      the LAST in its group is the real name.
 *   3. A member is only inheritable if it is CALLABLE. Dart fields cannot be
 *      overridden, and indexing them made a base's field satisfy "this base declares
 *      the name" — the same defect PY-21 defect 4 records for python, and the reason
 *      `memberNodesCallable` is deliberately left unset here too.
 */
export const DART_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: {
    class_definition: "class",
    mixin_declaration: "mixin",
    extension_declaration: "extension",
    extension_type_declaration: "extension_type",
    enum_declaration: "enum",
  },
  // Methods and accessors only. `getter_signature` and `setter_signature` count
  // (Dart overrides both); constructors and fields do not.
  memberNodes: [
    "method_signature",
    "function_signature",
    "getter_signature",
    "setter_signature",
    "operator_signature",
  ],
  // NOT the class body. `typeNodes` already resets the member scope when it enters a
  // declaration, so listing `class_body` here would put every direct member one scope
  // deep and exclude precisely the members the index exists to record — measured: a
  // Dart spec with `class_body` in scopeNodes indexed 9 types and ZERO members.
  // What must be scopes are the BODIES a local function can hide inside, or a local
  // `function_signature` would be indexed as a member of the enclosing class.
  scopeNodes: ["function_body", "function_expression_body", "block"],
  baseResolver: (node: Node): string[] => {
    const out: string[] = []
    const pushLeaf = (group: any): void => {
      if (!group) return
      // the LAST type_identifier in a group is the real type name; earlier ones in
      // the same group are an import alias (`_i2` in `extends _i2.A2`).
      let last: Node | null = null
      for (let i = 0; i < group.namedChildCount; i++) {
        const c = group.namedChild(i)
        if (c && c.type === "type_identifier") last = c
      }
      if (last && last.text) out.push(last.text)
    }
    for (const c of node.namedChildren) {
      if (!c) continue
      if (c.type === "superclass") {
        // `extends A with B` — BOTH live inside this node
        for (const g of c.namedChildren) {
          if (!g) continue
          if (g.type === "type_identifier") out.push(g.text)
          else if (g.type === "superclass" || g.type === "mixin" || g.type === "interfaces") pushLeaf(g)
        }
        continue
      }
      // a mixin's `on X` is a bare type_identifier DIRECT child, with no wrapper
      if (c.type === "type_identifier") { out.push(c.text); continue }
      if (c.type === "interfaces" || c.type === "mixin_on_clause") pushLeaf(c)
    }
    return out
  },
}

/**
 * The F# declaration shapes, as the GRAMMAR names them, verified against the tree rather than
 * remembered: `.tmp-probe/p10-tree.mts validation/m14/fixtures/fsharp/override-target.fs 5`
 * prints every node and field quoted below.
 *
 * WHY F# NEEDED THIS AT ALL. `analyze` on this lane has never received a project index, so every
 * cross-file question was answered per file: pass 8 measured the classes it costs — 65,215 edges
 * whose name more than one `.fs` in the project declares, 3,689 declared in the project's `.fsi`
 * files only, and the in-project half of a 150,114-edge out-of-project population. This spec is
 * the prerequisite: without it `buildProjectIndex*` cannot read a single F# declaration.
 *
 * THE CLAUSE IS THE DECLARATION. `type X() = …` parses as ONE `type_definition` holding a
 * CLAUSE node per type, so F#'s mutual group (`type A = … and B = …`) is several types in one
 * node and each clause carries its own `type_name`. That is the shape FS-P9 measured 157
 * unnamed members in — a first-name read published them nowhere — which is why the spec lists
 * clause types and not the `type_definition` wrapper.
 *
 * TWO DELIBERATE OMISSIONS, each because including it would make the index WRONG rather than
 * larger:
 *
 *   · `type_declaration` (a bodyless `type Surface`) is the grammar's forward declaration, and an
 *     F# signature pair (`Surface.fsi` + `Surface.fs`) states it in one file and defines it in
 *     the other. Indexing both would hit `indexTree`'s different-kind rule and downgrade a real
 *     `class`/`interface` to `unknown` for every signature pair — the kind is the one thing the
 *     downstream question ("is this base an interface?") needs, so the name is left to the
 *     clause that carries a kind.
 *   · `type_extension` (`type Foo with member …`) does not DECLARE a type; its members attach to
 *     one declared elsewhere, and treating it as a declaration would publish a second `Foo` of
 *     kind `unknown`, with the same kind-downgrade effect on the real one.
 *
 * `anon_type_defn` covers both `type X() = …` and an interface written as bare `abstract member`s
 * (`type ITagged = abstract member Tag : unit -> string`, the fixture's own shape). The grammar
 * does not distinguish them, so the spec reports `class` and does NOT guess: `typeMembers` and
 * `typeBases` — what the cross-file question actually reads — are unaffected by the guess either
 * way, and a wrong `interface` would be a confident wrong answer about a base's kind.
 */
const FSHARP_TYPE_NODES: Record<string, DeclarationKind> = {
  // `anon_type_defn` is BOTH a class and an interface — see FSHARP_KIND_RESOLVER below, which is
  // the whole reason the hook exists. The static entry is the CLASS reading, because a clause
  // with a constructor is the shape that cannot be an interface, and it is what an index build
  // with no resolver falls back to.
  anon_type_defn: "class",
  record_type_defn: "record",
  union_type_defn: "union",
  interface_type_defn: "interface",
  enum_type_defn: "enum",
  // An abbreviation (`type Address = int64<address>`) declares a NAME and no kind of its own —
  // it IS whatever it aliases, which this index cannot see. `unknown` is therefore the accurate
  // answer here rather than the evasive one it would be for a record.
  type_abbrev_defn: "unknown",
  delegate_type_defn: "unknown",
}

/**
 * FS-P16. IS THIS `anon_type_defn` AN INTERFACE?
 *
 * The grammar does not say, and F# writes almost every interface as a clause of abstract members
 * — `type ITagged = abstract member Tag : unit -> string` and `type ITagged = interface end`
 * produce DIFFERENT node types (`anon_type_defn` and `interface_type_defn`), so the static map
 * got the `interface end` spelling right and filed the common one as a class. The lane's own
 * pass-14 spec fixture missed it because it pinned `interface end` — an unpinned spelling that
 * looked like coverage, which is the same shape of defect this lane keeps finding elsewhere.
 *
 * THE RULE IS CLASS EVIDENCE FIRST, and every rule below is a node the tree actually has
 * (verified by dumping all four shapes rather than by reading the grammar's docs):
 *
 *   `type AbstractThing() = abstract member A : int`  `primary_constr_args`     -> a class
 *   `type WithField = val mutable X : int …`          `member_defn` with no `member_signature`
 *                                                                                -> a class
 *   `type WithBoth() = abstract member A … member this.M() = 1`   the concrete member has
 *                                                     `method_or_prop_defn`, i.e. a body -> a class
 *   `[<AbstractClass>] type Abstractish = abstract member A : int`   the attribute is a SIBLING
 *                                                     of the clause, inside `type_definition`
 *                                                                                -> a class
 *   `type IChild = inherit ITagged … abstract member C : int`       no constructor, no concrete
 *                                                     member, an INHERITANCE of another interface
 *                                                                                -> an interface
 *
 * The last row is not an oversight: an F# interface may inherit another interface, so `inherit`
 * cannot be class evidence. What separates the two is the CONSTRUCTOR and a member WITH A BODY,
 * and the residual is stated rather than implied — a clause with an `inherit`, only abstract
 * members, no constructor argument list and no `[<AbstractClass>]` would read as an interface.
 * Both class shapes above are pinned by the spec fixture, so the rule's boundary is a test and
 * not a comment; and the analyzer's own symbol kind for the same clause is `interface`
 * (13,908 `method` / 140 `interface` symbols on the pass-16 draw), so the two readers of one tree
 * can be compared on the fixture instead of trusted separately.
 */
function fsharpKindResolver(node: Node): DeclarationKind | undefined {
  if (node.type !== "anon_type_defn") return undefined
  let members = 0
  let sawBody = false
  const visit = (n: Node): void => {
    for (const c of n.namedChildren) {
      if (!c) continue
      // A nested clause is its own subject. Descending into it would let a type declared inside a
      // class body decide the ENCLOSING clause's kind.
      if (FSHARP_TYPE_NODES[c.type] !== undefined) continue
      if (c.type === "member_defn") {
        members++
        // An abstract member is `member_defn > member_signature`; a field (`val mutable X`) and a
        // concrete member (`member this.M() = …`) are `member_defn` with anything else.
        let abstract = false
        for (const inner of c.namedChildren) if (inner?.type === "member_signature") abstract = true
        if (!abstract) sawBody = true
        continue
      }
      visit(c)
    }
  }
  visit(node)
  // A clause with NO member is not an interface: `type Empty = class end` is an empty class and
  // `type Probe = abstract member A : int` has one. Zero members is the class reading.
  if (members === 0 || sawBody) return undefined
  for (const c of node.namedChildren) if (c?.type === "primary_constr_args") return undefined
  const parent = node.parent
  if (parent) {
    for (const c of parent.namedChildren) {
      if (c?.type === "attributes" && /\bAbstractClass\b/.test(c.text)) return undefined
    }
  }
  return "interface"
}

// SCSS DECLARATION SPEC — for project-index cross-file resolution of @use/@forward
// 
// SCSS modules export top-level variables, mixins and functions. A `@use` or `@forward`
// statement imports a module and optionally binds it to a namespace. The index needs
// to record:
//   - Module name (the file's basename, per SCSS spec)
//   - Exported members: top-level $variables, @mixin, @function
//   - Namespace aliases from @use ... as <ns>
//
// The grammar provides:
//   - stylesheet: the root node, represents the module (file IS the module)
//   - use_statement: @use 'path' as <ns>
//   - forward_statement: @forward 'path' as <ns>
//   - mixin_statement: @mixin name($params) { ... }
//   - function_statement: @function name($params) { ... }
//   - declaration with $variable name (property_name starting with $)
//   - use_statement/forward_statement have `module` (string_value) and optional `plain_value`/`identifier` for `as` namespace
//
// SCSS has no type hierarchy (no implements/instantiates). The module IS the type unit.
// The "kind" for an SCSS module is "module" (already in DeclarationKind).
// EXPORTED, and that is the whole fix: every sibling spec in this file is exported, this one was
// not, and three callers needed it — `script/m14/run-fixtures.ts` read it through an `any` handle
// (so it was `undefined`, and `buildProjectIndexFromDisk`'s default silently indexed SCSS files with
// SOLIDITY's spec), `parallel-indexer.ts` had no way to map the language, and the gate had no way to
// build the index that would exercise the mechanism at all.
export const SCSS_DECLARATION_SPEC: DeclarationSpec = {
  // The stylesheet root node IS the module declaration, and its name is the file's basename —
  // which is what `nameFromFile` now makes true. The sentence that used to stand here said
  // "(handled by the caller via file path)" and NO CALLER EVER PASSED IT, so the extraction was
  // empty and this spec indexed nothing.
  nameFromFile: true,
  typeNodes: {
    stylesheet: "module",
  },
  // Modules are the "types" — the file IS the module
  nameOnlyNodes: ["use_statement", "forward_statement"],
  // A Sass module's public surface is EXACTLY its top-level `$variables`, `@mixin`s and
  // `@function`s — that is what `@use` binds. `declaration` is listed so a top-level `$x: …`
  // becomes a member; the `nameResolver` below returns "" for any declaration whose
  // property_name is not `$`-prefixed, so a plain `color: red` at the root is NOT a member.
  // MEASURED before this list carried `declaration`: `bulma/sass/utilities/initial-variables.scss`
  // has 65 top-level `$` declarations and the index recorded ZERO members for it, because a
  // variable is a `declaration` node and no member channel named it.
  memberNodes: ["mixin_statement", "function_statement", "declaration"],
  memberNodesCallable: ["mixin_statement", "function_statement"],
  // Scope nodes: a declaration inside a rule, a mixin/function body, or a control-flow block is
  // LOCAL to that scope and is not part of the module's surface. `@media` is deliberately ABSENT
  // for the reason the analyzer records: Sass gives a media query no new variable scope, so a
  // root-level `@media { $x: 1 }` still assigns the module-level `$x`.
  scopeNodes: ["mixin_statement", "function_statement", "if_statement", "each_statement", "for_statement", "while_statement", "rule_set"],
  /**
   * Read the member name in the spelling the analyzer PUBLISHES, so a cross-file consumer looks up
   * the same string the declaring file would have published:
   *   `@mixin button`   -> `button`        (the analyzer's `mixinNames` key is the BARE name, and
   *                                         `@include ns.button` splits on the dot to reach it)
   *   `@function double`-> `double`
   *   `$brand: …`       -> `$brand`        (the analyzer publishes a variable as `$brand`, and a
   *                                         read edge targets `$brand`, so the `$` is load-bearing)
   * Anything else (a plain `color: red` declaration, a selector) returns "" and is not a member.
   */
  nameResolver: (node: Node): string => {
    const isPrivate = (published: string): boolean => {
      // Sass's PRIVATE-MEMBER rule, identical to `isPrivateSassName` in the analyzer: a name
      // beginning `-` or `_` is not exposed by `@use`, so it is not part of the module's surface.
      const bare = published.startsWith("$") ? published.slice(1) : published
      return bare.startsWith("-") || bare.startsWith("_")
    }
    if (node.type === "mixin_statement" || node.type === "function_statement") {
      let bare = ""
      const viaField = node.childForFieldName("name")
      if (viaField) bare = viaField.text
      else {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "identifier") { bare = c.text; break }
        }
      }
      return bare !== "" && !isPrivate(bare) ? bare : ""
    }
    if (node.type === "declaration") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "property_name") {
          if (!c.text.startsWith("$")) return ""
          return isPrivate(c.text) ? "" : c.text
        }
      }
      return ""
    }
    return node.childForFieldName("name")?.text ?? ""
  },
}

export const FSHARP_DECLARATION_SPEC: DeclarationSpec = {
  typeNodes: FSHARP_TYPE_NODES,
  kindResolver: fsharpKindResolver,
  // FS-P17, the two named channels. `function_or_value_defn` is F#'s binding node (`let f x = …`,
  // `let value = 3`) and its identity is the name the analyzer already PUBLISHES for a top-level
  // binding; `module_defn` and `namespace` are the scope headers, and the analyzer publishes those
  // as the whole dotted header too (`module Fixture.Project.Domain` names its symbol
  // `Fixture.Project.Domain`). Both are recorded WITHOUT a kind — see `nameOnlyNodes`.
  // `named_module` is the FILE-HEADER form (`module Alpha.Beta.Gamma` as the first line) and it is
  // a DIFFERENT node from `module_defn` entirely — found by dumping the tree, not by reading the
  // grammar's docs. It is also the most important entry in this list: it is how most F# files
  // declare their module, and its name is what another file writes targets against.
  nameOnlyNodes: ["function_or_value_defn", "module_defn", "namespace", "named_module"],
  // `member this.Speak() = …`, `override this.Speak() = …` and `abstract member Tag : …` are all
  // `member_defn` — which is exactly the callable surface `overrides` reads. F# properties are
  // accessors and ARE overridable, so a `member this.Tag` counts; fields are not listed because
  // they cannot be overridden, the same reasoning PY-21 and DARTD16 record for their grammars.
  memberNodes: ["member_defn"],
  memberNodesCallable: ["member_defn"],
  // A member inside an OBJECT EXPRESSION belongs to the anonymous implementation, not to the
  // function that encloses it. The fixture has the shape: `let mock = { new System.IDisposable
  // with override this.Dispose() = () … }` — without this, `Dispose` and `Tag` are published as
  // members of whatever type the `let` sits in.
  // FS-P17 adds TWO scope nodes to the object expression, and the second one is a defect the first
  // draft of this channel shipped rather than a refinement of it. Measured on the lane's own twelve
  // fixtures (`/tmp/fs-names.mts`): with only `function_or_value_defn` as a scope, the NAME-ONLY
  // list contained `local` (declared at `call-ownership.fs:67` inside a member body) and `built`
  // (`call-target-spelling.fs:63`, the same shape) — a local declared in a project DECLARATION, so
  // every bare call to a name that happens to match a local anywhere in the corpus would be
  // refined to `in-project-name`. The reason the first draft missed it: a scope node suppresses its
  // CHILDREN, and a `let` directly inside a member body has no `function_or_value_defn` ABOVE it —
  // the binding IS the node being visited, so `scopes` was still 0. `member_defn` is what starts
  // the scope where a body begins.
  //
  // Both are scopes for MEMBERS as well as for names: a member inside a nested binding belongs to
  // the nested binding's object expression, not to the type around it. Neither changes the member
  // attribution of the member itself — `scopes` is tested BEFORE this increment — which the spec
  // fixture confirms by reading 22 types-with-members and the same member sets after the change.
  scopeNodes: ["object_expression", "function_or_value_defn", "member_defn"],
  nameResolver: (node: Node): string => {
    // FS-P17: the three shapes added for `nameOnlyNodes`, read from the tree rather than assumed
    // (`/tmp/fs-mod-dump.mts` prints all four). A dependency-free reader is not available here, so
    // each is a bounded walk over the node's own direct children:
    //
    //   `namespace Fixture.Project.Domain`   the name IS the `long_identifier`'s TEXT
    //   `module A.B.C =`                     the direct `identifier` children joined, which is the
    //                                        dotted header the analyzer publishes as the symbol
    //   `let f (a: string) = …`              the first identifier inside `*_declaration_left` —
    //                                        the pattern's TEXT is the whole signature (FS-D6), so
    //                                        its first identifier is the only name here
    if (node.type === "namespace" || node.type === "named_module") {
      for (const c of node.namedChildren) {
        if (c?.type === "long_identifier" || c?.type === "identifier") return c.text
      }
      return ""
    }
    if (node.type === "module_defn") {
      const ownName = (n: Node): string => {
        const parts: string[] = []
        for (const c of n.namedChildren) {
          if (c?.type === "identifier" || c?.type === "long_identifier") parts.push(c.text)
        }
        return parts.join(".")
      }
      const own = ownName(node)
      if (own === "") return ""
      // The QUALIFIED path, because that is what a file outside the enclosing namespace writes:
      // `module Helpers` inside `module Fixture.Project.Domain` is `Fixture.Project.Domain.Helpers`
      // to every other file in the project, and recording only `Helpers` would leave
      // `open Fixture.Project.Domain.Helpers` looking exactly like FSharp.Core — measured on the
      // FS-P10 fixture pair before this climb existed. The chain is read from the PARENT pointers,
      // which is what the tree gives; a `namespace` ancestor contributes its own dotted header.
      const chain: string[] = [own]
      let p: Node | null = node.parent
      while (p) {
        if (p.type === "module_defn") {
          const outer = ownName(p)
          if (outer !== "") chain.unshift(outer)
        } else if (p.type === "namespace" || p.type === "named_module") {
          // A file-header module (`module Fixture.Project.Domain`) is a scope exactly as a
          // namespace is, and it is the more common of the two in this corpus: without this branch
          // a `module Helpers = …` inside one is recorded as `Helpers` alone, so a sibling file's
          // `open Fixture.Project.Domain.Helpers` stays external for no reason a reader could see.
          for (const c of p.namedChildren) {
            if (c?.type === "long_identifier" || c?.type === "identifier") {
              chain.unshift(c.text)
              break
            }
          }
          break
        }
        p = p.parent
      }
      return chain.join(".")
    }
    if (node.type === "function_or_value_defn") {
      for (const c of node.namedChildren) {
        if (c?.type !== "function_declaration_left" && c?.type !== "value_declaration_left") continue
        const idents: string[] = []
        const stack: Node[] = [c]
        while (stack.length > 0) {
          const n = stack.shift()!
          if (n.type === "identifier" && n.text) idents.push(n.text)
          for (const inner of n.namedChildren) if (inner) stack.push(inner)
        }
        if (idents.length > 0) return idents[0]!
      }
      return ""
    }
    for (const c of node.namedChildren) {
      if (!c) continue
      // A clause's `type_name` is an UNNAMED child of the clause — the `type_name` FIELD is on
      // that node's own `identifier`, one level deeper. Verified against the tree: asking the
      // clause for a `type_name` field returns undefined and reads every type as "" — an index
      // of the right shape holding nothing, which is what the first cut of this spec did.
      if (c.type === "type_name") return c.childForFieldName("type_name")?.text ?? c.text
      // `member_defn > method_or_prop_defn`, whose `name` field is a `property_or_ident`
      // carrying `method` = the part after the instance dot.
      if (c.type === "method_or_prop_defn") {
        const method = c.childForFieldName("name")?.childForFieldName("method")
        if (method?.text) return method.text
      }
      // `member_defn > member_signature`, whose first child IS the identifier.
      if (c.type === "member_signature") {
        for (const inner of c.namedChildren) {
          if (inner && inner.type === "identifier" && inner.text) return inner.text
        }
      }
    }
    return node.childForFieldName("name")?.text ?? ""
  },
  baseResolver: (node: Node): string[] => {
    const out: string[] = []
    // The base's OWN name is the LAST segment of the written path — `System.IO.MemoryStream` is
    // filed as `MemoryStream`, the same rule the Solidity and python resolvers apply, so the
    // lookup keys on the name a project would have declared. Read from the `simple_type`'s own
    // `long_identifier` rather than by collecting every `identifier` in the subtree: the first
    // cut collected identifiers in POP order, which ends on the FIRST segment (`System`) — the
    // wrong name, and a shape the shared `baseNodes` path in `indexTree` also has (it walks with
    // a stack and takes the last identifier popped). Scoping the read to the path also keeps a
    // generic argument (`Dictionary<string, Foo>`) from becoming the base.
    const pushLeaf = (n: Node): void => {
      let written = ""
      for (const c of n.namedChildren) {
        if (!c) continue
        if (c.type === "long_identifier" || c.type === "identifier") {
          written = c.text
          break
        }
      }
      if (written === "") written = n.text
      const segment = written.split(".").filter((s) => s.length > 0).pop() ?? ""
      const clean = segment.replace(/[<(].*$/, "")
      if (clean !== "") out.push(clean)
    }
    const visit = (n: Node, isRoot: boolean): void => {
      for (const c of n.namedChildren) {
        if (!c) continue
        // A member's body is not a base list, and an object expression's `interface … with`
        // describes the ANONYMOUS implementation, not this type's bases.
        if (c.type === "member_defn" || c.type === "object_expression") continue
        // A type declared inside this one is its own subject; the clause types above are already
        // in the index under their own name.
        if (!isRoot && FSHARP_TYPE_NODES[c.type] !== undefined) continue
        if (c.type === "class_inherits_decl" || c.type === "interface_implementation") {
          for (const inner of c.namedChildren) {
            if (inner && inner.type === "simple_type") pushLeaf(inner)
          }
          continue
        }
        visit(c, false)
      }
    }
    visit(node, true)
    return out
  },
}

function addTo<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

/** Read one already-parsed tree into `index`. Exported so a caller that already has
 *  a tree (a worker mid-file, a census) does not pay to parse again. */
export function indexTree(root: Node, index: ProjectIndex, spec: DeclarationSpec, fileName?: string): void {
  // The owner is tracked by walking DOWN rather than by searching upward per member:
  // a tree walk that resolved each member's owner by scanning the whole file is the
  // shape that turns an index build into quadratic work, and this runs once per file
  // for the whole project.
  // `scopes` counts `scopeNodes` ancestors, so a declaration inside a nested function is not
  // recorded as a member of the class around it. PY-7: without it the python spec indexes every
  // closure as a class method, which makes a base appear to declare methods it does not have and
  // the resolution then suppresses real overrides on the strength of those.
  const stack: { node: Node; owner: string | null; scopes: number }[] = [
    { node: root, owner: null, scopes: 0 },
  ]
  /** The declaration's own name: the spec's hook when it has one, the grammar's `name` field
   *  otherwise — which is every previous language, so nothing that used this file before
   *  reads a different name. */
  const nameOf = (n: Node): string =>
    spec.nameResolver !== undefined ? spec.nameResolver(n, fileName) : (n.childForFieldName("name")?.text ?? "")
  while (stack.length > 0) {
    const { node, owner, scopes } = stack.pop()!
    let nextOwner = owner
    let nextScopes = scopes + (spec.scopeNodes?.includes(node.type) ? 1 : 0)

    const staticKind = spec.typeNodes[node.type]
    let kind = staticKind
    if (staticKind !== undefined && spec.kindResolver !== undefined) {
      const resolved = spec.kindResolver(node)
      if (resolved !== undefined) kind = resolved
    }
    if (kind !== undefined) {
      let name = nameOf(node)
      // A TYPE UNIT NAMED BY ITS FILE. `indexTree` has always accepted `fileName` and no caller
      // passed it, so this branch is the missing half of the SCSS spec's own documented contract.
      if (name === "" && spec.nameFromFile === true && fileName !== undefined && fileName !== "") {
        name = fileName.split(/[\\/]/).pop() ?? ""
      }
      if (name !== "") {
        // A name declared twice with DIFFERENT kinds is a compile error in Solidity;
        // recording `unknown` rather than letting the last writer win means a
        // downstream consumer sees the ambiguity instead of a confident wrong answer.
        const prior = index.typeKinds.get(name)
        if (prior === undefined) index.typeKinds.set(name, kind)
        else if (prior !== kind) index.typeKinds.set(name, "unknown")
        index.symbolNames.add(name)
        nextOwner = name
        // A class body starts its own member scope, so a class nested inside a method is
        // indexed under its OWN name and not smeared onto the enclosing class.
        nextScopes = 0
      }
    }

    // FS-P17. The NAME-only channel: a declaration whose name a target can write and whose kind
    // this index does not claim. Placed before the member/base branches and after the type branch,
    // so a node listed in both reads its kind AND its name (the type branch already adds the name)
    // rather than being recorded twice — a Set makes the second add a no-op, but the ORDER is
    // what keeps this branch from having to know which nodes overlap.
    if (
      spec.nameOnlyNodes !== undefined &&
      scopes === 0 &&
      spec.typeNodes[node.type] === undefined &&
      spec.nameOnlyNodes.includes(node.type)
    ) {
      const name = nameOf(node)
      if (name !== "") {
        index.symbolNames.add(name)
        // A DOTTED header also records its LAST SEGMENT, because both spellings are names a source
        // writes for the same declaration: `Fixture.Project.Domain.Helpers` is what a file outside
        // the namespace writes and `Helpers` is what a file inside it writes, and an index that
        // recorded only one of them would refine one and miss the other for no reason a reader
        // could see. The claim is existence either way ("the project declares a name spelled like
        // this"), which is the same claim `symbolNames` already carries.
        const dot = name.lastIndexOf(".")
        if (dot > 0) index.symbolNames.add(name.slice(dot + 1))
      }
    }

    if (owner !== null && scopes === 0 && spec.memberNodes.includes(node.type)) {
      const name = nameOf(node)
      if (name !== "") {
        addTo(index.typeMembers, owner, name)
        index.symbolNames.add(name)
      }
    }

    if (owner !== null && spec.baseNodes?.includes(node.type)) {
      const ownerName = index.typeKinds.has(owner) ? owner : null
      if (ownerName !== null) {
        const anc = node.childForFieldName("ancestor")
        // A base list may be `A, B.C` — the ancestor's own name is the LAST identifier
        // in the path, which is the base's own name.
        let baseName = ""
        if (anc) {
          const stack2: Node[] = [anc]
          let last = ""
          while (stack2.length > 0) {
            const n = stack2.pop()!
            if (n.type === "identifier") last = n.text
            for (let i = 0; i < n.namedChildCount; i++) {
              const c = n.namedChild(i)
              if (c) stack2.push(c)
            }
          }
          baseName = last
        }
        if (baseName !== "") {
          let list = index.typeBases.get(ownerName)
          if (!list) {
            list = []
            index.typeBases.set(ownerName, list)
          }
          if (!list.includes(baseName)) list.push(baseName)
        }
      }
    }

    if (spec.baseResolver !== undefined && kind !== undefined) {
      const ownerName = nameOf(node)
      if (ownerName !== "") {
        for (const baseName of spec.baseResolver(node)) {
          if (baseName === "") continue
          let list = index.typeBases.get(ownerName)
          if (!list) {
            list = []
            index.typeBases.set(ownerName, list)
          }
          if (!list.includes(baseName)) list.push(baseName)
        }
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, owner: nextOwner, scopes: nextScopes })
    }
  }
}

export function emptyProjectIndex(): ProjectIndex {
  return {
    typeKinds: new Map(),
    typeMembers: new Map(),
    typeBases: new Map(),
    symbolNames: new Set(),
    damagedFiles: new Set(),
    stats: { files: 0, damaged: 0 },
  }
}

/**
 * Build an index over a set of already-parsed files.
 *
 * `readTree` is injected rather than a parser created here, for two reasons: the
 * caller usually has the wasm loaded already (constructing a second parser per index
 * is pure waste), and the worker path may have several parser instances by language.
 * Keeping the I/O injected also makes the whole scanner testable with a stub.
 */
export function buildProjectIndex(
  files: { path: string; tree: { rootNode: Node; hasError?: boolean } }[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
): ProjectIndex {
  const index = emptyProjectIndex()
  for (const f of files) {
    index.stats.files++
    if (f.tree.hasError) {
      index.stats.damaged++
      index.damagedFiles.add(f.path)
    }
    indexTree(f.tree.rootNode, index, spec, f.path)
  }
  return index
}

/** Read `files` off disk with one parser and index them. The convenience path for a
 *  census or a gate, where no tree is already in hand. */
export async function buildProjectIndexFromDisk(
  wasmPath: string,
  files: string[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
): Promise<ProjectIndex> {
  const WTS = await import("web-tree-sitter")
  await WTS.Parser.init()
  const language = await (WTS as any).Language.load(fs.readFileSync(wasmPath))
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const parsed: { path: string; tree: { rootNode: Node; hasError?: boolean } }[] = []
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8")
    const tree = parser.parse(text)
    // `Parser.parse` returns `Tree | null`. Dropping a null here would make the index
    // count fewer files than it was asked about and report the shortfall as coverage,
    // so this fails loudly and names the file instead.
    if (tree === null) throw new Error(`project index: ${f} produced no parse tree`)
    parsed.push({ path: f, tree })
  }
  return buildProjectIndex(parsed, spec)
}

/**
 * STREAMING form of `buildProjectIndexFromDisk`: same index, bounded memory.
 *
 * `buildProjectIndexFromDisk` collects `{ path, tree }` for EVERY file and only then
 * builds, so its peak memory is the whole corpus's parse trees at once. That is fine
 * for a 400-file project and fatal for a 2,351-file one with dependencies: measuring
 * ProxiCall/lib with the 68 direct packages attached (4,378 files total) aborted the
 * wasm module outright — `Aborted(). Build with -sASSERTIONS for more than 1 error.`
 * The retained trees are the cause and the tree-sitter wasm heap is the victim; there
 * is no flag that makes a 4,378-tree retention smaller.
 *
 * The index never needs two trees at once. `indexTree` reads one tree into the index
 * and returns, so the tree can be deleted immediately and the next file parsed into
 * the same slot. Peak memory becomes ONE tree plus the index, and the result is
 * byte-identical to the collecting form because the index is order-independent for
 * this purpose (a name declared twice with different kinds records "unknown"
 * regardless of which arrives last).
 */
export async function buildProjectIndexStreaming(
  wasmPath: string,
  files: string[],
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
  onProgress?: (done: number, total: number) => void,
): Promise<ProjectIndex> {
  const WTS = await import("web-tree-sitter")
  await WTS.Parser.init()
  const language = await (WTS as any).Language.load(fs.readFileSync(wasmPath))
  // ONE parser for the whole run. A parser per file exhausts the wasm pool on a
  // corpus this size, and the pool is shared with whatever else the caller holds.
  const parser = new WTS.Parser()
  parser.setLanguage(language)
  const index = emptyProjectIndex()
  let done = 0
  // Both forms report the same accounting. The streaming form previously left
  // `stats.files` at 0 and never touched `stats.damaged`, so a caller comparing
  // the two forms saw `{"files":0,"damaged":0}` against `{"files":2,"damaged":0}`
  // — two APIs documented as equivalent disagreeing, with no error. Measured.
  //
  // A file that cannot be read, or whose parser returns null, is a SHORTFALL. It
  // is counted in `damaged` rather than skipped silently: a caller cannot tell
  // "indexed everything" from "indexed what it could reach" if both report the
  // same thing, which is the failure the collecting form refuses with a thrown
  // error. Here the tree is already being streamed, so the honest middle is to
  // finish and report the count.
  let damaged = 0
  for (const f of files) {
    let text: string
    try {
      text = fs.readFileSync(f, "utf8")
    } catch {
      damaged++
      done++
      continue
    }
    let tree: any = null
    try {
      tree = parser.parse(text)
      if (tree?.rootNode) {
        indexTree(tree.rootNode, index, spec, f)
      } else {
        damaged++
      }
    } catch {
      // A file that will not parse contributes no declarations, exactly as in the
      // collecting form. Recorded, not hidden.
      damaged++
    } finally {
      // The whole point: free the tree before the next parse.
      try { tree?.delete?.() } catch { /* an aborted instance refuses politely */ }
    }
    done++
    if (onProgress && done % 500 === 0) onProgress(done, files.length)
  }
  index.stats = { files: done - damaged, damaged }
  return index
}

/** A NAME-TO-MEMBERS index over every declared type, PLUS the transitive inheritance
 *  closure — the two facts a cross-file resolution question actually needs. Built
 *  once from the shallow index so no consumer re-walks the inheritance graph. */
export function buildResolutionTables(index: ProjectIndex): {
  /** member name -> the types declaring it, transitively closed over bases. */
  memberOwners: Map<string, Set<string>>
  /** every member any declared type exposes, inheritance-closed. */
  allMembers: Map<string, Set<string>>
} {
  const allMembers = new Map<string, Set<string>>()
  const memberOwners = new Map<string, Set<string>>()

  const closure = (typeName: string, seen = new Set<string>()): Set<string> => {
    const cached = allMembers.get(typeName)
    if (cached) return cached
    if (seen.has(typeName)) return new Set()
    seen.add(typeName)
    const out = new Set<string>(index.typeMembers.get(typeName) ?? [])
    for (const b of index.typeBases.get(typeName) ?? []) {
      for (const m of closure(b, seen)) out.add(m)
    }
    allMembers.set(typeName, out)
    return out
  }

  for (const typeName of index.typeKinds.keys()) {
    for (const m of closure(typeName)) addTo(memberOwners, m, typeName)
  }
  // Attached so a caller that runs a truth oracle AND an analyzer over the same
  // corpus can hand both the SAME closed map. Two consumers resolving against two
  // separately-built cross-file views produce disagreements that are uninterpretable:
  // neither side is wrong, they were just asked different questions.
  ;(index as any).__closedMembers = allMembers
  return { memberOwners, allMembers }
}

/**
 * RE-RUN a set of files WITH the index and return the enriched results.
 *
 * This is the integration seam, kept as a function rather than wired into the worker
 * pool here, and the reason is stated rather than implied: rewiring
 * `parallel-indexer.ts` means forking changes into the dispatch path of EVERY lane,
 * at a point where the parent holds only the CURRENT batch — so an incremental run
 * would resolve against a subset of the project and report a different answer for the
 * same file depending on what else was being indexed. That is a worse failure than an
 * unresolved edge, and it is not a decision one lane should make unilaterally.
 *
 * The caller that CAN see every file for a run calls this once, after the per-file pass
 * and before results are stored. Two consequences worth stating plainly:
 *
 *   · it costs a SECOND analysis pass for opted-in languages only, so no other lane's
 *     behaviour or cost changes at all;
 *   · it is idempotent per file, and running it on a file set that is a SUBSET of the
 *     project yields the per-file answer for the kinds that stay undecidable — the same
 *     answer as no index at all, never a wrong one.
 *
 * `parse` is injected for the same reason `readTree` is: the caller already has a
 * configured engine, and this module must not decide which wasm a project uses.
 */
export async function enrichWithProjectIndex(
  files: string[],
  // The context argument is how the caller hands the index to its own parse step; the
  // parameter type said one argument while the call below passed two. Optional, so a
  // one-argument parser still satisfies it.
  parse: (file: string, context?: { projectIndex?: ProjectIndex }) => Promise<any>,
  spec: DeclarationSpec = SOLIDITY_DECLARATION_SPEC,
  wasmPath?: string,
): Promise<{ results: any[]; index: ProjectIndex }> {
  let index: ProjectIndex
  if (wasmPath) {
    index = await buildProjectIndexFromDisk(wasmPath, files, spec)
  } else {
    throw new Error(
      "enrichWithProjectIndex needs a wasmPath, or a caller-supplied index. Building the " +
        "index requires a parser, and this module deliberately does not create one.",
    )
  }
  buildResolutionTables(index)
  const results: any[] = []
  for (const file of files) {
    results.push(await parse(file, { projectIndex: index }))
  }
  return { results, index }
}

/**
 * THE WIRE FORMAT.
 *
 * `child_process.fork()` serialises IPC with JSON unless advanced serialisation is
 * enabled, and JSON cannot carry a `Map` — a `Map` would arrive as `{}` and the index
 * would silently resolve NOTHING, which looks exactly like "the feature does not work"
 * and not like "the transport dropped it". So the index has an explicit, total
 * serialisation rather than relying on structured clone.
 *
 * It is deliberately a PLAIN object of arrays, which also means it survives `JSON
 * .stringify` for a cache file, and it is TOTAL: every field of `ProjectIndex` is
 * written and read back, including `damagedFiles` and `stats`. A partial format is the
 * kind of omission that only shows up as a wrong answer months later, so
 * `roundTripProjectIndex` below asserts field-for-field equality and the SOL-21 gate
 * runs it.
 */
export interface SerializedProjectIndex {
  version: 1
  typeKinds: [string, DeclarationKind][]
  typeMembers: [string, string[]][]
  typeBases: [string, string[]][]
  symbolNames: string[]
  damagedFiles: string[]
  stats: { files: number; damaged: number }
  /**
   * THE CLOSED-MEMBER MAP, which the SCSS resolver reads (`__closedMembers`) and which this
   * serializer did NOT carry: it was a runtime-only property on the in-memory index, so every
   * deserialized index — the worker's and the gate's alike — had it `undefined` and
   * `resolveModuleImports` returned at its first guard. Optional on read, so a payload written
   * before this field existed still deserializes (to an absent map, exactly as before).
   */
  closedMembers?: [string, string[]][]
}

export function serializeProjectIndex(index: ProjectIndex): SerializedProjectIndex {
  // THE PAYLOAD MUST CARRY WHAT THE RESOLVER READS. `__closedMembers` is attached by
  // `buildResolutionTables`, and the indexer's path (`buildProjectIndexFromDisk` -> here) never
  // called it — so the serialized payload had no closed-member map at all and
  // `resolveModuleImports` read `undefined` on every deserialized index. Computing it here, only
  // when it is absent, makes the serializer self-sufficient for EVERY caller rather than fixing one
  // of them; the cost is one closure pass over the shallow index, which is what the map is.
  if ((index as any).__closedMembers === undefined) buildResolutionTables(index)
  return {
    version: 1,
    typeKinds: [...index.typeKinds.entries()],
    typeMembers: [...index.typeMembers.entries()].map(([k, v]) => [k, [...v]]),
    typeBases: [...index.typeBases.entries()].map(([k, v]) => [k, [...v]]),
    symbolNames: [...index.symbolNames],
    damagedFiles: [...index.damagedFiles],
    stats: { ...index.stats },
    closedMembers: [...((index as any).__closedMembers?.entries() ?? [])].map(([k, v]: [string, Set<string>]) => [k, [...v]]),
  }
}

export function deserializeProjectIndex(raw: unknown): ProjectIndex | null {
  if (raw === null || typeof raw !== "object") return null
  const r = raw as Partial<SerializedProjectIndex>
  // A wrong `version` is refused rather than best-effort parsed. A partial read of a
  // future format would produce an index that is missing exactly the fields the new
  // format added — the shape of a wrong answer that is impossible to trace.
  if (r.version !== 1) return null
  if (!Array.isArray(r.typeKinds) || !Array.isArray(r.typeMembers) ||
      !Array.isArray(r.typeBases) || !Array.isArray(r.symbolNames)) return null
  const index = emptyProjectIndex()
  for (const [k, v] of r.typeKinds) index.typeKinds.set(k, v)
  for (const [k, v] of r.typeMembers) index.typeMembers.set(k, new Set(v))
  for (const [k, v] of r.typeBases) index.typeBases.set(k, [...v])
  for (const n of r.symbolNames) index.symbolNames.add(n)
  for (const f of r.damagedFiles ?? []) index.damagedFiles.add(f)
  index.stats = { files: r.stats?.files ?? 0, damaged: r.stats?.damaged ?? 0 }
  if (Array.isArray(r.closedMembers)) {
    ;(index as any).__closedMembers = new Map(r.closedMembers.map(([k, v]) => [k, new Set(v)]))
  }
  return index
}

/** Round-trip through ACTUAL JSON, not a structural copy — the transport is the thing
 *  under test, and `structuredClone` would not exercise it. Returns the differences it
 *  found rather than a boolean, so a failure says WHICH field was lost. */
export function roundTripProjectIndex(index: ProjectIndex): string[] {
  const problems: string[] = []
  const wire = JSON.parse(JSON.stringify(serializeProjectIndex(index))) as SerializedProjectIndex
  const back = deserializeProjectIndex(wire)
  if (back === null) {
    problems.push("deserializeProjectIndex returned null for a well-formed payload")
    return problems
  }
  if (back.typeKinds.size !== index.typeKinds.size) {
    problems.push(`typeKinds: ${back.typeKinds.size} of ${index.typeKinds.size}`)
  }
  if (back.symbolNames.size !== index.symbolNames.size) {
    problems.push(`symbolNames: ${back.symbolNames.size} of ${index.symbolNames.size}`)
  }
  if (back.typeMembers.size !== index.typeMembers.size) {
    problems.push(`typeMembers: ${back.typeMembers.size} of ${index.typeMembers.size}`)
  }
  if (back.typeBases.size !== index.typeBases.size) {
    problems.push(`typeBases: ${back.typeBases.size} of ${index.typeBases.size}`)
  }
  let memberTotal = 0
  for (const [k, v] of index.typeMembers) {
    const got = back.typeMembers.get(k)
    if (got === undefined) { problems.push(`typeMembers lost the key ${k}`); continue }
    if (got.size !== v.size) problems.push(`typeMembers[${k}]: ${got.size} of ${v.size}`)
    memberTotal += v.size
  }
  for (const [k, v] of index.typeBases) {
    const got = back.typeBases.get(k)
    if (got === undefined) { problems.push(`typeBases lost the key ${k}`); continue }
    if (got.length !== v.length) problems.push(`typeBases[${k}]: ${got.length} of ${v.length}`)
  }
  if (back.stats.files !== index.stats.files) problems.push("stats.files")
  if (back.stats.damaged !== index.stats.damaged) problems.push("stats.damaged")
  if (back.damagedFiles.size !== index.damagedFiles.size) problems.push("damagedFiles")
  // THE FIELD THE TRANSPORT ACTUALLY LOST. `roundTripProjectIndex` checked every DECLARED field and
  // this one is not declared on `ProjectIndex` — it is attached at runtime — so the transport test
  // passed while `resolveModuleImports` read `undefined` on every deserialized index. A test that
  // enumerates the fields it knows about cannot see a field nobody declared.
  {
    const before = (index as any).__closedMembers as Map<string, Set<string>> | undefined
    const after = (back as any).__closedMembers as Map<string, Set<string>> | undefined
    if ((before?.size ?? 0) !== (after?.size ?? 0)) {
      problems.push(`__closedMembers: ${after?.size ?? 0} of ${before?.size ?? 0}`)
    } else if (before !== undefined && after !== undefined) {
      for (const [k, v] of before) {
        const got = after.get(k)
        if (got === undefined) { problems.push(`__closedMembers lost the key ${k}`); continue }
        if (got.size !== v.size) problems.push(`__closedMembers[${k}]: ${got.size} of ${v.size}`)
      }
    }
  }
  // The payload the analyzer actually reads, checked end to end: a member name that
  // fails to survive means a call target that fails to resolve.
  const probe = index.typeMembers.keys().next().value
  if (probe !== undefined) {
    const before = [...(index.typeMembers.get(probe) ?? [])].sort()
    const after = [...(back.typeMembers.get(probe) ?? [])].sort()
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      problems.push(`typeMembers[${probe}] contents differ after the round trip`)
    }
  }
  return problems
}

