// go lane — ROUND 6, step 1: a TRUTH derivation for the `references` surface.
//
// THE HOLE. `script/m14/differential.ts` offers the comparison exactly five
// labels for go — extends, implements, instantiates, overrides, calls — and
// `uses`/`references`/`imports`/`contains` are excluded from the analyzer side.
// The reason is recorded in the harness: comparing a label the truth side does
// not derive counts every analyzer edge of that label as fabrication. The
// consequence is that 43,553 `references` edges across the five corpora, and
// 79,584 `uses` edges, cannot be MISSING and cannot be fabrication. Round 5
// found four real defects on that surface by reading the analyzer; this is the
// instrument that would have found them.
//
// WHAT IS DERIVED HERE. `references` carries two relationshipTypes, both
// emitted by the analyzer's extractDeclaredTypeRefs:
//
//   declared_type — a type named in a DECLARATION's type position
//   return_type   — a type named in a declaration's RESULT position
//
// The rules, stated from the Go spec rather than read off the analyzer:
//
//   1. A type reference is a `type_identifier` or `qualified_type` node
//      reachable from a type position. Type positions are the `type` FIELD of a
//      field_declaration, parameter_declaration, variadic_parameter_declaration,
//      var_spec or const_spec — plus the type ARGUMENTS and the element/key/
//      value/channel sides inside them, and the fields of an anonymous struct
//      or interface written inline.
//   2. A PREDECLARED identifier is not a declared type: Go's spec fixes them
//      (`bool`, the numerics, `string`, `error`, `any`, `comparable`,
//      `byte`/`rune` aliases). A reference to one names the language, not a
//      declaration, so no edge is derived — and none may be compared.
//   3. The edge's SOURCE is the nearest enclosing named declaration: a type
//      name for a field (Go scopes a field's type to its struct/interface), a
//      function or method name for a parameter, receiver, result, var or const
//      (Go scopes those to the function body), else `global`.
//   4. return_type vs declared_type is read from the `result` FIELD of the
//      enclosing function/method/method_spec/func_literal — the same field the
//      grammar exposes — never inferred from arity.
//   5. The TARGET is the LEAF: `io.Reader` declares `Reader`. Publishing the
//      dotted spelling would be source text on a name surface, which is the
//      R10 class round 2 corrected.
//   6. One edge per (source, target, relationshipType) — the lane's
//      per-set-with-first-site convention (GO32, ruled in the spec).
//
// DELIBERATELY A DIFFERENT SHAPE. The analyzer's rule is a generic descent
// that skips `block` and `expression_list`; this one is field-driven and
// enumerates the type positions. Two derivations written in different shapes
// can DISAGREE, and a disagreement is the finding. An oracle that shared the
// analyzer's shape would share its bugs — the C5 collusion pattern — and would
// report 100/0/0 for a wrong answer.
//
// This module is the DERIVATION only — no measurement, no top-level work — so
// the corpus sweep (`go-round6-references-corpus.ts`) and the shape battery
// (`go-round6-references-shapes.ts`) can both import it without dragging a
// corpus read along with them.
//
// Run: nothing directly. Imported by the two scripts named above.
// ────────────────────────────────────────────── the truth derivation
/** Go's predeclared identifiers (spec, "Predeclared identifiers"). */
const GO_PREDECLARED = new Set([
  "bool", "byte", "complex64", "complex128", "error", "float32", "float64",
  "int", "int8", "int16", "int32", "int64", "rune", "string",
  "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
  "any", "comparable", "true", "false", "iota", "nil",
])

/**
 * Collect every type name under `typeNode`, following type positions only.
 * Field-driven where the grammar names a field (`key`, `value`, `element`,
 * `type`, `result`, `parameters`), and a wrapper list for the anonymous
 * type-literal forms.
 */
const collectFromType = (typeNode: any, out: string[], seen: Set<any>): void => {
  if (!typeNode || seen.has(typeNode)) return
  seen.add(typeNode)
  const t = typeNode.type
  if (t === "type_identifier" || t === "qualified_type") {
    const raw = String(typeNode.text ?? "")
    const dot = raw.lastIndexOf(".")
    const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
    if (leaf && !GO_PREDECLARED.has(leaf) && !out.includes(leaf)) out.push(leaf)
    return
  }
  // A type literal written inline (`struct{ A Foo }`, `interface{ ~int | string }`,
  // `func(a Foo) Bar`) names types in its own fields — descend, because a type
  // reference inside one is still a type reference.
  for (let i = 0; i < typeNode.namedChildCount; i++) {
    const c = typeNode.namedChild(i)
    if (!c) continue
    // A parameter/field list inside a function_type: its declarations have a
    // `type` field, which collectFromType already knows how to read.
    collectFromType(c, out, seen)
  }
}

/** The nearest enclosing named declaration, per rule 3. */
const sourceNameFor = (start: any): string => {
  let n: any = start
  let insideTypeDecl = false
  for (let guard = 0; guard < 64 && n; guard++, n = n.parent) {
    if (!insideTypeDecl && (n.type === "type_spec" || n.type === "type_alias")) {
      const nm = n.childForFieldName?.("name")
      if (nm) return String(nm.text)
      insideTypeDecl = true
    }
    if (n.type === "function_declaration" || n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")
      if (nm) return String(nm.text)
    }
  }
  return "global"
}

/** Per rule 4: is this declaration in a `result` list? */
const isResultDeclaration = (decl: any): boolean => {
  const list = decl.parent
  if (!list || list.type !== "parameter_list") return false
  const owner = list.parent
  if (!owner) return false
  // `function_type` is DELIBERATELY not in this list, and that is a ruling
  // rather than an oversight — the one disagreement this derivation and the
  // analyzer produced that neither side should "fix" without a semantic
  // argument. The argument:
  //
  //   A `parameter_declaration` inside a `function_type` is part of a TYPE
  //   EXPRESSION. `Fn func(a A) (A, error)` is a field whose type happens to be
  //   a function type; the `(A, error)` inside it describes that TYPE, not a
  //   result of anything this file declares.
  //
  //   A `parameter_declaration` in a `function_declaration`'s `result` FIELD is
  //   the declaration of THAT function's result. Go's spec is explicit that the
  //   result list is a separate parameter list, and the grammar gives it its own
  //   field, which is exactly what this predicate reads.
  //
  // So the rule is: a separate `return_type` arises when the declaration IS a
  // result of a unit the file DECLARES. Labelling a function type's internal
  // result list `return_type` would claim `T` returns `A`, which it does not —
  // `T` is a struct. The extra edge also carries no information the
  // declared_type edge does not: same source, same target, and the product's
  // `references` edge is name-only, so nothing can consume the distinction.
  //
  // Recorded as GO37 in script/m14/spec/go-completeness.json.
  if (
    owner.type !== "function_declaration" && owner.type !== "method_declaration" &&
    owner.type !== "method_spec" && owner.type !== "func_literal"
  ) return false
  const res = owner.childForFieldName?.("result")
  return !!res && res.id === list.id
}

export interface GoRefTruth {
  label: string
  from: string
  target: string
  rt: string
  /** the node's own line, so a MISSING row can be localised */
  line: number
}

export const deriveGoDeclaredTypeRefs = (root: any): GoRefTruth[] => {
  const out: GoRefTruth[] = []
  const emitted = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const isDecl =
      n.type === "field_declaration" ||
      n.type === "parameter_declaration" ||
      n.type === "variadic_parameter_declaration" ||
      n.type === "var_spec" ||
      n.type === "const_spec"
    if (isDecl) {
      const rt = isResultDeclaration(n) ? "return_type" : "declared_type"
      const from = sourceNameFor(n)
      // Rule 1: the `type` FIELD, never a generic descent. A declaration with
      // no `type` field (`var x = 1`, `var a = Foo{}`) declares no type, so it
      // contributes nothing — which is the point of reading the field.
      const typeNode = n.childForFieldName?.("type")
      if (typeNode) {
        const names: string[] = []
        collectFromType(typeNode, names, new Set())
        for (const target of names) {
          const key = `${from}|${target}|${rt}`
          if (emitted.has(key)) continue
          emitted.add(key)
          out.push({ label: "references", from, target, rt, line: (typeNode.startPosition?.row ?? 0) + 1 })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

