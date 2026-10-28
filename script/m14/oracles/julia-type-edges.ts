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
  /** The whole dotted name, not its first segment: `Documenter.Writer` is the supertype. */
  const typeName = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier" || n.type === "operator") return n.text.trim()
    if (n.type === "field_expression") {
      const parts = kids(n).map((c: any) => typeName(c)).filter((x: string) => x)
      return parts.join(".")
    }
    if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
        n.type === "parenthesized_expression" || n.type === "type_head" ||
        n.type === "curly_expression") {
      return typeName(kids(n)[0])
    }
    return ""
  }
  // THE HEAD'S OWN `<:`, NOT A COMPARISON INSIDE IT. This used to scan the head's subtree, which
  // made a `<:` in a supertype EXPRESSION look like a subtype: `struct S <: (S <: Real ? Any : Real)`
  // (`julia/test/typegroup.jl:665`) is a ternary whose CONDITION compares S with Real, and a
  // `where` chain (`(AbstractArray{T, N} where T <: Integer where N)`, `julia/test/errorshow.jl:1543`)
  // bounds T. Three of the corpus's 11 non-name supertype operands are those two shapes, and the
  // scan derived `S -> Real` and `Foo -> Integer` from them. The head's top-level node IS the
  // subtype declaration; the operand must NAME the type, and `typeName` refuses a block, a call, a
  // literal, a macro call, an interpolation and a ternary.
  const bin = kids(head).find((c: any) => c.type === "binary_expression")
  if (!bin) return ""
  const { op, right } = operands(bin)
  if (op !== "<:" && op !== ">:") return ""
  return typeName(right)
}

/**
 * The name a BOUND names, with a qualified path kept WHOLE.
 *
 * `calleeName` takes the LAST segment, which is right for a construction (`Foo.Bar()` builds `Bar`)
 * and wrong for a bound: `where {T <: Base.IEEEFloat}` bounds T by `Base.IEEEFloat`, and reporting
 * `IEEEFloat` made every qualified bound read as an unexplained analyzer row and a missing truth
 * row. A bound is a reference to a TYPE, and a type declared in a namespace is named by its path.
 */
function boundName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression") {
    const parts = kids(n).map((c: any) => boundName(c)).filter((x: string) => x)
    return parts.join(".")
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
      n.type === "parenthesized_expression" || n.type === "curly_expression") {
    return boundName(kids(n)[0])
  }
  if (n.type === "quote_expression") {
    const inner = kids(n)[0]
    if (inner?.type === "operator") return inner.text.trim()
    if (inner?.type === "parenthesized_expression") {
      const op = kids(inner)[0]
      if (op?.type === "operator") return op.text.trim()
    }
    return n.text.trim()
  }
  return ""
}

/** The name a call's callee introduces; a qualified path is kept WHOLE. */
/** The WHOLE dotted path a callee names (`a.b.C` stays `a.b.C`), for the qualifier test. */
function calleePath(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression") {
    const parts = kids(n).map((c: any) => calleePath(c)).filter((x: string) => x)
    return parts.join(".")
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
      n.type === "parenthesized_expression" || n.type === "typed_expression") {
    return calleePath(kids(n)[0])
  }
  return ""
}

/**
 * The ADJACENT subtype links of a `<:` / `>:` chain, with BOTH ends as NAMES.
 *
 * `a <: b <: c` parses as `(binary (binary a <: b) <: c)` and states TWO facts: `a <: b` and
 * `b <: c`. The earlier rule here read `left.text` and published the edge `a <: b -> c`, so the
 * truth side carried a SOURCE FRAGMENT — and the analyzer carried the same defect, which is why
 * the two agreed and the direct oracle reported the row as a convention difference rather than
 * as both sides being wrong. MEASURED whole-population 2026-10-28: 25 of 25 unexplained `extends`
 * rows had a fragment source (`LB <: X`, `X <: f()`, `S <: V`) or a doubled target (`UB.UB`).
 *
 * A bound that is not a nameable type (a call, a literal) contributes NO link, by the same refusal
 * the analyzer applies: `A where X <: f() <: Z` is a lowering error, and naming `f` as a supertype
 * would invent a relation the source rejects.
 */
function subtypeChain(n: any): { from: string; to: string; at: any }[] {
  const out: { from: string; to: string; at: any }[] = []
  const link = (left: any, right: any, at: any) => {
    const from = calleePath(left)
    const to = boundName(right)
    if (from && to && from !== to) out.push({ from, to, at })
  }
  const walk = (node: any) => {
    if (!node || node.type !== "binary_expression") return
    const { op, left, right } = operands(node)
    if (op !== "<:" && op !== ">:") return
    let fromNode = left
    if (left && left.type === "binary_expression") {
      const inner = operands(left)
      if (inner.op === "<:" || inner.op === ">:") {
        walk(left)
        fromNode = inner.right
      }
    }
    link(fromNode, right, node)
  }
  walk(n)
  return out
}

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
 * A bound inside a struct's own type head belongs to its PARAMETER — `struct Circle{T<:Real} <: Shape`
 * contains `T<:Real`, and reading that as a relation on Circle is a false edge. The declared
 * supertype is on the type head's top level; the parameter bound is a different fact about a
 * different name. `collectHeadBounds` derives those parameter bounds, and `headWhereBounds` derives
 * the `where` bounds on the SUPERTYPE side (`… where {X,Y<:T}` inside a supertype's argument), which
 * are bounds on the supertype expression's own type variables and were not derived at all before.
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

  /** Bounds written inside a curly parameter list: `T<:Real`, `T>:Int`. */
  const boundsInCurly = (curly: any) => {
    for (const b of kids(curly)) {
      for (const l of subtypeChain(b)) add("extends", l.from, l.to)
    }
  }
  /**
   * Every parameter bound under a type head, at any depth.
   *
   * `struct DataFrameRows{D<:AbstractDataFrame} <: AbstractVector{…}` wraps the declared name in a
   * `parametrized_type_expression` on the LEFT of the head's binary expression, so the curly is
   * never a DIRECT child of the head — the earlier loop looked for one there, found only the binary
   * expression, and derived no bound at all for the single most common bounded-type spelling in
   * Julia. Every `D`/`Fwd`/`O`/`V`/`S` in the cross-check was this shape.
   */
  const collectHeadBounds = (n: any) => {
    if (n.type === "curly_expression") {
      boundsInCurly(n)
      return
    }
    for (const c of kids(n)) collectHeadBounds(c)
  }
  /**
   * `where` bounds written INSIDE a type head, on the SUPERTYPE side.
   *
   * `struct T54757{A>:Int,N} <: AbstractArray{Tuple{… Vararg{Y,N}} where {X,Y<:T54757}, N}`
   * (`julia/test/core.jl:6097`) states a bound on `Y` — a type variable of the UnionAll that is the
   * supertype's first ARGUMENT — and the earlier walk SKIPPED the whole head
   * (`if (c.type !== "type_head") visit(c)`), so that bound was not derived. MEASURED on the
   * whole population: this was the last truth-side MISSING row of `extends` after the chain fix,
   * and the analyzer had it, which is the direction a truth gap points: the analyzer was right and
   * this oracle was silent.
   *
   * The walk is confined to `where_expression` nodes. A bound written directly in a parameter list
   * is `collectHeadBounds`' business, above, and a `where`'s own bound binary is the same shape the
   * generic rule (2) matches, so the two derivations agree by construction and the dedup `seen` set
   * absorbs any overlap.
   */
  /**
   * The links a `where` clause states — or none, when the clause wraps a COMPARISON.
   *
   * POSITION IS THE DISCRIMINATOR, measured on the pinned grammar. A real bound is the where's
   * LAST named child (`f(x::T) where T<:Real` → `(where_expression (call) (binary T<:Real))`), or a
   * member of a last curly (`where {T<:Real}`). A comparison gets the mirror shape — the binary
   * comes FIRST and the type variable after it:
   *
   *   @test X <: Ref{Tuple{…}} where S      -> (where_expression (binary X<:Ref{…}) (identifier S))
   *
   * The earlier rule read ANY binary below a where, so the truth side fabricated `X -> Ref`
   * (`julia/test/subtype.jl:1588`), `I -> Tuple` (:1761) and `J -> Tuple` (:1762) — and the
   * analyzer agreed until its own scan was position-checked, which is exactly how a shared mistake
   * hides: the two sides agreed on rows neither should have had. MEASURED after the analyzer fix:
   * those five truth rows were the label's whole MISSING set on the residual files.
   *
   * THE ONE EXCEPTION IS A PARAMETER LIST. `Pair{N, S} where {N, NTuple{N,Int}<:S<:NTuple{M,Int}
   * where {M}}` (`subtype.jl:2939`) puts a chain FIRST and its own braces LAST, because the `where`
   * scopes only `{M}` and the chain is a BOUND on S — it sits inside an outer curly parameter list.
   * The `where` is then a member of that list, and the chain is a bound rather than a value.
   */
  const whereBoundLinks = (w: any): { from: string; to: string; at: any }[] => {
    const out: { from: string; to: string; at: any }[] = []
    const ws = kids(w)
    const last = ws[ws.length - 1]
    const inParamList = w.parent?.type === "curly_expression"
    for (const c of ws) {
      if (c.type === "binary_expression") {
        if (c !== last && !inParamList) continue
        out.push(...subtypeChain(c))
      } else if (c.type === "curly_expression") {
        for (const b of kids(c)) out.push(...subtypeChain(b))
      }
    }
    return out
  }

  const headWhereBounds = (n: any) => {
    if (n.type === "where_expression") {
      for (const l of whereBoundLinks(n)) add("extends", l.from, l.to)
    }
    for (const c of kids(n)) headWhereBounds(c)
  }
  const visit = (node: any) => {
    // (1) A TYPE DECLARATION's supertype, plus the bounds on its TYPE PARAMETERS.
    if (node.type === "struct_definition" || node.type === "abstract_definition" ||
        node.type === "primitive_definition") {
      const head = kids(node).find((c: any) => c.type === "type_head")
      if (head) {
        const declared = declaredName(node)
        const sup = supertypeOf(head)
        if (declared && sup) add("extends", declared, sup)
        // `struct SimpleEdge{T<:Integer} <: AbstractSimpleEdge{T}` has TWO subtype facts: the
        // declaration's supertype and the parameter's upper bound. The bound's source is `T`, not
        // `SimpleEdge` — reading it as the type would say SimpleEdge <: Integer, which is false.
        collectHeadBounds(head)
        headWhereBounds(head)
      }
      // The type head's own surface is handled above. Everything else in the struct still is.
      for (const c of kids(node)) if (c.type !== "type_head") visit(c)
      return
    }

    // (2) A `where` clause's parameter bounds. The RULE for which shape is a bound rather than a
    // comparison lives in `whereBoundLinks`, because a `where` around a test comparison and a
    // `where` around a bound chain differ only in the operand's position.
    if (node.type === "where_expression") {
      for (const l of whereBoundLinks(node)) add("extends", l.from, l.to)
    }

    // (3) A bounded parameter on a parametrized type outside a `where`: `f{T<:Real}(x)`. The
    // bound is on T, not on the callee, so it is its own edge.
    if (node.type === "parametrized_type_expression") {
      for (const c of kids(node)) if (c.type === "curly_expression") boundsInCurly(c)
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

  // Pass 1: the type names THIS tree declares, and its MODULES.
  //
  // The module set is what keeps a QUALIFIED call honest: `atinvokelatest.Xs(...)` in
  // `julia/test/misc.jl` constructs this file's `Xs`, while `Dates.DateTime(...)` in
  // `base/toml/parser.jl` constructs DATES' type and only shares a leaf with the internal
  // `struct DateTime` the same file declares. Matching on the last segment alone turned the second
  // into a same-file construction — which is exactly the kind of plausible wrong row an oracle is
  // supposed to refuse.
  const types = new Set<string>()
  const modules = new Set<string>()
  const collect = (n: any) => {
    if (n.type === "struct_definition" || n.type === "abstract_definition" ||
        n.type === "primitive_definition") {
      const name = declaredName(n)
      if (name) types.add(name)
    }
    if (n.type === "module_definition" || n.type === "baremodule_definition") {
      const byField = n.childForFieldName?.("name")
      const nm = byField ?? kids(n)[0]
      const m = nm ? String(nm.text ?? "").trim() : ""
      if (m) modules.add(m)
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
        // Reaching an `assignment` by walking UP THROUGH WRAPPERS ONLY is NOT enough to call this
        // a definition: a constructor call on the RIGHT of `x = Foo(…)` has the same ancestors.
        // The call is a declaration only when it is inside the assignment's LEFT subtree.
        if (q.type === "assignment") {
          let lhs: any = kids(q)[0]
          for (let d = 0; lhs && d < 4; d++) {
            if (lhs.id === n.id) { isDefinitionLHS = true; break }
            if (!WRAPPERS.has(lhs.type)) break
            lhs = kids(lhs)[0]
          }
          break
        }
        if (!WRAPPERS.has(q.type)) break
        q = q.parent
      }
      if (!inSignature && !isDefinitionLHS) {
        const calleeNode = kids(n)[0]
        const callee = calleeName(calleeNode)
        const full = calleePath(calleeNode)
        const dot = full.indexOf(".")
        const isLocalCtor = dot > 0
          ? modules.has(full.slice(0, dot)) && types.has(callee)
          : !!callee && types.has(callee)
        if (isLocalCtor) {
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