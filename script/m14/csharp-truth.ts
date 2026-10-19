/**
 * CSHARP LANE — truth modules for the three emitted-but-unmeasured labels (task-37 STEP 3).
 *
 * `differential.ts` compares seven csharp labels (calls, contains, references, uses, extends,
 * implements, instantiates) and derives each from a second-opinion oracle. Three labels the
 * analyzer EMITS have no oracle: exports (the assembly surface), imports (using directives) and
 * overrides (C# `override` members). This module derives them independently from the grammar, so
 * the differential can compare all ten.
 *
 * INDEPENDENCE: these walkers import no analyzer helper. They read the same tree and the same
 * language rules, not the analyzer's code — a truth row and an analyzer row agreeing here is
 * evidence, not a copy.
 *
 * CONTRACTS MIRRORED (the analyzer's corrected emission, pinned by the lane's fixtures):
 *  - exports: ONE edge per exported TYPE, `from: "root"`, target = the FULLY-QUALIFIED name, arity
 *    = generic arity, deduped on (name, arity) so a `partial` split is one unit on the FIRST
 *    declaration's line. Top-level only (a type nested inside another type is not assembly
 *    surface), public only, `file`-scoped types never export, block and file-scoped namespaces
 *    select the SAME set, and a DOTTED namespace declaration is absolute (nested spelling is one
 *    name: `Acme.Inner.Doubled`, never `Acme.Outer.Acme.Inner.Doubled`).
 *  - imports: `using` directives in all four shape families (plain / static / alias / global with
 *    each modifier combination) publish the imported NAMESPACE/TYPE (never the alias), with the
 *    `global::` qualifier stripped and tuple element names removed; `extern alias X;` publishes
 *    the assembly alias. An unparsed directive publishes nothing.
 *  - overrides: a member carrying the `override` modifier in a type with a base list publishes
 *    `from: Owner.member`, `target: member` (the published label drops the signature; the indexer
 *    member is named `this`). Non-override members (`virtual`, `new`, plain overloads) publish
 *    nothing. This is the label's FACT regardless of which ancestor is chosen — C# requires a
 *    same-name base member for an override to compile — so the oracle derives the published row
 *    without importing the analyzer's hierarchy walk.
 */

export type CSharpTruthEdge = { label: "exports" | "imports" | "overrides"; from: string; target: string; line?: number }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < (n?.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}
const childOfType = (n: any, ...types: string[]): any | null => {
  for (const c of kids(n)) if (c && types.includes(c.type)) return c
  return null
}
const isPublic = (n: any): boolean => kids(n).some((c: any) => c.type === "modifier" && c.text === "public")
const isFileScopedType = (n: any): boolean => kids(n).some((c: any) => c.type === "modifier" && c.text === "file")
const typeArity = (n: any): number => { const tp = childOfType(n, "type_parameter_list"); return tp ? kids(tp).length : 0 }
const lineOf = (n: any): number | undefined => (n ? n.startPosition.row + 1 : undefined)

/** A namespace declaration's own name; a dotted name is absolute (C# declaration spelling). */
function namespaceNameOf(n: any): string {
  const named = kids(n)
  const name = named.find((c: any) => ["identifier", "qualified_name", "alias_qualified_name"].includes(c.type))
  return name ? String(name.text) : ""
}
function qualify(namespace: string | null, name: string): string {
  return namespace && namespace.length > 0 ? `${namespace}.${name}` : name
}

/** Strip a `global::` qualifier (the fixture pins that both spellings are the same module). */
function stripGlobalQualifier(text: string): string {
  const idx = text.indexOf("::")
  return idx >= 0 ? text.slice(idx + 2) : text
}
/** Drop a generic argument list from a module name (`Foo<Bar>` names Foo; the args are refs). */
function stripGenericArgs(text: string): string {
  const lt = text.indexOf("<")
  if (lt < 0) return text
  let depth = 0
  for (let i = lt; i < text.length; i++) {
    const ch = text[i]
    if (ch === "<") depth++
    else if (ch === ">") { depth--; if (depth === 0) return text.slice(0, lt) + text.slice(i + 1) }
  }
  return text.slice(0, lt)
}

/** Remove angle-bracket groups (`Dictionary<string, Widget>` names Dictionary) and trailing
 *  array rank specifiers (`System.Int32[]` names System.Int32); strip a leading `global::`. */
function cleanModuleText(textIn: string): string {
  let text = String(textIn ?? "")
  const idx = text.indexOf("::")
  if (idx >= 0) text = text.slice(idx + 2)
  let out = ""
  let depth = 0
  for (const ch of text) {
    if (ch === "<") { depth++; continue }
    if (ch === ">") { if (depth > 0) depth--; continue }
    if (depth === 0) out += ch
  }
  out = out.trim()
  while (out.endsWith("[]")) out = out.slice(0, -2).trim()
  return out
}

/** A tuple TYPE's identity is its element TYPES: `(Type ContainerType, string FieldName)` names
 *  `(Type,string)`. Element names are labels, not part of the name (R9's own contract). */
function tupleModuleText(node: any): string {
  const elements: string[] = []
  for (const el of kids(node)) {
    if (el.type !== "tuple_element") continue
    const typeNode = el.childForFieldName?.("type") ?? el.namedChild?.(0) ?? null
    elements.push(typeNode ? cleanModuleText(typeNode.text) : cleanModuleText(el.text))
  }
  return `(${elements.join(",")})`
}

/** The module a `using` directive imports, or "" when it does not parse to a readable name. */
function usingTarget(directive: any): string {
  if (directive.hasError) return "" // an unparsed directive publishes nothing (the analyzer rule)
  const named = kids(directive)
  // The alias form is `using Alias = Target;` — the `=` is an ANONYMOUS child. The TARGET is
  // the first named child after it; the ALIAS before it is never a module.
  let eq: any = null
  for (let i = 0; i < directive.childCount; i++) {
    const c = directive.child(i)
    if (c && !c.isNamed && c.text === "=") { eq = c; break }
  }
  const NAME_TYPES = new Set(["identifier", "qualified_name", "alias_qualified_name", "generic_name", "tuple_type", "array_type", "predefined_type"])
  let targetNode: any = null
  if (eq) {
    for (const c of named) if (c.startIndex >= eq.endIndex) { targetNode = c; break }
  } else {
    targetNode = named.find((c: any) => NAME_TYPES.has(c.type)) ?? null
  }
  if (!targetNode) return ""
  if (targetNode.type === "tuple_type") return tupleModuleText(targetNode)
  return cleanModuleText(targetNode.text)
}

/**
 * `exports` truth: the assembly's public top-level type surface.
 * The active namespace is either a block namespace (ancestor) or a file-scoped declaration that
 * owns the FOLLOWING SIBLINGS (grammar: types are siblings of the namespace node).
 */
export function deriveCSharpExportsTruth(root: any): CSharpTruthEdge[] {
  const out: CSharpTruthEdge[] = []
  const seen = new Set<string>()
  const push = (namespace: string | null, name: string, arity: number, line: number | undefined) => {
    const target = qualify(namespace, name)
    const key = `${target}\u0000${arity}`
    if (seen.has(key)) return // one exported unit per (name, arity): a `partial` pair is ONE row
    seen.add(key)
    out.push({ label: "exports", from: "root", target, line })
  }
  const TYPE_DECLS = new Set([
    "class_declaration", "struct_declaration", "interface_declaration",
    "record_declaration", "enum_declaration", "delegate_declaration",
  ])
  const walkSiblings = (nodes: any[], namespace: string | null, insideType: boolean): void => {
    let activeNamespace = namespace
    for (const n of nodes) {
      if (!n) continue
      if (n.type === "preproc_if" || n.type === "preproc_else" || n.type === "preproc_elif") {
        // A type guarded by #if is still a top-level declaration of the file the parser read
        // (the analyzer publishes it; the tree keeps both branches). Descend transparently.
        walkSiblings(kids(n), activeNamespace, insideType)
        continue
      }
      if (n.type === "file_scoped_namespace_declaration") {
        const nm = namespaceNameOf(n)
        activeNamespace = nm.indexOf(".") >= 0 ? nm : qualify(namespace, nm)
        continue
      }
      if (n.type === "namespace_declaration") {
        const nm = namespaceNameOf(n)
        const full = nm.indexOf(".") >= 0 ? nm : qualify(namespace, nm)
        const body = childOfType(n, "declaration_list")
        walkSiblings(body ? kids(body) : kids(n), full, false)
        continue
      }
      if (TYPE_DECLS.has(n.type)) {
        if (!insideType && isPublic(n) && !isFileScopedType(n)) {
          const nameNode = n.childForFieldName("name") ?? childOfType(n, "identifier")
          const name = nameNode ? String(nameNode.text) : ""
          if (name.length > 0) push(activeNamespace, name, typeArity(n), lineOf(nameNode))
        }
        // members of a type are not assembly exports; do not descend for export purposes
        continue
      }
    }
  }
  walkSiblings(kids(root), null, false)
  return out
}

/** `imports` truth: using directives (all four shape families) + extern aliases. */
export function deriveCSharpImportsTruth(root: any): CSharpTruthEdge[] {
  const out: CSharpTruthEdge[] = []
  const seen = new Set<string>()
  const push = (target: string, line: number | undefined) => {
    if (!target) return
    const key = target
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "imports", from: "root", target, line })
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "using_directive") { push(usingTarget(n), lineOf(n)); return }
    if (n.type === "extern_alias_directive") {
      const id = childOfType(n, "identifier")
      if (id) push(String(id.text), lineOf(n))
      return
    }
    for (const c of kids(n)) walk(c)
  }
  walk(root)
  return out
}

/** The leaf name of a written base/type reference (`Ns.IFoo<T>` names IFoo). */
function leafTypeName(textIn: string): string {
  const cleaned = cleanModuleText(String(textIn ?? ""))
  const dot = cleaned.lastIndexOf(".")
  return dot >= 0 ? cleaned.slice(dot + 1) : cleaned
}
/** Named members directly inside a type/interface body (fields are not interface members). */
function memberNamesOfBody(body: any): string[] {
  const out: string[] = []
  if (!body) return out
  for (const m of kids(body)) {
    if (m.type === "method_declaration" || m.type === "property_declaration" || m.type === "event_declaration") {
      const nn = m.childForFieldName("name") ?? childOfType(m, "identifier")
      if (nn) out.push(String(nn.text))
    } else if (m.type === "indexer_declaration") {
      out.push("this")
    } else if (m.type === "event_field_declaration") {
      const vd = childOfType(m, "variable_declaration")
      if (vd) for (const d of kids(vd)) if (d.type === "variable_declarator") {
        const id = childOfType(d, "identifier")
        if (id) out.push(String(id.text))
      }
    }
  }
  return out
}
function baseNamesOf(typeNode: any): string[] {
  const bl = childOfType(typeNode, "base_list")
  if (!bl) return []
  const bases: string[] = []
  for (const c of kids(bl)) {
    if (c.type === "primary_constructor_base_type") {
      const t = childOfType(c, "identifier", "qualified_name", "generic_name")
      if (t) bases.push(leafTypeName(t.text))
      continue
    }
    if (c.type === "identifier" || c.type === "qualified_name" || c.type === "generic_name") {
      bases.push(leafTypeName(c.text))
    }
  }
  return bases
}

/**
 * `overrides` truth: TWO surfaces the analyzer publishes under this label.
 *  A. C# `override` members of a type with a base list (the historical class-override surface).
 *  B. Interface-member implementations (C923): ALWAYS for an explicit `IFoo.M` member; for an
 *     implicit member only where an IN-FILE interface in the ancestor chain declares the member —
 *     a base class that declares the same member stops that path (the analyzer's rule).
 * Both publish `from: Owner.member`, `target: member` (the label drops the signature; an indexer's
 * member name is `this`).
 */
export function deriveCSharpOverridesTruth(root: any): CSharpTruthEdge[] {
  const out: CSharpTruthEdge[] = []
  const seen = new Set<string>()
  const push = (owner: string, member: string) => {
    if (!owner || !member) return
    const from = `${owner}.${member}`
    const key = `${from}\u0000${member}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ label: "overrides", from, target: member })
  }
  const isOverride = (n: any): boolean => kids(n).some((c: any) => c.type === "modifier" && c.text === "override")
  const typeNameOf = (n: any): string => {
    const nn = n.childForFieldName("name") ?? childOfType(n, "identifier")
    return nn ? String(nn.text) : ""
  }
  // ---- pass 1: in-file type facts ----
  const interfaces = new Map<string, Set<string>>() // in-file interface name -> member names
  const membersByType = new Map<string, Set<string>>() // class/struct name -> named members
  const basesByType = new Map<string, string[]>()       // name -> base leaf names
  const collect = (n: any): void => {
    if (!n) return
    if (n.type === "interface_declaration") {
      const name = typeNameOf(n)
      if (name) {
        interfaces.set(name, new Set(memberNamesOfBody(childOfType(n, "declaration_list"))))
        basesByType.set(name, baseNamesOf(n))
      }
    } else if (n.type === "class_declaration" || n.type === "record_declaration" || n.type === "struct_declaration") {
      const name = typeNameOf(n)
      if (name) {
        membersByType.set(name, new Set(memberNamesOfBody(childOfType(n, "declaration_list"))))
        basesByType.set(name, baseNamesOf(n))
      }
    }
    for (const c of kids(n)) collect(c)
  }
  collect(root)

  /** Does any ancestor interface (before a class that redeclares the member) declare `member`? */
  const ancestorInterfaceDeclares = (bases: string[], member: string): boolean => {
    const queue: string[] = [...bases]
    const seenTypes = new Set<string>()
    while (queue.length > 0) {
      const parent = queue.shift()!
      if (seenTypes.has(parent)) continue
      seenTypes.add(parent)
      const ifaceMembers = interfaces.get(parent)
      if (ifaceMembers) {
        if (ifaceMembers.has(member)) return true
        // interface inheritance: climb its own base list
        for (const next of basesByType.get(parent) ?? []) if (!seenTypes.has(next)) queue.push(next)
        continue
      }
      // a base CLASS that declares the member stops this path (the analyzer's rule)
      if (membersByType.get(parent)?.has(member)) continue
      for (const next of basesByType.get(parent) ?? []) if (!seenTypes.has(next)) queue.push(next)
    }
    return false
  }

  // ---- pass 2: emit ----
  const EXPLICIT = "explicit_interface_specifier"
  const walkType = (typeNode: any, isInterface: boolean): void => {
    const owner = typeNameOf(typeNode)
    const body = childOfType(typeNode, "declaration_list")
    if (!body) return
    const bases = baseNamesOf(typeNode)
    const hasBase = bases.length > 0
    for (const m of kids(body)) {
      if (!m) continue
      if (m.type === "class_declaration" || m.type === "struct_declaration" || m.type === "record_declaration" || m.type === "interface_declaration") {
        walkType(m, m.type === "interface_declaration")
        continue
      }
      if (isInterface) continue
      const explicit = childOfType(m, EXPLICIT) != null
      const memberOf = (): string[] => {
        if (m.type === "method_declaration" || m.type === "property_declaration" || m.type === "event_declaration") {
          const nn = m.childForFieldName("name") ?? childOfType(m, "identifier")
          return nn ? [String(nn.text)] : []
        }
        if (m.type === "indexer_declaration") return ["this"]
        if (m.type === "field_declaration" || m.type === "event_field_declaration") {
          const vd = childOfType(m, "variable_declaration")
          const names: string[] = []
          if (vd) for (const d of kids(vd)) if (d.type === "variable_declarator") {
            const id = childOfType(d, "identifier")
            if (id) names.push(String(id.text))
          }
          return names
        }
        return []
      }
      // surface A: C# override members (fields/events included) need a base list
      if (isOverride(m) && hasBase) {
        for (const name of memberOf()) push(owner, name)
      }
      // surface B: interface implementations. Fields never implement interface members.
      if (m.type === "field_declaration") continue
      for (const name of memberOf()) {
        if (explicit) { push(owner, name); continue }
        if (hasBase && ancestorInterfaceDeclares(bases, name)) push(owner, name)
      }
    }
  }
  const walk = (n: any): void => {
    if (!n) return
    if (n.type === "class_declaration" || n.type === "record_declaration" || n.type === "struct_declaration" || n.type === "interface_declaration") {
      walkType(n, n.type === "interface_declaration")
      return
    }
    for (const c of kids(n)) walk(c)
  }
  walk(root)
  return out
}
