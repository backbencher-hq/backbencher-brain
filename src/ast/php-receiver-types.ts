import type { Node } from "web-tree-sitter"

export interface PhpReceiverType {
  owner: string
  ownerIdentity: string
  receiverTypeEvidence: "stable-parameter"
}

/** Conservative, scope-local parameter facts; no assignment or runtime flow guesses. */
export function stablePhpParameterReceivers(
  declaration: Node | null,
  resolve: (name: string) => { owner: string; ownerIdentity: string } | undefined,
): ReadonlyMap<string, PhpReceiverType> {
  const types = new Map<string, PhpReceiverType>()
  const parameters = declaration?.childForFieldName("parameters")
  if (!parameters) return types
  for (const parameter of parameters.namedChildren) {
    if (!parameter) continue
    if (parameter.type === "variadic_parameter" || parameter.childForFieldName("reference_modifier")) continue
    const name = parameter.childForFieldName("name")
    let type = parameter.childForFieldName("type")
    if (type?.type === "optional_type") type = type.namedChild(0)
    // A union/intersection does not establish a unique receiver declaration.
    if (!name || type?.type !== "named_type") continue
    const resolved = resolve(type.text)
    if (resolved) types.set(name.text, { ...resolved, receiverTypeEvidence: "stable-parameter" })
  }
  if (!types.size) return types
  const invalidateVariables = (node: Node): void => {
    const pending = [node]
    while (pending.length) {
      const current = pending.pop()!
      if (current.type === "variable_name") types.delete(current.text)
      else for (const child of current.namedChildren) if (child) pending.push(child)
    }
  }
  const body = declaration?.childForFieldName("body")
  const pending: Node[] = body ? [body] : []
  while (pending.length && types.size) {
    const node = pending.pop()!
    const kind = node.type
    if (["dynamic_variable_name", "eval_expression", "include_expression", "include_once_expression", "require_expression", "require_once_expression"].includes(kind)) return new Map()
    if (kind === "function_call_expression") {
      const callee = node.childForFieldName("function")?.text.toLowerCase().split("\\").at(-1)
      // extract/eval can create or replace local variables without naming them.
      if (callee === "extract" || callee === "eval") return new Map()
    }
    if (kind === "assignment_expression" || kind === "augmented_assignment_expression") {
      const left = node.childForFieldName("left")
      if (left) invalidateVariables(left)
    } else if (["reference_assignment_expression", "update_expression", "unset_statement", "foreach_statement", "catch_clause", "global_declaration", "static_variable_declaration", "anonymous_function_use_clause", "argument"].includes(kind)) {
      // Passing a parameter can expose it to an unknown by-reference callee.
      // Captures and nested writes are deliberately declined rather than guessed.
      invalidateVariables(node)
    }
    for (const child of node.namedChildren) if (child) pending.push(child)
  }
  return types
}
