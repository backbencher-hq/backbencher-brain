/**
 * ZIG WAVE 2 — the `references` ORACLE source, kept as a probe so the text
 * survives a /tmp cleaner: the canonical copy lives in
 * `script/m14/differential.ts` as `deriveZigReferenceEdges`, and this file is
 * what was spliced in. Kept because the oracle is the lane's only second
 * opinion for its largest emitted class, and an oracle that exists only in a
 * patch is an oracle nobody can review.
 *
 * WHY THIS EXISTS. Until now the zig lane's differential derived `calls` and
 * `uses` and nothing else, so the `references` class — declared-type
 * dependencies and import edges, the largest emitted class on the zig corpora —
 * was compared against NOTHING. The allowlist that keeps the comparison honest
 * dropped the analyzer's own `references` edges from the compared side, so a
 * fabricated declared-type reference, a lost one, and a corrupted one were all
 * invisible: the lane reported 100% coverage with a phantom type reference in
 * the graph.
 *
 * The three measured defects this oracle now audits, all of which the class's
 * own gates could not see:
 *   - the default VALUE was the declared type (`size: Size = .byte` published
 *     `-> byte`);
 *   - a type that names nothing published its FIELD name or its error member;
 *   - the local annotation position was absent from the collector.
 *
 * INDEPENDENCE. Every POSITION and every LEAF is re-derived here with its own
 * traversal. The one shared object with the analyzer is
 * `ZIG_DECLARED_TYPE_BUILTINS`, the type-name vocabulary, IMPORTED rather than
 * re-typed (the #916 lesson: a second copy of a name set is a second answer,
 * and two copies that cancel out of every count is how a self-agreeing edge
 * survives a year of gates). The leaf rules below MIRROR the analyzer's rather
 * than importing them, so the two implementations can disagree — and the
 * red-team in `zigw-oracle-check.ts` is what proves they do.
 */
export function deriveZigReferenceEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (target: string, from: string) => {
    const t = String(target ?? "")
    if (!t) return
    if (ZIG_DECLARED_TYPE_BUILTINS.has(t)) return
    // the analyzer's digit-head refusal (`123abc`-style heads are not types)
    const c0 = t.charCodeAt(0)
    if (c0 >= 48 && c0 <= 57) return
    const key = "references:" + t
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "references", from, target: t })
  }

  const direct = (p: any, type: string): any | null => {
    if (!p) return null
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }
  const fieldOf = (n: any, name: string): any | null =>
    n && typeof n.childForFieldName === "function" ? n.childForFieldName(name) ?? null : null

  // ── imports: `@import("x")` as a declaration RHS, or a usingnamespace ──────
  // The module path is a `string` under `arguments`; the quotes are stripped
  // because the published target is a module NAME. A builtin inside an ERROR
  // node is not a direct child, so the error-recovered
  // `const x = usingnamespace @import("y.zig")` (invalid in current Zig) yields
  // no import on EITHER side — which is the analyzer's own rule, mirrored.
  const importTarget = (callOrBuiltin: any): string | null => {
    const bi = direct(callOrBuiltin, "builtin_identifier")
    if (!bi || (bi.text !== "@import" && bi.text !== "@cImport")) return null
    const args = direct(callOrBuiltin, "arguments")
    const str = args ? direct(args, "string") ?? direct(args, "string_content") : null
    if (!str) return null
    const raw = String(str.text ?? "")
    if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
      return raw.slice(1, -1)
    }
    return raw
  }

  // ── declared types: the grammar's `type` FIELD, never a walk ───────────────
  // Mirrors the analyzer's `leafOfTypeNode`:
  //   - a container literal in a type position is ANONYMOUS (fields, no name);
  //   - an `error_type` is an unnamed set;
  //   - `!T` keeps its dependency in the `ok` half;
  //   - a labeled_type_expression names nothing knowable without its block;
  //   - otherwise the last `identifier` at or under the type node.
  const leaf = (t: any, depth = 0): string | null => {
    if (!t || depth > 6) return null
    if (t.type === "identifier") return String(t.text ?? "")
    if (t.type === "error_union_type") {
      const ok = fieldOf(t, "ok")
      return ok ? leaf(ok, depth + 1) : null
    }
    if (t.type === "error_type" || t.type === "labeled_type_expression") return null
    if (t.type === "struct_declaration" || t.type === "union_declaration" || t.type === "enum_declaration" || t.type === "error_set_declaration") return null
    let found: string | null = null
    const stack: any[] = [t]
    let guard = 0
    while (stack.length > 0 && guard++ < 200) {
      const n = stack.pop()!
      if (n.type === "identifier") found = String(n.text ?? "")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return found
  }
  const typeLeafFor = (decl: any): string | null => {
    const tf = fieldOf(decl, "type")
    if (tf) return leaf(tf)
    if (decl.type === "container_field" || decl.type === "variable_declaration") return null
    // parameter: a fn-TYPE parameter has no name and its child is the type; a
    // NAMED parameter with no type field is a recovered shape, where the type is
    // the first identifier after the name.
    const nameF = fieldOf(decl, "name")
    if (!nameF) return leaf(decl)
    const stack: any[] = []
    for (let i = decl.namedChildCount - 1; i >= 0; i--) {
      const c = decl.namedChild(i)
      if (c && c.id !== nameF.id) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier") return String(n.text ?? "")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "function_declaration" || t === "function_signature") {
      const params = direct(n, "parameters")
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (p && p.type === "parameter") push(typeLeafFor(p), "(declared-type)")
        }
      }
      // the return type is the grammar's `type` field (37,129 of 37,129 corpus
      // functions carry one); the positional fallback mirrors the analyzer's
      const ret = fieldOf(n, "type")
      if (ret) {
        push(leaf(ret), "(declared-type)")
      } else {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) kids.push(c)
        }
        for (let i = kids.length - 1; i >= 0; i--) {
          const c = kids[i]
          if (c.type === "block" || c.type === "parameters" || c.type === "block_expression") continue
          if (i === 0 && c.type === "identifier") continue
          if (c.type === "calling_convention") continue
          push(leaf(c), "(declared-type)")
          break
        }
      }
    } else if (t === "container_field" || t === "variable_declaration") {
      push(typeLeafFor(n), "(declared-type)")
    }
    if (t === "variable_declaration") {
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) kids.push(c)
      }
      const rhs = kids.length > 0 ? kids[kids.length - 1] : null
      if (rhs && (rhs.type === "call_expression" || rhs.type === "builtin_function")) {
        const target = importTarget(rhs)
        if (target) push(target, "(global)")
      }
    }
    if (t === "using_namespace_declaration") {
      const target = importTarget(direct(n, "builtin_function"))
      if (target) push(target, "(global)")
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return edges
}
