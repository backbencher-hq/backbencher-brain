/**
 * The Julia `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason the Dart oracle's header records:
 * that shared file is edited by several lanes at once, and every line a lane keeps out of a shared
 * file is a line that cannot conflict. Wiring it in is one import and one registration.
 *
 * The oracle is written from JULIA'S OWN CONTAINMENT RULE and shares no rule table, key set,
 * member list or resolver with `RealJuliaAnalyzer`. That is the only property that makes a MATCH
 * mean something: an oracle derived from the analyzer cannot disagree with it.
 *
 * ## Why this oracle exists at all
 *
 * `contains` is the backbone the graph is navigated by, and without independent truth its edges read
 * as analyzer-only — they are attributed, never corroborated. Julia's `contains` surface is not
 * small: across 941 corpus files the analyzer publishes 10,365 `contains` edges. The lane's own
 * fixtures assert a handful by name, which is a REGRESSION test, not a measurement: it says the
 * edge is still there, not that no edge is missing.
 *
 * ## The rule
 *
 * A declaration CONTAINS the members it declares. Both ends of the edge are names written in the
 * file, so this needs no name resolution at all — it is a "what did the programmer declare here"
 * question, not a resolution question. That property is why `contains` is the right first surface
 * for this lane: it is the one relation whose truth needs no judgement calls, so a disagreement
 * between this file and the analyzer is a real disagreement rather than two opinions.
 *
 * From tree-sitter-julia's own node types (read from `src/node-types.json`, NOT from the analyzer):
 *
 *   module_definition / baremodule_definition   declares its top-level declarations
 *   struct_definition                            declares its `field_expression`s
 *   abstract_definition                          declares NOTHING — a Julia abstract type has no body
 *   primitive_definition                        declares NOTHING — likewise
 *   function_definition / macro_definition       declare NOTHING — Julia has no nested declarations
 *
 * `module_definition` is the ONLY node in the whole grammar that carries a `name` field among these
 * (and one of just 7 of 151 named node types that carry any field at all), so the module's name is
 * read BY FIELD and everything else is read BY CHILD ORDER. Getting that backwards is not a
 * hypothetical: the analyzer's first version used `childForFieldName` throughout, which returns null
 * for a node with no such field, and emitted zero struct fields and zero `extends` edges over a
 * corpus with thousands of both — on files that parse with zero ERROR nodes.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * It does not derive `extends`, `calls`, `uses` or `references`. Those need name resolution and
 * therefore judgement, and an oracle that guesses produces agreement by construction. It also does
 * not claim `overrides` or `implements` AT ALL: Julia has multiple dispatch rather than overriding,
 * so two same-named methods are both live and neither replaces the other, and `abstract type` is a
 * type hierarchy rather than a protocol-conformance relation. The analyzer declines both and this
 * oracle declines them independently, which is the point — two independent declinations agreeing is
 * evidence; one declining and the other silent is not.
 */
export type JuliaContainsEdge = { label: "contains"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** The declared name of a definition node, from the grammar's POSITIONAL shape. */
function declaredName(node: any): string {
  // `module X end` — the only one of these that has a `name` field.
  if (node.type === "module_definition" || node.type === "baremodule_definition") {
    const byField = node.childForFieldName("name")
    if (byField) return byField.text.trim()
    const first = kids(node)[0]
    return first ? first.text.trim() : ""
  }

  // `struct Circle{T<:Real} <: Shape` — the head is positional. It may be a bare
  // `type_head`, or a `binary_expression` whose LEFT operand carries the declared name and whose
  // RIGHT is the supertype. Taking the right, or scanning for the first identifier ANYWHERE, returns
  // the supertype — which is how a whole family of structs once published as `class:Shape`.
  const head = kids(node).find((c: any) => c.type === "type_head")
  if (!head) return ""
  const leftmost = (n: any): string => {
    if (n.type === "identifier") return n.text.trim()
    // `type_head` is a wrapper, not a name. Its first child carries the name. The first draft called
    // `leftmost` ON the head without a case for it, so it returned "" for every struct and every
    // abstract type — which is why the oracle agreed with the analyzer on only the two short-form
    // assignments and was silent on the entire type surface. An oracle that derives nothing is
    // indistinguishable from an oracle that is wrong.
    if (n.type === "type_head") {
      const inner = kids(n)[0]
      return inner ? leftmost(inner) : ""
    }
    if (n.type === "binary_expression") {
      // children are (left) (operator) (right); the operator is a NAMED child in this grammar.
      const operands = kids(n).filter((c: any) => c.type !== "operator")
      const left = operands[0]
      return left ? leftmost(left) : ""
    }
    if (n.type === "where_expression" || n.type === "parenthesized_expression") {
      const inner = kids(n)[0]
      return inner ? leftmost(inner) : ""
    }
    if (n.type === "field_expression" || n.type === "parametrized_type_expression") {
      const inner = kids(n)[0]
      return inner ? leftmost(inner) : ""
    }
    return ""
  }
  return leftmost(head)
}

/** The name a short-form `f(x) = …` declaration introduces, or "" if this is a value assignment. */
function shortFormName(node: any): string {
  if (node.type !== "assignment") return ""
  let lhs = kids(node)[0]
  // `f(x)::T = …` wraps the call in a typed_expression; `x::Int = 5` is also one. Only a CALL
  // underneath makes it a function declaration, and that is the whole distinction.
  for (let i = 0; i < 4 && lhs; i++) {
    if (lhs.type === "call_expression") break
    if (lhs.type === "where_expression" || lhs.type === "typed_expression" || lhs.type === "parenthesized_expression") {
      lhs = kids(lhs)[0]
      continue
    }
    return ""
  }
  if (!lhs || lhs.type !== "call_expression") return ""
  const callee = kids(lhs)[0]
  if (!callee) return ""
  // `$(f)(p) = …` — a parenthesised INTERPOLATION is a runtime VALUE, not a name. `declaredCallee`
  // descends into it and returns the binding `f`, which is the LOOP VARIABLE of
  // `for f in (:arch, :libc, …)` in `Pkg.jl/src/BinaryPlatformsCompat.jl`; the method's name is
  // whatever that symbol holds, and the file does not spell it. The analyzer refuses it; the truth
  // published `contains BinaryPlatformsCompat -> f`, a member the module does not contain.
  if (callee.type === "interpolation_expression") return ""
  if (callee.type === "parenthesized_expression") {
    const inner = kids(callee)[0]
    if (inner && inner.type === "interpolation_expression") return ""
  }
  // A BARE OPERATOR IS A NAME. `+(level::LogLevel, inc::Integer) = …`
  // (`julia/base/logging/logging.jl:134`) declares the binding `+` in its module, and this side
  // returned "" for it while the analyzer published the member — measured as the largest single
  // class of unexplained `contains` rows on the whole population (every operator method defined at
  // module scope: `+`, `-`, `*`, `==`, `<=`, `<`, `|`, `~`). `declaredCallee` already unwraps the
  // quoted spelling (`Base.:(==)` → `Base.==`), so the two spellings meet in one place.
  if (callee.type === "identifier" || callee.type === "operator" || callee.type === "quote_expression") {
    return declaredCallee(callee)
  }
  if (callee.type === "field_expression") {
    // `Base.show(x) = …` declares `Base.show`, not `Base`. Keeping only the first segment was the
    // exact defect this file's header records as fixed, and the code still did it: the oracle
    // published `contains ImmutableArrays -> Base` for a file that declares `Base.size`, which then
    // read as a MISSING analyzer edge for a member the module does not contain.
    return declaredCallee(callee)
  }
  if (callee.type === "parametrized_type_expression") {
    // `f{T}(x) = …` declares `f`; the `{T}` is the parameter list, not part of the name.
    return declaredCallee(callee)
  }
  return ""
}

/**
 * The name a callee introduces, with a QUALIFIED PATH KEPT WHOLE.
 *
 * `Base.foo(x) = …` declares `Base.foo`, not `Base`. Recursing into the first child — the obvious
 * implementation — returned the first SEGMENT, so the oracle published `contains Test -> Base` for
 * a file that contains no such member at all: a FABRICATED truth row, which is worse than a missing
 * one because it would have been reported as an analyzer edge the analyzer got right and the oracle
 * got wrong, in the direction that reads as a defect.
 *
 * Collapsing a qualified name is also the exact mistake the lane's own analyzer was fixed for, and
 * the measurement behind it: 72 bare segments across 400 corpus files are reachable by more than one
 * distinct path, so a first-segment read fuses unrelated functions. Two independent implementations
 * making the same mistake is not two pieces of evidence.
 */
function declaredCallee(n: any): string {
  // A SPLICE IS A VALUE, NOT A NAME. `function $(f)(p::PlatformUnion)` inside
  // `for f in (:arch, :libc, …)` declares whatever `f` holds; the file does not spell it, so a
  // truth row named `f` is a member that does not exist. Refusing at the resolver keeps every
  // caller honest rather than repeating the guard at each one.
  if (n.type === "interpolation_expression") return ""
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "prefixed_string_literal") return n.text.trim()
  if (n.type === "operator") return n.text.trim()
  // A QUOTED OPERATOR NAMES THE OPERATOR — `Base.:(==)(x, y) = …` declares `Base.==`, the same
  // binding every call site spells `==`. The wrapper is syntax, not part of the name (and a target
  // carrying `(` is refused downstream as a snippet, so the parenthesised spelling could not even be
  // stored). Found as a same-file `Base.==` / `Base.:(==)` split on one definition.
  if (n.type === "quote_expression") {
    const inner = kids(n)[0]
    if (inner?.type === "operator") return inner.text.trim()
    if (inner?.type === "parenthesized_expression") {
      const op = kids(inner)[0]
      if (op?.type === "operator") return op.text.trim()
    }
    return n.text.trim()
  }
  if (n.type === "field_expression" || n.type === "parametrized_type_expression") {
    const parts = kids(n).map((c: any) => declaredCallee(c)).filter((x: string) => x)
    if (parts.length === 0) return ""
    if (parts.length === 1) return parts[0]
    // A field_expression is (receiver) (member); a parametric one is (name) (parameters). Only the
    // former is a dotted path — for the latter the second part is a curly_expression and returns "".
    return n.type === "field_expression" ? parts.slice(0, -1).concat(parts[parts.length - 1]).join(".") : parts[0]
  }
  const first = kids(n)[0]
  return first ? declaredCallee(first) : ""
}

/**
 * `const X = 1` / `const global X = 1` / `global const X = 1` — a binding, not a function.
 *
 * THE STATEMENT CAN WRAP THE ASSIGNMENT MORE THAN ONCE, and the first draft read only the node it
 * was handed. Both corpus spellings nest: `global const JL_FE_INEXACT = …` is
 * `global_statement (const_statement (assignment …))`, and `const global x3::Int = …` is a
 * `const_statement` whose `assignment` sits under a `typed_expression`. Reading one level returned
 * "" for every one of them, so `julia/base/rounding.jl`'s nine `global const JL_FE_*` and
 * `julia/test/syntax.jl`'s module-level globals were invisible to this side while the analyzer
 * published them — the 11 unexplained `contains` rows on the 200-file draw.
 *
 * A BARE NAME IS NOT A DECLARATION HERE. `global zstdmt_path` with no assignment asserts that a
 * global exists; it creates no binding (the binding is created by an assignment), and the analyzer
 * publishes no symbol for it. The caller that wants only real declarations requires an assignment
 * child before calling, so this function stays a pure spelling reader.
 */
function constBindingName(node: any): string {
  let cur: any = node
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.type === "assignment") {
      const lhs = kids(cur)[0]
      if (!lhs) return ""
      if (lhs.type === "identifier" || lhs.type === "operator" || lhs.type === "quote_expression") return lhs.text.trim()
      if (lhs.type === "typed_expression") {
        const inner = kids(lhs)[0]
        return inner && (inner.type === "identifier" || inner.type === "operator") ? inner.text.trim() : ""
      }
      // A PARAMETRIC ALIAS DECLARES ITS BASE NAME. `const RestrictedBasis{B} = Mul{…}` puts a
      // `parametrized_type_expression` on the assignment's left, and reading only the identifier
      // shapes above returned "" for every one of them — measured on `julia/test/subtype.jl`'s
      // `module I31703`, whose eight parametric aliases (`RestrictedBasis`, `RestrictedQuasiArray`,
      // `BasisOrRestricted`, …) the analyzer published as module members and this side did not.
      if (lhs.type === "parametrized_type_expression" || lhs.type === "curly_expression") {
        const base = kids(lhs)[0]
        return base && (base.type === "identifier" || base.type === "operator") ? base.text.trim() : ""
      }
      return ""
    }
    if (cur.type === "identifier") return cur.text.trim()
    if (cur.type === "typed_expression") {
      const inner = kids(cur)[0]
      return inner && inner.type === "identifier" ? inner.text.trim() : ""
    }
    const next = kids(cur).find((c: any) =>
      c.type === "assignment" || c.type === "const_statement" || c.type === "global_statement" || c.type === "local_statement")
    if (!next) return ""
    cur = next
  }
  return ""
}

/** Does this node carry the `global` keyword as an ANONYMOUS token? `const global x` does. */
function hasGlobalKeywordToken(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === "global") return true
  }
  return false
}

/** The node types that introduce a NEW scope, so a binding inside one is not a module member. */
const LOCAL_SCOPE_NODES: ReadonlySet<string> = new Set([
  "function_definition", "macro_definition", "let_statement", "for_statement",
  "while_statement", "do_clause", "quote_expression", "quote_statement",
  "struct_definition", "module_definition", "baremodule_definition",
  "arrow_function_expression", "comprehension_expression",
])

/**
 * Was this binding written in the MODULE's own scope — not inside a function, `let`, loop or quote?
 *
 * The container walk descends through `if`/`begin`/`try` because a declaration there is still a
 * module member, and it stops at every node that owns a scope. A plain `x = 1` is different from a
 * `const`: the assignment branch returned before descending, but the recursion also reaches
 * assignments inside a `let` or `for` body, where the binding is LOCAL. Julia's rule is the
 * lexical one, so the test is the ancestor chain rather than the node's type.
 */
function declaredInModuleScope(n: any, moduleNode: any): boolean {
  let cur = n.parent
  while (cur) {
    if (cur.id === moduleNode.id) return true
    if (LOCAL_SCOPE_NODES.has(cur.type)) return false
    // A SHORT-FORM FUNCTION IS AN `assignment`, so `f(x) = (y = 1; y)` reaches this walk with no
    // function node in between and `y` would read as a module member. The call-headed left side is
    // what makes the assignment a declaration of `f`; a plain `x = (y = 1)` is not a scope.
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

/** The nearest enclosing `module`/`baremodule`, or null. */
function enclosingModule(n: any): any {
  let cur = n.parent
  while (cur) {
    if (cur.type === "module_definition" || cur.type === "baremodule_definition") return cur
    cur = cur.parent
  }
  return null
}

/** Is this node quoted code or a macro body — text that expands elsewhere, not a declaration here? */
function insideQuotedCode(n: any): boolean {
  let cur = n.parent
  while (cur) {
    if (cur.type === "module_definition" || cur.type === "baremodule_definition") return false
    if (cur.type === "quote_expression" || cur.type === "quote_statement" || cur.type === "macro_definition") return true
    cur = cur.parent
  }
  return false
}

/**
 * The field names a `struct` declares.
 *
 * MEASURED, and the obvious reading is wrong: a struct FIELD DECLARATION is a `typed_expression`
 * (`radius::T`), not a `field_expression`. `field_expression` is field ACCESS — `c.radius` — and it
 * is the only one of the two that carries a real field name (`value`), which is exactly why reaching
 * for it here yields zero: `struct Circle{T<:Real} <: Shape` has children `type_head` and
 * `typed_expression`, and `descendantsOfType(["field_expression"])` over the struct returns an empty
 * list. Confusing the two is a plausible mistake rather than a careless one, since the node is
 * NAMED for the thing it does in an expression and the declaration reuses a different node entirely.
 *
 * The field's name is the typed expression's FIRST child, and the second is its type.
 */
function structFields(node: any): string[] {
  const out: string[] = []
  /** A field name from a declaration-shaped node, or "". Used for macro-wrapped fields. */
  const fieldNameOf = (a: any): string => {
    if (!a) return ""
    if (a.type === "identifier") return a.text.trim()
    if (a.type === "typed_expression") {
      const nm = kids(a)[0]
      return nm && nm.type === "identifier" ? nm.text.trim() : ""
    }
    if (a.type === "const_statement" || a.type === "assignment") {
      const inner = kids(a).find((c: any) => c.type === "typed_expression" || c.type === "assignment" || c.type === "identifier")
      return inner ? fieldNameOf(inner) : ""
    }
    return ""
  }
  const visit = (n: any) => {
    // `@atomic str::Union{String,Nothing}` — a macro-annotated field. The macro is not a field and
    // the typed_expression inside its argument list is; a walk that only looks at direct children
    // missed every atomic/const-annotated field. Measured: `LazyString -> str` was one of the two
    // MISSING contains rows on the 40-file draw.
    if (n.type === "macrocall_expression") {
      const args = kids(n).find((c: any) => c.type === "macro_argument_list")
      if (args) {
        for (const a of kids(args)) {
          if (a.type === "typed_expression" || a.type === "const_statement" ||
              a.type === "assignment" || a.type === "identifier") {
            const nm = fieldNameOf(a)
            if (nm) out.push(nm)
          }
        }
      }
      return
    }
    // An INNER CONSTRUCTOR is not a field declaration. `struct Error <: Result` declares
    // test_type, orig_expr, value, backtrace, context and source — and its inner constructor takes
    // a PARAMETER `excs::Union{Base.ExceptionStack,Nothing}`, which this walk read as a seventh
    // field and published as `contains Error -> excs`. The same shape put
    // `BigFloatDataRoundingIncrementHelper -> len` in the missing set, where `len` is a constructor
    // argument and the struct's fields are n, trunc_len, final_bit and round_bit.
    //
    // A parameter is a binding, not a member — the same ruling this repo applies to every other
    // lane's parameters, and the analyzer was RIGHT on both and the oracle was wrong. Both were
    // found by the oracle disagreeing with the analyzer, which is the only reason the disagreement
    // is legible: one side is derived from Julia's rule and the other from a walk, so when they
    // differ there is something to adjudicate.
    if (n.type === "function_definition" || n.type === "macro_definition") return
    // An inner constructor written in SHORT form is an `assignment` whose left side is a call,
    // not a field. `IdDict{K,V}(d::IdDict{K,V}) where {K,V} = new(…)` inside the struct is the
    // case that published `contains IdDict -> d`: `d` is the constructor's PARAMETER, and the
    // same bug published `VersionSpec -> vs` for `VersionSpec(vs::VersionSpec) = vs`. A field is
    // a bare `typed_expression` directly in the struct body; this walk must not descend into a
    // constructor body at all.
    if (n.type === "assignment") {
      const lhs = kids(n)[0]
      let head: any = lhs
      for (let i = 0; i < 4 && head; i++) {
        if (head.type === "call_expression" || head.type === "where_expression" || head.type === "signature") return
        if (head.type !== "typed_expression" && head.type !== "parenthesized_expression") break
        head = kids(head)[0]
      }
      if (head && head.type === "call_expression") return
      // `a = 1` IN A STRUCT BODY IS A FIELD with a default and no annotation. `@kwdef` structs are
      // written this way throughout the corpus, and the generic descent below never read it: the
      // identifier's parent is the assignment, not the struct, so the field test missed it and the
      // analyzer's correct `contains TestInnerConstructor -> a` came back as an unexplained row.
      // A TYPED default (`a::T = 2`) is left to the `typed_expression` case below, which reads the
      // name from position 0 — returning here as well would drop every annotated @kwdef field.
      if (n.parent && n.parent.id === node.id && lhs && lhs.type === "identifier") {
        out.push(String(lhs.text ?? "").trim())
        return
      }
      if (lhs && lhs.type === "identifier") return // a default value's identifiers are not fields
    }
    // `const d` / `const f = 1` — an UNTYPED const field. `const e::Int` reaches the
    // `typed_expression` case by descent, but a bare identifier's parent is the const statement, so
    // the field test never saw it and four @kwdef const fields read as unexplained analyzer rows.
    if (n.type === "const_statement" && n.parent && n.parent.id === node.id) {
      for (const c of kids(n)) {
        if (c.type === "identifier") { out.push(String(c.text ?? "").trim()); return }
        if (c.type === "typed_expression") {
          const nm = kids(c)[0]
          if (nm?.type === "identifier") out.push(String(nm.text ?? "").trim())
          return
        }
        if (c.type === "assignment") {
          const lhs = kids(c)[0]
          const nm = lhs?.type === "identifier" ? lhs : lhs?.type === "typed_expression" ? kids(lhs)[0] : null
          if (nm?.type === "identifier") out.push(String(nm.text ?? "").trim())
          return
        }
      }
      return
    }
    if (n.type === "typed_expression") {
      const name = kids(n)[0]
      // Only a bare-identifier left-hand side is a FIELD DECLARATION; `x, y::Int` destructures and
      // introduces no new member, and `f(x)::T` is a signature.
      //
      // `var"("` IS A LEGAL FIELD NAME — julia's `var"…"` spelling exists so that a binding can be
      // called something the grammar cannot write bare, and `struct TEST_47594; var"("::Int; end`
      // (`stdlib/REPL/test/replcompletions.jl`) is a field named `(`. The analyzer names it and the
      // universal filter has a julia exemption for exactly this spelling; the oracle's
      // identifier-only test reported the analyzer's correct row as unexplained.
      if (name && (name.type === "identifier" || name.type === "prefixed_string_literal") && kids(n).length === 2) {
        out.push(name.text.trim())
      }
      return // do not descend: the field's own type is not a member
    }
    // A field with NO annotation is a bare identifier directly in the struct body:
    // `mutable struct Barrier; b; end`. The first draft accepted only `typed_expression`, so the
    // analyzer's correct `Barrier -> b` read as unexplained.
    if (n.type === "identifier" && n.parent && n.parent.id === node.id) {
      const s = String(n.text ?? "").trim()
      if (s) out.push(s)
      return
    }
    for (const c of kids(n)) visit(c)
  }
  visit(node)
  return out
}

/**
 * The macros whose expansion evaluates its block in the scope the block is WRITTEN in.
 *
 * The same five names the analyzer carries, and the same reason: these are julia's own semantics
 * (`Base.@eval` evaluates in the containing module's global scope; `@static` is a compile-time
 * branch; `@sync`/`@async`/`@time` wrap a block), not a rule derived from any analyzer.
 */
const SCOPE_TRANSPARENT_MACROS: ReadonlySet<string> = new Set(["eval", "static", "sync", "async", "time"])

export function deriveJuliaContainsTruth(root: any): JuliaContainsEdge[] {
  const out: JuliaContainsEdge[] = []

  const visit = (node: any) => {
    // A struct contains its fields. This is the one container whose members are unambiguous.
    if (node.type === "struct_definition") {
      const owner = declaredName(node)
      if (owner) {
        for (const f of structFields(node)) out.push({ label: "contains", from: owner, target: f })
        // A struct's INNER CONSTRUCTORS are declarations nested in the type and belong to its
        // method table: `function HTMLAsset(…)` inside `struct HTMLAsset` is a member. The first
        // draft derived fields only, so every type with an inner constructor read as an unexplained
        // `contains HTMLAsset -> HTMLAsset` on the analyzer side.
        /**
         * The name a struct-body child DECLARES, or "" — and a macro applied to a declaration does
         * not hide it.
         *
         * `@inline DataFrameRow(df::D, …) where {…} = new{…}(…)` is the inner constructor of
         * `DataFrames.DataFrameRow` (`DataFrames.jl/src/dataframerow/dataframerow.jl:86`), and the
         * direct-children loop read only `function_definition`/`assignment`/`global`/`local`, so the
         * decorated form published no truth row and the analyzer's CORRECT
         * `contains DataFrameRow -> DataFrameRow` read as unexplained. The same shape appears on
         * `@propagate_inbounds`, `@assume_effects` and `@noinline` members throughout Base.
         *
         * The rule is the language's: `@m f(x) = …` expands to a declaration of `f` with the macro
         * applied — it is what this lane's `decorates` edge already records in the other direction.
         */
        const memberOf = (c: any, depth = 0): string => {
          if (!c || depth > 2) return ""
          if (c.type === "function_definition" || c.type === "macro_definition") return declaredNameOfSignature(c)
          if (c.type === "assignment") return shortFormName(c)
          // `global _LazyString(parts, str) = new(...)` inside a struct declares an inner
          // constructor through a global wrapper; it is still a member of the struct.
          if (c.type === "global_statement" || c.type === "local_statement") {
            const inner = kids(c).find((x: any) => x.type === "assignment" || x.type === "function_definition")
            return inner ? memberOf(inner, depth + 1) : ""
          }
          if (c.type === "macrocall_expression") {
            const args = kids(c).find((x: any) => x.type === "macro_argument_list")
            if (!args) return ""
            for (const a of kids(args)) {
              const n = memberOf(a, depth + 1)
              if (n) return n
            }
          }
          return ""
        }
        for (const c of kids(node)) {
          const n = memberOf(c)
          if (n) out.push({ label: "contains", from: owner, target: n })
        }
      }
    }

    // A module contains each declaration made directly in it. `baremodule` is the same node with a
    // different first token.
    if (node.type === "module_definition" || node.type === "baremodule_definition") {
      const owner = declaredName(node)
      if (owner) {
        /**
         * A declaration that is a DIRECT member of this module, or false to recurse.
         *
         * `inMacroArgs` marks the scan of a NON-transparent macro's arguments. There a plain
         * `x = value` assignment is a macro OPTION, not a module binding: `@layer Trio trainable=(a,b)`
         * (`Flux.jl/test/layers/macro.jl`) and `Base.Experimental.@compiler_options compile=min`
         * (`julia/test/trim/BasicJLL/Zstd_jll/src/Zstd_jll.jl`) both made this side publish members
         * named `trainable`, `compile`, `optimize`, `infer` — declarations no module contains, and
         * rows the analyzer correctly does not emit. A macro's own expansion decides what its
         * arguments mean, and an option assignment is the shape it uses most.
         */
        const addMember = (c: any, inMacroArgs = false): boolean => {
          if (c.type === "function_definition" || c.type === "macro_definition") {
            const n = declaredNameOfSignature(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            return true
          }
          if (c.type === "struct_definition" || c.type === "abstract_definition" || c.type === "primitive_definition") {
            const n = declaredName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            return true
          }
          if (c.type === "const_statement" || c.type === "global_statement" || c.type === "local_statement") {
            // A CHAINED binding declares EVERY name in it: `global binding1 = global binding2 =
            // nothing` puts a second `global_statement` on the right of the first assignment, and
            // reading only the outer left-hand side missed `binding2`
            // (`stdlib/REPL/test/replcompletions.jl:2634`). The analyzer walks the chain and this side
            // has to walk it too, or its correct second row reads as unexplained.
            const readChain = (stmt: any): void => {
              const n = constBindingName(stmt)
              if (n) out.push({ label: "contains", from: owner, target: n })
              const assign = kids(stmt).find((x: any) => x.type === "assignment")
              const rhs = assign ? kids(assign).slice(1) : []
              for (const r of rhs) if (r.type === "global_statement" || r.type === "local_statement") readChain(r)
            }
            readChain(c)
            return true
          }
          if (c.type === "assignment") {
            const n = shortFormName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            // A PLAIN MODULE-SCOPE ASSIGNMENT IS A MEMBER TOO. `artifact_dir::String = ""` and
            // `const PATH = Ref("")`'s non-const twin declare module bindings, and the JLL stubs
            // (LibCURL_jll, Zstd_jll, LibUnwind_jll, p7zip_jll) are written this way. `shortFormName`
            // reads the CALL-headed short form and returns "" here, so the row the analyzer published
            // read as unexplained. The lexical test keeps a `let`/`for` local out.
            else if (!inMacroArgs && declaredInModuleScope(c, node)) {
              const b = constBindingName(c)
              if (b) out.push({ label: "contains", from: owner, target: b })
            }
            return true
          }
          // `@inline fast(x) = x` — the macro ANNOTATES a definition that is written in source, so
          // the definition is a member of the module and the macro is not. Only the assignment is
          // claimed; the macro itself is not, because `@inline` declares nothing.
          //
          // A MACRO DECIDES THE SCOPE OF ITS OWN ARGUMENTS. `@testset "…" begin f(x) = … end`
          // expands its body under a local scope, so f is a LOCAL function and not a member of the
          // module the test file declares; the same is true of `@test_throws`, `@testitem` and any
          // user macro, whose expansion this file cannot see. The analyzer used to attribute every
          // declaration inside one to the enclosing module — 33 of the 200-file draw's unexplained
          // `contains` rows — and this side never did, which is how the disagreement was found.
          //
          // JULIA'S SCOPE-TRANSPARENT MACROS ARE THE EXCEPTION, and they are language facts rather
          // than a heuristic: `@eval` evaluates in the containing module's global scope and
          // `@static`/`@sync`/`@async`/`@time` evaluate their block in the scope it is written in.
          // 63 nameable declarations sit inside an `@eval` block in the same draw against 212 inside
          // a `@testset`, so refusing every macro would trade the larger correct set for the smaller.
          if (c.type === "macrocall_expression") {
            /**
             * A RECOVERED SPAN IS NOT AN ARGUMENT LIST. `julia/Compiler/test/irpasses.jl`'s
             * `@nospecialize(T)` inside a signature comes back as a macrocall spanning 1,660 lines
             * with 309 direct children, and the analyzer refuses that shape (`decoratedDeclarations`,
             * >4 children). This side must refuse it for the same reason: every declaration in the
             * rest of the file is not an argument to that macro.
             */
            const recovered = kids(c).find((x: any) => x.type === "macro_argument_list")
            if (recovered && kids(recovered).length > 4) return true
            const m = kids(c).find((x: any) => x.type === "macro_identifier")
            const raw = m ? String(m.text ?? "").trim() : ""
            const macroName = raw.startsWith("@") ? raw.slice(1) : raw
            if (SCOPE_TRANSPARENT_MACROS.has(macroName)) {
              // A transparent macro's body can be a `macro_argument_list` OR a direct BLOCK child:
              // `@eval begin … end` puts a `compound_statement` straight on the macrocall, so
              // scanning only the argument list found nothing for the spelling every package uses
              // to generate methods.
              for (const a of kids(c)) {
                if (a.type === "macro_identifier") continue
                if (a.type === "macro_argument_list") {
                  for (const inner of kids(a)) collectMembers(inner)
                  continue
                }
                collectMembers(a)
              }
              return true
            }
            // EVERY ARGUMENT IS SCANNED, not just the first that "handles" something. `addMember`
            // returns "consumed", and a nested `@doc(foo)` consumes its own (declaration-free)
            // argument list — so the first version's `if (addMember(inner)) return true` stopped
            // before reaching the declaration that follows it. MEASURED: `julia/../doctestapi.jl`'s
            // `@doc @doc(foo) function bar end` published `bar` on the analyzer side and nothing on
            // this one, because the inner `@doc(foo)` was scanned first and ended the loop.
            for (const a of kids(c)) {
              if (a.type !== "macro_argument_list") continue
              for (const inner of kids(a)) addMember(inner, true)
            }
            return true
          }
          // A nested module is itself a member of its parent; its contents belong to it.
          if (c.type === "module_definition" || c.type === "baremodule_definition") {
            const n = declaredName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            return true
          }
          return false
        }
        // A module's body may be wrapped in `if`/`try`/`begin` at top level. A declaration there
        // is still a module member — `Compiler.jl` defines `macro show` inside
        // `if !isdefined(Base, :end_base_include)`. Recursion stops at every declaration that
        // owns its own scope (function, type, nested module), which is what keeps a method's
        // locals out of the module's membership.
        const collectMembers = (n: any) => {
          if (addMember(n)) return
          for (const c of kids(n)) collectMembers(c)
        }
        for (const c of kids(node)) collectMembers(c)
      }
    }

    for (const c of kids(node)) visit(c)
  }

  /** The name in a long-form signature, through `where` and return-type wrappers. */
  function declaredNameOfSignature(node: any): string {
    const sig = kids(node).find((c: any) => c.type === "signature")
    if (!sig) return ""
    let cur: any = kids(sig)[0]
    // STOP AT THE CALL. The loop used to unwrap a `call_expression` as well, which walked THROUGH
    // the declaration's own call and into its callee — so a callable object
    // (`function (pass::T)(…)`) unwrapped to the ARGUMENT `pass` and was published as a member the
    // module does not contain. The call is the terminus here; the branch below reads its callee.
    for (let i = 0; i < 5 && cur; i++) {
      if (cur.type === "where_expression" || cur.type === "typed_expression" ||
          cur.type === "parenthesized_expression") {
        cur = kids(cur)[0]
        continue
      }
      break
    }
    if (!cur) return ""
    // `function scaled{T<:Real}(s, k)::Float64` unwraps to the signature's `call_expression`, whose
    // CALLEE is a `parametrized_type_expression`. The unwrap loop stopped on that node because it is
    // not one of the wrapper types, and the checks below only understood `call_expression` and
    // `identifier` — so the oracle was silent on every GENERIC method, which is the single most
    // characteristic thing Julia declares. `declaredCallee` already knows how to read a name-bearing
    // node, so it is the right terminus for all of them rather than a special case per wrapper.
    if (cur.type === "call_expression") {
      const callee = kids(cur)[0]
      // A CALLABLE OBJECT has no static name: `function (pass::EnclosingParenHighlightPass)(input,
      // ast, context)` wraps the callable's TYPE in a parenthesised expression, and recursing into it
      // returned the ARGUMENT `pass` — a member the module does not contain, published as truth.
      // The analyzer was right to emit nothing, and the oracle's job is to derive the language's
      // answer, which is that a function declared this way is bound to no name written here.
      if (callee?.type === "parenthesized_expression") {
        const inner = kids(callee)[0]
        return inner && inner.type === "identifier" ? inner.text.trim() : ""
      }
      return callee ? declaredCallee(callee) : ""
    }
    return declaredCallee(cur)
  }

  // A `global` DECLARATION BELONGS TO ITS MODULE AT ANY NESTING, and the container walk above
  // cannot reach the ones that matter: it stops at a function body (whose locals are not members)
  // and at a type body (whose fields are handled by `structFields`). But `global x = …` inside
  // `__init__` is exactly the assertion that `x` is the MODULE's binding, and every JLL stub in
  // Base writes its paths that way (`Zstd_jll.jl:98-101`, `LibCURL_jll.jl`, `p7zip_jll.jl`).
  // MEASURED: the 11 unexplained `contains` rows on the 200-file draw were all this shape — 10 of
  // the 11 in JLL `__init__` bodies, and every one of them a correct analyzer row.
  //
  // It does NOT apply to quoted code: a `global` written inside a macro body or a `quote` block
  // expands at some other site, which is the same reason the analyzer keeps macro bodies out of
  // membership.
  const globalSweep = (n: any) => {
    const isGlobal = n.type === "global_statement" || (n.type === "const_statement" && hasGlobalKeywordToken(n))
    if (isGlobal && !insideQuotedCode(n)) {
      const mod = enclosingModule(n)
      const owner = mod ? declaredName(mod) : ""
      // Only a statement that ASSIGNS declares a binding; `global x` alone asserts one exists.
      // Only the OUTERMOST statement of a chain is visited; its own chain walk reads the rest, so
      // `global a = global b = nothing` cannot publish `b` twice.
      const outermost = !(n.parent && (n.parent.type === "global_statement" || n.parent.type === "const_statement"))
      if (owner && outermost) {
        const chain = (stmt: any) => {
          const assign = kids(stmt).find((x: any) => x.type === "assignment")
          if (!assign) return
          const b = constBindingName(stmt)
          if (b) out.push({ label: "contains", from: owner, target: b })
          for (const r of kids(assign).slice(1)) {
            if (r.type === "global_statement" || r.type === "local_statement") chain(r)
          }
        }
        chain(n)
      }
    }
    for (const c of kids(n)) globalSweep(c)
  }
  globalSweep(root)

  visit(root)
  return out
}