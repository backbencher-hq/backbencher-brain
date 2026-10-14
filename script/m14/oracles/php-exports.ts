// LANE-OWNED (php), 2026-10-08. `exports` was php's LAST un-audited label: the analyzer
// emits it (58 edges over the whole admitted population), the differential compared
// nothing, and `rel-type-coverage-gate` reported it as
// `DERIVATION|php|emits exports but the differential audits [...] — the type is stored and
// compared against nothing`. Two rounds of doc prose said the same thing in different
// words; this file is the oracle that ends it.
//
// It lives in `script/m14/oracles/` rather than inside `differential.ts` for the reason
// `php-contains.ts` and `dart-contains.ts` give: the shared harness is edited by several
// lanes at once, and every line a lane keeps out of it is a line that cannot conflict.
// Wiring is one import and one registration.
//
// WHY NOT A COPY OF THE ANALYZER'S RULE. The point of a second implementation is that it
// shares no code with the first — `script/m60/php-oracle-independence.ts` runs the same
// check for this lane's declarations, and it exists because a "truth" derived by calling
// the analyzer can only ever agree with it. So this file was written from PHP's
// semantics and the pinned grammar, and the grammar shapes below were READ OFF THE TREE
// (`validation/m14/fixtures/php/callee-shapes.mts` prints every callee spelling and
// asserts its field shape) rather than inferred from the analyzer's source.
//
// THE RULE, in PHP's own terms. A file PUBLISHES a constant when it executes a call to
// the global `define()` with a literal name, at a point that runs when the file is
// included. Three properties decide it:
//
//   1. THE CALLEE RESOLVES TO THE GLOBAL `define`. Two spellings do, and only two:
//        `define(...)`   — an unqualified name; the manual's fallback rule ("For
//                          functions and constants, PHP will fall back to global
//                          functions or constants if a namespaced function or constant
//                          does not exist") reaches the global function when the current
//                          namespace declares none. NOT modelling "when the current
//                          namespace declares none" is a MEASURED choice: the whole-
//                          population define-audit found 0 files that declare their own
//                          `define`, so the shadowed case has no instances to resolve.
//        `\define(...)`  — a FULLY QUALIFIED name: "Fully qualified names always resolve
//                          to the name without leading namespace separator", so this is
//                          the global function in every program, unconditionally.
//      NOT publications: `Other\define` (qualified — the current namespace, or the import
//      table, is prepended), `namespace\define` (relative — resolves to the current
//      namespace and does not fall back, because the fallback is a rule for UNQUALIFIED
//      names), a method call named `define` (`$o->define`, `Foo::define` — PHP never
//      routes a method call to the global function; note the grammar puts those in
//      `member_call_expression` / `scoped_call_expression` with NO `function` field), a
//      variable callee (`$f(...)`), and the aliased `use function define as pub` (which
//      DOES publish, and occurs 0 times in 5,094 files, so it is priced rather than
//      half-implemented).
//
//   2. THE FIRST ARGUMENT'S VALUE IS A STRING LITERAL. `define($name, 1)` publishes a
//      name nobody can write down, so there is no endpoint to point at. Measured: 1
//      occurrence in the population, deliberately unemitted by both sides.
//      The VALUE node is read THROUGH the `argument` wrapper — the shape that made this
//      lane's first probe read a vacuous zero over the whole corpus (see
//      `exports-probe-controls.mts`), and the reason the controls for it exist.
//
//   3. THE CALL IS AT FILE SCOPE — no enclosing callable or type body. A `define()` in a
//      function body publishes the name only if that function runs, so an edge from the
//      FILE would assert something the file does not guarantee. A top-level `if` is NOT a
//      scope: it executes when the file is included, so it does publish, and that
//      asymmetry is pinned by the fixture `php/define-exports`.
//
// THE NAMED SHAPES, from the grammar (probe-verified, not paraphrased):
//
//   function_call_expression  function: name            "define"            -> bare
//   function_call_expression  function: qualified_name  "\define"           -> absolute
//   function_call_expression  function: qualified_name  "Other\define"      -> qualified
//   function_call_expression  function: relative_name   "namespace\define"  -> relative
//   function_call_expression  function: variable_name   "$f"                -> dynamic
//   member_call_expression    function: null            name: "define"      -> method
//   scoped_call_expression    function: null            name: "define"      -> method
//
// WHAT THIS ORACLE DELIBERATELY DOES NOT DERIVE, each with its measured count over the
// 5,094-file population (`validation/m60/php/exports-probe.json`, the `defineAudit` block):
// 3 nested literal `define()` calls, 1 nested non-literal, 536 dynamic-callee calls, and
// the 0-occurrence qualified / relative / aliased / alias-call shapes above. Every one of
// them is an EXCLUDED row with a stated reason, not an unexamined one.
//
// THE EDGE SHAPE. `from: "global"` is the spelling this lane's other two file-scoped edge
// types use (`imports` via `emitUseClause`, `imports` via `emitInclude`); the differential
// matches on label+target, so `from` documents intent and does not affect the comparison.
// The target is the literal's text with its QUOTES REMOVED and its escape sequences LEFT
// AS WRITTEN — `define("A\nB", 1)` publishes the characters `A\nB`, and both sides have to
// agree on what a published name IS before either can be checked against the other.
// Deduping is per file on `label:target`, which is the shape the analyzer side is collapsed
// to by the harness before comparison (the analyzer emits one edge per call SITE; a file
// that defines the same name twice is one edge after the collapse, and one row here).

export function derivePhpExportsTruth(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()

  /**
   * A callable or type BODY — the ancestors that make a `define()` conditional.
   *
   * Written from the grammar's body shapes. A braced `namespace { ... }` block is NOT in
   * this set and must not be: it is the file's own scope, and a `define()` inside it runs
   * when the file is included. `compound_statement` and `statement` are equally absent on
   * purpose — a top-level `if` body is one, and its `define()` still runs.
   */
  const BODY_KINDS = new Set([
    "function_definition",
    "method_declaration",
    "anonymous_function",
    "arrow_function",
    "class_declaration",
    "interface_declaration",
    "trait_declaration",
    "enum_declaration",
  ])

  /** File scope = no body between this call and the program root. */
  const isFileScope = (call: any): boolean => {
    let a: any = call?.parent
    let guard = 0
    while (a && guard++ < 64) {
      if (BODY_KINDS.has(String(a.type))) return false
      if (a.type === "program") return true
      a = a.parent
    }
    return false
  }

  /** The Nth argument's VALUE node, looking through the `argument` wrapper. */
  const argumentValueAt = (call: any, index: number): any => {
    const args = call.namedChildren?.find?.((k: any) => k.type === "arguments")
    const wanted = args?.namedChild(index)
    if (!wanted) return null
    return wanted.type === "argument" ? wanted.namedChild(0) : wanted
  }

  /** The name a string literal writes: quotes off, escapes as written. */
  const literalName = (node: any): string | null => {
    if (!node || (node.type !== "string" && node.type !== "encapsed_string")) return null
    const text = String(node.text ?? "")
    if (text.length < 2) return null
    return text.slice(1, -1)
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "function_call_expression") {
      const callee = n.childForFieldName?.("function")
      const spelling = callee?.text
      // `name` "define" (unqualified) or `qualified_name` "\define" (fully qualified).
      // A TEXT test here is a test on the CALLEE NODE's own text, which is what the
      // grammar gives; it is not a scan of the file's bytes.
      const resolvesToGlobal = spelling === "define" || spelling === "\\define"
      if (resolvesToGlobal && isFileScope(n)) {
        const name = literalName(argumentValueAt(n, 0))
        if (name !== null && name.length > 0 && name.trim().length > 0) {
          const key = "exports:" + name
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ label: "exports", from: "global", target: name })
          }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return edges
}
