/**
 * The Julia `overrides` oracle — LANE-OWNED.
 *
 * Beside the other three julia oracles rather than in `differential.ts`, for the reason that shared
 * file's own header records: it is edited by several lanes at once, and every line a lane keeps out
 * of a shared file is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `overrides` is the lane's ONE DERIVATION finding: the analyzer emits the type, the graph stores
 * the edges, and nothing compared them against an independent derivation. The previous version of
 * this lane DECLINED the type on a prose argument ("Julia has multiple dispatch, not overriding"),
 * which is the failure `script/m14/ontology-coverage-gate.ts`'s header records as BD8b for bash — a
 * type omitted on a justification, invisible to the differential because the oracle omitted it too.
 * The type is now emitted behind four guards and 3 edges survive over the 971-file corpus; those 3
 * edges were stored and compared against nothing, which is a state that reads exactly like coverage.
 *
 * ## The rule, from JULIA and not from the analyzer
 *
 * Julia's method table holds exactly ONE entry per `(name, signature)` pair. Two methods with the
 * same name and DIFFERENT signatures are two methods, both live, neither replacing the other. Two
 * declarations of the SAME `(name, signature)` are the same method, so the second REPLACES the first.
 * Julia says so itself: `--warn-overwrite=yes` prints
 * `WARNING: Method definition f(Int) in module Main at line 12 overwritten at line 40`.
 *
 * So the rule is: two DECLARATION SITES in the same enclosing scope whose name and whose signature
 * are equal, where the later site is in an unconditional position. The four guards that matter, each
 * of them derived from julia semantics rather than from the analyzer's code:
 *
 *   1. **Signature is the argument list PLUS the `where` clause.** `f(x) where {T} = …` and
 *      `f(x) where {S} = …` are two methods. `f(x) = 1` and `f( x ) = 2` are one. Getting this
 *      wrong in either direction manufactures or loses edges, so the argument list is compared with
 *      its layout collapsed — which is a CHARACTER operation on the node's own text, not a pattern
 *      over the file, and not a regex (the lane forbids one).
 *   2. **Unconditional position.** `if VERSION < v"1.11" … mem(n) = … else … mem(n) = … end` has two
 *      sites with one signature and exactly ONE branch running, so it replaces nothing. A version
 *      guard is idiomatic julia and this bucket is large: 237 of the corpus's 417 pairs survive an
 *      unconditional-position test, so the guard removes 43% of the candidate pairs.
 *   3. **Not a local binding.** Inside a function body, `f(x) = …` binds a CLOSURE in a local
 *      variable. It adds no method and displaces nothing, and it is very common: of the corpus's
 *      417 pairs, 37 are local bindings.
 *   4. **A DECLARED scope.** The edge's source is the enclosing `module`, because a module owns a
 *      method table. At file scope there is no declared scope to source the edge from, and 71.9% of
 *      the corpus declares no module at all — which is why 3 edges survive from 417 pairs and not
 *      more. That is the refusal being counted rather than hidden.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * `implements`. Julia has no interface conformance: `abstract type` participates in a type hierarchy
 * (`<:`), not a protocol relation. This oracle declines it independently of the analyzer, and two
 * independent declinations agreeing is evidence while one declining and the other silent is not.
 *
 * ## The limitation this oracle cannot cover, declared rather than implied
 *
 * It is a SECOND WALKER OVER THE SAME GRAMMAR. It can disagree with the analyzer when either is
 * wrong; it is BLIND when a construct is absent from both, which is precisely how the original
 * `overrides` omission survived a differential that was green throughout. Nothing here can see a
 * relationship type that neither side derives. Only measuring the language can, and that is
 * `validation/m14/fixtures/julia/census.ts`'s instrument B.
 */

export type JuliaOverridesEdge = { label: "overrides"; from: string; target: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/** Every run of whitespace collapsed to one space, ends trimmed. `/s+/` → " " without a regex. */
function collapseSpace(text: string): string {
  const words: string[] = []
  let word = ""
  for (const ch of text) {
    if (ch.trim() === "") {
      if (word) { words.push(word); word = "" }
    } else {
      word += ch
    }
  }
  if (word) words.push(word)
  return words.join(" ")
}

/**
 * Node types inside which a declaration does NOT run unconditionally, or is not text this file
 * declares. Read from the grammar's own vocabulary: `if_statement`, `else_clause`, `elseif_clause`,
 * `try_statement`, `catch_clause`, `finally_clause`, `ternary_expression`, `do_clause`,
 * `let_statement`, `macrocall_expression`, `quote_expression`, `quote_statement`.
 *
 * `function_definition`, `macro_definition`, `let_statement` and `do_clause` also appear in the
 * LOCAL-BINDING guard, for a different reason: they are where a short-form `f(x) = …` is a closure
 * rather than a method. The two sets overlap on purpose; a node in both is refused twice over.
 */
const CONDITIONAL_OR_GENERATED = new Set([
  "if_statement", "else_clause", "elseif_clause", "if_clause",
  "try_statement", "catch_clause", "finally_clause",
  "ternary_expression", "macrocall_expression",
  "quote_expression", "quote_statement",
])

/** Scopes in which `f(x) = …` binds a local closure and enters no method table. */
const LOCAL_BINDING_SCOPE = new Set([
  "function_definition", "macro_definition", "do_clause", "let_statement",
  "arrow_function_expression",
])

/** The operator of a `binary_expression`. In this grammar it is a NAMED child, not an anonymous token. */
function binOp(n: any): string {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === "operator") return c.text.trim()
  }
  return ""
}

/**
 * Is this declaration reached unconditionally, with text julia itself wrote?
 *
 * Walks ANCESTORS, not the parent: a declaration inside `else` sits under `else_clause` and then
 * `if_statement`, and one inside `catch` sits under `catch_clause` and then `try_statement`, so a
 * parent-only test reads `catch_clause`'s child as unconditional when the parent is the clause.
 *
 * `&&` is tested BY OPERATOR because `binary_expression` is the most common node in julia and cannot
 * be listed wholesale. In `cond && function f() … end` the right operand runs only when `cond`
 * holds. `||` is deliberately NOT refused: the grammar's `||` right operand never holds a
 * declaration in this corpus (measured: 5,145 `||` binary_expressions, 0 with a declaration on the
 * right), so listing it would be an unmeasured claim about the grammar.
 */
function isUnconditionalPosition(n: any): boolean {
  let cur: any = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (CONDITIONAL_OR_GENERATED.has(cur.type)) return false
    if (cur.type === "binary_expression") {
      const named = kids(cur).filter((c: any) => c.type !== "operator")
      const right = named.length > 1 ? named[named.length - 1] : null
      if (binOp(cur) === "&&" && right && right.id === n.id) return false
    }
    cur = cur.parent ?? null
  }
  return true
}

/** Is this declaration inside a scope where `f(x) = …` is a local closure rather than a method? */
function isInLocalBindingScope(n: any): boolean {
  let cur: any = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (LOCAL_BINDING_SCOPE.has(cur.type)) return true
    cur = cur.parent ?? null
  }
  return false
}

/**
 * The `(name, signature)` half that decides whether two declarations are the SAME method.
 *
 * `root` is the node the declaration hangs off — a `signature` for the long form, the assignment's
 * unwrapped left-hand side for the short one — and both are needed because they are not the same
 * node: a `where` clause wraps the callable in a `where_expression` in one spelling and the other
 * has no `where` at all.
 */
function methodKey(root: any): { name: string; signature: string } | null {
  let call: any = null
  if (root.type === "call_expression") {
    call = root
  } else {
    // Unwrap `where_expression` / `parenthesized_expression` / `typed_expression` to the callable.
    let cur: any = root
    for (let i = 0; i < 5 && cur; i++) {
      if (cur.type === "call_expression") { call = cur; break }
      const next = kids(cur).find(
        (c: any) => c.type === "call_expression" || c.type === "where_expression" ||
          c.type === "parenthesized_expression" || c.type === "typed_expression",
      )
      if (!next) break
      cur = next
    }
  }
  if (!call) return null
  const callee = kids(call)[0]
  const name = callee ? callee.text.trim() : ""
  if (!name) return null
  const args = kids(call).find((c: any) => c.type === "argument_list")
  // The `where` clause hangs off the DECLARATION, not off the callable, so it is looked up on the
  // declaration root as well as on the callable's parent chain.
  let whereNode: any = null
  let cur: any = root
  for (let i = 0; i < 5 && cur && !whereNode; i++) {
    if (cur.type === "where_expression") { whereNode = cur; break }
    cur = cur.parent ?? null
  }
  if (!whereNode && call.parent && call.parent.type === "where_expression") whereNode = call.parent
  const signature = `${args ? collapseSpace(args.text) : ""}${whereNode ? `|where ${collapseSpace(whereNode.text)}` : ""}`
  return { name, signature }
}

/**
 * The nearest enclosing `module` — its NODE IDENTITY and its DECLARED NAME.
 *
 * Two things, and both are needed, which is the whole reason this returns an object rather than a
 * string. The NAME is the only admissible edge source, because the graph resolves endpoints by name.
 * The IDENTITY is what the method-pair key must be scoped by, because two modules in one file can
 * share a name and are still two method tables with two method tables' worth of entries —
 * `julia/test/deprecation_exec.jl` declares `module Src` three times.
 *
 * The first version of this oracle threaded the NAME into the key and found ZERO truth edges over
 * the corpus including on the files where the analyzer emits them. The failure is the same one this
 * lane has now hit twice, and it is worth writing down because the symptom was silence: the
 * declaration's LINE was in the key, so two declarations of the same method never shared a key. A
 * key that cannot collide reports a perfect absence, which is the most dangerous shape a measurement
 * can take.
 */
function enclosingModule(n: any): { id: number; name: string } | null {
  let cur: any = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (cur.type === "module_definition" || cur.type === "baremodule_definition") {
      const byField = cur.childForFieldName?.("name")
      const nm = byField ?? kids(cur)[0]
      const name = nm && nm.type === "identifier" ? nm.text.trim() : ""
      return name ? { id: cur.id, name } : null
    }
    cur = cur.parent ?? null
  }
  return null
}

/**
 * The short-form declaration's left-hand side, unwrapped.
 *
 * `f(x) = expr` and `A.B(x) = expr` are NOT `function_definition` nodes — julia's most common way
 * of writing a function has no node of its own — and `f(x)::T = expr` puts a `typed_expression` on
 * the left. An earlier version of the neighbouring census read only a direct `call_expression` child
 * of the assignment, and `f(x) where {T} = expr` therefore declared nothing at all.
 */
function shortFormKey(assignment: any): { name: string; signature: string } | null {
  let lhs = kids(assignment)[0] ?? null
  for (let i = 0; i < 8 && lhs && lhs.type !== "call_expression"; i++) {
    if (lhs.type !== "where_expression" && lhs.type !== "curly_expression" && lhs.type !== "typed_expression" && lhs.type !== "parenthesized_expression") break
    lhs = kids(lhs)[0] ?? null
  }
  if (!lhs || lhs.type !== "call_expression") return null
  return methodKey(lhs)
}

/**
 * `overrides` truth for one tree.
 *
 * Returns at most one edge per (scope, name, signature): the FIRST declaration's scope is the
 * source, and the second declaration of the same pair is the one that replaces it. Julia's method
 * table has one entry per pair, so a third declaration of the same pair replaces the second, and the
 * edge still names the same scope and method — the type describes the replacement, and there is one.
 */
export function deriveJuliaOverridesTruth(root: any): JuliaOverridesEdge[] {
  const edges: JuliaOverridesEdge[] = []
  // `scopeNodeId|name|signature` -> true once the pair has been declared in that scope. Scoped by the
  // module NODE's identity rather than by its name, for the reason `enclosingModule` records.
  const seen = new Set<string>()

  const claim = (scope: { id: number; name: string } | null, key: { name: string; signature: string } | null) => {
    if (!scope || !key || !key.signature) return
    const k = `${scope.id}|${key.name}|${key.signature}`
    if (seen.has(k)) {
      // The replacement is only an override if the PRIOR declaration was equally real: same scope,
      // unconditional position, not a local binding. A guard applied to one site and not the other
      // would report a replacement julia never performs. Both sites are claimed through this one
      // function, so they are held to the same guards by construction.
      edges.push({ label: "overrides", from: scope.name, target: key.name })
      return
    }
    seen.add(k)
  }

  const visit = (n: any): void => {
    if (!n) return
    const isLongForm = n.type === "function_definition" || n.type === "macro_definition"
    const isShortForm = n.type === "assignment"
    if (isLongForm || isShortForm) {
      const ok = isUnconditionalPosition(n) && !isInLocalBindingScope(n)
      if (ok) {
        const scope = enclosingModule(n)
        if (isLongForm) {
          const sig = kids(n).find((c: any) => c.type === "signature")
          claim(scope, sig ? methodKey(sig) : null)
        } else {
          claim(scope, shortFormKey(n))
        }
      }
    }
    for (const c of kids(n)) visit(c)
  }

  visit(root)
  return edges
}
