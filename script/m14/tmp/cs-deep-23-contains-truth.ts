/**
 * 2026-09-28: csharp's `contains` truth — the LAST unoracled label (12.9% of the lane's
 * output, 3,262 edges over 300 roslyn files).
 *
 * WHY IT IS WORTH WRITING, and why it is harder than it looks. The analyzer derives
 * containment from `symbol.ownerName` — a field set during its own walk — so the class is
 * STRUCTURALLY SELF-AGREEING: it cannot disagree with the symbol table, because it is built
 * from it. That is exactly why nothing has ever adjudicated it, and exactly why an independent
 * derivation is the only thing that can: this one walks the TREE and rebuilds the owner chain
 * from declaration nesting, never touching a symbol.
 *
 * THE CONTRACT BEING RE-DERIVED (each row read off the analyzer's own emission rules, not off
 * its output):
 *   * a TYPE is contained by the NAMESPACE it sits in — a block namespace it is lexically
 *     inside, or the file-scoped one in effect for it (which covers SIBLING declarations, not
 *     descendants, so the scope has to survive its own subtree — the CSD1 rule);
 *   * a MEMBER is contained by the TYPE it is declared in;
 *   * a NESTED TYPE is contained by the TYPE it is declared in, not by the namespace;
 *   * a record's POSITIONAL PARAMETERS are members (Roslyn makes them properties);
 *   * a constructor is named `constructor`, a destructor `Finalize`, an indexer `this` — the
 *     analyzer's own spellings, and the reason a symbol name is not always text in the file;
 *   * a NAMESPACE has no owner in the published payload, so a nested namespace emits nothing.
 *
 * The owner is published as the SIMPLE name at every level, because that is what `ownerName`
 * carries — the lane publishes full dotted paths for RELATIONSHIP TARGETS and simple names for
 * containment sources, and an independent truth has to know which is which.
 */
export function deriveCSharpContains(root: any): { label: string; from: string; target: string }[] {
  const out: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()

  // The declaration shapes that become SYMBOLS whose name is a `name` field (or, for an
  // indexer, the `this` keyword). Deliberately the analyzer's own set: a truth that emitted a
  // shape the analyzer does not symbolise would read as MISSING for its own extra precision.
  const SYMBOL_DECLS = new Set([
    "class_declaration", "struct_declaration", "interface_declaration",
    "record_declaration", "enum_declaration", "enum_member_declaration",
    "delegate_declaration", "event_declaration", "event_field_declaration",
    "operator_declaration", "conversion_operator_declaration",
    "method_declaration", "constructor_declaration", "destructor_declaration",
    "property_declaration", "indexer_declaration", "field_declaration",
  ])
  const TYPE_DECLS = new Set([
    "class_declaration", "struct_declaration", "interface_declaration", "record_declaration",
  ])

  const nameOf = (n: any): string | null => {
    if (n.type === "constructor_declaration") return "constructor"
    if (n.type === "destructor_declaration") return "Finalize"
    if (n.type === "indexer_declaration") return "this"
    const field = n.childForFieldName?.("name")
    if (field && typeof field.text === "string") return field.text
    if (n.type === "field_declaration") {
      // A field's name lives on the DECLARATOR, and one field_declaration can declare several
      // (`int a, b;`) — each declarator is its own symbol, so each is its own containment edge.
      const vd = (n.namedChildren ?? []).find((c: any) => c.type === "variable_declaration")
      const names: string[] = []
      for (const d of vd?.namedChildren ?? []) {
        if (d?.type !== "variable_declarator") continue
        const id = (d.namedChildren ?? []).find((c: any) => c.type === "identifier")
        if (id && typeof id.text === "string" && id.text) names.push(id.text)
      }
      return names.length === 1 ? names[0] : null
    }
    return null
  }

  /** Owner = the nearest enclosing scope, tracked as a STACK for true nesting plus a side
   *  variable for a file-scoped namespace, whose scope covers SIBLING declarations rather than
   *  descendants — the CSD1 shape, and the reason a plain stack would name every bare top-level
   *  type to the file instead of to the namespace. */
  const stack: Array<{ node: any; name: string; isType: boolean; exit?: boolean }> = []
  let fileScopedNs: string | undefined

  /**
   * The owner is the NEAREST enclosing scope, of whatever kind — one rule, not two.
   *
   * The first version of this truth asked for "the nearest scope of the OTHER kind" (a type takes
   * the namespace around it, a member takes the type). That is wrong, and 42 rows named why: for a
   * NESTED type the nearest enclosing scope is the outer TYPE, and asking for a namespace skipped
   * straight past it to the file's namespace — so `class LocalizableStringWithArguments` nested
   * inside `DiagnosticHelper` was attributed to `Microsoft.CodeAnalysis.Diagnostics` instead. The
   * analyzer was right in all 42. A uniform rule gets both cases for free: a top-level type's
   * nearest scope IS its block namespace, a nested type's nearest scope is its outer type, a
   * member's is its type, and with an empty stack the file-scoped namespace is the answer.
   */
  const ownerOf = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = stack[i]
      if (s.exit) continue
      return s.name
    }
    return fileScopedNs
  }

  const walk = (n: any): void => {
    const t = n.type

    if (t === "file_scoped_namespace_declaration") {
      const raw = (n.namedChildren ?? []).find((c: any) => c.type === "qualified_name" || c.type === "identifier")
      // A NEW file-scoped section replaces the old one (CSD10) — otherwise a second section
      // would keep nesting to the first namespace's name.
      fileScopedNs = raw ? String(raw.text) : undefined
      // NO stack push and NO exit item: the scope must outlive its own subtree.
      for (const c of n.namedChildren ?? []) walk(c)
      return
    }
    if (t === "namespace_declaration") {
      const raw = (n.namedChildren ?? []).find((c: any) => c.type === "qualified_name" || c.type === "identifier")
      const nm = raw ? String(raw.text) : "anonymous"
      const before = fileScopedNs
      fileScopedNs = undefined
      stack.push({ node: n, name: nm, isType: false })
      for (const c of n.namedChildren ?? []) walk(c)
      stack.pop()
      fileScopedNs = before
      return
    }

    if (SYMBOL_DECLS.has(t)) {
      const isType = TYPE_DECLS.has(t) || t === "enum_declaration" || t === "delegate_declaration"
      const name = nameOf(n)
      if (name) {
        // The owner rule: a type takes the namespace in effect (a block namespace it is inside,
        // else the file-scoped one), and a member takes the enclosing type.
        const owner = ownerOf()
        if (owner) {
          const key = `${owner}|${name}`
          if (!seen.has(key)) { seen.add(key); out.push({ label: "contains", from: owner, target: name }) }
        }
      }
      // A record's POSITIONAL PARAMETERS are members too (Roslyn makes them properties), and
      // they sit in the declaration's own parameter_list, so they are read here rather than by
      // the generic walk below.
      if (t === "record_declaration") {
        const recName = n.childForFieldName?.("name")?.text
        const pl = (n.namedChildren ?? []).find((c: any) => c.type === "parameter_list")
        if (recName && pl) {
          for (const p of pl.namedChildren ?? []) {
            if (p?.type !== "parameter") continue
            const pn = p.childForFieldName?.("name")?.text
            if (!pn) continue
            const key = `${recName}|${pn}`
            if (!seen.has(key)) { seen.add(key); out.push({ label: "contains", from: recName, target: pn }) }
          }
        }
      }
      // An ENUM and a DELEGATE own members exactly as a class does (its members, its nested
      // types), so they push a scope too. The first version pushed only for TYPE_DECLS, and 53
      // ANALYZER-only rows named it: every enum member came out ownerless because the enum never
      // entered the stack.
      if ((TYPE_DECLS.has(t) || t === "enum_declaration" || t === "delegate_declaration") && name) {
        stack.push({ node: n, name, isType: true })
        for (const c of n.namedChildren ?? []) walk(c)
        stack.pop()
        return
      }
    }

    for (const c of n.namedChildren ?? []) walk(c)
  }

  walk(root)
  return out
}
