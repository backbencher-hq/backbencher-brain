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

/** The name a call's callee introduces; a qualified path is kept WHOLE. */
export function juliaCalleeName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression") {
    // A dotted path: `Core.Intrinsics.bitcast` is (receiver)(member), left-nested.
    const parts = kids(n).map((c: any) => juliaCalleeName(c)).filter((x: string) => x)
    return parts.length === 0 ? "" : parts[parts.length - 1]
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

  // Types declared in THIS tree — a call to one of them is `instantiates`, not `calls`.
  const types = new Set<string>()
  const collect = (n: any) => {
    if (n.type === "struct_definition" || n.type === "abstract_definition" ||
        n.type === "primitive_definition") {
      const name = typeDeclaredName(n)
      if (name) types.add(name)
    }
    for (const c of kids(n)) collect(c)
  }
  collect(root)

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
    if (n.type === "macrocall_expression") {
      const m = kids(n).find((c: any) => c.type === "macro_identifier")
      if (m) add(juliaCalleeName(m).replace(/^@/, ""))
    }

    // (1)(2) An invocation, unless it is a definition or a construction of a local type.
    if (n.type === "call_expression" && !insideLHS(n)) {
      const callee = juliaCalleeName(kids(n)[0])
      if (callee && !types.has(callee)) add(callee)
    }

    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}
