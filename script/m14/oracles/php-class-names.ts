/** Test-only namespace/import derivation, independent of the PHP analyzer. */
function environmentAt(node: any): { namespace: string; statements: any[] } {
  let current = node
  while (current.parent) {
    if (current.parent.type === "namespace_definition") {
      const declaration = current.parent
      const body = declaration.namedChildren.find((child: any) => child.type === "compound_statement")
      return { namespace: declaration.childForFieldName("name")?.text ?? "", statements: body?.namedChildren ?? [] }
    }
    current = current.parent
  }
  let namespace = ""
  let start = 0
  const statements: any[] = current.namedChildren
  for (let index = 0; index < statements.length; index++) {
    const statement = statements[index]
    if (statement.startIndex >= node.startIndex) break
    if (statement.type === "namespace_definition" && !statement.namedChildren.some((child: any) => child.type === "compound_statement")) {
      namespace = statement.childForFieldName("name")?.text ?? ""
      start = index + 1
    }
  }
  return { namespace, statements: statements.slice(start) }
}

export function phpDeclaredClassIdentity(node: any, name: string): string {
  return [environmentAt(node).namespace, name].filter(Boolean).join("\\").toLowerCase()
}

export function phpClassReferenceIdentity(node: any, raw: string): string {
  if (raw.startsWith("\\")) return raw.slice(1).toLowerCase()
  const environment = environmentAt(node)
  const components = raw.split("\\")
  if (components[0]?.toLowerCase() === "namespace") return [environment.namespace, ...components.slice(1)].filter(Boolean).join("\\").toLowerCase()
  const imports = new Map<string, string>()
  const nonClass = (declaration: any) => declaration.children.some((part: any) => part.type === "function" || part.type === "const")
  for (const statement of environment.statements) {
    if (statement.startIndex >= node.startIndex) break
    if (statement.type !== "namespace_use_declaration" || nonClass(statement)) continue
    const group = statement.namedChildren.find((part: any) => part.type === "namespace_use_group")
    const prefix = group ? statement.namedChildren.find((part: any) => part.type === "namespace_name")?.text : ""
    const clauses = (group ?? statement).namedChildren.filter((part: any) => part.type === "namespace_use_clause")
    for (const clause of clauses) {
      if (nonClass(clause)) continue
      const names = clause.namedChildren.filter((part: any) => part.type === "name" || part.type === "qualified_name")
      if (!names.length) continue
      const imported = [prefix, names[0].text].filter(Boolean).join("\\").replace(/^\\/, "")
      const alias = names[1]?.text ?? imported.split("\\").at(-1)!
      imports.set(alias.toLowerCase(), imported)
    }
  }
  const imported = imports.get(components[0]!.toLowerCase())
  return (imported ? [imported, ...components.slice(1)] : [environment.namespace, ...components])
    .filter(Boolean).join("\\").toLowerCase()
}

/** Independently derive function lookup from the call's lexical namespace/imports. */
export function phpFunctionReferenceCandidates(node: any, raw: string): string[] {
  const environment = environmentAt(node)
  if (raw[0] === "\\") return [raw.substring(1).toLowerCase()]
  const words = raw.split("\\")
  if (words[0].toLowerCase() === "namespace") return [[environment.namespace, ...words.slice(1)].filter(Boolean).join("\\").toLowerCase()]
  // Qualified functions use the namespace/class import table; function imports
  // apply only to unqualified calls.
  if (words.length > 1) return [phpClassReferenceIdentity(node, raw)]
  const aliases = new Map<string, string>()
  const kind = (part: any) => part.children.find((child: any) => child.type === "function" || child.type === "const")?.type
  for (const statement of environment.statements) {
    if (statement.startIndex >= node.startIndex) break
    if (statement.type !== "namespace_use_declaration") continue
    const group = statement.namedChildren.find((part: any) => part.type === "namespace_use_group")
    const prefix = group ? statement.namedChildren.find((part: any) => part.type === "namespace_name")?.text : ""
    for (const clause of (group ?? statement).namedChildren) {
      if (clause.type !== "namespace_use_clause" || (kind(clause) ?? kind(statement)) !== "function") continue
      const names = clause.namedChildren.filter((part: any) => part.type === "name" || part.type === "qualified_name")
      if (!names.length) continue
      const identity = [prefix, names[0].text].filter(Boolean).join("\\").replace(/^\\/, "").toLowerCase()
      aliases.set((names[1]?.text ?? identity.split("\\").at(-1)).toLowerCase(), identity)
    }
  }
  const imported = aliases.get(raw.toLowerCase())
  if (imported) return [imported]
  const local = [environment.namespace, raw].filter(Boolean).join("\\").toLowerCase()
  return environment.namespace ? [local, raw.toLowerCase()] : [local]
}
