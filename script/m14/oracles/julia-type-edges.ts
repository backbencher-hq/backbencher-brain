/**
 * The Julia `extends` + `instantiates` oracles — LANE-OWNED.
 *
 * They live here rather than in `differential.ts` for the reason the Dart and Julia `contains`
 * oracles record: that shared file is edited by several lanes at once, and every line a lane keeps
 * out of a shared file is a line that cannot conflict. Wiring them in is two imports and two
 * registrations.
 *
 * Both are written from JULIA'S OWN TYPE RULES and share no rule table, key set or resolver with
 * `RealJuliaAnalyzer`. That is the only property that makes a MATCH mean something: an oracle
 * derived from the analyzer cannot disagree with it.
 *
 * ## Why these two labels, and why now
 *
 * F5's label allowlist admits `extends` and `instantiates` for EVERY language by default. That means
 * Julia was comparing 79 `extends` and 194 `instantiates` edges against **zero** truth rows, and the
 * harness printed the warning that matters: "COMPARED WITH NO TRUTH — the published coverage for
 * those labels is not coverage". Every one of those edges landed in `unexplained`, which is the
 * correct verdict for an uncorroborated edge, and also means two labels were contributing a
 * percentage to the lane's row that meant nothing.
 *
 * `contains` already had truth from the sibling oracle. These two are the remaining structural
 * labels, and both are derivable from a single tree — which is the property that makes an oracle
 * worth writing at all.
 *
 * ## The `extends` rule
 *
 * A subtype relation. Julia has exactly TWO syntactic forms for it, and an oracle that covers only
 * the first misses half the surface:
 *
 *   1. A TYPE DECLARATION with a supertype. `struct Circle{T<:Real} <: Shape` means Circle is a
 *      subtype of Shape. The supertype lives on the RIGHT of a `<:` binary expression inside the
 *      type head, and — measured, not assumed — that expression's OPERATOR IS A NAMED CHILD at
 *      index 1, so "the right operand is child 1" is wrong and an anonymous-child scan finds nothing.
 *      `abstract type A <: B` and `primitive type P <: Q` are the same node with a different keyword.
 *
 *   2. A TYPE PARAMETER'S UPPER BOUND. `f(x::T) where {T<:Real}` bounds T by Real. The edge is the
 *      same relation between two names, and it is a SUBTYPE of nothing in particular — T is the
 *      parameter, not a declared type.
 *
 * The boundary that matters, because getting it wrong in EITHER direction fabricates: inside a
 * struct's type head, `T<:Real` bounds the PARAMETER and says nothing about Circle. Reading it as
 * `Circle <: Real` is a false edge — that was a real defect in the analyzer, caught by the mutant
 * `julia/parameter-bound-as-supertype`, and this oracle states the boundary rather than assuming it.
 *
 * ## The `instantiates` rule
 *
 * A call to a TYPE is a construction: `Circle(1.0)` constructs a Circle. This is `instantiates`
 * rather than `calls` because the two are different facts about the same syntax — the first says a
 * type was built, the second says a function was entered.
 *
 * ## WHAT THIS ORACLE DELIBERATELY DOES NOT CLAIM, and why that is a scope limit rather than a gap
 *
 * A construction can only be recognised when the callee is a type THIS TREE DECLARES. A call to a
 * type from another file is, from one tree, indistinguishable from a call to a function — and the
 * truth side is not allowed to guess, because a wrong truth row is worse than a missing one. So
 * this oracle is scoped to same-file constructions and says so, rather than emitting a confident row
 * it cannot support.
 *
 * That also means it will NOT agree with the analyzer on cross-file constructions IF the analyzer
 * claims them; the analyzer's own rule is the same one (`declaredTypes`, types named in this file),
 * so the two should agree, and where they do not, that is the finding.
 */
export type JuliaTypeEdge = { label: "extends" | "instantiates"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** The two operands of a `binary_expression`, skipping the operator — which is a NAMED child. */
function operands(n: any): { op: string; left: any | null; right: any | null } {
  const ks = kids(n).filter((c: any) => c.type !== "operator")
  return { op: (kids(n).find((c: any) => c.type === "operator")?.text ?? "").trim(), left: ks[0] ?? null, right: ks[ks.length - 1] ?? null }
}

/** The DECLARED name of a type head — the LEFTMOST name, never the first identifier found. */
function declaredName(node: any): string {
  const byField = node.childForFieldName?.("name")
  if (byField && byField.type === "identifier") return byField.text.trim()
  const head = kids(node).find((c: any) => c.type === "type_head")
  if (!head) return ""
  const leftmost = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier") return n.text.trim()
    if (n.type === "binary_expression") {
      const { left } = operands(n)
      return leftmost(left)
    }
    if (n.type === "where_expression" || n.type === "parenthesized_expression" ||
        n.type === "type_head" || n.type === "field_expression" ||
        n.type === "parametrized_type_expression") {
      return leftmost(kids(n)[0])
    }
    return ""
  }
  return leftmost(head)
}

/** The name a `type_head`'s SUPER TYPE names, or "" when there is none. */
function supertypeOf(head: any): string {
  const leftmost = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier") return n.text.trim()
    if (n.type === "binary_expression" || n.type === "where_expression" ||
        n.type === "parenthesized_expression" || n.type === "type_head" ||
        n.type === "field_expression" || n.type === "parametrized_type_expression") {
      return leftmost(kids(n)[0])
    }
    return ""
  }
  const scan = (n: any): string => {
    if (n.type === "binary_expression") {
      const { op, right } = operands(n)
      if (op === "<:" || op === ">:") return leftmost(right)
    }
    for (const c of kids(n)) {
      const hit = scan(c)
      if (hit) return hit
    }
    return ""
  }
  return scan(head)
}

/** The name a call's callee introduces; a qualified path is kept WHOLE. */
function calleeName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression" || n.type === "parametrized_type_expression") {
    const parts = kids(n).map((c: any) => calleeName(c)).filter((x: string) => x)
    return parts.length === 0 ? "" : parts[parts.length - 1]
  }
  if (n.type === "where_expression" || n.type === "parenthesized_expression" ||
      n.type === "typed_expression") {
    return calleeName(kids(n)[0])
  }
  return ""
}

/**
 * `extends` truth: type-declaration supertypes and `where`-clause parameter bounds.
 *
 * The `where` walk STOPS at a curly/parameter list rather than descending into it, because a bound
 * inside a struct's own type head belongs to its PARAMETER — `struct Circle{T<:Real} <: Shape`
 * contains `T<:Real`, and reading that as a relation on Circle is a false edge. The declared
 * supertype is on the type head's top level; the parameter bound is a different fact about a
 * different name.
 */
export function deriveJuliaExtendsTruth(root: any): JuliaTypeEdge[] {
  const out: JuliaTypeEdge[] = []
  const seen = new Set<string>()
  const add = (label: "extends", from: string, target: string) => {
    const f = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!f || !t || f === t) return
    const k = `${label}|${f}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label, from: f, target: t })
  }

  const visit = (node: any) => {
    // (1) A TYPE DECLARATION's supertype.
    if (node.type === "struct_definition" || node.type === "abstract_definition" ||
        node.type === "primitive_definition") {
      const head = kids(node).find((c: any) => c.type === "type_head")
      if (head) {
        const declared = declaredName(node)
        const sup = supertypeOf(head)
        if (declared && sup) add("extends", declared, sup)
      }
      // The type head's own parameter list is NOT descended into: `T<:Real` there bounds T.
      // Everything else in the struct still is.
      for (const c of kids(node)) if (c.type !== "type_head") visit(c)
      return
    }

    // (2) A `where` clause's parameter bounds — a subtype relation between two NAMES.
    if (node.type === "where_expression") {
      for (const c of kids(node)) {
        if (c.type !== "binary_expression") continue
        const { op, left, right } = operands(c)
        if (op !== "<:" && op !== ">:") continue
        const bound = calleeName(right)
        const param = left ? left.text.trim() : ""
        if (param && bound) add("extends", param, bound)
      }
    }

    for (const c of kids(node)) visit(c)
  }

  visit(root)
  return out
}

/**
 * `instantiates` truth: a call whose callee is a TYPE DECLARED IN THIS TREE.
 *
 * Scoped to same-file types deliberately — see the header. A cross-file construction is not
 * derivable from one tree, and the truth side must not guess.
 */
export function deriveJuliaInstantiatesTruth(root: any): JuliaTypeEdge[] {
  const out: JuliaTypeEdge[] = []
  const seen = new Set<string>()

  // Pass 1: the type names THIS tree declares.
  const types = new Set<string>()
  const collect = (n: any) => {
    if (n.type === "struct_definition" || n.type === "abstract_definition" ||
        n.type === "primitive_definition") {
      const name = declaredName(n)
      if (name) types.add(name)
    }
    for (const c of kids(n)) collect(c)
  }
  collect(root)
  if (types.size === 0) return out

  // Pass 2: calls to one of them. A qualified callee (`Base.Foo`) is matched on its LAST segment,
  // because that is the binding being constructed and the harness normalises targets the same way.
  const visit = (n: any) => {
    if (n.type === "call_expression") {
      // A CONSTRUCTOR DEFINITION is not a construction. `Int256(i::Int) = …` is a short-form
      // OUTER constructor and `function StringView{T}(data::T) where …` an INNER one; in both, the
      // `call_expression` naming the type is the DECLARATION of how to build it, not an invocation.
      // The first draft walked every `call_expression` and so reported
      // `instantiates Int256` and `instantiates StringView` for files that merely DECLARE those
      // constructors — 7 fabricated rows out of 57, and the analyzer was right on every one.
      //
      // This is the same distinction the lane's own fixture and mutants turned on: a definition is
      // spelled with the same node as an invocation, so the tree does not make it and the reader
      // must. Declared here by POSITION — a call that is the left-hand side of an assignment, or
      // that sits inside a `signature`, is a declaration.
      // The same wrapper chain applies to the DEFINITION test as to the name: `f(x) where {T} = …`
      // and `f(x)::T = …` both bury the call under `where_expression` / `typed_expression`, so
      // testing only the immediate parent classifies a PARAMETERISED constructor definition as a
      // construction — which is how `NoLengthDict{K,V}() where {K,V} = new(Dict{K,V}())` came to be
      // reported as `instantiates NoLengthDict` in a file that only ever DECLARES it.
      const WRAPPERS = new Set(["where_expression", "typed_expression", "parenthesized_expression"])
      let q: any = n.parent
      let inSignature = false
      let isDefinitionLHS = false
      for (let i = 0; q && i < 4; i++) {
        if (q.type === "signature") { inSignature = true; break }
        // Reaching an `assignment` by walking UP THROUGH WRAPPERS ONLY is itself the proof: this
        // call is transitively that assignment's left-hand side, i.e. a definition. Comparing
        // against `kids(assignment)[0]` was wrong, because that node is the `where_expression`, not
        // the call inside it — so `NoLengthDict{K,V}() where {K,V} = new(…)` kept reading as a
        // construction while the analyzer correctly declined it.
        if (q.type === "assignment") { isDefinitionLHS = true; break }
        if (!WRAPPERS.has(q.type)) break
        q = q.parent
      }
      if (!inSignature && !isDefinitionLHS) {
        const callee = calleeName(kids(n)[0])
        if (callee && types.has(callee)) {
          const k = `instantiates|${callee}`
          if (!seen.has(k)) {
            seen.add(k)
            out.push({ label: "instantiates", from: "", target: callee })
          }
        }
      }
    }
    for (const c of kids(n)) visit(c)
  }
  visit(root)
  return out
}