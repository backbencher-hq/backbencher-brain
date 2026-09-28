/**
 * The TypeScript `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason the JSON oracle's
 * header records: that shared file is edited by several lanes at once, and every
 * line a lane keeps out of a shared file is a line that cannot conflict. This lane
 * has already rewritten its block there three times while other lanes worked
 * alongside it. Wiring it in later is one import and one registration.
 *
 * The oracle is written from TypeScript's containment rule and shares no rule
 * table, key set, member list or resolver with `RealTypeScriptAnalyzer`. That is
 * the only property that makes a MATCH mean something: an oracle derived from the
 * analyzer cannot disagree with it.
 *
 * ## Why this oracle exists at all
 *
 * `differential.ts` gives TypeScript a dedicated `calls`/`instantiates` oracle
 * (`deriveTypeScriptEdges`) on top of the generic heritage walker, and that is
 * where the JVM lanes got theirs too — the M37.21 #611 note is explicit that the
 * generic walker "never audited the call surface". But `contains` had truth for
 * exactly ONE language in the whole instrument: `deriveJavaContainsTruth`. For
 * TypeScript the analyzer's containment surface — the backbone of the hierarchy,
 * and the surface the graph is navigated by — had no independent cross-check at
 * any corpus scale. The committed lane evidence is `truthSource: manual_audit`
 * over five hand-written fixture files, which is a regression test, not an
 * independent measurement.
 *
 * It is not a hypothetical gap. The first defect this oracle's construction
 * surfaced (while probing the shapes it would need) was a named class expression
 * emitting no class symbol and therefore no containment edges at all, plus a
 * duplicated row for an accessor pair — and neither was visible to any gate.
 *
 * ## The rule
 *
 * A declaration CONTAINS the members it declares. Both ends of the edge are names
 * written in the file, so the rule needs no name resolution: this is not a
 * resolution question, it is a "what did the programmer declare here" question.
 *
 * Containers, and what the language says they contain:
 *
 *   class / interface   the members written in their body
 *   enum                the members written in its body
 *   namespace / module  the declarations written in its body
 *   object literal      the shorthand methods written in it
 *
 * ## The four places this mirrors the analyzer, and why each is a NAMING or
 * DECISION mirror rather than the rule being weakened
 *
 * 1. An object literal's DATA properties are not members. `const o = { p: 1 }`
 *    yields no `p` symbol in either twin — a documented family decision, since a
 *    data property is a value in a record, not a declared member. Deriving it here
 *    would manufacture an edge the family has ruled out, and a superset in the
 *    truth is worse than a subset: it converts a real disagreement into a phantom.
 * 2. A get/set pair is ONE member, and the LAST one written is the one kept. This
 *    is not cosmetic: two symbols sharing one owner means containment emits the
 *    same `contains` row twice, which is a duplicated edge in the graph. Both the
 *    class and the object-literal path collapse a pair; the oracle mirrors it by
 *    keeping the last declaration of each name, which also handles TypeScript's
 *    overload sets (N signatures + 1 implementation) in the same rule.
 * 3. Synthetic names are the analyzer's to invent, so the oracle derives the
 *    member NAME and lets the name stand: an `index_signature` writes `[k: string]`
 *    and is a member named `[k]`; a `construct_signature` writes `new (): I` and
 *    is a member named `(new)`. Both spellings are the file's own, and both were
 *    confirmed by probe before being encoded.
 * 4. An object literal is a container only when something BINDS it. `const o = {
 *    m(){} }` is owned by `o`, but the same literal in an argument list, a return
 *    statement or an array element has no binding name to own it, and the analyzer
 *    emits its members with no owner. An orphan member is not a containment
 *    relation, so the oracle does not invent one.
 * 5. A type ALIAS over an object literal is a container. `type FileErr = { file:
 *    string }` declares a structural type, and the properties it writes ARE the
 *    members that type has; a graph consumer asking what fields a type declares
 *    is asking exactly this. Measured on 150 real files, this was the single
 *    largest source of oracle/analyzer disagreement on the first run (69 of 69),
 *    which is the point of building the oracle: the modelling was correct, total,
 *    and written down nowhere. An alias over anything else is NOT a container \u2014
 *    `type P = Promise<string>` and `type F = (x: number) => string` declare no
 *    members of their own, and an INTERSECTION of two literals declares the union
 *    of two bodies it does not itself write, so only a single literal body is
 *    followed.
 * 6. A container needs a container. This is the C#-family rule the analyzer
 *    states outright \u2014 "variables declared inside a function body are locals \u2014
 *    not symbols" \u2014 and it is NOT the same as function depth. Measured, all ten
 *    shapes:
 *
 *      module-level `const o = { m(){} }`      -> o IS a symbol, `o contains m`
 *      namespace-level same                     -> o IS a symbol, `o contains m`
 *      function-local `const o = { m(){} }`     -> o is a LOCAL: no edge
 *      method-body / static-block same          -> no edge
 *      `class C {}` inside a function body      -> C IS a symbol, `C contains m`
 *      `interface I {}` inside a function body  -> I IS a symbol, `I contains a`
 *
 *    So TYPE declarations are symbols wherever they are written, while a VALUE
 *    binding is a symbol only at declaration level. The oracle therefore tracks
 *    the declaration context rather than function depth, and derives an object
 *    literal's members only at declaration level. The analyzer's own asymmetry
 *    here is worth recording: for a function-local object it still emits the
 *    members, each carrying an `ownerName` that names a local and so resolves to
 *    nothing \u2014 a dangling owner, the same class as the named-class-expression
 *    defect. It is reported rather than mirrored, because the honest resolution
 *    for the two is opposite (a named class is a type and should be a symbol; a
 *    function-local binding is a local and must not become one).
 *
 * What it deliberately does NOT derive: a class STATIC BLOCK. `static { ... }` is
 * a statement, not a named member, and it is emitted as no symbol at all
 * (measured) — a container-level statement has no name to contain.
 */

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): string | null => n?.childForFieldName?.(f)?.text ?? null

/** A member declaration that carries a name, inside a type body. */
const NAMED_MEMBERS = new Set([
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "property_signature",
  "public_field_definition",
])

/** `get x(){}` / `set x(v){}` are ANONYMOUS `get`/`set` token children. */
function accessorKind(node: any): "get" | "set" | undefined {
  for (let i = 0; i < (node?.childCount ?? 0); i++) {
    const c = node.child(i)
    if (c && (c.type === "get" || c.type === "set")) return c.type
  }
  return undefined
}

  /** An `index_signature` writes `[k: string]: any`; the member is named `[k]`. */
function indexMemberName(node: any): string | null {
  const n = field(node, "name")
  return n ? `[${n}]` : null
}

/**
 * Parameter PROPERTIES of a constructor: `constructor(readonly meta: M, private
 * silent = false)`.
 *
 * TypeScript makes these class members \u2014 they are declared fields, initialized
 * by the constructor \u2014 so they belong to the class, not to the constructor. The
 * grammar marks them structurally: the parameter carries an `accessibility_modifier`
 * (named) or a `readonly` token, and has no `name` field, so the name is its first
 * `identifier` child. Probed against the pinned grammar: `constructor(readonly a:
 * T, private b = 1, public c: number, plain: string, opt?: number)` yields
 * modifiers on the first three and none on the last two.
 */
function parameterProperties(ctor: any): string[] {
  const params = ctor?.childForFieldName?.("parameters")
  const out: string[] = []
  for (const prm of named(params)) {
    if (prm.type !== "required_parameter" && prm.type !== "optional_parameter") continue
    let isProperty = false
    for (let i = 0; i < prm.childCount; i++) {
      const c = prm.child(i)
      if (c && (c.type === "accessibility_modifier" || c.type === "readonly")) {
        isProperty = true
        break
      }
    }
    if (!isProperty) continue
    for (const c of named(prm)) {
      if (c.type === "identifier") {
        out.push(c.text)
        break
      }
    }
  }
  return out
}

export function deriveTypeScriptContainsTruth(root: any): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const push = (owner: string, target: string) => {
    if (!owner || !target) return
    const k = `${owner}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "contains", from: owner, target })
  }

  /**
   * Members of a type body, keeping the LAST declaration of each name.
   *
   * One rule covers both collapses TypeScript's own type system performs: a
   * get/set pair is a single property, and N overload signatures plus one
   * implementation are a single member. Walking the body in reverse and taking
   * each name once is that rule, with no special-casing.
   */
  const typeBodyMembers = (owner: string, body: any) => {
    if (!body) return
    const taken = new Set<string>()
    for (let i = body.namedChildCount - 1; i >= 0; i--) {
      const m = body.namedChild(i)
      if (!m) continue
      let name: string | null = null
      if (NAMED_MEMBERS.has(m.type)) name = field(m, "name")
      else if (m.type === "index_signature") name = indexMemberName(m)
      else if (m.type === "construct_signature") name = "(new)"
      if (!name || taken.has(name)) continue
      taken.add(name)
      push(owner, name)
      // A constructor's parameter properties are members of the CLASS, declared
      // by the constructor (see `parameterProperties`).
      if (name === "constructor" && m.type === "method_definition") {
        for (const p of parameterProperties(m)) {
          if (taken.has(p)) continue
          taken.add(p)
          push(owner, p)
        }
      }
    }
  }

  /**
   * Members of an object literal: shorthand METHODS only (a data property is a
   * record entry, not a member — mirror 1), last declaration per name (mirror 2).
   *
   * A NESTED literal is followed under the SAME owner: `const root = { todo: {
   * author(){} } }` gives `root contains author`, because `todo` names no value
   * of its own — the family's ownership contract for a nested config object, and
   * the analyzer's behaviour for it is deliberate rather than accidental.
   */
  const objectMembers = (obj: any, owner: string) => {
    const taken = new Set<string>()
    for (let i = obj.namedChildCount - 1; i >= 0; i--) {
      const m = obj.namedChild(i)
      if (!m) continue
      if (m.type === "method_definition") {
        const name = field(m, "name")
        if (!name || taken.has(name)) continue
        taken.add(name)
        push(owner, name)
        continue
      }
      if (m.type === "pair") {
        const value = m.childForFieldName?.("value")
        if (value?.type === "object") objectMembers(value, owner)
      }
    }
  }

  /** The declarations written in a namespace / module body. */
  const moduleBodyMembers = (owner: string, body: any) => {
    if (!body) return
    for (const st of named(body)) {
      if (st.type === "export_statement") {
        for (const d of named(st)) declarationNames(d).forEach((n) => push(owner, n))
        continue
      }
      if (st.type === "ambient_declaration") {
        // `export declare const x` inside an ambient module wraps the declaration
        // in its own ambient_declaration; the name is still declared here.
        for (const d of named(st)) declarationNames(d).forEach((n) => push(owner, n))
        continue
      }
      declarationNames(st).forEach((n) => push(owner, n))
    }
  }

  /** Names a statement-level declaration introduces. */
  const declarationNames = (d: any): string[] => {
    switch (d?.type) {
      case "function_declaration":
      case "generator_function_declaration":
      case "function_signature":
      case "class_declaration":
      case "abstract_class_declaration":
      case "interface_declaration":
      case "type_alias_declaration":
      case "enum_declaration":
      case "internal_module":
      case "module":
        return [field(d, "name")].filter(Boolean) as string[]
      case "lexical_declaration":
      case "variable_declaration": {
        const out: string[] = []
        for (const decl of named(d)) {
          if (decl.type !== "variable_declarator") continue
          const nm = field(decl, "name")
          if (nm) out.push(nm)
        }
        return out
      }
      default:
        return []
    }
  }

  /**
   * A function in CALL-ARGUMENT position is entry-point work: its body's
   * declarations are indexed, while a locally-defined function's are locals.
   * Measured, and it is a property of the function's ROLE, not of depth:
   *
   *   `foo(() => { const o = { m(){} } })`          -> o IS a symbol, `o contains m`
   *   `const g = () => { const o = { m(){} } }`     -> o is a LOCAL, no edge
   *   `function f() { const o = { m(){} } }`        -> o is a LOCAL, no edge
   *   `class K { go() { const o = { m(){} } } }`    -> o is a LOCAL, no edge
   *   `foo(() => { function g() { const o = ... } })`  -> o is a LOCAL again
   *
   * The last line is the rule's edge: a callback's own body is entry-point work,
   * and anything DEFINED inside it is a local again. So entering a function
   * always resets the context, and the reset is what makes the two agree.
   */
  const FUNCTION_NODES = new Set([
    "function_declaration", "generator_function_declaration", "function_signature",
    "function_expression", "arrow_function", "method_definition", "function",
  ])
  const isCallArgument = (n: any): boolean => {
    // The function's parent is the `arguments` NODE, not the call itself, so the
    // call is one level up. Probed: in `it("x", () => {})` the arrow's parent is
    // `arguments` and `parent.childForFieldName("arguments")` is undefined, so
    // reading the call off the parent silently reported every callback as a local
    // and lost every callback-body object literal in the corpus.
    const args = n?.parent?.type === "arguments" ? n.parent : n?.parent?.childForFieldName?.("arguments")
    const call = args?.parent
    if (!args || !call || (call.type !== "call_expression" && call.type !== "new_expression")) return false
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c && c.startIndex === n.startIndex) return true
    }
    return false
  }

  const childContext = (
    node: any,
    ctx: "decl" | "callback" | "fn" | "member",
  ): "decl" | "callback" | "fn" | "member" => {
    const t = node?.type
    if (FUNCTION_NODES.has(t)) return isCallArgument(node) ? "callback" : "fn"
    if (t === "class_body" || t === "interface_body" || t === "enum_body") return "member"
    if (
      t === "internal_module" || t === "namespace_declaration" ||
      t === "module_declaration" || t === "module"
    ) return "decl"
    return ctx
  }

  const walk = (n: any, boundObjectOwner: string | null, ctx: "decl" | "callback" | "fn" | "member") => {
    const t = n?.type

    if (t === "class_declaration" || t === "abstract_class_declaration") {
      const owner = field(n, "name")
      if (owner) typeBodyMembers(owner, n.childForFieldName?.("body"))
    } else if (t === "class") {
      // A class EXPRESSION is a declaration only when it carries a name; an
      // anonymous one is a value whose members belong to whatever binds it.
      const owner = field(n, "name")
      if (owner) typeBodyMembers(owner, n.childForFieldName?.("body"))
    } else if (t === "interface_declaration") {
      const owner = field(n, "name")
      if (owner) typeBodyMembers(owner, n.childForFieldName?.("body"))
    } else if (t === "enum_declaration") {
      const owner = field(n, "name")
      const body = n.childForFieldName?.("body")
      if (owner && body) {
        const taken = new Set<string>()
        for (const m of named(body)) {
          const name = m.type === "property_identifier" || m.type === "string" ? m.text : field(m, "name")
          if (!name || taken.has(name)) continue
          taken.add(name)
          push(owner, name)
        }
      }
    } else if (t === "internal_module" || t === "namespace_declaration" || t === "module_declaration") {
      const owner = field(n, "name")
      if (owner) moduleBodyMembers(owner, n.childForFieldName?.("body"))
    } else if (t === "module") {
      // `declare module "amb"` \u2014 the module NAME is a quoted string node, and the
      // owner is the name without its quotes. Stripped with plain string ops, not
      // a pattern: the quotes are the first and last characters, nothing else.
      const raw = field(n, "name")
      const owner = raw && raw.length >= 2 ? raw.slice(1, -1) : null
      if (owner) moduleBodyMembers(owner, n.childForFieldName?.("body"))
    } else if (t === "type_alias_declaration") {
      // `type FileErr = { file: string }` \u2014 the properties of a single object
      // literal body are the members the alias declares (mirror 5). An alias over
      // a generic, a function type, or an intersection of literals is not walked.
      const owner = field(n, "name")
      const value = n.childForFieldName?.("value")
      if (owner && value?.type === "object_type") typeBodyMembers(owner, value)
    } else if (t === "object" && boundObjectOwner && (ctx === "decl" || ctx === "callback")) {
      objectMembers(n, boundObjectOwner)
    } else if (t === "variable_declarator") {
      // The declarator's VALUE decides what the children are walked with: an
      // object literal is owned by the binding, and anything else — including a
      // class expression, which is its own container when it is named — is
      // walked unbound so the generic recursion below still reaches it. An early
      // return here without recursing silently dropped every class expression
      // bound to a variable, which is the common spelling.
      const value = n.childForFieldName?.("value")
      const name = field(n, "name")
      const owner = value?.type === "object" ? name : null
      for (const c of named(n)) walk(c, owner, ctx)
      return
    }

    // A NESTED object literal inherits the OUTERMOST binding, which is the
    // family's ownership contract for a nested config object: in
    // `const root = { todo: { author(){} } }` the analyzer emits `root->author`,
    // not `todo->author`, because `todo` names no value of its own. Measured and
    // deliberate, so the owner is passed down through the literal's children
    // rather than reset to null.
    const childOwner = t === "object" ? boundObjectOwner : null
    for (const c of named(n)) walk(c, childOwner, childContext(n, ctx))
  }

  walk(root, null, "decl")
  return edges
}
