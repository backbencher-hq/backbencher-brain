/**
 * The JAVA heritage / instantiation / override oracle — lane-owned pure derivations over the tree.
 *
 * Beside `differential.ts` for the reason that file's header records: the shared instrument is
 * edited by every lane, and every line a lane keeps out of it is a line that cannot conflict. The
 * WIRING (import, dispatch in `if (lang === "java")`, compared-label admission) is the Lead's.
 *
 * WHY EACH DERIVATION EXISTS. Java's compared set in the differential is
 * `{extends, implements, instantiates, overrides, calls, uses, contains, references}` (the default
 * heritage three + overrides + the four audited classes). Before this module, `deriveJavaEdges`
 * supplied only `calls`, and `deriveJavaUsesTruth` / `deriveJavaContainsTruth` /
 * `deriveJavaReferencesTruth` supplied the other three audited classes — so the analyzer's
 * `extends`, `implements`, `instantiates` and `overrides` rows were compared against NOTHING and
 * would be charged as unexplained fabrications (the exact DERIVATION-debt shape the programme
 * charter's D4 clause forbids). Each function below mirrors the analyzer's own contract, from the
 * language rule rather than from the analyzer's output:
 *
 *   * EXTENDS / IMPLEMENTS (JLS 8.1.4/8.1.4.1, 9.1.3) — a class's `superclass` is the single
 *     extends parent; a `super_interfaces` type list is implements; an INTERFACE's
 *     `extends_interfaces` type list is extends. A generic's ARGUMENTS are not heritage rows (they
 *     are references), so each parent is reduced to its base name exactly as the analyzer's
 *     `extractJavaTypeBaseName` does.
 *
 *   * INSTANTIATES (JLS 15.9) — `object_creation_expression` names the instantiated type. Java
 *     objects are created ONLY by `new`, so this is the whole construct; an array creation is not
 *     an instantiation (it is a reference edge). The analyzer skips a creation whose type node
 *     yields no base name; this mirrors that skip.
 *
 *   * OVERRIDES (JLS 8.4.8, 8.4.8.1) — the analyzer resolves an override in an in-file hierarchy by
 *     exact signature (pass 1) or by name under generic substitution (pass 2), and emits a
 *     first-parent GUESS at confidence 0.5 (pass 3) when the declaring ancestor is out of file.
 *     This oracle derives ONLY what pass 1/2 can prove from the file, because those are the
 *     confident rows: for every non-static, non-private instance method of a declared type, walk
 *     the type's IN-FILE ancestor chain (breadth-first, private ancestor methods excluded per JLS
 *     8.4.8.1) and emit the override when an ancestor declares the same name with
 *     - the same parameter-type signature, or
 *     - the same arity where at least one side's signature carries a TYPE VARIABLE (the generic
 *       substitution pass 2 pairs, because `Child extends Outer<String>` instantiates `foo(E)` as
 *       `foo(String)` and the two can never match textually).
 *     Pass-3 guess rows carry confidence 0.5 and therefore land in the differential's HEURISTIC
 *     bucket, not the fabrication count — they are not derived here on purpose. The anonymous
 *     subclass shapes are included because the analyzer resolves them through the same machinery:
 *     an `object_creation_expression` with a class body is an anonymous subclass of the instantiated
 *     type, and an enum constant with a body (JLS 8.9.1) is an anonymous subclass of its enum.
 *
 * SHAPE. Pure over a tree-sitter root; returns `{label, from, target}[]`, per-target deduped (the
 * matcher keys label+normalized-target and ignores `from`).
 */

export type JavaOracleEdge = { label: string; from: string; target: string }

const namedChildren = (n: any): any[] => (n?.namedChildren ?? [])
const childByType = (n: any, type: string): any | null => {
  if (!n) return null
  for (const c of namedChildren(n)) if (c && c.type === type) return c
  return null
}
const fieldOf = (n: any, f: string): any | null =>
  typeof n?.childForFieldName === "function" ? n.childForFieldName(f) : null

const TYPE_DECLARATIONS = new Set([
  "class_declaration", "interface_declaration", "enum_declaration",
  "record_declaration", "annotation_type_declaration",
])

/** Base name of a TYPE node, mirroring `extractJavaTypeBaseName` / `javaTypeBaseName`: a
 *  scoped/generic type reduces to its written base path, annotations dropped. */
function baseName(n: any): string {
  if (!n) return ""
  const t = String(n.type ?? "")
  if (t === "type_identifier" || t === "identifier") return String(n.text ?? "")
  if (t === "generic_type") {
    for (const c of namedChildren(n)) {
      if (c && (c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "generic_type")) {
        const b = baseName(c)
        if (b) return b
      }
    }
    return ""
  }
  if (t === "scoped_type_identifier") {
    const parts: string[] = []
    for (const c of namedChildren(n)) {
      if (!c) continue
      if (c.type === "annotation" || c.type === "marker_annotation") continue
      const b = baseName(c)
      if (b) parts.push(b)
    }
    return parts.join(".")
  }
  if (t === "annotated_type") {
    for (const c of namedChildren(n)) {
      if (!c) continue
      if (c.type === "annotation" || c.type === "marker_annotation") continue
      const b = baseName(c)
      if (b) return b
    }
    return ""
  }
  return ""
}

/** The heritage clause names a declaration writes, split the way the analyzer splits them:
 *  `superclass` -> extends; `super_interfaces` -> implements; `extends_interfaces` -> extends. */
function heritageParents(n: any): { extendsNames: string[]; implementsNames: string[] } {
  const extendsNames: string[] = []
  const implementsNames: string[] = []
  const superclass = childByType(n, "superclass")
  if (superclass) {
    const t =
      childByType(superclass, "scoped_type_identifier") ||
      childByType(superclass, "generic_type") ||
      childByType(superclass, "type_identifier")
    const b = baseName(t)
    if (b) extendsNames.push(b)
  }
  const ifaces = childByType(n, "super_interfaces") || childByType(n, "extends_interfaces")
  if (ifaces) {
    const list = childByType(ifaces, "type_list") || ifaces
    const isExtends = ifaces.type === "extends_interfaces"
    for (const c of namedChildren(list)) {
      if (!c) continue
      if (c.type !== "type_identifier" && c.type !== "generic_type" && c.type !== "scoped_type_identifier") continue
      const b = baseName(c)
      if (!b) continue
      ;(isExtends ? extendsNames : implementsNames).push(b)
    }
  }
  return { extendsNames, implementsNames }
}

/**
 * (1) EXTENDS + IMPLEMENTS edges, exactly the heritage the source writes, one row per parent.
 */
export function deriveJavaInheritanceTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    const k = label + "|" + target
    if (!target || seen.has(k)) return
    seen.add(k)
    out.push({ label, from: "(class)", target })
  }
  const walk = (n: any): void => {
    if (!n) return
    if (TYPE_DECLARATIONS.has(String(n.type))) {
      const { extendsNames, implementsNames } = heritageParents(n)
      for (const t of extendsNames) push("extends", t)
      for (const t of implementsNames) push("implements", t)
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/**
 * (2) INSTANTIATES edges — `new T(...)` names T (JLS 15.9). The search order and the "skip when no
 * base name is derivable" rule mirror the analyzer's object_creation_expression branch.
 */
export function deriveJavaInstantiatesTruth(root: any): JavaOracleEdge[] {
  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "object_creation_expression") {
      const typeNode =
        childByType(n, "type_identifier") || childByType(n, "generic_type") ||
        childByType(n, "scoped_type_identifier") || childByType(n, "identifier")
      if (typeNode) {
        const name = typeNode.type === "identifier" ? String(typeNode.text ?? "") : baseName(typeNode)
        if (name && !seen.has(name)) {
          seen.add(name)
          out.push({ label: "instantiates", from: "(expr)", target: name })
        }
      }
    }
    for (const c of namedChildren(n)) walk(c)
  }
  walk(root)
  return out
}

/** A method declaration's override-relevant facts. Parameter types are the raw written types, the
 *  same text the analyzer builds its signature from. */
type JavaMethodFacts = {
  name: string
  params: string[]
  isStatic: boolean
  isPrivate: boolean
  isConstructor: boolean
}
type JavaTypeFacts = {
  name: string
  dotted: string
  parentNames: string[]
  methods: JavaMethodFacts[]
  node: any
}

const MODIFIER_KEYWORDS = new Set(["static", "private", "public", "protected", "final", "abstract", "native", "synchronized", "strictfp", "default", "transient", "volatile"])

/** The written modifiers of a declaration (unnamed keyword children of its `modifiers` node). */
function modifiersOf(n: any): Set<string> {
  const out = new Set<string>()
  const mods = childByType(n, "modifiers")
  if (!mods) return out
  const total = typeof mods.childCount === "number" ? mods.childCount : 0
  for (let i = 0; i < total; i++) {
    const c = typeof mods.child === "function" ? mods.child(i) : null
    if (c && MODIFIER_KEYWORDS.has(String(c.type))) out.add(String(c.type))
  }
  return out
}

/** Parameter types as written, mirroring `extractJavaParameters`'s type text (the analyzer's
 *  signature is built from exactly these strings). */
function methodFacts(m: any): JavaMethodFacts | null {
  const nameNode = fieldOf(m, "name") || childByType(m, "identifier")
  if (!nameNode) return null
  const params: string[] = []
  const paramsNode = childByType(m, "formal_parameters") || childByType(m, "inferred_parameters")
  if (paramsNode) {
    for (const p of namedChildren(paramsNode)) {
      if (!p) continue
      if (p.type === "formal_parameter") {
        const typeNode = fieldOf(p, "type")
        params.push(typeNode ? String(typeNode.text ?? "") : "unknown")
      } else if (p.type === "spread_parameter") {
        // JLS 8.4.1: the grammar gives a varargs parameter no `type` field — the name
        // lives in a trailing variable_declarator and the type is the remaining child.
        // The ANALYZER models it as an ARRAY type ("T[]"), which is what makes
        // `foo(int...)` and `foo(int[])` the same signature (JD21). Mirrored exactly:
        // without it every varargs override read as a truth-only/analyzer-only pair.
        const decl = childByType(p, "variable_declarator")
        const nameNode = decl ? childByType(decl, "identifier") : null
        if (!nameNode) continue
        let spreadType = ""
        for (const c of namedChildren(p)) {
          if (!c) continue
          if (c.type === "modifiers" || c.type === "variable_declarator") continue
          if (String(c.type).includes("annotation")) continue
          spreadType = String(c.text ?? "")
          break
        }
        params.push((spreadType || "unknown") + "[]")
      } else if (p.type === "ERROR") {
        // ERROR-node recovery: the analyzer text-processes the fragment, so its signature
        // is not derivable from structure. "unknown" keeps the ARITY right (the pairing
        // rule) without pretending to know the type.
        params.push("unknown")
      }
      // receiver_parameter is deliberately NOT a parameter: the analyzer skip-lists it
      // (JD36) — `void m(Outer this)` is a receiver binder, not a user parameter.
    }
  }
  const mods = modifiersOf(m)
  return {
    name: String(nameNode.text ?? ""),
    params,
    isStatic: mods.has("static"),
    isPrivate: mods.has("private"),
    isConstructor: false,
  }
}

/** Is any written parameter type a type VARIABLE (single capital letter)? Used only for the
 *  generic-substitution pairing (JLS 8.4.8 with 4.4) — the analyzer's pass 2. */
function hasTypeVariable(params: string[]): boolean {
  for (const p of params) {
    const t = p.trim()
    if (t.length === 1 && t >= "A" && t <= "Z") return true
  }
  return false
}

/**
 * (3) OVERRIDES edges the file can PROVE — pass 1 (exact signature) and pass 2 (name + arity under
 * generic substitution) of the analyzer's resolver, over the IN-FILE ancestor chain. See the module
 * header for why pass 3 is deliberately not derived.
 */
export function deriveJavaOverridesTruth(root: any): JavaOracleEdge[] {
  const declarations: JavaTypeFacts[] = []

  const collectType = (node: any, nesting: string[]): void => {
    const nameNode = fieldOf(node, "name") || childByType(node, "identifier")
    if (!nameNode) return
    const name = String(nameNode.text ?? "")
    const dotted = [...nesting, name].join(".")
    const { extendsNames, implementsNames } = heritageParents(node)
    const facts: JavaTypeFacts = {
      name, dotted,
      parentNames: [...extendsNames, ...implementsNames],
      methods: [],
      node,
    }
    const body =
      childByType(node, "class_body") || childByType(node, "enum_body") ||
      childByType(node, "interface_body") || childByType(node, "annotation_type_body")
    // MEMBERS live in two places: an ENUM's constants are direct children of its `enum_body`,
    // while its methods/fields/nested types sit behind the `enum_body_declarations` wrapper. A
    // version that read only the wrapper (the obvious shape) silently dropped every enum constant
    // body, so an `@Override` inside a constant's anonymous subclass had no truth row.
    const processMember = (member: any, nestingForNested: string[]): void => {
      if (!member) return
      if (member.type === "method_declaration") {
        const f = methodFacts(member)
        if (f) facts.methods.push(f)
      } else if (member.type === "enum_body_declarations") {
        for (const inner of namedChildren(member)) processMember(inner, nestingForNested)
      } else if (TYPE_DECLARATIONS.has(String(member.type))) {
        collectType(member, nestingForNested)
      } else if (member.type === "enum_constant") {
        // JLS 8.9.1: a constant with a body is an anonymous subclass of the enum.
        const constantBody = childByType(member, "class_body")
        if (constantBody) collectAnonymous(constantBody, name)
      }
    }
    if (body) for (const member of namedChildren(body)) processMember(member, [...nesting, name])
    declarations.push(facts)
  }

  const collectAnonymous = (classBody: any, parentName: string): void => {
    const facts: JavaTypeFacts = {
      name: `anonymous_${parentName}`,
      dotted: `anonymous_${parentName}`,
      parentNames: [parentName],
      methods: [],
      node: classBody,
    }
    for (const member of namedChildren(classBody)) {
      if (!member) continue
      if (member.type === "method_declaration") {
        const f = methodFacts(member)
        if (f) facts.methods.push(f)
      } else if (TYPE_DECLARATIONS.has(String(member.type))) {
        collectType(member, [facts.name])
      }
    }
    declarations.push(facts)
  }

  const walk = (n: any, enclosingTypeName: string | null): void => {
    if (!n) return
    if (TYPE_DECLARATIONS.has(String(n.type))) {
      collectType(n, [])
      return // collectType walks the body itself
    }
    if (n.type === "object_creation_expression") {
      const typeNode =
        childByType(n, "type_identifier") || childByType(n, "generic_type") ||
        childByType(n, "scoped_type_identifier") || childByType(n, "identifier")
      const classBody = childByType(n, "class_body")
      if (classBody) {
        const superName = typeNode ? (typeNode.type === "identifier" ? String(typeNode.text ?? "") : baseName(typeNode)) : ""
        if (superName) collectAnonymous(classBody, superName.split(".").pop() || superName)
        // do not descend into the anon body here; its members were collected
        for (const c of namedChildren(n)) if (c !== classBody) walk(c, enclosingTypeName)
        return
      }
    }
    for (const c of namedChildren(n)) walk(c, enclosingTypeName)
  }
  void walk(root, null)

  // Name index for in-file ancestry: exact dotted first, then the LEAF segment when unambiguous.
  const byDotted = new Map<string, JavaTypeFacts>()
  const byLeaf = new Map<string, JavaTypeFacts[]>()
  for (const d of declarations) {
    byDotted.set(d.dotted, d)
    const leaf = d.name
    const arr = byLeaf.get(leaf) ?? []
    arr.push(d)
    byLeaf.set(leaf, arr)
  }
  const resolve = (written: string): JavaTypeFacts | null => {
    const exact = byDotted.get(written)
    if (exact) return exact
    const leaf = written.split(".").pop() as string
    const candidates = byLeaf.get(leaf)
    if (candidates && candidates.length === 1) return candidates[0]
    return null // an out-of-file or ambiguous parent: nothing to prove
  }

  const out: JavaOracleEdge[] = []
  const seen = new Set<string>()
  const ancestorsOf = (decl: JavaTypeFacts): JavaTypeFacts[] => {
    const found: JavaTypeFacts[] = []
    const visited = new Set<JavaTypeFacts>([decl])
    const queue = [...decl.parentNames]
    while (queue.length > 0) {
      const written = queue.shift() as string
      const parent = resolve(written)
      if (!parent || visited.has(parent)) continue
      visited.add(parent)
      found.push(parent)
      for (const p of parent.parentNames) queue.push(p)
    }
    return found
  }

  for (const decl of declarations) {
    const ancestors = ancestorsOf(decl)
    if (ancestors.length === 0) continue
    const ancestorMethods: JavaMethodFacts[] = []
    for (const a of ancestors) for (const m of a.methods) if (!m.isPrivate) ancestorMethods.push(m)
    for (const m of decl.methods) {
      if (m.isConstructor || m.isStatic || m.isPrivate) continue
      const match = ancestorMethods.some((am) => {
        if (am.name !== m.name) return false
        if (am.params.length !== m.params.length) return false
        const exact = am.params.every((p, i) => p.trim() === m.params[i].trim())
        if (exact) return true
        // pass 2: generic substitution pairing — same arity, a type variable on either side
        return hasTypeVariable(am.params) || hasTypeVariable(m.params)
      })
      if (!match) continue
      const k = "overrides|" + m.name
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ label: "overrides", from: "(override)", target: m.name })
    }
  }
  return out
}

/**
 * CONVENIENCE — the four derivations in one call for a single wiring site.
 */
export function deriveJavaDeclarationSurfaceTruth(root: any): JavaOracleEdge[] {
  return [
    ...deriveJavaInheritanceTruth(root),
    ...deriveJavaInstantiatesTruth(root),
    ...deriveJavaOverridesTruth(root),
  ]
}
