/**
 * The Dart `references` oracle — LANE-OWNED.
 *
 * `references` is the tenth relationship type and this lane emitted nine of ten.
 * It is emitted now, and this file is the independent derivation of it, because a
 * lane-owned oracle is the only thing that can disagree with the analyzer on a
 * label the analyzer just grew. A differential cannot do it from the outside: once
 * the analyzer emits `references` and the truth does not, every row reads as
 * `unexplained` and the correct response to that row is not derivable from the
 * row. That is the exact situation `script/m14/ontology-coverage-gate.ts` was
 * written about, and this file is the fix for this lane rather than a report of it.
 *
 * ## THE RULE, stated from the language
 *
 *   `X references T`  <=>  the declaration `X` names the type `T` in a TYPE
 *   POSITION, and `T` is a type the run can see.
 *
 * Two clauses, and the second is the whole difficulty.
 *
 *   1. the name must be MENTIONED IN A TYPE POSITION. In this grammar that is a
 *      grammatical fact and not a convention: `type_identifier` is the node the
 *      parser builds for a type name, and a value identifier is a different node.
 *      So the mention needs no shape heuristic and no capitalization test — the
 *      grammar already made the decision.
 *   2. the name must RESOLVE. This is where a per-file walker has to stop, and
 *      stopping is the correct answer rather than a shortfall: measured over 1,000
 *      corpus files, 75,769 type mentions sit outside heritage clauses and 3,460
 *      (4.57%) name a type the same file declares. The rest name `String`,
 *      `Widget`, `Future` — real types declared in files this tree has not read.
 *
 * ## WHAT IS SHARED WITH THE ANALYZER, AND WHAT IS NOT
 *
 * Shared: nothing. This file walks the tree with its own recursion, keeps its own
 * enclosing-declaration attribution, its own position table, its own type-name
 * resolver, and its own dedup. It does not import the analyzer, read its tables, or
 * call its helpers. The value of an oracle that reuses the implementation under
 * test is zero — it would agree with a bug in both directions — so the duplication
 * is the cost of the check being worth anything.
 *
 * Not shared but CONSEQUENTIAL: the analyzer's rule was read off the corpus
 * (`validation/m14/fixtures/dart/type-position-probe.ts` prints the
 * parent-position histogram), and so was this one's. Agreement between them on a
 * corpus therefore measures that two implementations of one measured rule agree,
 * which is a real statement and NOT the same as the rule being correct. The
 * fixture suite carries the correctness argument; this file carries the
 * implementation-disagreement argument.
 *
 * ## THE POSITION TABLE, and why each exclusion exists
 *
 * A `type_identifier` under any of these is a mention the analyzer has already
 * published under a different label, so deriving it here as `references` would ask
 * the harness to compare one fact against itself under two names:
 *
 *   superclass / interfaces / mixins / mixin_declaration / mixin_application
 *     -> `extends` / `implements` / `uses`. Heritage.
 *   new_expression / const_object_expression / constructor_invocation /
 *   redirecting_factory_constructor_signature
 *     -> `instantiates`. Construction.
 *   type_parameter
 *     -> nothing. `class Box<T>` DECLARES a type variable.
 *   ERROR
 *     -> nothing. A parse-error region is not a fact about a well-formed program.
 *
 * Everything else is published. The full inventory with per-position counts is in
 * the probe's output; the positions that carry the volume are parameter types
 * (`formal_parameter`, `normal_parameter_type`, `super_formal_parameter`,
 * `constructor_param`), return types (`function_signature`, `getter_signature`,
 * `setter_signature`, `operator_signature`), `type_arguments`, `type_cast`,
 * `type_test`, `function_type`, `record_type_field`, `try_statement`, and the
 * declaration forms (`declaration`, `program`, `initialized_variable_definition`,
 * `typed_identifier`, `for_loop_parts`).
 *
 * ## THE RESOLVER
 *
 * `visibleTypes` is what the run can see. Left unset, it is the types THIS TREE
 * declares, which is the per-file answer and the one production gets (nothing in
 * `parallel-indexer.ts` `PROJECT_INDEX_EXTENSIONS` names `.dart`). A caller with a
 * project index passes its type names and both sides then answer the wider
 * question — from the SAME set, or a disagreement between them would be
 * uninterpretable.
 *
 * An UNNAMED extension (`extension on String {}`) is deliberately absent from the
 * tree-derived set: it is published under a SYNTHESIZED name no source can spell
 * (`unnamed_extension_String`), so admitting it would put a name in the resolver
 * that no code writes.
 *
 * ## SOURCE ATTRIBUTION
 *
 * The innermost PUBLISHED declaration that mentions the type, which is the rule
 * every other label in this analyzer follows (DARTD8/DARTD9): a member's own
 * signature, a type's own declaration, and the FILE for a top-level mention that
 * belongs to no declaration. A local variable is not published as a symbol, so its
 * type mention folds into the enclosing function; a LOCAL FUNCTION is not published
 * either (`local_function_declaration > lambda_expression > function_signature`),
 * so its mention folds the same way. Three corpus rows are also attributed by the
 * grammar rather than by the source text: `class A<U,V> = Object with M<U,V> …;`
 * publishes the class under a name the grammar puts inside
 * `mixin_application_class`, and `foo() => Bar(...)` is a `constructor_signature`,
 * whose published name is the family name `constructor`.
 */

export interface DartReferenceEdge {
  label: "references"
  from: string
  target: string
}

/** Node types that carry a type mention this lane already published elsewhere. */
const PUBLISHED_ELSEWHERE = new Set<string>([
  "superclass", "interfaces", "mixins",
  "mixin_declaration", "mixin_application",
  "new_expression", "const_object_expression", "constructor_invocation",
  "redirecting_factory_constructor_signature",
  "type_parameter",
  "ERROR",
])

/** The declaration nodes whose name a mention can bind to. */
const TYPE_DECLARATIONS = new Set<string>([
  "class_definition", "mixin_application_class", "mixin_declaration", "extension_declaration",
  "extension_type_declaration", "enum_declaration", "type_alias",
])

const CONSTRUCTOR_SIGNATURES = new Set<string>([
  "constructor_signature", "factory_constructor_signature",
  "constant_constructor_signature", "redirecting_factory_constructor_signature",
])

const namedChildren = (n: any): any[] => {
  const out: any[] = []
  if (!n) return out
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** Wrapper nodes that carry a signature child and no name of their own. */
const SIGNATURE_WRAPPERS = new Set<string>(["method_signature", "declaration"])

/** The signature name of a member node, or null when it declares nothing. */
function memberName(n: any): string | null {
  // A member is sometimes wrapped (`method_signature > function_signature`,
  // `declaration > method_signature > getter_signature`), and the wrapper has no name
  // of its own, so the walk descends to the signature. It descends to the DEEPEST
  // signature, one wrapper at a time: a single `find` over named children can stop at
  // an outer `method_signature` and return nothing for every getter and setter.
  let target = n
  let guard = 0
  while (SIGNATURE_WRAPPERS.has(target.type) && guard++ < 4) {
    const inner = namedChildren(target).find((c: any) => isSignature(c.type))
    if (!inner || inner.type === target.type) break
    target = inner
  }
  // The constructor test runs on the node the descent ARRIVED at, not on the node it
  // started at, and that order is load-bearing: tree-sitter-dart resolves
  // `foo() => Bar(...)` to `method_signature > constructor_signature`, so a
  // constructor test on the OUTER node misses every expression-bodied member whose
  // body starts with a capitalized call. Measured: 3 rows in a 799-file /
  // 1,210-row corpus sample (`class A<X,Y,Z> { wrap() => A<A<X,X,X>, …>(); }`).
  //
  // The lane contract: constructors are published under the family name, with the
  // named segment in metadata. `Class.named` is not the symbol name, and a
  // constructor_signature reached through a wrapper is still that family name.
  //
  // BUT THE NODE TYPE DOES NOT DECIDE, and this is the second half of the rule — the
  // half this file was missing for a round. `tree-sitter-dart` has no node for a method
  // declared WITHOUT a return type, so
  //
  //     class A3<X, Y, Z> { wrap() => A3<A3<X, X, X>>(); }
  //
  // parses as `method_signature > constructor_signature` with field(name) = `wrap`
  // (printed by `.tmp-probe/dt-ctor-shape.mts`): structurally identical to a real
  // constructor, and its OWN NAME FIELD says `wrap`. Reading the type alone published
  // `constructor` for a member the source names `wrap` — a NAME LIE on the TRUTH side,
  // which is the direction this file's header says is the worst one, because it
  // manufactures agreement with a wrong analyzer instead of catching it. The analyzer
  // fixed exactly this under DARTD22 (`isRealConstructor`); the oracle did not move.
  //
  // The test that IS exact is the LANGUAGE'S naming rule, not the grammar's node choice:
  // a constructor is named after its class and the unnamed one is spelled `.new`, while a
  // MEMBER MAY NOT share its class's name — that is a compile error. So
  // `name === owner || name === "new"` holds for every constructor and for no method.
  // An OWNERLESS signature (no enclosing type at all) is not this rule's business and
  // stays on the family name, exactly as the analyzer's rule leaves it.
  if (CONSTRUCTOR_SIGNATURES.has(target.type)) {
    const lead = target.childForFieldName?.("name")?.text ?? null
    const owner = enclosingTypeNameOf(target)
    if (lead === null || lead === "new" || owner === "" || lead === owner) return "constructor"
    // A METHOD the grammar mislabelled. Its own name is the answer, and returning it HERE
    // keeps the fall-through guard below out of the way — that guard only knows
    // function/getter/setter signatures and would answer null for this node type.
    return lead
  }
  if (!target.name && target.type !== "operator_signature") {
    const isSig = target.type === "function_signature" || target.type === "getter_signature" ||
      target.type === "setter_signature"
    if (!isSig) return null
  }
  const nameField = target.childForFieldName?.("name")
  if (nameField?.text) return nameField.text
  // `operator_signature` has no name field: the member's identity is the token that
  // follows the `operator` keyword, which is why the family contract spells it
  // `operator <token>` (a bare `*` is not a legal identifier and collides with
  // unrelated syntax). The token is located by scanning for the KEYWORD rather than
  // by a child index, because a scoped return type shifts every child.
  if (target.type === "operator_signature") {
    for (let i = 0; i < target.childCount; i++) {
      const c = target.child(i)
      if (c && !c.isNamed && c.text === "operator") {
        const token = target.child(i + 1)
        if (token) return `operator ${token.text}`
      }
    }
    return null
  }
  return null
}

const isSignature = (t: string): boolean =>
  t === "method_signature" || t === "function_signature" || t === "getter_signature" ||
  t === "setter_signature" || t === "operator_signature" || t.endsWith("constructor_signature")

/**
 * Is this signature a LOCAL FUNCTION's, which is to say one the lane does not publish
 * as a symbol?
 *
 * A local function is `local_function_declaration > lambda_expression >
 * function_signature` — the lambda wrapper is what the analyzer tests to KEEP the
 * enclosing source (DARTD8, pinned by mutant `local-fn-call-context-reintroduced`),
 * and the analyzer publishes no symbol for the local function at all. Naming it here
 * would publish a SOURCE ENDPOINT NOTHING CAN BIND, which is the defect this file
 * exists to prevent, in the source half rather than the target half.
 *
 * Measured: 13 of 19 rows the two implementations disagreed on in a 799-file /
 * 1,210-row corpus sample — 13 in `material_ui/test/dropdown_menu_test.dart` and the
 * rest in `dart2wasm/lib/class_info.dart`, and every one of them inside a local
 * function nested in a closure inside a local function.
 */
const isLambdaSignature = (n: any): boolean =>
  n?.type === "function_signature" && n.parent?.type === "lambda_expression"

/**
 * The name of the TYPE that encloses `n`, read from the PARENT chain, or "" when there is none.
 *
 * Exists for the constructor test above, whose rule is stated over the enclosing type's name
 * ("a constructor is named after its class"). The analyzer derives the same value from its own
 * `scopeStack` in the symbol pass and from a parent walk in the relationship passes, and those two
 * must agree or an edge's source and the symbol it names are decided by different rules.
 */
function enclosingTypeNameOf(n: any): string {
  let cur = n?.parent
  let guard = 0
  while (cur && guard++ < 64) {
    if (TYPE_DECLARATIONS.has(cur.type)) return typeDeclarationName(cur)?.name ?? ""
    cur = cur.parent
  }
  return ""
}

/** The name a type declaration publishes, and whether it is an UNNAMED extension. */
function typeDeclarationName(n: any): { name: string; unnamedExtension: boolean } | null {
  if (n.type === "mixin_application_class") {
    // `class A<U, V> = Object with M<U, V> implements I<V>;` — a class ALIAS. The
    // grammar hangs the NAME inside `mixin_application_class` and leaves no `name`
    // field on the enclosing `class_definition`, so a name-field read sees no class at
    // all and every mention of it in the file goes unresolvable. Measured: 2 rows in
    // a 799-file corpus sample (`class SuperC = S with M;`, `class A<U,V> = Object
    // with M<U,V> implements I<V>;`). The analyzer publishes the class and both sides
    // must agree that it exists.
    const id = namedChildren(n).find((c: any) => c.type === "identifier")
    return id ? { name: id.text, unnamedExtension: false } : null
  }
  if (n.type === "mixin_declaration") {
    const id = namedChildren(n).find((c: any) => c.type === "identifier")
    return id ? { name: id.text, unnamedExtension: false } : null
  }
  if (n.type === "type_alias") {
    const id = n.childForFieldName?.("name") ?? namedChildren(n).find((c: any) => c.type === "type_identifier")
    return id ? { name: id.text, unnamedExtension: false } : null
  }
  // `extension on String {}` declares no name, so it is published under a SYNTHESIZED one
  // — `unnamed_extension_String`, or bare `unnamed_extension` when the `on` type is not an
  // identifier — so that it never occupies a REAL declaration's name. The spelling has to
  // match `DART_UNNAMED_EXTENSION` in `real-dart-analyzer.ts` to the CHARACTER, because it
  // is the SOURCE every mention inside the body is attributed to; that is the one thing this
  // file's "shared: nothing" rule cannot buy, and the differential fixture is what holds the
  // two together. The name is still kept OUT of the visible set: nothing in source can spell
  // it, so admitting it would put a name no code writes into the resolver.
  if (n.type === "extension_declaration" && !n.childForFieldName?.("name")) {
    for (const c of namedChildren(n)) {
      if (c.type === "type_identifier" || c.type === "void_type") {
        return { name: `unnamed_extension_${c.text}`, unnamedExtension: true }
      }
    }
    return { name: "unnamed_extension", unnamedExtension: true }
  }
  const name = n.childForFieldName?.("name")?.text
  if (!name) return null
  return { name, unnamedExtension: false }
}

/** The names of the types THIS TREE declares. */
export function dartTypesDeclaredIn(root: any): Set<string> {
  const out = new Set<string>()
  const walk = (n: any): void => {
    if (TYPE_DECLARATIONS.has(n.type)) {
      const d = typeDeclarationName(n)
      if (d && !d.unnamedExtension) out.add(d.name)
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/** Is `name` a TYPE PARAMETER introduced by an ancestor of `node`? */
function shadowedByTypeParameter(node: any, name: string): boolean {
  let cur = node.parent
  let guard = 0
  while (cur && guard++ < 64) {
    const tp = namedChildren(cur).find((c: any) => c.type === "type_parameters")
    if (tp) {
      for (const c of namedChildren(tp)) {
        if (c.type !== "type_parameter") continue
        // The parameter's TEXT SPANS ITS BOUND: `class Box<T extends Wallet>` is ONE
        // `type_parameter` node with a `type_bound` child, so `c.text` is
        // `"T extends Wallet"`. Comparing that against `T` refuses every CONSTRAINED
        // type variable, and the constrained one is the common case.
        const declared = c.childForFieldName?.("name")?.text ??
          namedChildren(c).find((k: any) => k.type === "type_identifier")?.text
        if (declared === name) return true
      }
    }
    cur = cur.parent
  }
  return false
}

/**
 * The rule, as a single walk. `visibleTypes` defaults to what this tree declares,
 * which is the per-file (production) answer.
 *
 * `fileLabel` is the source of a mention that belongs to no published declaration —
 * a top-level variable's type, for instance, since a local or a top-level variable
 * is not a symbol and its mention folds outward (DARTD8). It is the file's own base
 * name, because that is the identity the file has and the convention every other
 * label in this analyzer already follows for the same situation (measured on a
 * 1,000-file sample: 142 of 17,647 `calls` rows and 50 of that run's 2,186
 * `references` rows carry it — measured on the 1,000-file sample the two figures
 * were taken on, and stated as such rather than re-quoted against the lane's later
 * 2,735-file sample, which is a different measurement). It is passed in rather than invented here so both sides answer with the
 * same string: the alternative is a constant that can never bind to a symbol, which
 * is the placeholder defect M60 rule R7 exists to stop.
 */
// ─────────────────────────────── ANNOTATIONS ───────────────────────────────
//
// 2026-10-18 (owner ruling: annotations are owed relationships). An annotation NAMES a declared
// type, so it is a `references` mention under this file's own rule — but it is NOT a
// `type_identifier`, so the mention branch below never sees it, and its SOURCE is a declaration
// the annotation does not contain. Both halves are derived here from the grammar, independently
// of the analyzer (no import, no shared table — the same contract every rule in this file keeps).
//
// The positions are the measured ones (`validation/m14/fixtures/dart/annotation-shapes-probe.ts`):
// a CHILD of the type declaration / `enum_constant` / `formal_parameter` /
// `local_variable_declaration`, and a SIBLING of the declaration inside `class_body` / `program`.
// A top-level annotated variable is three siblings (`annotation`, `type_identifier`,
// `initialized_identifier_list`), which is why the sibling walk has a type-node step.
//
// ANNOTATION TARGETS ARE NOT GATED ON `visible`. Every other mention in this file publishes only
// when the type is one the run can see; an annotation is a DECLARATION-SITE fact (`@override` is
// written there whether or not dart:core is in the run), and the analyzer publishes it
// unconditionally — a truth derivation gated on visibility would manufacture `unexplained` rows
// the lane does not have.

/** The annotation's type name as written: `name` field, alias leaf, no arguments. */
function annotationTargetName(ann: any): string | null {
  const f = ann.childForFieldName?.("name") ??
    namedChildren(ann).find((c: any) => c.type === "identifier" || c.type === "type_identifier")
  if (!f) return null
  if (f.type === "identifier" || f.type === "type_identifier") return f.text
  if (f.type === "scoped_identifier") {
    const leaf = f.childForFieldName?.("name") ??
      namedChildren(f).find((c: any) => c.type === "identifier")
    return leaf ? leaf.text : null
  }
  const id = namedChildren(f).find((c: any) => c.type === "identifier" || c.type === "type_identifier")
  return id ? id.text : null
}

/** Names a declaration node publishes — used only by the annotation sibling forms. */
function annotationDeclarationNames(node: any): string[] {
  if (!node) return []
  // The top-level annotated variable: `annotation`, `type_identifier`, `initialized_identifier_list`.
  if (node.type === "type_identifier" || node.type === "void_type" || node.type === "nullable_type" ||
      node.type === "function_type" || node.type === "inferred_type") {
    const after = node.nextNamedSibling
    return after && (after.type === "initialized_identifier_list" || after.type === "static_final_declaration_list")
      ? annotationDeclarationNames(after)
      : []
  }
  if (node.type === "initialized_identifier_list" || node.type === "static_final_declaration_list") {
    const out: string[] = []
    for (const c of namedChildren(node)) {
      const id = namedChildren(c).find((x: any) => x.type === "identifier") ?? (c.type === "identifier" ? c : null)
      if (id) out.push(id.text)
    }
    return out
  }
  if (TYPE_DECLARATIONS.has(node.type)) {
    const d = typeDeclarationName(node)
    return d && d.name ? [d.name] : []
  }
  if (node.type === "enum_constant") {
    const id = node.childForFieldName?.("name") ?? namedChildren(node).find((c: any) => c.type === "identifier")
    return id ? [id.text] : []
  }
  if (isSignature(node.type)) {
    const nm = memberName(node)
    return nm ? [nm] : []
  }
  if (node.type === "declaration") {
    const sig = namedChildren(node).find((c: any) => isSignature(c.type))
    if (sig) {
      const nm = memberName(sig)
      return nm ? [nm] : []
    }
    const out: string[] = []
    for (const c of namedChildren(node)) {
      if (c.type === "initialized_identifier_list" || c.type === "static_final_declaration_list") {
        out.push(...annotationDeclarationNames(c))
      }
    }
    return out
  }
  return []
}

/** The declarations one annotation decorates, in the grammar's own positions. */
function annotationSources(ann: any, member: string | null, typeName: string | null, fileName: string): string[] {
  const parent = ann.parent
  if (!parent) return []
  const p = parent.type
  if (TYPE_DECLARATIONS.has(p)) {
    const d = typeDeclarationName(parent)
    return d && d.name ? [d.name] : []
  }
  if (p === "enum_constant") {
    const id = parent.childForFieldName?.("name") ?? namedChildren(parent).find((c: any) => c.type === "identifier")
    return id ? [id.text] : []
  }
  if (p === "local_variable_declaration" || p === "formal_parameter" || p === "constructor_param" ||
      p === "super_formal_parameter") {
    // A local / parameter publishes no symbol, so the annotation belongs to the declaration
    // that carries the position — the enclosing callable, then the enclosing type, then the file.
    const carrier = member ?? typeName ?? fileName
    return carrier ? [carrier] : []
  }
  if (p === "class_body" || p === "program" || p === "enum_body") {
    let sib = ann.nextNamedSibling
    let guard = 0
    while (sib && sib.type === "annotation" && guard++ < 16) sib = sib.nextNamedSibling
    return annotationDeclarationNames(sib)
  }
  return []
}

export function deriveDartReferencesTruth(
  root: any,
  visibleTypes?: Set<string> | string[],
  fileLabel = "file",
): DartReferenceEdge[] {
  const visible = visibleTypes ? new Set(visibleTypes as any) : dartTypesDeclaredIn(root)
  const out: DartReferenceEdge[] = []
  const seen = new Set<string>()

  const visit = (n: any, member: string | null, type: string | null, fileName: string): void => {
    // The enclosing PUBLISHED declaration, innermost first.
    let nextMember = member
    let nextType = type
    if (TYPE_DECLARATIONS.has(n.type)) {
      const d = typeDeclarationName(n)
      if (d) nextType = d.name
    }
    if (isSignature(n.type)) {
      if (!isLambdaSignature(n)) {
        const nm = memberName(n)
        if (nm) nextMember = nm
      }
    } else if (n.type === "declaration") {
      const sig = namedChildren(n).find((c: any) => isSignature(c.type))
      if (sig) {
        const nm = memberName(sig)
        if (nm) nextMember = nm
      }
    } else if (n.type === "function_body" || n.type === "function_expression_body" || n.type === "block") {
      // DART GRAMMAR: a body is a named child of the CONTAINER that FOLLOWS the
      // signature it belongs to — `method_signature` then `function_body` as
      // siblings — so a body is never a descendant of the declaration that names
      // it. Every mention inside a body would otherwise be attributed to whatever
      // encloses the CONTAINER (the class, or the file), which is a different fact.
      // The previous named sibling is the signature, and it is consulted only when
      // this node changed nothing itself.
      //
      // The same lambda refusal applies here, and it is the branch that actually
      // decides most of the corpus rows: a local function's body hangs off
      // `lambda_expression` with its signature as the previous sibling, so guarding
      // only the signature branch above leaves the leak open through this one.
      if (nextMember === member) {
        const prev = n.previousNamedSibling
        if (prev && isSignature(prev.type) && !isLambdaSignature(prev)) {
          const nm = memberName(prev)
          if (nm) nextMember = nm
        }
      }
    }

    // MIXIN `on`-CLAUSE (2026-10-18). DARTD14 used to publish the constraint as
    // `extends{isMixinOn}`; the canonical vocabulary made it what it is — a type the mixin's
    // DECLARATION mentions — so the analyzer emits `references{isMixinOn}` and the truth must
    // derive it from the grammar the same way. The on-base is a DIRECT `type_identifier` child
    // of `mixin_declaration` (probed: dart-mixin-shape.ts), which is why the generic
    // `type_identifier` branch below never sees it (its position is in PUBLISHED_ELSEWHERE).
    if (n.type === "mixin_declaration") {
      const own = typeDeclarationName(n)?.name ?? ""
      for (const c of namedChildren(n)) {
        if (c.type !== "type_identifier") continue
        const from = own
        const target = c.text
        if (!from || !target || from === target) continue
        const key = `${from}|${target}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ label: "references", from, target })
        }
      }
    }

    if (n.type === "annotation") {
      const target = annotationTargetName(n)
      if (target) {
        for (const from of annotationSources(n, nextMember, nextType, fileName)) {
          const key = `${from}|${target}`
          if (!seen.has(key) && from && from !== target) {
            seen.add(key)
            out.push({ label: "references", from, target })
          }
        }
      }
    }

    if (n.type === "type_identifier") {
      const parent = n.parent
      const position = parent ? parent.type : ""
      // THE SUBJECT OF AN UNNAMED EXTENSION IS NOT A MENTION ITS BODY MAKES — the analyzer's
      // `isUnnamedExtensionSubject`, and the reason is there: the extension's published name is
      // DERIVED from that type, so an edge from the synthesized name to its own subject would
      // name a source no index keeps. `extension M on M2 {}` is NAMED and keeps its `M -> M2`.
      const unnamedExtensionSubject =
        position === "extension_declaration" && parent?.childForFieldName?.("name") === null
      if (!PUBLISHED_ELSEWHERE.has(position) && !unnamedExtensionSubject) {
        // Under a `qualified` name the `type_identifier` IS the type and its own
        // text says which: `prefix.Type` keeps `prefix` in an `identifier` sibling
        // and `Type.member` keeps `member` in one, so there is nothing to strip.
        const name = n.text
        const from = nextMember ?? nextType ?? fileName
        if (
          name && name !== "dynamic" && name !== from &&
          visible.has(name) && !shadowedByTypeParameter(n, name)
        ) {
          const key = `${from}|${name}`
          if (!seen.has(key)) {
            seen.add(key)
            out.push({ label: "references", from, target: name })
          }
        }
      }
    }

    for (const c of namedChildren(n)) visit(c, nextMember, nextType, fileLabel)
  }

  visit(root, null, null, fileLabel)
  return out
}
