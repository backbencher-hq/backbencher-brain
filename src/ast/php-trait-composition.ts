import type { Node } from "web-tree-sitter"

export interface PhpTraitUse {
  traits: string[]
  aliases: Array<{ trait?: string; method: string; alias: string; visibility?: string }>
  exclusions: Array<{ trait: string; method: string; excluded: string[] }>
  complete: boolean
}

/** Keep trait composition separate from inheritance, including unsupported grammar evidence. */
export function phpTraitComposition(declaration: Node, resolve: (name: string) => string): PhpTraitUse[] {
  const body = declaration.childForFieldName("body") ?? declaration.namedChildren.find(child =>
    child && ["declaration_list", "enum_declaration_list"].includes(child.type))
  const groups: PhpTraitUse[] = []
  for (const use of body?.namedChildren ?? []) {
    if (use?.type !== "use_declaration") continue
    const group: PhpTraitUse = { traits: [], aliases: [], exclusions: [], complete: !use.hasError }
    for (const child of use.namedChildren) {
      if (!child) continue
      if (["name", "qualified_name"].includes(child.type)) group.traits.push(resolve(child.text))
      else if (child.type === "use_list") for (const rule of child.namedChildren) {
        if (!rule) continue
        const subject = rule.namedChild(0)
        const qualified = subject?.type === "class_constant_access_expression"
        const parts = qualified ? subject.namedChildren.filter((n): n is Node => !!n) : []
        const trait = qualified && parts[0] ? resolve(parts[0].text) : undefined
        const method = (qualified ? parts[1]?.text : subject?.text)?.toLowerCase()
        if (!method) { group.complete = false; continue }
        if (rule.type === "use_as_clause") {
          const alias = rule.namedChildren.slice(1).find(n => n?.type === "name")?.text
          const visibility = rule.namedChildren.find(n => n?.type === "visibility_modifier")?.text
          // Visibility-only adaptations preserve the destination but change access contracts.
          if (alias || visibility) group.aliases.push({ trait, method, alias: alias?.toLowerCase() ?? method, visibility })
        } else if (rule.type === "use_instead_of_clause" && trait) {
          group.exclusions.push({ trait, method, excluded: rule.namedChildren.slice(1)
            .filter((n): n is Node => !!n && ["name", "qualified_name"].includes(n.type)).map(n => resolve(n.text)) })
        } else group.complete = false
      }
      else group.complete = false
    }
    groups.push(group)
  }
  return groups
}
