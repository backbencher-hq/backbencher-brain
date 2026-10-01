/**
 * The Dart `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason the JSON oracle's
 * header records: that shared file is edited by several lanes at once, and every
 * line a lane keeps out of a shared file is a line that cannot conflict. Wiring it
 * in is one import and one registration.
 *
 * The oracle is written from Dart's containment rule and shares no rule table, key
 * set, member list or resolver with `RealDartAnalyzer`. That is the only property
 * that makes a MATCH mean something: an oracle derived from the analyzer cannot
 * disagree with it.
 *
 * ## Why this oracle exists at all
 *
 * `contains` had truth for five languages in the whole instrument — java, kotlin,
 * scala, csharp, typescript — while 19 lanes published `contains` that the
 * differential's allowlist dropped, so nothing compared it and the lane's percentage
 * did not know. Dart is the largest of those: 7,698 `contains` edges in a 25-file
 * sample, the biggest single-label blob the M60 label-coverage sweep found. For the
 * whole of that surface — the backbone the graph is navigated by — the lane had no
 * independent cross-check at any scale. The committed lane evidence was
 * `truthSource: manual_audit` over hand-written fixtures, which is a regression
 * test, not a measurement.
 *
 * ## The rule
 *
 * A declaration CONTAINS the members it declares. Both ends of the edge are names
 * written in the file, so this needs no name resolution: it is a "what did the
 * programmer declare here" question, not a resolution question.
 *
 * From tree-sitter-dart's own node types (verified against the grammar, not read
 * out of the analyzer):
 *
 *   class_definition / mixin_declaration / extension_declaration
 *       the members in its `class_body`
 *   enum_declaration
 *       the `enum_constant`s in its `enum_body`
 *
 * and inside a `class_body`:
 *
 *   declaration -> initialized_identifier_list -> initialized_identifier -> identifier
 *                                                       a FIELD
 *   declaration -> constructor_signature
 *   method_signature -> function_signature  | getter_signature | setter_signature
 *                        -> identifier                            a METHOD
 *   method_signature -> factory_constructor_signature              a FACTORY
 *
 * ## The one mirror, and why it is a mirror rather than a weakening
 *
 * A constructor's name is not written anywhere in the file: `Counter.zero()` spells
 * `Counter` and `zero` separately and the analyzer publishes the member as
 * `constructor`. Synthetic names are the analyzer's to invent, so this derives it
 * from the same convention instead of manufacturing an edge the family has ruled
 * out. A superset in the truth is worse than a subset: it converts a real
 * disagreement into a phantom.
 *
 * The container name is the UNQUALIFIED identifier — Dart has no qualified class
 * names in a file — and matching is site-agnostic on `owner -> target`, so this
 * needs no file or owner disambiguation.
 */

export type DartContainsEdge = { label: "contains"; from: string; target: string }

// The container node types, read from the GRAMMAR rather than from the analyzer:
// enumerating every declaration form the grammar actually produces is positive
// evidence, and it is what caught two omissions the first draft had —
// `extension_type_declaration` (Dart 3's `extension type X._(...)`, which is how
// the jni bindings declare every type) and the fact that `extension_declaration`
// carries an `extension_body`, not a `class_body`.
const CONTAINER = new Set([
  "class_definition",
  "mixin_declaration",
  "extension_declaration",
  "extension_type_declaration",
])
const ENUM_CONTAINER = new Set(["enum_declaration"])
/** `class_body` for class/mixin/extension-type, `extension_body` for `extension`. */
const BODY = new Set(["class_body", "extension_body"])

export function deriveDartContainsTruth(root: any): DartContainsEdge[] {
  const out: DartContainsEdge[] = []
  const seen = new Set<string>()
  const add = (from: string, target: string): void => {
    const o = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!o || !t) return
    const k = `${o}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from: o, target: t })
  }

  const named = (n: any): any[] => (n?.namedChildren ?? [])
  const firstOfType = (n: any, t: string): any => named(n).find((c: any) => c?.type === t) ?? null

  /** the declaration's own name, as the grammar spells it */
  const declaredName = (n: any): string => firstOfType(n, "identifier")?.text ?? ""

  /**
   * Members are collected in document order and then emitted; order does not change
   * the SET of rows, but keeping it explicit means the shape census stays readable.
   */
  const membersOf = (body: any, owner: string): void => {
    if (!body) return
    const ordered: string[] = []
    const pushName = (nm: string | undefined): void => { if (nm) ordered.push(nm) }

    for (const decl of named(body)) {
      switch (decl.type) {
        case "declaration": {
          // a field, in EITHER of the two shapes the grammar produces:
          //   `final String label;`  -> initialized_identifier_list -> initialized_identifier
          //   `static final X = e;`  -> static_final_declaration_list -> static_final_declaration
          // Handling only the first missed every `static final` field, which in
          // JNI-binding code is most of the class: `Arrays` alone published 431
          // properties, and the first draft derived 2.
          for (const list of named(decl).filter((c: any) => c.type === "initialized_identifier_list")) {
            for (const init of named(list).filter((c: any) => c.type === "initialized_identifier")) {
              pushName(firstOfType(init, "identifier")?.text)
            }
          }
          for (const list of named(decl).filter((c: any) => c.type === "static_final_declaration_list")) {
            for (const sf of named(list).filter((c: any) => c.type === "static_final_declaration")) {
              // the DECLARED name is the first identifier; the ones after it belong
              // to the initialiser expression (`_class.staticMethodId(...)`), which
              // is why taking `named(sf)[0]` rather than every identifier matters.
              pushName(named(sf)[0]?.type === "identifier" ? named(sf)[0].text : undefined)
            }
          }
          // A CONSTRUCTOR, matched as a FAMILY. The corpus spells it four ways —
          // `constructor_signature`, `constant_constructor_signature` (every
          // `const Foo({super.key})`, which is most of a Flutter widget class),
          // `redirecting_factory_constructor_signature`, and a factory — and
          // matching one spelling misses the rest. Measured: enumerating them cost
          // 2,548 rows on 1,294 files, and the missing one was the CONST spelling,
          // which a battery written from `class D { D({int? x}); }` cannot see
          // because that exact source text parses as the plain spelling.
          if (named(decl).some((c: any) => c.type.includes("constructor") || c.type.includes("factory"))) pushName("constructor")
          break
        }
        case "method_signature": {
          const inner = named(decl)[0]
          if (!inner) break
          // `const C.zero() : this(0);` arrives as `method_signature >
          // constant_constructor_signature`, so the family test has to be here too
          // and not only on the `declaration` path.
          if (inner.type.includes("constructor") || inner.type.includes("factory")) { pushName("constructor"); break }
          // A PLAIN constructor also arrives as `method_signature >
          // constructor_signature` — `class ContentBloc { ContentBloc({…}); }`
          // parses that way, NOT as `declaration > constructor_signature`. DARTD3
          // applies to it exactly as it does to the other three spellings, so the
          // member is `constructor` and not the class's own name. Without this arm
          // the oracle published `ContentBloc -> ContentBloc` — a self-containment
          // row the analyzer never emits — and failed to publish
          // `ContentBloc -> constructor`, which it does. Measured over 1,294
          // ProxiCall/lib files that is ~2,565 missing rows and 23 invented ones,
          // and it is invisible to a four-case battery because `class C { C({int? x
          // }); }` happens to parse as the `declaration` spelling: the two spellings
          // are the same source text, and a battery built from one of them cannot
          // see the other.
          if (inner.type === "constructor_signature") { pushName("constructor"); break }
          pushName(firstOfType(inner, "identifier")?.text)
          break
        }
        case "enum_constant": {
          // Dart 2.17+ enhanced enums put fields, methods and constructors directly
          // in the `enum_body` alongside the constants, so an enum body is walked by
          // the same collector as a class body. Handling only the constants missed
          // every member of an enhanced enum — measured on proxicall, where
          // `_PayoutIconCase` contributed 3 analyzer rows the first draft could not
          // reach.
          pushName(firstOfType(decl, "identifier")?.text)
          break
        }
        default:
          break
      }
    }

    // Names are published AS WRITTEN. An earlier draft of this oracle assumed the
    // analyzer disambiguated repeated members by appending `$1`, `$2`, ... and
    // invented that here — which manufactured 233 truth rows the analyzer does not
    // publish, a fabrication on the TRUTH side, the exact class of defect this
    // oracle exists to catch. The `$` suffixes are LITERAL in the source: the jni
    // bindings write `static core$_.int binarySearch$1(` themselves. A controlled
    // probe confirmed the analyzer publishes the bare name for two same-named
    // constructors and three same-named methods alike. So: no invention here.
    for (const nm of ordered) add(owner, nm)
  }

  const visit = (n: any): void => {
    if (CONTAINER.has(n.type)) {
      const owner = declaredName(n)
      if (owner) {
        const body = named(n).find((c: any) => BODY.has(c.type)) ?? null
        membersOf(body, owner)
      }
    } else if (ENUM_CONTAINER.has(n.type)) {
      const owner = declaredName(n)
      if (owner) {
        membersOf(firstOfType(n, "enum_body"), owner)
      }
    }
    for (const c of named(n)) visit(c)
  }

  visit(root)
  return out
}