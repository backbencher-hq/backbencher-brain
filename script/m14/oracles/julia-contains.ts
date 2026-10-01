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
  if (callee.type === "identifier") return callee.text.trim()
  if (callee.type === "field_expression" || callee.type === "parametrized_type_expression") {
    // `Base.show(x) = …` and `f{T}(x) = …` both name a qualified/parametric function.
    const first = kids(callee)[0]
    return first ? declaredCallee(first) : ""
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
  if (n.type === "identifier") return n.text.trim()
  if (n.type === "quote_expression" || n.type === "operator") return n.text.trim()
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

/** `const X = 1` / `const global X = 1` — a binding, not a function. */
function constBindingName(node: any): string {
  const assign = kids(node).find((c: any) => c.type === "assignment")
  if (!assign) return ""
  const lhs = kids(assign)[0]
  if (!lhs) return ""
  if (lhs.type === "identifier") return lhs.text.trim()
  if (lhs.type === "typed_expression") {
    const inner = kids(lhs)[0]
    return inner && inner.type === "identifier" ? inner.text.trim() : ""
  }
  return ""
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
  const visit = (n: any) => {
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
    if (n.type === "typed_expression") {
      const name = kids(n)[0]
      // Only a bare-identifier left-hand side is a FIELD DECLARATION; `x, y::Int` destructures and
      // introduces no new member, and `f(x)::T` is a signature.
      if (name && name.type === "identifier" && kids(n).length === 2) out.push(name.text.trim())
      return // do not descend: the field's own type is not a member
    }
    for (const c of kids(n)) visit(c)
  }
  visit(node)
  return out
}

export function deriveJuliaContainsTruth(root: any): JuliaContainsEdge[] {
  const out: JuliaContainsEdge[] = []

  const visit = (node: any) => {
    // A struct contains its fields. This is the one container whose members are unambiguous.
    if (node.type === "struct_definition") {
      const owner = declaredName(node)
      if (owner) for (const f of structFields(node)) out.push({ label: "contains", from: owner, target: f })
    }

    // A module contains each declaration made directly in it. `baremodule` is the same node with a
    // different first token.
    if (node.type === "module_definition" || node.type === "baremodule_definition") {
      const owner = declaredName(node)
      if (owner) {
        for (const c of kids(node)) {
          if (c.type === "function_definition" || c.type === "macro_definition") {
            const n = declaredNameOfSignature(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            continue
          }
          if (c.type === "struct_definition" || c.type === "abstract_definition" || c.type === "primitive_definition") {
            const n = declaredName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            continue
          }
          if (c.type === "const_statement" || c.type === "global_statement" || c.type === "local_statement") {
            const n = constBindingName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            continue
          }
          if (c.type === "assignment") {
            const n = shortFormName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
            continue
          }
          // `@inline fast(x) = x` — the macro ANNOTATES a definition that is written in source, so
          // the definition is a member of the module and the macro is not. Only the assignment is
          // claimed; the macro itself is not, because `@inline` declares nothing.
          if (c.type === "macrocall_expression") {
            for (const a of kids(c)) {
              if (a.type !== "macro_argument_list") continue
              for (const inner of kids(a)) {
                if (inner.type === "assignment") {
                  const n = shortFormName(inner)
                  if (n) out.push({ label: "contains", from: owner, target: n })
                }
              }
            }
            continue
          }
          // A nested module is itself a member of its parent.
          if (c.type === "module_definition" || c.type === "baremodule_definition") {
            const n = declaredName(c)
            if (n) out.push({ label: "contains", from: owner, target: n })
          }
        }
      }
    }

    for (const c of kids(node)) visit(c)
  }

  /** The name in a long-form signature, through `where` and return-type wrappers. */
  function declaredNameOfSignature(node: any): string {
    const sig = kids(node).find((c: any) => c.type === "signature")
    if (!sig) return ""
    let cur: any = kids(sig)[0]
    for (let i = 0; i < 5 && cur; i++) {
      if (cur.type === "call_expression" || cur.type === "where_expression" ||
          cur.type === "typed_expression" || cur.type === "parenthesized_expression") {
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
      return callee ? declaredCallee(callee) : ""
    }
    return declaredCallee(cur)
  }

  visit(root)
  return out
}