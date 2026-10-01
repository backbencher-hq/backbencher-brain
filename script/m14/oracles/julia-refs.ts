/**
 * The Julia `uses` + `references` oracles — LANE-OWNED.
 *
 * Written from Julia's own scoping rules and sharing no rule table, key set or resolver with
 * `RealJuliaAnalyzer`. Like its siblings, it lives outside `differential.ts` because that file is
 * edited by several lanes at once and a lane that keeps lines out of it keeps conflicts out of it.
 *
 * ## Why these two, and what they are actually worth
 *
 * `uses` (15,499 edges) and `references` (33,938) are the last two structural labels this lane
 * publishes without independent truth. They are worth writing for a reason that is easy to miss:
 * they are SMALL and DERIVABLE, which is not a compliment.
 *
 * `uses` here is deliberately narrow. It is not "every identifier read" — that would need scope and
 * binding analysis and could not be derived from one tree. It is **a member read of a value**, and
 * that is a syntactic fact: `a.b` reads the member `b` of something. The lane publishes 4,265
 * `property` symbols against it.
 *
 * `references` is a reference to a TYPE or a NAMESPACE: the type in an annotation, the base of a
 * parameterised type, a dotted namespace path, and an `using`/`import` target.
 *
 * ## The boundary both oracles turn on
 *
 * **Julia spells namespace access and field access identically.** `Base.show` and `obj.field` are
 * the same `field_expression` node, and nothing in the tree says which it is. The rule used here is
 * syntactic and is stated rather than assumed, because the alternative is guessing:
 *
 *   - a NESTED `field_expression` (receiver is itself a `field_expression`) is a NAMESPACE PATH and
 *     becomes ONE `references` edge to the whole dotted name;
 *   - a SINGLE-LEVEL `field_expression` is a MEMBER READ and becomes `uses` to the member alone.
 *
 * Measured behind that choice: 72 bare segments across 400 corpus files are reachable by more than
 * one distinct dotted path, so collapsing a path to its last segment fuses unrelated bindings — and
 * the whole path is kept for exactly that reason. The corollary is that the member of a namespace
 * path is NOT also published as a `uses` edge, which would rebuild the same ambiguity by the back
 * door.
 */
export type JuliaRelEdge = { label: "uses" | "references"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** A dotted path, left-nested, as text. Used for the WHOLE-path `references` edge. */
function pathText(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "quote_expression" || n.type === "operator") return n.text.trim()
  if (n.type === "field_expression" || n.type === "parametrized_type_expression") {
    const parts = kids(n).map((c: any) => pathText(c)).filter((x: string) => x)
    if (parts.length === 0) return ""
    if (n.type === "field_expression") return parts.join(".")
    return parts[0]
  }
  if (n.type === "where_expression" || n.type === "parenthesized_expression" ||
      n.type === "typed_expression" || n.type === "curly_expression") {
    return pathText(kids(n)[0])
  }
  return ""
}

/** The name a type annotation names. `typed_expression` is POSITIONAL: name first, type second. */
function annotationTypeName(n: any): string {
  if (!n) return ""
  if (n.type === "typed_expression") return pathText(kids(n)[1])
  return ""
}

/** `using X` / `import X` / `import X: a, b` — the module named, path kept whole. */
function importModuleName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "field_expression" || n.type === "import_path" || n.type === "as_expression") {
    const parts = kids(n).map((c: any) => importModuleName(c)).filter((x: string) => x)
    if (parts.length === 0) return n.text.trim().split(":")[0]!.trim()
    return n.type === "field_expression" ? parts.join(".") : parts[0]
  }
  return ""
}

/**
 * `uses` truth: a member read of a VALUE.
 *
 * Single-level `field_expression` only. A nested one is a namespace path and belongs to
 * `references`; emitting its member here too would publish a bare `uses -> bitcast` beside
 * `references -> Core.Intrinsics.bitcast`, which reads as an independent read of a variable named
 * `bitcast` that does not exist.
 */
export function deriveJuliaUsesTruth(root: any): JuliaRelEdge[] {
  const out: JuliaRelEdge[] = []
  const seen = new Set<string>()

  const visit = (n: any) => {
    if (n.type === "field_expression") {
      const receiver = n.childForFieldName("value")
      const member = kids(n)[kids(n).length - 1]
      // "Is the receiver a field_expression" is NOT the test. In `Compiler.InferenceParams.definitions`
      // the MIDDLE link has an identifier receiver and looks single-level, so the first version
      // published `uses -> InferenceParams` and `uses -> AbstractInterpreter` for what is one
      // namespace path — 700 of 758 truth rows mismatched, a 7.7% agreement rate that looked like a
      // catastrophic analyzer defect and was an oracle bug.
      //
      // The test that holds is ANCESTRAL: if ANY ancestor is a `field_expression`, this node is an
      // inner link of a namespace path and its member is not a member read at all. Checking only the
      // immediate receiver catches the outer link and misses every one beneath it, which is the
      // worst way to be wrong — it produces a plausible answer for the easy case.
      let anc: any = n.parent
      let inNamespacePath = false
      for (let i = 0; anc && i < 6; i++) {
        if (anc.type === "field_expression") { inNamespacePath = true; break }
        anc = anc.parent
      }
      // BOTH tests are needed, and each catches a link the other misses. The OUTERMOST node of a
      // namespace path is identified by its nested RECEIVER (`Compiler.AbstractInterpreter` — the
      // receiver `Compiler` is itself a field_expression, and this node has no field_expression
      // ancestor because nothing is above it). The INNER links are identified by their ANCESTOR
      // (`Compiler.transform_result_for_cache` inside `Compiler.AbstractInterpreter.foo`: the middle
      // node's receiver is the plain identifier `Compiler`, so the receiver test passes and only the
      // ancestor test catches it).
      //
      // One test alone gives a plausible answer for the easy case and a wrong one for the rest: the
      // receiver-only version published 700 false member reads per 40 files, and the ancestor-only
      // version then published the outermost links. The two are not alternatives.
      if (!inNamespacePath && receiver && receiver.type !== "field_expression" && member) {
        const target = pathText(member)
        if (target) {
          const k = `uses|${target}`
          if (!seen.has(k)) {
            seen.add(k)
            out.push({ label: "uses", from: "", target })
          }
        }
      }
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}

/**
 * `references` truth: a reference to a TYPE or a NAMESPACE.
 *
 *   1. `x::T` — the annotation's type. `typed_expression` is positional and both ends are names.
 *   2. `Vector{T}` — the BASE of a parameterised type. The `{T}` is a parameter, not a reference.
 *   3. A NESTED `field_expression` — a namespace path, as ONE edge to the whole dotted name.
 *   4. `using X` / `import X` — the module.
 */
export function deriveJuliaReferencesTruth(root: any): JuliaRelEdge[] {
  const out: JuliaRelEdge[] = []
  const seen = new Set<string>()
  const add = (target: string) => {
    const t = String(target ?? "").trim()
    if (!t) return
    const k = `references|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "references", from: "", target: t })
  }

  const visit = (n: any) => {
    // (1) `x::T`
    if (n.type === "typed_expression") {
      const t = annotationTypeName(n)
      if (t) add(t)
    }

    // (2) `Vector{T}` — the base only.
    if (n.type === "parametrized_type_expression") {
      const base = kids(n)[0]
      if (base) {
        const t = pathText(base)
        if (t) add(t)
      }
    }

    // (3) A namespace path, whole.
    if (n.type === "field_expression") {
      const receiver = n.childForFieldName("value")
      if (receiver && receiver.type === "field_expression") add(pathText(n))
    }

    // (4) `using X` / `import X` / `import X: a`
    if (n.type === "using_statement" || n.type === "import_statement") {
      const m = importModuleName(kids(n)[0])
      if (m) add(m)
    }

    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}
