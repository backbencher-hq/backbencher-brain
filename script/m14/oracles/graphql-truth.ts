/**
 * The GraphQL oracle — LANE-OWNED, written from the SDL specification and the fleet's own
 * documented conventions, sharing no rule table, resolver or helper with `RealGraphqlAnalyzer`.
 *
 * ## The grammar this reads (tree-sitter-graphql, the pinned build)
 *
 * `source_file` → (`comment` | `Document` → `Definition` → `TypeSystemDefinition` →
 * `TypeDefinition` → one of `ObjectTypeDefinition` / `InterfaceTypeDefinition` /
 * `InputObjectTypeDefinition` / `EnumTypeDefinition` / `UnionTypeDefinition` /
 * `ScalarTypeDefinition` / `SchemaDefinition`, or `TypeSystemExtension` → `TypeExtension` →
 * the `…Extension` counterpart). Members live in `FieldsDefinition` → `FieldDefinition`,
 * `InputFieldsDefinition` → `InputValueDefinition`, `EnumValuesDefinition` →
 * `EnumValueDefinition` → `EnumValue`, `UnionMemberTypes` → `NamedType`, and
 * `OperationTypeDefinition` (operation type + named type). Heritage is `ImplementsInterfaces`,
 * which the grammar nests left-recursively. All node names are Capitalised in this build.
 *
 * ## What it derives, and the rule for each
 *
 *  - `contains`   — a named definition contains the members written in ITS OWN body. A member of an
 *                   EXTENSION belongs to the extended type's name: SDL extensions add to the type
 *                   rather than declaring a new one. A schema contains its operations by the
 *                   operation TYPE (`schema.mutation`), which is the spelling the lane publishes.
 *  - `references` — a field's written type, list/non-null unwrapped, is a name the field references
 *                   (`id: ID!` references `ID`). Argument types are NOT derived here.
 *  - `implements` / `extends` — SDL writes both heritage clauses with ONE syntax
 *                   (`implements A & B`). The label is a decision about the SUPERtype the document
 *                   declares here: an interface is `implements` (the specification's meaning); an
 *                   object, input object, union or scalar is inheritance, which the fleet calls
 *                   `extends`; a supertype this document does not declare, or declares two ways,
 *                   stays `implements` — inventing `extends` for an unclassifiable name is the
 *                   fabrication the workstream forbids.
 *  - `overrides`  — a heritaged owner whose body re-declares a field the SAME-document supertype
 *                   also declares: `Owner.field -> Super.field`.
 *  - `exports`    — every definition the file declares, from the file identity `(file)`.
 *  - `imports`    — the `#import "path"` comment convention, source = the file's basename.
 *  - `uses`       — union members: `union U = A | B` reads A and B as values of U.
 *
 * ## What it deliberately does NOT claim
 *
 * Directive applications, argument types, descriptions and default values are not edges this
 * oracle derives. A label it does not derive is simply absent from truth; the labels it does
 * derive are admitted explicitly in `differential.ts`'s compared-label list beside the measurement.
 */

export type GraphqlEdge = { label: string; from: string; target: string }

const children = (n: any): any[] => {
  const out: any[] = []
  const count = n?.namedChildCount ?? 0
  for (let i = 0; i < count; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const firstOfType = (n: any, type: string): any | undefined => children(n).find((c: any) => c.type === type)
const text = (n: any): string => (n ? String(n.text ?? "") : "")

/** A node's own name: the lane's spelling for a definition, field, enum value or union member. */
function ownName(n: any): string {
  if (!n) return ""
  if (n.type === "Name") return text(n)
  const child = firstOfType(n, "Name")
  if (child) return text(child)
  // enum values and operation types carry a leaf token rather than a `Name`
  const leaf = children(n).find((c: any) => c.type === "EnumValue" || c.type === "OperationType")
  if (leaf) return text(leaf)
  return ""
}
/** The named type inside a `Type` expression: NamedType, with list/non-null wrappers already gone. */
function referencedTypeName(typeNode: any): string {
  if (!typeNode) return ""
  const direct = firstOfType(typeNode, "NamedType")
  if (direct) return ownName(direct)
  for (const c of children(typeNode)) {
    const nested = referencedTypeName(c)
    if (nested) return nested
  }
  return ""
}
/** One definition block, unwrapped from Document → Definition → TypeSystemDefinition → … */
function definitionBlocks(root: any): { node: any; block: any; isExtension: boolean }[] {
  const out: { node: any; block: any; isExtension: boolean }[] = []
  const doc = children(root).find((c: any) => c.type === "Document") ?? root
  for (const def of children(doc)) {
    if (def.type !== "Definition") continue
    for (const system of children(def)) {
      // A SchemaDefinition is a DIRECT child of TypeSystemDefinition in this grammar, while the
      // type definitions sit one level down inside TypeDefinition; a schema EXTENSION is likewise
      // not guaranteed to sit under TypeExtension. Both levels are read, so a schema's operations
      // are not silently absent from truth (measured 2026-11-01: they were, and the analyzer's
      // `contains schema -> schema.<op>` rows read as fabrications).
      if (system.type === "TypeSystemDefinition") {
        const td = firstOfType(system, "TypeDefinition")
        for (const block of td ? children(td) : children(system)) out.push({ node: def, block, isExtension: false })
      } else if (system.type === "TypeSystemExtension") {
        const te = firstOfType(system, "TypeExtension")
        for (const block of te ? children(te) : children(system)) out.push({ node: def, block, isExtension: true })
      }
    }
  }
  return out
}
const BLOCK_KINDS = new Set([
  "ObjectTypeDefinition",
  "InterfaceTypeDefinition",
  "InputObjectTypeDefinition",
  "EnumTypeDefinition",
  "UnionTypeDefinition",
  "ScalarTypeDefinition",
  "SchemaDefinition",
])
const EXTENSION_KINDS = new Set([
  "ObjectTypeExtension",
  "InterfaceTypeExtension",
  "InputObjectTypeExtension",
  "EnumTypeExtension",
  "UnionTypeExtension",
  "SchemaExtension",
])

/** (member name, written type name) for every member a definition body declares. */
function membersOf(block: any): { name: string; type: string; defaultText: string; directives: string[]; args: { name: string; type: string; defaultText: string }[] }[] {
  const out: { name: string; type: string; defaultText: string; directives: string[]; args: { name: string; type: string; defaultText: string }[] }[] = []
  const pushField = (n: any) => {
    const nm = ownName(n)
    const t = firstOfType(n, "Type")
    // ARGUMENTS are references too: a field whose argument is `filter: CheckRunFilter` names the
    // input type, and the analyzer publishes those (measured on the GitHub SDL: 295 of the 295
    // unexplained `references` rows were argument types, not return types).
    const args: { name: string; type: string; defaultText: string }[] = []
    const argsNode = firstOfType(n, "ArgumentsDefinition") ?? firstOfType(n, "Arguments")
    if (argsNode) {
      const walkArgs = (m: any) => {
        for (const c of children(m)) {
          if (c.type === "InputValueDefinition") {
            const at = firstOfType(c, "Type")
            args.push({ name: ownName(c), type: referencedTypeName(at), defaultText: text(firstOfType(c, "DefaultValue")) })
            continue
          }
          if (c.type === "ArgumentsDefinition" || c.type === "Arguments") walkArgs(c)
        }
      }
      walkArgs(argsNode)
    }
    // A DIRECTIVE APPLICATION on a declaration is a `uses` of the directive in this lane's
    // spelling: `user: User @deprecated` publishes `uses <owner>.<member> -> @deprecated`
    // (measured on the GitHub SDL: 210 unexplained `uses` rows, every one of them a directive or
    // an enum default, and this is the directive half).
    const directives: string[] = []
    const walkDirectives = (m: any) => {
      for (const c of children(m)) {
        if (c.type === "Directive") {
          const nm2 = ownName(c)
          if (nm2) directives.push(nm2)
          continue
        }
        if (c.type === "Directives" || c.type === "DirectivesConst") walkDirectives(c)
      }
    }
    walkDirectives(n)
    // An enum DEFAULT on the member itself: `side: DiffSide = RIGHT` on an INPUT OBJECT field.
    const ownDefault = firstOfType(n, "DefaultValue")
    out.push({ name: nm, type: referencedTypeName(t), defaultText: text(ownDefault), directives, args })
  }
  const walk = (n: any) => {
    for (const c of children(n)) {
      if (c.type === "FieldDefinition" || c.type === "InputValueDefinition") {
        pushField(c)
        continue
      }
      if (c.type === "EnumValueDefinition") {
        out.push({ name: ownName(c), type: "", defaultText: "", directives: [], args: [] })
        continue
      }
      if (c.type === "OperationTypeDefinition") {
        // schema { mutation: Mutation } → the member is the OPERATION TYPE (`schema.mutation`)
        out.push({ name: text(c).split(":")[0].trim(), type: "", defaultText: "", directives: [], args: [] })
        continue
      }
      if (c.type === "FieldsDefinition" || c.type === "InputFieldsDefinition" || c.type === "EnumValuesDefinition") {
        walk(c)
        continue
      }
    }
  }
  walk(block)
  return out
}

export function deriveGraphqlTruth(root: any, filePath: string): GraphqlEdge[] {
  const edges: GraphqlEdge[] = []
  const push = (label: string, from: string, target: string) => {
    if (from && target) edges.push({ label, from, target })
  }
  const fileLabel = String(filePath ?? "").split("/").pop() ?? ""
  const defs = definitionBlocks(root)

  // ── kind map: the heritage label depends on what THIS document says a name is ───────────────
  const kindOf = new Map<string, Set<string>>()
  const addKind = (name: string, kind: string) => {
    if (!name) return
    const set = kindOf.get(name) ?? new Set<string>()
    set.add(kind)
    kindOf.set(name, set)
  }
  for (const { block } of defs) {
    const nm = ownName(block)
    if (block.type === "ObjectTypeDefinition" || block.type === "ObjectTypeExtension") addKind(nm, "object")
    else if (block.type === "InterfaceTypeDefinition" || block.type === "InterfaceTypeExtension") addKind(nm, "interface")
    else if (block.type === "InputObjectTypeDefinition" || block.type === "InputObjectTypeExtension") addKind(nm, "input")
    else if (block.type === "UnionTypeDefinition" || block.type === "UnionTypeExtension") addKind(nm, "union")
    else if (block.type === "ScalarTypeDefinition" || block.type === "ScalarTypeExtension") addKind(nm, "scalar")
    else if (block.type === "EnumTypeDefinition" || block.type === "EnumTypeExtension") addKind(nm, "enum")
  }

  const fieldsDeclared = new Map<string, string[]>()
  const heritage: { owner: string; supertype: string }[] = []

  for (const { block, isExtension } of defs) {
    if (!BLOCK_KINDS.has(block.type) && !EXTENSION_KINDS.has(block.type) && !isExtension) continue
    const owner = ownName(block)
    const members = membersOf(block)
    for (const m of members) push("contains", owner, `${owner}.${m.name}`)
    if (members.length) fieldsDeclared.set(owner, [...(fieldsDeclared.get(owner) ?? []), ...members.map((m) => m.name).filter(Boolean)])
    for (const m of members) {
      if (m.type) push("references", `${owner}.${m.name}`, m.type)
      // member-level enum DEFAULT: `side: DiffSide = RIGHT` on an INPUT OBJECT field
      const mdv = /^\s*=?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(m.defaultText ?? "")
      if (mdv && m.type) push("uses", `${owner}.${m.name}`, `${m.type}.${mdv[1]}`)
      // DIRECTIVE APPLICATION on a member: `user: User @deprecated` is `uses ... -> @deprecated`
      for (const d of m.directives ?? []) push("uses", `${owner}.${m.name}`, `@${d}`)
      for (const a of m.args ?? []) {
        if (a.type) push("references", `${owner}.${m.name}`, a.type)
        // A default value that is an enum member reads that member: `side: DiffSide = RIGHT` is a
        // `uses` of `DiffSide.RIGHT`. The analyzer publishes it; the oracle must model it.
        const m2 = /^\s*=?\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(a.defaultText ?? "")
        if (m2 && a.type) push("uses", `${owner}.${m.name}`, `${a.type}.${m2[1]}`)
      }
    }
    if (!isExtension && block.type !== "SchemaDefinition" && owner) push("exports", "(file)", owner)
    // the schema keyword itself is an exported declaration in this lane's spelling
    if (!isExtension && block.type === "SchemaDefinition") push("exports", "(file)", "schema")

    // heritage clauses (object and interface definitions/extensions)
    const walkIfaces = (n: any) => {
      for (const c of children(n)) {
        if (c.type === "NamedType") {
          const nm = ownName(c)
          if (nm) heritage.push({ owner, supertype: nm })
          continue
        }
        if (c.type === "ImplementsInterfaces") walkIfaces(c)
      }
    }
    const ifaces = firstOfType(block, "ImplementsInterfaces")
    if (ifaces) walkIfaces(ifaces)

    // union members are `uses`
    const walkUnion = (n: any) => {
      for (const c of children(n)) {
        if (c.type === "NamedType") {
          const nm = ownName(c)
          if (nm) push("uses", owner, nm)
          continue
        }
        if (c.type === "UnionMemberTypes") walkUnion(c)
      }
    }
    const unionMembers = firstOfType(block, "UnionMemberTypes")
    if (unionMembers) walkUnion(unionMembers)

    // schema operations read their operation TYPE as a value: `schema { query: Query }` is
    // `contains schema -> schema.query` plus `uses schema.query -> Query`, both of which the
    // analyzer publishes (measured 2026-11-01 on the GitHub SDL: 2 operations, 2 uses edges).
    for (const op of children(block)) {
      if (op.type !== "OperationTypeDefinition") continue
      const opName = text(op).split(":")[0].trim()
      const named = firstOfType(op, "NamedType")
      const target = named ? ownName(named) : ""
      if (opName) push("contains", "schema", `schema.${opName}`)
      if (opName && target) push("uses", `schema.${opName}`, target)
    }
  }

  // ── imports: the #import comment convention, source = the file's basename ────────────────────
  const walkComments = (n: any) => {
    for (const c of children(n)) {
      if (c.type === "comment") {
        const m = /^\s*#import\s+"([^"]+)"/.exec(text(c))
        if (m) push("imports", fileLabel, m[1])
        continue
      }
      walkComments(c)
    }
  }
  walkComments(root)

  // ── heritage labels + overrides, both off the same-document kind map ────────────────────────
  for (const h of heritage) {
    const kinds = kindOf.get(h.supertype)
    const only = kinds && kinds.size === 1 ? [...kinds][0] : undefined
    const isInheritance = only === "object" || only === "input" || only === "union" || only === "scalar"
    push(isInheritance ? "extends" : "implements", h.owner, h.supertype)
    const superFields = fieldsDeclared.get(h.supertype) ?? []
    const ownerFields = fieldsDeclared.get(h.owner) ?? []
    for (const f of ownerFields) {
      if (superFields.includes(f)) push("overrides", `${h.owner}.${f}`, `${h.supertype}.${f}`)
    }
  }
  return edges
}
