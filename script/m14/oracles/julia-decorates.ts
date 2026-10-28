/**
 * The Julia `decorates` oracle — LANE-OWNED.
 *
 * `decorates` was added to the lane on 2026-10-27 with an implementation and a fixture, but no
 * independent derivation. That is exactly the state the honesty contract calls a DERIVATION
 * finding: the edges are stored and nothing corroborates them. This oracle derives the same fact
 * from Julia's own rule — a macro APPLIED TO a declaration is an application of that macro, not a
 * call to it — without importing the analyzer's helper, rule table or key set.
 *
 * ## The rule
 *
 * `@inline function f`, `Base.@kwdef struct S`, `@doc "…" function g`, `@inline h(x) = x` and
 * `@enum E a b` all put a DECLARATION directly in the macro's argument list. The relation is
 * directed decorated declaration → decorator, the direction `src/ast/types.ts` fixes for every
 * lane.
 *
 * The declaration must be a DIRECT argument. `@testset begin f(x) = x end` is a macro wrapping a
 * block that happens to contain a declaration; the macro is not applied to `f`, and treating it as
 * a decorator would turn every test block into one. The first draft scanned arbitrarily deep and
 * did exactly that.
 *
 * A macro whose arguments contain no declaration is a real macro CALL (`@time f()`, `@test x`) and
 * contributes nothing here; the calls oracle derives it independently.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * It does not resolve the decorator binding. `Base.@kwdef` and a user-defined `@kwdef` produce the
 * same target spelling, because the source names the same macro binding and the resolution question
 * is a project-wide one this per-file relation does not answer.
 */

export type JuliaDecoratesEdge = { label: "decorates"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** The macro's binding name, without its sigil. */
function macroName(n: any): string {
  if (!n) return ""
  const text = String(n.text ?? "").trim()
  let start = 0
  while (start < text.length && text.charCodeAt(start) === 64 /* @ */) start++
  return text.slice(start).trim()
}

/**
 * The name a `quote_expression` spells: the OPERATOR for `:(==)` / `:+`, the symbol for `:foo`.
 *
 * `Base.:(==)` and `Base.==` name ONE binding and the lane keys a binding by one spelling — the
 * analyzer publishes the unwrapped operator (`quotedName` in real-julia-analyzer.ts), and this side
 * kept the written wrapper, so `@eval function Base.:(==)(…)` read as an unexplained row beside a
 * missing one. The `:` and the parens are syntax, not part of the name.
 */
function quotedName(n: any): string {
  const inner = kids(n)[0]
  const plain = (x: any): string =>
    x && (x.type === "operator" || x.type === "identifier") && !String(x.text ?? "").includes("\n")
      ? String(x.text).trim()
      : ""
  if (inner) {
    const direct = plain(inner)
    if (direct) return direct
    if (inner.type === "parenthesized_expression") {
      const op = plain(kids(inner)[0])
      if (op) return op
    }
  }
  return String(n.text ?? "").trim()
}

/** The leftmost name of a type head, through the wrappers the grammar uses. */
function typeName(head: any): string {
  if (!head) return ""
  if (head.type === "quote_expression") return quotedName(head)
  if (head.type === "identifier" || head.type === "operator") {
    return String(head.text ?? "").trim()
  }
  if (head.type === "field_expression") {
    // A qualified type declaration is one name, not its first segment.
    const parts = kids(head).map(typeName).filter(Boolean)
    return parts.join(".")
  }
  if (head.type === "binary_expression") {
    const operands = kids(head).filter((c: any) => c.type !== "operator")
    return typeName(operands[0])
  }
  if (head.type === "type_head" || head.type === "where_expression" ||
      head.type === "parenthesized_expression" || head.type === "parametrized_type_expression") {
    return typeName(kids(head)[0])
  }
  return ""
}

/** The declared name in a long-form signature, through `where` and return-type wrappers. */
function signatureName(sig: any): string {
  if (!sig) return ""
  if (sig.type === "signature") return signatureName(kids(sig)[0])
  if (sig.type === "typed_expression") return signatureName(kids(sig)[0])
  if (sig.type === "parenthesized_expression") return signatureName(kids(sig)[0])
  if (sig.type === "where_expression") return signatureName(kids(sig)[0])
  if (sig.type === "call_expression") return calleeName(kids(sig)[0])
  if (sig.type === "quote_expression") return quotedName(sig)
  // `function qux end` — a long-form declaration with NO argument list. The grammar puts a bare
  // `identifier` in the signature, and every case above misses it, so `@doc @doc(foo) function bar
  // end` derived no decorates row while the analyzer published one (measured: doctestapi.jl).
  if (sig.type === "identifier" || sig.type === "operator") return String(sig.text ?? "").trim()
  return ""
}

/** The name a callee introduces; a qualified path is kept whole. */
function calleeName(n: any): string {
  if (!n) return ""
  if (n.type === "quote_expression") return quotedName(n)
  if (n.type === "identifier" || n.type === "operator") {
    return String(n.text ?? "").trim()
  }
  if (n.type === "field_expression") {
    const parts = kids(n).map(calleeName).filter(Boolean)
    return parts.join(".")
  }
  // A TYPED PATTERN IS A VALUE, NOT A DECLARATION'S NAME. `(m::Model)(x) = …` adds a method to
  // `Model`'s call table and declares no binding named `m`; naming it after the pattern's VARIABLE
  // is the fabrication the analyzer refuses (its `calleeName` returns null for a parenthesised
  // typed callee). The parenthesised case unwraps only the `where`/paren wrappers before testing,
  // because `(t::Type{Model} where X)(x) = …` puts a `where_expression` between the parens and the
  // typed pattern — unwrapping THROUGH the typed node is what published `T` as a name.
  if (n.type === "typed_expression" || n.type === "unary_typed_expression") return ""
  if (n.type === "parenthesized_expression") {
    let base = kids(n)[0]
    for (let i = 0; i < 4 && base &&
         (base.type === "where_expression" || base.type === "parenthesized_expression"); i++) {
      base = kids(base)[0]
    }
    if (base && (base.type === "typed_expression" || base.type === "unary_typed_expression")) return ""
    return calleeName(kids(n)[0])
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression") {
    return calleeName(kids(n)[0])
  }
  return ""
}

/** The name of a declaration node, or "" when the node declares nothing. */
function declaredName(n: any): string {
  if (n.type === "function_definition" || n.type === "macro_definition") {
    const sig = kids(n).find((c: any) => c.type === "signature")
    return signatureName(sig)
  }
  if (n.type === "struct_definition" || n.type === "abstract_definition" ||
      n.type === "primitive_definition") {
    return typeName(kids(n).find((c: any) => c.type === "type_head"))
  }
  if (n.type === "module_definition" || n.type === "baremodule_definition") {
    const byField = n.childForFieldName?.("name")
    if (byField) return String(byField.text ?? "").trim()
    return typeName(kids(n)[0])
  }
  if (n.type === "assignment") {
    // `h(x) = x` — the declaration is the left-hand call, reached through the same wrappers the
    // analyzer unwraps. A plain `x = 1` is a binding, not a declaration a macro decorates.
    let lhs = kids(n)[0]
    for (let i = 0; i < 4 && lhs; i++) {
      if (lhs.type === "call_expression") return calleeName(kids(lhs)[0])
      if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
          lhs.type === "parenthesized_expression") {
        lhs = kids(lhs)[0]
        continue
      }
      break
    }
  }
  return ""
}

export function deriveJuliaDecoratesTruth(root: any): JuliaDecoratesEdge[] {
  const out: JuliaDecoratesEdge[] = []
  const seen = new Set<string>()

  const visit = (n: any) => {
    if (n.type === "macrocall_expression") {
      const macroNode = kids(n).find((c: any) => c.type === "macro_identifier")
      const name = macroName(macroNode)
      const args = kids(n).find((c: any) => c.type === "macro_argument_list")
      // A RECOVERED SPAN IS NOT AN ARGUMENT LIST — the same guard the analyzer applies, measured on
      // `julia/Compiler/test/irpasses.jl`: `@nospecialize(T)` inside a signature comes back as a
      // macrocall spanning 1,660 lines with 309 direct children, and harvesting those published a
      // `decorates -> nospecialize` row for every declaration after it. A decorator macro takes a
      // handful of arguments; above four the node is the parser's recovery of a broken region.
      if (name && args && kids(args).length <= 4) {
        for (const arg of kids(args)) {
          const decorated = declaredName(arg)
          if (!decorated) continue
          const key = `${decorated}|${name}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ label: "decorates", from: decorated, target: name })
        }
      }
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return out
}
