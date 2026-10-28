/**
 * The Julia `calls` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason its siblings record: that shared file
 * is edited by several lanes at once, and every line a lane keeps out of it is a line that cannot
 * conflict. Wiring it in is one import and one registration.
 *
 * Written from JULIA'S OWN DISPATCH RULE and sharing no rule table, key set or resolver with
 * `RealJuliaAnalyzer`.
 *
 * ## Why this is the biggest oracle in the lane
 *
 * `calls` is by a wide margin the largest relationship this analyzer publishes: **85,921 edges over
 * 941 corpus files**, against 10,365 `contains`, 33k `references` and 15k `uses`. Until now it was
 * also the largest UNCORROBORATED surface in the lane, because F5's label allowlist did not admit
 * `calls` for julia at all — so those edges were not merely unexplained, they were not being looked
 * at. An edge that is never compared is not a claim, and it is not a gap either; it is invisible, and
 * invisible is the one state a differential exists to end.
 *
 * ## The rule
 *
 * A `calls` edge says an EXPRESSION was invoked. That is derivable from one tree, which is the whole
 * reason this oracle is possible: the syntax of an invocation is present in the file regardless of
 * where the callee is defined. So the rule is:
 *
 *   1. A `call_expression` whose callee is a TYPE declared in this tree is a construction
 *      (`instantiates`), not a call, and is EXCLUDED here.
 *   2. Any other `call_expression` — one whose callee is a function declared here, one declared
 *      elsewhere, one that is a `Base`/`Core` builtin this oracle cannot see — IS a call.
 *   3. A MACRO invocation is a call to the macro: `@view A[1]` calls `view`.
 *   4. A `ccall` / `@ccall` target is a call to a FOREIGN symbol. It is still a call, and it is
 *      still in this label; what makes it foreign is metadata on the edge, not a different relation.
 *
 * ## The boundary that matters
 *
 * A CALL and a DEFINITION are spelled with the same node. `f(x) = …` and `f(x)` are both
 * `call_expression`, and `function f(x) … end` puts the same node inside a `signature`. Counting
 * declarations as invocations is the single easiest way to be wrong here, and it was this lane's own
 * JUL-4 defect at scale: 2,502 false self-calls across a 200-file sample before the declaration-site
 * set existed. A `calls` oracle that counted them would have agreed with the broken analyzer and
 * disagreed with the fixed one — two implementations wrong together, which is the J3 failure a
 * differential cannot catch by construction and the reason the rule is stated before the code.
 *
 * The test is POSITIONAL, because the tree offers nothing else: a call is a definition when it is
 * the left-hand side of an assignment (reached through `where`/`typed`/parenthesized wrappers) or
 * when it sits inside a `signature`.
 *
 * ## What this oracle does NOT claim
 *
 * It does not resolve the callee, so it does not claim that a call target is a FUNCTION rather than a
 * constant or a type from another module. It claims only that the file invokes something at that
 * name. That is a smaller claim than the analyzer's, and the gap is where the remaining
 * `unexplained` rows live — which is the correct place for them.
 */
export type JuliaCallsEdge = { label: "calls"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

const WRAPPERS = new Set(["where_expression", "typed_expression", "parenthesized_expression"])

/** Does this text carry whitespace, i.e. is it a source SPAN rather than a spelling? */
const hasLayout = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) return true
  }
  return false
}

/** The name a call's callee introduces; a qualified path is kept WHOLE. */
export function juliaCalleeName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression") {
    // A dotted path: `Core.Intrinsics.bitcast` is (receiver)(member), left-nested. The WHOLE path
    // is kept, because the analyzer publishes the path and collapsing it to the last segment made
    // every qualified call read as an unexplained analyzer edge plus a missing truth edge. Measured
    // on the 40-file draw: 294 unexplained calls, of which `Changelog.generate` was the first.
    const parts = kids(n).map((c: any) => juliaCalleeName(c)).filter((x: string) => x)
    return parts.join(".")
  }
  // `macro_identifier` is `@name` wrapped around an identifier. Its name is the identifier, and
  // the `@` is the sigil rather than part of the binding. The first version had no case for the
  // wrapper, so `@__DIR__` — the most ordinary macro call in the language — derived nothing.
  if (n.type === "macro_identifier") return juliaCalleeName(kids(n)[0])
  // An OPERATOR is a callable value in Julia: `==(v)`, `!(x)`, `+(a, b)`. It is a named child of
  // the call_expression and has no identifier inside, so the first version derived nothing for it.
  if (n.type === "operator") return n.text.trim()
  // A QUOTED OPERATOR names the operator, and the `:`/parens are syntax rather than the name:
  // `Base.:(==)(x, y) = …` declares `Base.==`, the same binding the call sites spell `==`. Without
  // this case the member resolved to "" and the whole path collapsed to `Base` — the module — which
  // then read as a decorated declaration named after its namespace rather than after the method.
  if (n.type === "quote_expression") {
    const inner = kids(n)[0]
    if (inner?.type === "operator") return inner.text.trim()
    if (inner?.type === "parenthesized_expression") {
      const op = kids(inner)[0]
      if (op?.type === "operator") return op.text.trim()
    }
    // A TEXT WITH LAYOUT IS A SPAN, NOT A NAME. The grammar reads `1 : length(Bc) - 1` as a call
    // whose callee is the quote `": length"` — a range that got parsed as a quoted-symbol call — and
    // publishing that span demands a `calls` row for a name the source never writes. The analyzer
    // refuses a span (its key-publication rule), so the truth side must too, or the oracle asks for an
    // edge that cannot honestly exist. 5 of the 8 `calls` MISSING rows on a 200-file draw were this
    // exact shape (`": length"`, `": Position"`, `": step : UInt"`).
    return hasLayout(n.text) ? "" : n.text.trim()
  }
  // `var"@enum"(…)` is a call to a binding whose legal name is a var-string. A prefixed string
  // with any OTHER prefix (`MIME"text/html"`) is a string-macro construction, not a call to a
  // binding; the analyzer emits that too, but the shared target filter removes the quote-bearing
  // target, so the truth side must not demand it.
  if (n.type === "prefixed_string_literal") {
    const t = n.text.trim()
    return t.startsWith('var"') ? t : ""
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
      n.type === "parenthesized_expression" || n.type === "typed_expression") {
    return juliaCalleeName(kids(n)[0])
  }
  return ""
}

/** The declared name of a type head — the LEFTMOST name, never the first identifier found. */
function typeDeclaredName(node: any): string {
  const head = kids(node).find((c: any) => c.type === "type_head")
  if (!head) return ""
  const leftmost = (n: any): string => {
    if (!n) return ""
    if (n.type === "identifier") return n.text.trim()
    if (n.type === "binary_expression") {
      const ks = kids(n).filter((c: any) => c.type !== "operator")
      return leftmost(ks[0])
    }
    if (WRAPPERS.has(n.type) || n.type === "type_head" || n.type === "field_expression" ||
        n.type === "parametrized_type_expression") {
      return leftmost(kids(n)[0])
    }
    return ""
  }
  return leftmost(head)
}

/** Is this `call_expression` inside the LEFT-HAND SIDE of an assignment? */
function insideLHS(n: any): boolean {
  let q: any = n.parent
  for (let i = 0; q && i < 4; i++) {
    if (q.type === "assignment") {
      // Compare the LHS SUBTREE, not `kids(assignment)[0]`: with `f(x) where {T} = …` or `f(x)::T = …`
      // the first child is a `where_expression`/`typed_expression` and the call is inside it.
      let lhs: any = kids(q)[0]
      for (let d = 0; lhs && d < 4; d++) {
        if (lhs.id === n.id) return true
        if (!WRAPPERS.has(lhs.type)) break
        lhs = kids(lhs)[0]
      }
      return false
    }
    if (q.type === "signature") return true
    if (!WRAPPERS.has(q.type)) return false
    q = q.parent
  }
  return false
}

export function deriveJuliaCallsTruth(root: any): JuliaCallsEdge[] {
  const out: JuliaCallsEdge[] = []
  const seen = new Set<string>()
  const includeShadowOwners = collectIncludeOwners(root)

  // Types declared in THIS tree — a call to one of them is `instantiates`, not `calls` — and the
  // MODULES it declares, because a qualified constructor is same-file only when its qualifier is
  // one of them. `atinvokelatest.Xs(...)` constructs this file's `Xs`; `Dates.DateTime(...)` in
  // `base/toml/parser.jl` constructs Dates' type and merely shares a leaf with the internal
  // `struct DateTime` in the same file. With the leaf alone the first was demanded as a call beside
  // the analyzer's instantiation and the second as a call the analyzer had classified as an
  // instantiation — 7 missing `calls` rows on a 200-file draw, from one too-simple test.
  const types = new Set<string>()
  const modules = new Set<string>()
  const collect = (n: any) => {
    if (n.type === "struct_definition" || n.type === "abstract_definition" ||
        n.type === "primitive_definition") {
      const name = typeDeclaredName(n)
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
  /** Is this callee a construction of a type THIS FILE declares? */
  const isLocalConstruction = (callee: string): boolean => {
    if (types.has(callee)) return true
    const dot = callee.indexOf(".")
    if (dot <= 0) return false
    const qualifier = callee.slice(0, dot)
    const leaf = callee.slice(callee.lastIndexOf(".") + 1)
    return modules.has(qualifier) && types.has(leaf)
  }

  const add = (target: string) => {
    const t = String(target ?? "").trim()
    if (!t) return
    // The harness normalises targets to their last segment, and this oracle emits unique
    // (label, target) rows per file to mirror that: the analyzer side is collapsed the same way, and
    // one edge counted twice on one side and once on the other makes a number incomparable.
    const k = `calls|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "calls", from: "", target: t })
  }

  const visit = (n: any) => {
    // (3) A macro invocation calls the macro. `macro_identifier` is `@name` in the tree; the `@` is
    // the sigil, not part of the binding, so it is stripped — a node-name mismatch between the two
    // sides would otherwise make every macro call read as a miss.
    //
    // A macro that WRAPS A DECLARATION is `decorates`, not `calls`: the analyzer publishes the
    // decorated declaration -> decorator edge and deliberately does NOT also publish a call to the
    // macro. `@kwdef struct S` was the first row of the 40-file draw's missing set, which is the
    // tell that the two labels must be disjoint here.
    if (n.type === "macrocall_expression") {
      if (!wrapsNamedDeclaration(n)) {
        const m = kids(n).find((c: any) => c.type === "macro_identifier")
        if (m) add(juliaCalleeName(m))
      }
    }

    // (1)(2) An invocation, unless it is a definition, a construction of a local type, or a
    // STATIC `include("path")`. The last exclusion is the one the ontology added: `include` with a
    // literal path is `part_of` in the analyzer (the file shares the including module's scope), so
    // the truth side must not demand a `calls -> include` row for it. The old oracle did, and the
    // whole-population direct check reported those as MISSING analyzer edges — 109 MISSING on the
    // 200-file draw, of which `calls -> include` was the first sample. A DYNAMIC include
    // (`include(x)`, `include(joinpath(...))`) still derives `calls`, because the analyzer publishes
    // exactly that.
    // `sqrt.(v)` is a broadcast invocation and `A'` is a call to `adjoint`; neither is a
    // `call_expression`, so a calls oracle that only knows that node misses both. The analyzer
    // publishes them as ordinary calls, because a consumer asking who calls `sqrt` should not have
    // to know about broadcasting. Measured: `abs.(strides)` was the last unexplained call on the
    // 40-file draw.
    if (n.type === "broadcast_call_expression" && !insideLHS(n)) {
      const callee = juliaCalleeName(kids(n)[0])
      if (callee) add(callee)
    }
    if (n.type === "adjoint_expression" && kids(n).length === 1) add("adjoint")

    if (n.type === "call_expression" && !insideLHS(n) && !(isStaticInclude(n) && !isShadowedInclude(n, includeShadowOwners))) {
      const callee = juliaCalleeName(kids(n)[0])
      if (callee && !isLocalConstruction(callee)) add(callee)
      // `ccall(:jl_foo, …)` names a C symbol. The analyzer publishes it as its OWN `calls` edge
      // (so two ccall sites to different symbols do not collapse into one), and the C symbol is
      // the callable the source names — a fact this oracle can read from the first argument.
      if (callee === "ccall") {
        const args = kids(n).find((c: any) => c.type === "argument_list")
        const first = args ? kids(args)[0] : null
        const q = first && first.type === "tuple_expression" ? kids(first)[0] : first
        if (q && q.type === "quote_expression") {
          const t = q.text.trim()
          add(t.startsWith(":") ? t.slice(1) : t)
        }
      }
    }

    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}

/**
 * Does this macro call wrap a declaration it can NAME? The decorated forms are the long-form
 * type/function definitions and the short-form `f(x) = …`, reached through the macro's argument list.
 *
 * This is a separate derivation from the analyzer's `decoratedDeclarations`: the fact being
 * recognised is the one the language states (a macro applied to a declaration), not a rule table
 * copied from the emitter.
 *
 * WHY THE NAME MATTERS. A macro applied to a declaration is `decorates` and NOT `calls`, because the
 * edge's source is the decorated declaration and the macro's application is what the row says. But a
 * declaration whose name is not written in the tree has no source to attribute the application to:
 * `@eval $op(x::A, y::A) = …` and `@kwdef struct $(esc(:Struct))` are generated by a runtime value.
 * The analyzer publishes `calls -> op-macro` there — the macro IS invoked, which is a fact the file
 * states — and the oracle used to suppress it and report those four rows as unexplained edges. So
 * the suppression is conditioned on a name existing, which is exactly the condition that lets a
 * `decorates` row be published at all.
 */
function wrapsNamedDeclaration(call: any): boolean {
  const declarations = new Set([
    "function_definition", "macro_definition", "struct_definition",
    "abstract_definition", "primitive_definition", "module_definition",
  ])
  /** The name a declaration argument carries, or "" when the tree does not spell one. */
  const declaredNameIn = (n: any): string => {
    if (n.type === "function_definition" || n.type === "macro_definition") {
      const sig = kids(n).find((c: any) => c.type === "signature")
      let cur: any = sig ? kids(sig)[0] : null
      for (let i = 0; i < 4 && cur; i++) {
        if (cur.type === "call_expression") {
          const callee = kids(cur)[0]
          // `function @main(args)` — the callable is a MACROCALL and the binding it declares is the
          // macro's name, which is the spelling the analyzer publishes.
          if (callee && callee.type === "macrocall_expression") {
            const m = kids(callee).find((c: any) => c.type === "macro_identifier")
            return m ? juliaCalleeName(m) : ""
          }
          return callee ? juliaCalleeName(callee) : ""
        }
        if (cur.type === "where_expression" || cur.type === "typed_expression" ||
            cur.type === "parenthesized_expression") { cur = kids(cur)[0]; continue }
        break
      }
      return ""
    }
    if (n.type === "struct_definition" || n.type === "abstract_definition" || n.type === "primitive_definition") {
      return typeDeclaredName(n)
    }
    if (n.type === "module_definition" || n.type === "baremodule_definition") {
      const byField = n.childForFieldName?.("name")
      const nm = byField ?? kids(n)[0]
      return nm ? String(nm.text ?? "").trim() : ""
    }
    return ""
  }
  const isShortDefinition = (n: any): boolean => {
    if (n.type !== "assignment") return false
    let lhs = kids(n)[0]
    for (let i = 0; i < 4 && lhs; i++) {
      if (lhs.type === "call_expression") return true
      if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
          lhs.type === "parenthesized_expression") {
        lhs = kids(lhs)[0]
        continue
      }
      return false
    }
    return false
  }
  // DIRECT arguments only. A macro that wraps a block containing a function declaration is not
  // applying itself TO that declaration — `@testset` is the common case, and scanning arbitrarily
  // deep would turn every test block into a decorator edge.
  const args = kids(call).find((c: any) => c.type === "macro_argument_list")
  if (!args) return false
  for (const n of kids(args)) {
    if (declarations.has(n.type)) {
      if (declaredNameIn(n)) return true
      continue
    }
    if (isShortDefinition(n)) {
      // A callee the tree cannot spell — `$op(x) = …`, `($fname)(x) = …` — leaves no name to
      // attribute the application to, so there is no `decorates` row and the invocation stands as the
      // `calls` edge the analyzer publishes. Asking `juliaCalleeName` rather than testing node kinds
      // is what covers the parenthesised spelling: the interpolation is wrapped, and a type test on
      // the immediate callee missed it and suppressed a call the analyzer had every reason to emit.
      let lhs = kids(n)[0]
      for (let i = 0; i < 4 && lhs; i++) {
        if (lhs.type === "call_expression") {
          const callee = kids(lhs)[0]
          if (callee && !juliaCalleeName(callee)) break
          return true
        }
        if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
            lhs.type === "parenthesized_expression") { lhs = kids(lhs)[0]; continue }
        break
      }
    }
  }
  return false
}

/** The declared name of a callable/type/module, for the shadow-scope test. */
function declaredScopeName(n: any): string {
  if (n.type === "function_definition" || n.type === "macro_definition") {
    const sig = kids(n).find((c: any) => c.type === "signature")
    let s = sig ? kids(sig)[0] : null
    for (let i = 0; i < 4 && s; i++) {
      if (s.type === "call_expression") return juliaCalleeName(kids(s)[0])
      if (s.type === "where_expression" || s.type === "typed_expression" ||
          s.type === "parenthesized_expression") { s = kids(s)[0]; continue }
      break
    }
    return ""
  }
  if (n.type === "struct_definition" || n.type === "abstract_definition" ||
      n.type === "primitive_definition") return typeDeclaredName(n)
  if (n.type === "module_definition" || n.type === "baremodule_definition") {
    const byField = n.childForFieldName?.("name")
    const nm = byField ?? kids(n)[0]
    return nm ? String(nm.text ?? "").trim() : ""
  }
  if (n.type === "assignment") {
    let lhs = kids(n)[0]
    for (let i = 0; i < 4 && lhs; i++) {
      if (lhs.type === "call_expression") return juliaCalleeName(kids(lhs)[0])
      if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
          lhs.type === "parenthesized_expression") { lhs = kids(lhs)[0]; continue }
      break
    }
  }
  return ""
}

/** Scopes that declare a binding named `include`; "" is file scope and shadows everything. */
function collectIncludeOwners(root: any): Set<string> {
  const owners = new Set<string>()
  const walk = (n: any, scope: string) => {
    const declared = declaredScopeName(n)
    if (declared === "include") owners.add(scope)
    const next = declared || scope
    for (const c of kids(n)) walk(c, next)
  }
  walk(root, "")
  return owners
}

/** The nearest enclosing declaration scope of a node, or "" at file scope. */
function enclosingScopeName(n: any): string {
  let cur = n.parent ?? null
  for (let i = 0; cur && i < 48; i++) {
    const d = declaredScopeName(cur)
    if (d) return d
    cur = cur.parent ?? null
  }
  return ""
}

function isShadowedInclude(n: any, owners: Set<string>): boolean {
  if (owners.size === 0) return false
  const scope = enclosingScopeName(n)
  return [...owners].some((owner) => owner === "" || scope === owner || scope.startsWith(owner + "."))
}

/**
 * `include("path")` with ONE literal string and no interpolation/escape is the `part_of` form.
 *
 * The analyzer's `includePart` states the same rule from the other side: a string with an
 * interpolation or escape sequence is not the bytes of a path, so it stays a dynamic call. The
 * oracle repeats the test independently rather than importing the analyzer's helper.
 */
function isStaticInclude(node: any): boolean {
  const callee = kids(node)[0]
  if (!callee || juliaCalleeName(callee) !== "include") return false
  const args = kids(node).find((c: any) => c.type === "argument_list")
  if (!args) return false
  const first = kids(args)[0]
  if (!first || first.type !== "string_literal") return false
  for (const c of kids(first)) {
    if (c.type === "string_interpolation" || c.type === "escape_sequence") return false
  }
  return first.text.startsWith("\"") || first.text.startsWith("\"\"\"")
}
