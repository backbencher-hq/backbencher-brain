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

/**
 * The name a `quote_expression` spells: the OPERATOR for a quoted operator (`:(==)` → `==`, `:+` →
 * `+`), the symbol's own spelling for a Symbol value (`:foo`).
 *
 * A quoted operator names the same binding as every `==(a, b)` call site and every `x::(==)`
 * annotation, so the wrapper is syntax rather than part of the name — and the parenthesised spelling
 * cannot even be stored, because a target carrying `(` is refused downstream as a snippet.
 */
function quotedName(n: any): string {
  // A QUOTE IN A NAME POSITION IS SYNTAX: `x.:(foo)` reads the member `foo`, and `Base.:(==)` names
  // the operator `==`. The analyzer unwraps both (one resolver, one spelling), so the truth side
  // does too — reading only the operator left `:(foo)` as a truth row beside the analyzer's `foo`,
  // and reading only the identifier would leave the operator family split.
  const plain = (x: any): string =>
    x && (x.type === "operator" || x.type === "identifier") ? x.text.trim() : ""
  const inner = kids(n)[0]
  const direct = plain(inner)
  if (direct) return direct
  if (inner?.type === "parenthesized_expression") {
    const wrapped = plain(kids(inner)[0])
    if (wrapped) return wrapped
  }
  return n.text.trim()
}

/** Does this text carry a character a NAME can carry (a letter, a digit, or julia's `_`)? */
function hasNameCharacter(t: string): boolean {
  for (let i = 0; i < t.length; i++) {
    const c = t.codePointAt(i)!
    if (c === 95 /* _ */) return true
    if (c >= 48 && c <= 57) return true
    if (c >= 65 && c <= 90) return true
    if (c >= 97 && c <= 122) return true
    if (c > 127) return true // a unicode identifier character; julia allows them
  }
  return false
}

/** A dotted path, left-nested, as text. Used for the WHOLE-path `references` edge. */
function pathText(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "operator") return n.text.trim()
  if (n.type === "quote_expression") return quotedName(n)
  // A PARENTHESISED EXPRESSION IS A BLOCK WHEN IT HOLDS MORE THAN ONE STATEMENT, and a block's
  // value is its LAST expression — `x::(struct Inner; y::Outer; end; TG)` annotates the field with
  // the block's value, `TG`. Reading the FIRST child named the declaration instead. MEASURED: the
  // three `references` rows this oracle could not derive on the 200-file draw (`TG_60919_C_Inner`,
  // `TG_60919_D_Inner`, `TG_EarlyCall_A`, all in `julia/test/typegroup.jl`) were exactly the block
  // spelling; a single-child parenthesised type `(Any)` is unchanged by the rule.
  if (n.type === "parenthesized_expression") {
    const parts = kids(n)
    return parts.length > 0 ? pathText(parts[parts.length - 1]) : ""
  }
  if (n.type === "field_expression" || n.type === "parametrized_type_expression") {
    const parts = kids(n).map((c: any) => pathText(c)).filter((x: string) => x)
    if (parts.length === 0) return ""
    if (n.type === "field_expression") return parts.join(".")
    return parts[0]
  }
  if (n.type === "where_expression" ||
      n.type === "typed_expression" || n.type === "curly_expression") {
    return pathText(kids(n)[0])
  }
  return ""
}

/**
 * The name a TYPE-POSITION expression refers to.
 *
 * `pathText` plus the three shapes that name a type BASE instead of a dotted path, each of which the
 * analyzer publishes and none of which is a path segment:
 *
 *   `x::typeof(identity)`  → `typeof`   (a call: the callee is the type base)
 *   `mime::MIME"text/plain"` → `MIME`   (a string macro: the prefix is the type)
 *   `rows::$T1`            → `T1`       (an interpolation: the name is the only static fact)
 *
 * A CALL is deliberately NOT handled by `pathText`: `Foo().bar.baz` is a field read on a value, not
 * a namespace path, and a path that began at the callee published `typeof.name.name` for a chain this
 * file never spells.
 */
function typeExprName(n: any): string {
  if (!n) return ""
  if (n.type === "call_expression") return pathText(kids(n)[0])
  if (n.type === "prefixed_string_literal") {
    const t = n.text.trim()
    // `var"#foo"` is a BINDING NAME, quotes and all — the grammar's prefixed-string node is also how
    // julia spells a legal identifier, so only a string MACRO prefix is read as a type base.
    if (t.startsWith('var"')) return t
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 34 /* " */) return t.slice(0, i)
    return t
  }
  if (n.type === "interpolation_expression") return pathText(kids(n)[0])
  return pathText(n)
}

/** The name a type annotation names. `typed_expression` is POSITIONAL: name first, type second. */
function annotationTypeName(n: any): string {
  if (!n) return ""
  if (n.type === "typed_expression") return typeExprName(kids(n)[1])
  return ""
}

/** `using X` / `import X` / `import X: a, b` — the module named, path kept whole. */
function importModuleName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text.trim()
  // `using A, B` gives each module its own child; `using A: b` wraps module + names in a
  // `selected_import`, whose FIRST child is the module and everything after it is the name list.
  if (n.type === "selected_import" || n.type === "import_alias" || n.type === "as_expression") {
    return importModuleName(kids(n)[0])
  }
  // Relative paths keep their leading dots: `using .MiniCassette` and `using ..Graphs` name
  // different modules, and the dots are part of the path rather than punctuation.
  if (n.type === "import_path" || n.type === "scoped_identifier") return n.text.trim()
  if (n.type === "field_expression") {
    const parts = kids(n).map((c: any) => importModuleName(c)).filter((x: string) => x)
    return parts.join(".")
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
      // The member goes through `pathText`, which unwraps a QUOTED operator: `x.:(==)` reads the
      // member `==`, the spelling every other site uses for that binding.
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
      // IMMEDIATE parent only. A link is an inner link of a chain when the chain's next `.`
      // directly wraps it; an `expr.dest` inside `SSAValue(expr.dest).id` has a call_expression
      // parent, so it is a complete member read of its own, not a segment of the outer path. The
      // earlier ancestor walk suppressed those and read as five unexplained `uses` edges.
      let anc: any = n.parent
      let inNamespacePath = false
      for (let i = 0; anc && i < 1; i++) {
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

/** A declaration's simple name, through the grammar's wrappers. */
function declarationName(n: any): string {
  if (!n) return ""
  if (n.type === "identifier" || n.type === "operator") return n.text.trim()
  if (n.type === "quote_expression") return quotedName(n)
  if (n.type === "type_head" || n.type === "parametrized_type_expression" ||
      n.type === "where_expression" || n.type === "parenthesized_expression" ||
      n.type === "typed_expression") return declarationName(kids(n)[0])
  if (n.type === "binary_expression") {
    const operands = kids(n).filter((c: any) => c.type !== "operator")
    return declarationName(operands[0])
  }
  return ""
}

/** Simple name a callable introduces. */
function calleeDeclarationName(n: any): string {
  if (!n) return ""
  if (n.type === "call_expression") return calleeDeclarationName(kids(n)[0])
  if (n.type === "field_expression") {
    const parts = kids(n).map(calleeDeclarationName).filter(Boolean)
    return parts.join(".")
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
      n.type === "typed_expression" || n.type === "parenthesized_expression") {
    return calleeDeclarationName(kids(n)[0])
  }
  if (n.type === "identifier" || n.type === "operator") return n.text.trim()
  if (n.type === "quote_expression") return quotedName(n)
  return ""
}

/** The name a short-form `f(x) = …` assignment declares, or "". */
function shortCallee(n: any): string {
  let lhs = kids(n)[0]
  for (let i = 0; i < 4 && lhs; i++) {
    if (lhs.type === "call_expression") return calleeDeclarationName(lhs)
    if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
        lhs.type === "parenthesized_expression") { lhs = kids(lhs)[0]; continue }
    break
  }
  return ""
}

/** The node types that introduce a NEW lexical scope, so a binding inside one is not a module member. */
const LOCAL_SCOPE_NODES: ReadonlySet<string> = new Set([
  "function_definition", "macro_definition", "let_statement", "for_statement",
  "while_statement", "do_clause", "quote_expression", "quote_statement",
  "struct_definition", "module_definition", "baremodule_definition",
  "arrow_function_expression", "comprehension_expression",
])

/** The nearest enclosing `module`/`baremodule`, or null. */
function enclosingModule(n: any): any {
  let cur = n.parent
  while (cur) {
    if (cur.type === "module_definition" || cur.type === "baremodule_definition") return cur
    cur = cur.parent
  }
  return null
}

/** Was this binding written in the MODULE's own scope — not inside a body, loop, `let` or quote? */
function declaredInModuleScope(n: any, moduleNode: any): boolean {
  let cur = n.parent
  while (cur) {
    if (cur.id === moduleNode.id) return true
    if (LOCAL_SCOPE_NODES.has(cur.type)) return false
    // A SHORT-FORM FUNCTION IS AN `assignment`: `f(x) = (y = 1; y)` has no function node between
    // `y` and the module, so the call-headed left side is what marks the body as a scope.
    if (cur.type === "assignment") {
      let head: any = kids(cur)[0]
      for (let i = 0; i < 4 && head; i++) {
        if (head.type === "call_expression") return false
        if (head.type !== "where_expression" && head.type !== "typed_expression" && head.type !== "parenthesized_expression") break
        head = kids(head)[0]
      }
    }
    cur = cur.parent
  }
  return false
}

/** name -> every module path in which this file declares it, duplicates INCLUDED. */
function declarationOwners(root: any): Map<string, string[]> {
  const owners = new Map<string, string[]>()
  const add = (name: string, path: string) => {
    if (!name) return
    if (!owners.has(name)) owners.set(name, [])
    owners.get(name)!.push(path)
  }
  const walk = (n: any, path: string) => {
    if (n.type === "module_definition" || n.type === "baremodule_definition") {
      const byField = n.childForFieldName?.("name")
      const nm = byField ?? kids(n)[0]
      const name = nm ? String(nm.text ?? "").trim() : ""
      // IMMEDIATE owner, which is the spelling the graph's `qualifiedName` publishes
      // (`MiniCassette.Ctx`, not `contextual.MiniCassette.Ctx`). Matching the binding spelling is
      // the point of this qualification; a deeper path would demand an edge to a name the symbol
      // table never contains.
      const next = name || path
      for (const c of kids(n)) walk(c, next)
      return
    }
    if (n.type === "struct_definition" || n.type === "abstract_definition" ||
        n.type === "primitive_definition") {
      const typeName = declarationName(kids(n).find((c: any) => c.type === "type_head"))
      add(typeName, path)
      // A TYPE DECLARED IN A TYPE BODY is a declaration of a second type, and the graph's own
      // qualifiedName for it is `<enclosing type>.<name>` — the analyzer's active scope is the
      // enclosing type, not its module. Only the invalid-code tests declare one
      // (`julia/test/typegroup.jl:626`), and without this the analyzer's correctly qualified
      // `TG_60919_C.TG_60919_C_Inner` could only ever read as an unexplained row.
      if (typeName) {
        for (const c of kids(n)) {
          if (c.type === "struct_definition" || c.type === "abstract_definition" || c.type === "primitive_definition") {
            add(declarationName(kids(c).find((x: any) => x.type === "type_head")), typeName)
          }
        }
      }
      // An INNER CONSTRUCTOR is a second symbol with the type's own name, and the analyzer's
      // reference retarget only qualifies a name with ONE declaration. Counting the constructor is
      // what keeps `HTMLContext` bare (struct + inner constructor) while `ContentSegment` (struct
      // only) is qualified.
      for (const c of kids(n)) {
        if (c.type === "function_definition" || c.type === "macro_definition") {
          const sig = kids(c).find((x: any) => x.type === "signature")
          if (sig) add(calleeDeclarationName(kids(sig)[0]), path)
        } else if (c.type === "assignment") {
          const n2 = shortCallee(c)
          if (n2) add(n2, path)
        } else if (c.type === "global_statement" || c.type === "local_statement") {
          const a = kids(c).find((x: any) => x.type === "assignment")
          const n2 = a ? shortCallee(a) : ""
          if (n2) add(n2, path)
        }
      }
      return
    }
    if (n.type === "const_statement" || n.type === "global_statement" || n.type === "local_statement") {
      const assign = kids(n).find((c: any) => c.type === "assignment")
      if (assign) add(declarationName(kids(assign)[0]), path)
      return
    }
    if (n.type === "function_definition" || n.type === "macro_definition") {
      const sig = kids(n).find((c: any) => c.type === "signature")
      const name = sig ? calleeDeclarationName(kids(sig)[0]) : ""
      add(name, path)
      return
    }
    if (n.type === "assignment") {
      let lhs = kids(n)[0]
      for (let i = 0; i < 4 && lhs; i++) {
        if (lhs.type === "call_expression") { add(calleeDeclarationName(lhs), path); return }
        if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
            lhs.type === "parenthesized_expression") { lhs = kids(lhs)[0]; continue }
        break
      }
      // A PLAIN MODULE-SCOPE ASSIGNMENT DECLARES A BINDING. The `contains` oracle derives
      // `Mod -> name` for it, and the analyzer publishes the symbol, so the reference retarget
      // qualifies references to it — `HTMLWriter.ImageElements`. Leaving it out of this map made
      // every such reference read as `HTMLWriter.ImageElements` unexplained plus the bare truth
      // row missing: 9 + 9 rows on the 200-file draw, all key-convention, none a defect. The guard
      // is the same lexical one the `contains` oracle uses: a binding in a `let`, a loop or a
      // short-form body is local and is not a declaration of the module.
      const head = lhs && lhs.type === "typed_expression" ? kids(lhs)[0] : lhs
      if (head && head.type === "identifier") {
        const mod = enclosingModule(n)
        if (mod && declaredInModuleScope(n, mod)) add(head.text.trim(), path)
      }
      return
    }
    for (const c of kids(n)) walk(c, path)
  }
  walk(root, "")
  return owners
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
  // A same-file declaration is addressed by its module-qualified name in the graph
  // (`HTMLWriter.ContentSegment`, `StridedArrays.NonMemStridedArray`). The analyzer's reference
  // retarget does that, and the oracle must know the same binding spellings or every correctly
  // qualified row reads as an unexplained analyzer edge plus a missing bare one. Only a UNIQUE
  // declaration is qualified, which is the analyzer's own condition.
  const declared = declarationOwners(root)
  const add = (target: string) => {
    let t = String(target ?? "").trim()
    if (!t) return
    // A NAME CONTAINS AT LEAST ONE LETTER OR DIGIT. A type or a namespace is spelled with one, so a
    // punctuation-only target is a PARSE ARTIFACT — `g::::IsDirected` (julia's four-colon trait idiom)
    // makes the grammar read `::` as a quote whose inner is `:`, and the annotation then "names" `:`.
    // The analyzer refuses a name it cannot spell, and the universal target filter refuses `(` in a
    // leaf; a target with no identifier character is not a name in either. Refusing here keeps the
    // truth from demanding an edge that no resolver could ever bind.
    if (!hasNameCharacter(t)) return
    if (!t.includes(".")) {
      // QUALIFY ONLY A UNIQUE DECLARATION, by COUNT not by distinct owner. `SearchRecord` has a
      // struct and an outer constructor of the same name, so the analyzer's retarget correctly
      // declines to qualify it; a set of owners would have seen one path and qualified it anyway.
      const owners = declared.get(t)
      if (owners && owners.length === 1) {
        const owner = owners[0]!
        if (owner) t = `${owner}.${t}`
      }
    }
    const k = `references|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "references", from: "", target: t })
  }

  const visit = (n: any) => {
    // (1) `x::T` and the anonymous spelling `::T`. The grammar uses a DISTINCT node for the
    // anonymous form (`unary_typed_expression`), and a references oracle that only knows
    // `typed_expression` misses every `f(::Type{…})` annotation. The analyzer now emits them, so
    // the 40-file draw read 21 unexplained qualified references before this case existed.
    if (n.type === "typed_expression") {
      const t = annotationTypeName(n)
      if (t) add(t)
    }
    if (n.type === "unary_typed_expression") {
      const t = typeExprName(kids(n)[0])
      if (t) add(t)
    }

    // (2) `Vector{T}` — the base only. A parametrized type inside a DECLARATION HEAD is not a
    // reference: the analyzer publishes the supertype as `extends` and deliberately refuses to
    // double-publish it as a mention, and a parameter's bound (`T<:AbstractString`) belongs to the
    // bound edge. Without this guard the oracle demanded `References -> AbstractEdge` for
    // `struct S <: AbstractEdge{T}`, which reads as a missing analyzer edge that is really a
    // different relation already carried by `extends`.
    if (n.type === "parametrized_type_expression") {
      // A TYPE DECLARATION'S OWN HEAD is the only place a parameterised type is not a reference:
      // the supertype is already an `extends` row and a parameter's bound (`S<:NTuple{…}`) is an
      // `extends` row from the parameter, so a `references` row there would spell one fact twice
      // under two labels. A WHERE CLAUSE IS NOT THAT PLACE — `f(x::T) where {T<:AbstractDict{…}}`
      // names `AbstractDict`, the analyzer publishes it, and treating the where's parameter list as
      // a declaration head is how every `Union{…}` / `AbstractDict{…}` / `AbstractGraph{…}` bound in
      // the corpus came to read as an unexplained analyzer edge.
      let anc: any = n.parent
      let inHead = false
      while (anc) {
        if (anc.type === "type_head") { inHead = true; break }
        if (anc.type === "function_definition" || anc.type === "struct_definition" ||
            anc.type === "abstract_definition" || anc.type === "primitive_definition" ||
            anc.type === "module_definition" || anc.type === "source_file") break
        anc = anc.parent
      }
      if (!inHead) {
        const base = kids(n)[0]
        if (base) {
          const t = pathText(base)
          if (t) add(t)
        }
      }
    }

    // (3) A namespace path, whole — but only the OUTERMOST link. `ctx.doc.blueprint.pages` is one
    // path, not four references; adding every nested link published `ctx.doc` and
    // `ctx.doc.blueprint` as references the analyzer never claims, which read as missing analyzer
    // edges. The same ancestry rule as `uses`, for the same reason.
    if (n.type === "field_expression") {
      // IMMEDIATE parent only — the same boundary as `uses`. `ctx.doc.blueprint` inside
      // `f(ctx.doc.blueprint)` is a complete path; only a link directly wrapped by another
      // field_expression is an inner segment.
      let anc: any = n.parent
      let innerLink = false
      for (let i = 0; anc && i < 1; i++) {
        if (anc.type === "field_expression") { innerLink = true; break }
        anc = anc.parent
      }
      const receiver = n.childForFieldName("value")
      if (!innerLink && receiver && receiver.type === "field_expression") add(pathText(n))
    }

    // (4) `using X` / `import X` / `import X: a` — EVERY module named, not just the first.
    // `using Test, DataFrames, CategoricalArrays` names three, and the analyzer publishes all
    // three; reading only the first made the other two look unexplained.
    if (n.type === "using_statement" || n.type === "import_statement") {
      for (const c of kids(n)) {
        const m = importModuleName(c)
        if (m) add(m)
      }
    }

    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}
