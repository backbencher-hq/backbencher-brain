import type { Node } from "web-tree-sitter"

export interface PhpSignatureShape {
  parameters: Array<{ optional: boolean; variadic: boolean; byReference: boolean; type?: string[][] }>
  returnsByReference: boolean
  abstract: boolean
  returnType?: string[][]
}

export function phpSignatureShape(node: Node, resolveClass?: (name: string) => string | undefined): PhpSignatureShape | undefined {
  const parameters = node.childForFieldName("parameters")
  if (!parameters || parameters.hasError) return undefined
  const typeOf = (type: Node | null): string[][] | undefined => {
    if (!type) return [["mixed"]]
    if (type.hasError) return undefined
    if (["primitive_type", "bottom_type"].includes(type.type)) {
      const text = type.text.toLowerCase()
      return text === "iterable" ? [["array"], ["class:traversable"]] : [[text]]
    }
    if (type.type === "named_type") {
      if (type.text.toLowerCase() === "static") return undefined // version-sensitive late binding
      const identity = resolveClass?.(type.text)
      return identity ? [[`class:${identity}`]] : undefined
    }
    const children = type.namedChildren.filter((child): child is Node => !!child)
    const members = children.map(typeOf)
    if (members.some(member => !member)) return undefined
    if (type.type === "optional_type") return [...members.flatMap(member => member!), ["null"]]
    if (["union_type", "disjunctive_normal_form_type"].includes(type.type)) return members.flatMap(member => member!)
    if (type.type === "intersection_type") {
      let product: string[][] = [[]]
      for (const member of members) product = product.flatMap(left => member!.map(right => [...left, ...right]))
      return product
    }
    return undefined
  }
  return {
    parameters: parameters.namedChildren.filter((n): n is Node => !!n &&
      ["simple_parameter", "variadic_parameter", "property_promotion_parameter"].includes(n.type)).map(parameter => ({
        optional: parameter.childForFieldName("default_value") !== null,
        variadic: parameter.type === "variadic_parameter",
        byReference: parameter.childForFieldName("reference_modifier") !== null,
        type: (() => {
          const type = typeOf(parameter.childForFieldName("type"))
          // PHP accepts an implicitly nullable parameter with a null default.
          return type && parameter.childForFieldName("default_value")?.type === "null" ? [...type, ["null"]] : type
        })(),
      })),
    returnsByReference: node.namedChildren.some(child => child?.type === "reference_modifier"),
    abstract: node.namedChildren.some(child => child?.type === "abstract_modifier"),
    returnType: node.childForFieldName("return_type") ? typeOf(node.childForFieldName("return_type")) : [["untyped-return"]],
  }
}

/** Reject proven calling-shape conflicts. Type variance remains a separate check. */
export function phpSignatureShapeCompatible(child: PhpSignatureShape | undefined, parent: PhpSignatureShape | undefined, name: string): boolean {
  if (!child || !parent) return true // Older stored declarations have no shape evidence.
  if (name.toLowerCase() === "__construct" && !parent.abstract) return true
  const required = (shape: PhpSignatureShape) => shape.parameters.reduce((count, parameter, index) =>
    !parameter.optional && !parameter.variadic ? index + 1 : count, 0)
  if (required(child) > required(parent)) return false
  const childRest = child.parameters.at(-1)?.variadic === true
  const parentRest = parent.parameters.at(-1)?.variadic === true
  if (parentRest && !childRest) return false
  if (!childRest && child.parameters.length < parent.parameters.length) return false
  for (let i = 0; i < Math.max(parent.parameters.length, child.parameters.length); i++) {
    const base = parent.parameters[i] ?? (parentRest ? parent.parameters.at(-1) : undefined)
    const derived = child.parameters[i] ?? (childRest ? child.parameters.at(-1) : undefined)
    if (base && derived && base.byReference !== derived.byReference) return false
  }
  if (parent.returnsByReference && !child.returnsByReference) return false
  return true
}
