/**
 * 2026-09-28: csharp's BARE-IDENTIFIER `uses` truth — the last unoracled slice of the lane's
 * output (617 rows, 2.4%, marker `identifier_usage`, confidence 1.0).
 *
 * WHAT IS AND IS NOT INDEPENDENT HERE, stated first because it bounds the claim. The MEMBER
 * INVENTORY — which names are Property-kind members of which type — is passed IN from the
 * analyzer's own symbol table, and that is the family's sanctioned arrangement (the zig lane's
# `deriveZigBareUses` does the same, and for the same reason): the question this truth audits is
 * *which identifier SITES read which member*, and re-deriving the inventory as well would only
 * create a second place to be wrong about a set the harness already trusts. Everything the audit
 * is actually about — the RESOLUTION walk, the shadowing frames, and every exclusion gate — is
 * re-derived here from the tree.
 *
 * THE RULE, and the shape of it:
 *
 *   resolve   an identifier reads when it is not excluded (below) AND it is not shadowed by a
 *             lexically enclosing binding AND some enclosing class — innermost first, then its
 *             base chain breadth-first to a bounded depth, then outward to the next enclosing
 *             class — DECLARES a Property-kind member of that name. Methods, enum members, events
 *             and delegates never resolve bare: a bare method name is a method GROUP, and the
 *             rest are qualified-only in C#.
 *   shadow    walk-order frames: a method's and a local function's parameters, a block, a lambda's
 *             parameters (named and implicit), a local function's OWN name in the enclosing
 *             frame, a class's primary-constructor parameters, a declaration pattern's names, an
 *             `out` declaration, query range variables, a catch variable, a foreach variable, and
 *             deconstruction targets. The frames are POPPED on exit, so a binding introduced after
 *             a read does not retroactively silence it.
 *   exclude   the fifteen positions where an identifier names something that is not a value read.
 *             Each is a separate rule with a separate reason, and each is re-derived from the
 *             grammar rather than from the analyzer's gate list.
 *
 * WHY A REIMPLEMENTATION AND NOT A CALL. The alternative — importing the analyzer's own
 * resolution — would be a second answer to the same question inside one process, and a
 * differential built from it can only ever report that the lane agrees with itself. That is the
 * failure this whole round exists to close: 60.3% of the lane's output had no second answer at
 * all.
 */
export function deriveCSharpBareUses(
  root: any,
  symbols: Array<{ name?: string; kind?: string; ownerName?: string }>,
): { label: string; from: string; target: string }[] {
  // ---- the shared inventory: Property-kind members, by owner and by owner leaf -------------
  const leafOf = (s: string): string => {
    const segs: string[] = []
    for (const a of s.split("::")) for (const b of a.split(".")) if (b) segs.push(b)
    return segs.length > 0 ? segs[segs.length - 1] : s
  }
  const members = new Map<string, Set<string>>()
  const addMember = (owner: string, name: string): void => {
    if (!owner || !name || name === "_") return
    for (const key of [owner, leafOf(owner)]) {
      let set = members.get(key)
      if (!set) { set = new Set<string>(); members.set(key, set) }
      set.add(name)
    }
  }
  for (const s of symbols ?? []) {
    if (s?.kind === "property" && s.ownerName) addMember(String(s.ownerName), String(s.name ?? ""))
  }

  // ---- the base lists, for the resolution walk ---------------------------------------------
  // Only needed to reach a member declared on an ANCESTOR. Keyed by the name a base list writes,
  // and by the enclosing name, which is all a name-keyed resolution can use.
  const bases = new Map<string, string[]>()
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (/^(class|interface|struct|record)_declaration$/.test(n.type)) {
        const nm = n.childForFieldName?.("name")?.text
        if (nm) {
          const bl = (n.namedChildren ?? []).find((c: any) => c.type === "base_list")
          const bs: string[] = []
          for (const b of bl?.namedChildren ?? []) {
            if (!b || b.type === "argument_list") continue
            const tn = b.type === "primary_constructor_base_type"
              ? (b.namedChildren ?? []).find((c: any) => c.type === "identifier" || c.type === "generic_name")
              : b
            if (!tn || typeof tn.text !== "string") continue
            let text = tn.text
            const call = text.indexOf("(")
            if (call > 0) text = text.slice(0, call)
            const lt = text.indexOf("<")
            if (lt > 0) text = text.slice(0, lt)
            bs.push(leafOf(text.trim()))
          }
          if (bs.length > 0) bases.set(nm, bs)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
  }

  // ---- the frames ---------------------------------------------------------------------------
  interface Frame { names: Set<string>; cls: string | null }
  const frames: Frame[] = [{ names: new Set<string>(), cls: null }]

  const shadowed = (name: string): boolean => {
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].names.has(name)) return true
    return false
  }
  const resolvable = (name: string): boolean => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const fr = frames[i]
      if (!fr.cls) continue
      const seen = new Set<string>()
      const queue = [fr.cls]
      let depth = 0
      while (queue.length > 0 && depth < 10) {
        depth++
        const cur = queue.shift()!
        if (seen.has(cur)) continue
        seen.add(cur)
        if (members.get(cur)?.has(name) || members.get(leafOf(cur))?.has(name)) return true
        for (const b of bases.get(cur) ?? bases.get(leafOf(cur)) ?? []) if (!seen.has(b)) queue.push(b)
      }
    }
    return false
  }

  const out: { label: string; from: string; target: string }[] = []
  const emitted = new Set<string>()

  // Source attribution: the nearest enclosing callable, else the innermost enclosing class (a
  // member initializer or a class-level attribute argument reads in class scope), else "global"
  // (top-level statements).
  //
  // LOCAL FUNCTIONS ARE DELIBERATELY NOT SOURCES, and this cost 17 phantom findings to learn.
  // The first cut of this function returned a `local_function_statement`'s name, and every one of
  // the 17 rows it invented named a method the graph does not contain: `AnalyzeInvocationOperation`
  // and `TryGetMethodName` are local functions inside `OnCompilationStart`, and the symbol table
  // holds 0 symbols for either. A relationship whose SOURCE is not a node in the graph is a
  // dangling edge -- worse than a missing one, because it looks connected. The rule is therefore
  // "the nearest enclosing callable THAT IS PUBLISHED AS A SYMBOL", and the half of it that makes
  // this a derivation rather than a transcription is that the exclusion is justified by an
  // invariant checked against the symbol table (cs-deep-36), not by reading the analyzer's code.
  const containingFn = (n: any): string | null => {
    let cur: any = n.parent
    while (cur) {
      const t = cur.type
      if (t === "method_declaration") return cur.childForFieldName?.("name")?.text ?? null
      if (t === "constructor_declaration") return "constructor"
      if (t === "destructor_declaration") return "Finalize"
      if (t === "property_declaration") return cur.childForFieldName?.("name")?.text ?? null
      if (t === "indexer_declaration") return "this"
      cur = cur.parent
    }
    return null
  }
  const innermostClass = (): string | null => {
    for (let i = frames.length - 1; i >= 0; i--) if (frames[i].cls) return frames[i].cls
    return null
  }

  // ---- the exclusion gates ------------------------------------------------------------------
  const firstIdent = (n: any): any | null => {
    for (let i = 0; i < (n?.namedChildCount ?? 0); i++) {
      const c = n.namedChild(i)
      if (c && c.type === "identifier") return c
    }
    return null
  }
  const same = (a: any, b: any): boolean => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
  const namedOf = (n: any): any | null => n?.childForFieldName?.("name") ?? null
  const paramName = (p: any): string | null => namedOf(p)?.text ?? firstIdent(p)?.text ?? null

  const isCallableKind = (t: string): boolean =>
    t === "method_declaration" || t === "constructor_declaration" || t === "destructor_declaration" ||
    t === "operator_declaration" || t === "conversion_operator_declaration" || t === "local_function_statement"

  /** A declared type name, in any position: a `variable_declaration`'s type field, a
   *  parameter's, a property's, a base list, a type-parameter list, a constraint clause, a tuple
   *  TYPE (as opposed to a tuple expression). A type never reads a value. */
  const isTypePosition = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t = cur.type
      // A `variable_declarator` is the boundary between a declaration's TYPE and its INITIALIZER,
      // and it must be tested before the `variable_declaration` case below -- otherwise every read
      // in `var f = Some.Field;` is gated by the `var` that introduces it. Removing this branch
      // while fixing the generic-name gate below cost 162 rows across 200 files, which is the
      // measurement that says the branch is load-bearing rather than redundant.
      if (t === "variable_declarator") {
        const vd = cur.parent
        if (vd && vd.type === "variable_declaration") {
          const tf = vd.childForFieldName?.("type")
          return !!tf && n.startIndex >= tf.startIndex && n.endIndex <= tf.endIndex
        }
        return false
      }
      if (t === "variable_declaration" || t === "parameter" || t === "property_declaration" ||
          t === "indexer_declaration" || t === "event_declaration" || t === "event_field_declaration" ||
          t === "base_list" || t === "type_parameter_list" || t === "type_parameter_constraints_clause" ||
          t === "tuple_type" || t === "nullable_type" || t === "array_type" || t === "pointer_type" || t === "ref_type") {
        return true
      }
      // `generic_name` and `qualified_name` are DELIBERATELY not in the list above, and their
      // absence was the last of the 17+1 rows this truth got wrong:
      //   `var f = Document.GetRequiredLanguageService<ISyntaxFactsService>();`
      //   ^^^^^^^^ a real read of the field `Document`
      // The name-shaped nodes are TYPE nodes in a type position and METHOD nodes in an
      // expression, and the grammar uses the same node type for both. Gating on the node type
      // therefore silences every read that reaches a generic method -- the most common shape in
      // modern C#. The type positions are already covered by the declaration cases above, which
      // is where a type name actually appears, so nothing is lost by not guessing from the node.
      if (t.includes("statement") || t.includes("declaration") || t.includes("block") ||
          t.includes("function") || t.includes("body") || t.includes("clause")) return false
      cur = cur.parent
    }
    return false
  }

  /** The callee of a call: the invocation's `function`, and the member side of a receiver. */
  const isCalleeShaped = (n: any): boolean => {
    let top: any = n
    let p: any = n.parent
    while (p && (p.type === "generic_name" || p.type === "parenthesized_expression")) { top = p; p = p.parent }
    if (p && p.type === "member_access_expression") {
      const expr = p.childForFieldName?.("expression")
      if (expr && n.startIndex >= expr.startIndex && n.endIndex <= expr.endIndex) return false
      top = p
      p = p.parent
    }
    if (p && p.type === "member_binding_expression") {
      top = p
      p = p.parent
      if (p && p.type === "conditional_access_expression") { top = p; p = p.parent }
    }
    if (!p || p.type !== "invocation_expression") return false
    const fn = p.childForFieldName?.("function")
    return !!fn && top.startIndex >= fn.startIndex && top.endIndex <= fn.endIndex
  }

  const isMemberLeaf = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "member_access_expression") return false
    return same(p.childForFieldName?.("name"), n)
  }
  const inQualifiedName = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) { if (cur.type === "qualified_name" || cur.type === "alias_qualified_name") return true; cur = cur.parent }
    return false
  }
  const isNamePosition = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t = cur.type
      if (t === "typeof_expression" || t === "default_expression" || t === "sizeof_expression" ||
          t === "name_of_expression") return true
      if (t === "is_expression" || t === "as_expression") {
        const first = cur.namedChild(0)
        return !first || n.startIndex < first.startIndex || n.endIndex > first.endIndex
      }
      if (t.includes("statement") || t.includes("declaration") || t.includes("expression") ||
          t.includes("clause") || t.includes("function") || t.includes("body") ||
          t.includes("pattern") || t.includes("argument")) return false
      cur = cur.parent
    }
    return false
  }
  const isNameofOperand = (n: any): boolean => {
    const isNameof = (inv: any): boolean => {
      const fn = inv.childForFieldName?.("function")
      return !!fn && fn.type === "identifier" && fn.text === "nameof"
    }
    const p0 = n.parent
    if (p0 && p0.type === "invocation_expression") return isNameof(p0)
    let cur: any = p0
    while (cur && (cur.type === "argument_list" || cur.type === "argument" || cur.type === "parenthesized_expression")) {
      cur = cur.parent
      if (cur && cur.type === "invocation_expression") return isNameof(cur)
    }
    return false
  }
  const isPreprocText = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t = cur.type
      if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
          t.includes("specifier") || t.includes("enumerator") || t.includes("compound") ||
          t.includes("argument_list") || t.includes("init") || t.includes("expression") ||
          t.includes("function") || t.includes("class_body") || t.includes("field_declaration_list") ||
          t.includes("block")) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }
  const isLabelOrDiscard = (n: any): boolean => {
    const p = n.parent
    return !!p && (p.type === "goto_statement" || p.type === "break_statement" ||
      p.type === "continue_statement" || p.type === "labeled_statement" || p.type === "discard")
  }
  /** The declared NAME of an entity — the grammar's own `name` field where there is one, else the
   *  first direct identifier, which is the spelling rule every declaration shares. */
  /** local | member | null -- is this declarator's name binding a local, or naming a member of
   *  its class? Decided by climbing to the nearest scope boundary, and asked by BOTH the binding
   *  path and the entity-name path, because when the two disagreed the reconciler found 742
   *  TRUTH-only rows in 200 files and every one of them was a member DECLARATION being published
   *  as a read of itself: `public const X AddBraces` is the only place `AddBraces` occurs in
   *  EnforceOnBuildValues.cs, and the truth claimed the class read it. A local declarator binds
   *  (the frame silences later reads); a member declarator NAMES something, and names are the
   *  one thing that never reads. One helper, so the two sides cannot drift. */
  const declaratorRole = (n: any): "local" | "member" | null => {
    let cur: any = n.parent
    while (cur) {
      const ct = cur.type
      if (ct === "method_declaration" || ct === "constructor_declaration" || ct === "destructor_declaration" ||
          ct === "operator_declaration" || ct === "conversion_operator_declaration" ||
          ct === "local_function_statement" || ct === "lambda_expression" || ct === "block" ||
          ct === "accessor_declaration" || ct === "top_level_statement" ||
          (ct.includes("statement") && ct !== "field_declaration" && ct !== "event_field_declaration" &&
            ct !== "using_statement" && ct !== "foreach_statement" && ct !== "fixed_statement")) return "local"
      if (ct === "class_declaration" || ct === "struct_declaration" || ct === "interface_declaration" ||
          ct === "record_declaration" || ct === "enum_declaration") return "member"
      cur = cur.parent
    }
    return null
  }
  const isEntityName = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    // The declarator test comes FIRST, and it has to. `variable_declarator` ends in
    // `_declarator`, so the `_declaration(s)?` guard below rejects it -- and an earlier version
    // of this function put the declarator test AFTER that guard, where it was unreachable. The
    // symptom was 742 TRUTH-only rows in 200 files, all of them member declarations published as
    // reads of themselves, and the first fix appeared to do nothing at all because it was in the
    // dead branch too. An unchanged count after a fix is information: it means the fix was never
    // executed, which is worth more than the fix was.
    if (p.type === "variable_declarator") return declaratorRole(n) === "member"
    const entities = /_(declaration|declarations)$/
    if (!entities.test(p.type) && p.type !== "constructor_initializer") return false
    if (p.type === "variable_declaration") return false
    const nf = namedOf(p)
    if (nf && same(nf, n)) return true
    return same(firstIdent(p), n)
  }
  const isAssignLhs = (n: any): boolean => {
    let cur: any = n
    let p: any = n.parent
    while (p && p.type === "parenthesized_expression") { cur = p; p = p.parent }
    if (!p || p.type !== "assignment_expression") return false
    const lhs = p.namedChild(0)
    return !!lhs && cur.startIndex >= lhs.startIndex && cur.endIndex <= lhs.endIndex
  }
  const isOutWrite = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "argument") return false
    let sawOut = false
    for (let i = 0; i < p.childCount; i++) {
      const c = p.child(i)
      if (!c) continue
      if (!c.isNamed && c.type === "out") { sawOut = true; continue }
      if (c.isNamed) {
        if (c.type === "declaration_expression") return false
        return sawOut && same(c, n)
      }
    }
    return false
  }
  const isForeachWrite = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "foreach_statement") return false
    let last: any = null
    for (let i = p.namedChildCount - 1; i >= 0; i--) {
      const c = p.namedChild(i)
      if (c && c.type !== "block") { last = c; break }
    }
    if (!last || last.type === "block") return false
    for (let i = 0; i < p.namedChildCount; i++) {
      const c = p.namedChild(i)
      if (!c || c === last || c.type === "block") continue
      if (c.type === "identifier" && same(c, n)) return true
    }
    return false
  }
  const isDeconWrite = (n: any): boolean => {
    let cur: any = n
    let q: any = n.parent
    while (q && (q.type === "tuple_expression" || q.type === "argument" || q.type === "parenthesized_expression")) {
      cur = q
      q = q.parent
    }
    if (!q || q.type !== "assignment_expression") return false
    const lhs = q.namedChild(0)
    return !!lhs && cur.startIndex >= lhs.startIndex && cur.endIndex <= lhs.endIndex
  }
  const isInValueSetter = (n: any): boolean => {
    if (n.text !== "value") return false
    let cur: any = n.parent
    while (cur) {
      if (cur.type === "accessor_declaration") {
        for (let i = 0; i < cur.childCount; i++) {
          const c = cur.child(i)
          if (c && !c.isNamed && (c.type === "set" || c.type === "init" || c.type === "add" || c.type === "remove")) return true
        }
        return false
      }
      if (cur.type === "method_declaration" || cur.type === "constructor_declaration" ||
          cur.type === "local_function_statement" || cur.type === "lambda_expression" ||
          cur.type === "class_declaration" || cur.type === "struct_declaration" ||
          cur.type === "interface_declaration" || cur.type === "record_declaration" ||
          cur.type === "enum_declaration") return false
      cur = cur.parent
    }
    return false
  }
  const isImportName = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) { if (cur.type === "using_directive" || cur.type === "extern_alias_directive") return true; cur = cur.parent }
    return false
  }
  /** A designator: the identifier NAMES a member, so it never reads one. Covers an attribute's
   *  name, a named-argument designator, an anonymous-type member designator, and a `with` /
   *  subpattern designator — all of which are "the first identifier of a fresh segment". */
  const isDesignator = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    if (p.type === "attribute") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "generic_name" || c.type === "qualified_name" || c.type === "alias_qualified_name")) {
          return same(c, n)
        }
      }
      return false
    }
    if (p.type === "attribute_argument" || p.type === "assignment_expression" && false) {
      return same(firstIdent(p), n)
    }
    if (p.type === "with_initializer" || p.type === "subpattern") return same(firstIdent(p), n)
    return false
  }
  /** An anonymous-object member designator: `new { X = 1, Y = v }` — `X` names a member, `v`
   *  reads one. Segment discipline: a fresh segment starts after `,` `;` `{` `}`. */
  const isAnonDesignator = (n: any): boolean => {
    let q: any = n.parent
    while (q && q.type !== "anonymous_object_creation_expression" && q.type !== "block" &&
           q.type !== "method_declaration" && q.type !== "constructor_declaration" &&
           q.type !== "local_function_statement" && q.type !== "lambda_expression") q = q.parent
    if (!q || q.type !== "anonymous_object_creation_expression") return false
    let fresh = true
    let foundFirst = false
    for (let i = 0; i < q.childCount; i++) {
      const c = q.child(i)
      if (!c) continue
      if (!c.isNamed) {
        if (c.type === "," || c.type === ";" || c.type === "{" || c.type === "}") { fresh = true; foundFirst = false }
        else if (c.type === "=" || c.type === ":") fresh = false
        continue
      }
      if (c.type === "identifier") {
        if (!foundFirst && fresh) {
          if (same(c, n)) {
            // designating only when an `=` follows in this segment
            for (let k = i + 1; k < q.childCount; k++) {
              const d = q.child(k)
              if (!d) break
              if (!d.isNamed && (d.type === "," || d.type === ";" || d.type === "{" || d.type === "}")) break
              if (!d.isNamed && d.type === "=") return true
            }
            return false
          }
          foundFirst = true
        } else if (same(c, n)) return false
      }
    }
    return false
  }

  // ---- the walk ----------------------------------------------------------------------------
  interface Item { node: any; exit?: boolean; pushed?: boolean }
  const stack: Item[] = [{ node: root }]

  while (stack.length > 0) {
    const item = stack.pop()!
    const n = item.node
    if (item.exit) {
      if (item.pushed && frames.length > 0) frames.pop()
      continue
    }
    const t = n.type
    let pushed = false

    // --- frames ------------------------------------------------------------------------------
    if (isCallableKind(t)) {
      const fr: Frame = { names: new Set<string>(), cls: null }
      const pl = (n.namedChildren ?? []).find((c: any) => c.type === "parameter_list")
      for (const p of pl?.namedChildren ?? []) {
        if (p?.type !== "parameter") continue
        const pn = paramName(p)
        if (pn && pn !== "_") fr.names.add(pn)
      }
      // A local function's NAME binds in the ENCLOSING scope, so `F(); ... F() {}` reads nothing.
      if (t === "local_function_statement") {
        const nm = namedOf(n)?.text ?? firstIdent(n)?.text
        const outer = frames[frames.length - 1]
        if (outer && nm && nm !== "_") outer.names.add(nm)
      }
      frames.push(fr)
      pushed = true
    } else if (
      t === "block" || t === "lambda_expression" || t === "switch_expression_arm" ||
      t === "query_expression" || t === "foreach_statement" || t === "for_statement" ||
      t === "using_statement" || t === "catch_clause"
    ) {
      const fr: Frame = { names: new Set<string>(), cls: null }
      if (t === "lambda_expression") {
        const walk: any[] = [n]
        while (walk.length > 0) {
          const m = walk.pop()!
          if (m !== n && (m.type === "block" || m.type === "lambda_expression")) continue
          if (m.type === "parameter") {
            const pn = paramName(m)
            if (pn && pn !== "_") fr.names.add(pn)
          } else if (m.type === "implicit_parameter") {
            for (let i = 0; i < m.namedChildCount; i++) {
              const c = m.namedChild(i)
              if (c && c.type === "identifier" && c.text !== "_") fr.names.add(c.text)
            }
          }
          for (let i = m.namedChildCount - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) walk.push(c) }
        }
      } else if (t === "foreach_statement") {
        // `foreach (var x in ys)` and `foreach (Point p in ps)` BIND x / p; `foreach (x in ys)`
        // ASSIGNS an existing x, which is a write. With a type node present the binding is the
        // first identifier after it; with an all-bare header it is everything between the first
        // (the positional type) and the last (the source).
        const isTypeish = (c: any): boolean =>
          c.type === "implicit_type" || c.type === "predefined_type" || c.type === "generic_name" ||
          c.type === "qualified_name" || c.type === "nullable_type" || c.type === "array_type" ||
          c.type === "pointer_type" || c.type === "tuple_type" || c.type === "ref_type"
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type === "block") break
          kids.push(c)
        }
        if (kids.some((c) => isTypeish(c))) {
          let seenType = false
          let bound = false
          for (const c of kids) {
            if (isTypeish(c)) { seenType = true; continue }
            if (!bound && seenType && c.type === "identifier" && c.text !== "_") { fr.names.add(c.text); bound = true }
          }
        } else {
          const ids = kids.filter((c) => c.type === "identifier" && c.text !== "_")
          for (let i = 1; i + 1 < ids.length; i++) fr.names.add(ids[i].text)
        }
      } else if (t === "catch_clause") {
        const cd = (n.namedChildren ?? []).find((c: any) => c.type === "catch_declaration")
        for (let i = 0; i < (cd?.namedChildCount ?? 0); i++) {
          const c = cd!.namedChild(i)
          if (c && c.type === "identifier" && c.text !== "_") {
            // the variable is the one with an EARLIER sibling (the type comes first)
            for (let k = 0; k < i; k++) if (cd!.namedChild(k)) { fr.names.add(c.text); break }
          }
        }
      }
      frames.push(fr)
      pushed = true
    } else if (t === "class_declaration" || t === "struct_declaration" || t === "interface_declaration" || t === "record_declaration") {
      const fr: Frame = { names: new Set<string>(), cls: null }
      const nm = namedOf(n)?.text ?? firstIdent(n)?.text ?? null
      if (nm) fr.cls = nm
      // Primary-constructor parameters bind in the class body. A RECORD's positionals are NOT
      // bound: they coincide with the properties, so a read of one must flow to the member.
      if (t !== "record_declaration") {
        const pl = (n.namedChildren ?? []).find((c: any) => c.type === "parameter_list")
        for (const p of pl?.namedChildren ?? []) {
          if (p?.type !== "parameter") continue
          const pn = paramName(p)
          if (pn && pn !== "_") fr.names.add(pn)
        }
      }
      frames.push(fr)
      pushed = true
    } else if (t === "variable_declarator") {
      // A LOCAL declaration binds; a MEMBER declaration is an entity NAME (excluded above) --
      // see `declaratorRole`, which decides this once for both paths.
      if (declaratorRole(n) === "local") {
        // the LEFTMOST name, through declarator wrappers (`int *p` -> p, `int x` -> x)
        let d: any = n
        while (d) {
          if (d.type === "identifier") { if (d.text !== "_") frames[frames.length - 1]?.names.add(d.text); break }
          let next: any = null
          for (let i = 0; i < d.namedChildCount; i++) {
            const c = d.namedChild(i)
            if (c && (c.type === "identifier" || c.type.endsWith("declarator"))) { next = c; break }
          }
          if (!next) break
          d = next
        }
      }
    } else if (t === "declaration_pattern") {
      // `Point p`, `List<int> x`, `var v`: skip the first child (the type), bind the rest.
      const fr = frames[frames.length - 1]
      if (fr) for (let i = 1; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "identifier" && c.text !== "_") fr.names.add(c.text)
      }
    } else if (t === "declaration_expression") {
      // `out int v`, `out v`: the LAST direct identifier declares.
      const fr = frames[frames.length - 1]
      if (fr) {
        let last: any = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") last = c
        }
        if (last && last.text !== "_") fr.names.add(last.text)
      }
    } else if (t === "from_clause" || t === "join_clause" || t === "let_clause") {
      // `from x in src`, `join y in ys`, `let b = a`: the FIRST identifier binds.
      const fr = frames[frames.length - 1]
      const id = firstIdent(n)
      if (fr && id && id.text !== "_") fr.names.add(id.text)
    } else if (t === "tuple_expression") {
      // Deconstruction `(int a, int b) = t`: only when this tuple is the LHS. A typed argument
      // binds its identifiers; an all-bare argument binds all but the first (the positional
      // type); a lone bare identifier ASSIGNS an existing variable, so it binds nothing.
      const p = n.parent
      if (p && p.type === "assignment_expression" && p.namedChild(0)) {
        const lhs = p.namedChild(0)
        if (n.startIndex >= lhs.startIndex && n.endIndex <= lhs.endIndex) {
          const fr = frames[frames.length - 1]
          const isTypeish = (c: any): boolean =>
            c.type === "implicit_type" || c.type === "predefined_type" || c.type === "generic_name" ||
            c.type === "qualified_name" || c.type === "nullable_type" || c.type === "array_type" ||
            c.type === "pointer_type" || c.type === "tuple_type" || c.type === "ref_type"
          if (fr) for (let i = 0; i < n.namedChildCount; i++) {
            const arg = n.namedChild(i)
            if (!arg || arg.type !== "argument") continue
            const ids: any[] = []
            let typed = false
            for (let k = 0; k < arg.namedChildCount; k++) {
              const c = arg.namedChild(k)
              if (!c) continue
              if (isTypeish(c)) typed = true
              else if (c.type === "identifier" && c.text !== "_") ids.push(c)
            }
            const bind = typed ? ids : ids.slice(1)
            for (const b of bind) fr.names.add(b.text)
          }
        }
      }
    }

    // --- the read itself ---------------------------------------------------------------------
    if (t === "identifier") {
      const name = n.text
      if (
        name && name !== "_" &&
        !isEntityName(n) &&
        !isDesignator(n) &&
        !isAnonDesignator(n) &&
        !isOutWrite(n) &&
        !isDeconWrite(n) &&
        !isForeachWrite(n) &&
        !isImportName(n) &&
        !isTypePosition(n) &&
        !isInValueSetter(n) &&
        !isNameofOperand(n) &&
        !isCalleeShaped(n) &&
        !isMemberLeaf(n) &&
        !inQualifiedName(n) &&
        !isNamePosition(n) &&
        !isPreprocText(n) &&
        !isLabelOrDiscard(n) &&
        !isAssignLhs(n) &&
        !shadowed(name) &&
        resolvable(name)
      ) {
        const src = containingFn(n) ?? innermostClass() ?? "global"
        const key = `${src}|${name}`
        if (!emitted.has(key)) {
          emitted.add(key)
          out.push({ label: "uses", from: src, target: name })
        }
      }
    }

    stack.push({ node: n, exit: true, pushed })
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ node: c })
    }
  }
  return out
}
