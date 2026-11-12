import type { PhpSignatureShape } from "./php-signature-shape"

export type PhpTypeRelation = boolean | undefined
const all = (values: PhpTypeRelation[]): PhpTypeRelation => values.includes(false) ? false : values.includes(undefined) ? undefined : true
const any = (values: PhpTypeRelation[]): PhpTypeRelation => values.includes(true) ? true : values.includes(undefined) ? undefined : false

/** Three-valued type comparison: missing project hierarchy never proves incompatibility. */
export function phpSignatureVariance(
  child: PhpSignatureShape | undefined, parent: PhpSignatureShape | undefined,
  name: string, classSubtype: (subtype: string, supertype: string) => PhpTypeRelation,
): PhpTypeRelation {
  if (!child || !parent) return undefined
  if (name.toLowerCase() === "__construct" && !parent.abstract) return true
  const atom = (sub: string, sup: string): PhpTypeRelation => {
    if (sub === sup || sub === "never" || sup === "untyped-return") return true
    if (sub === "untyped-return") return false
    if (sup === "mixed") return sub !== "void"
    if (sub === "mixed" || sub === "void" || sup === "void") return false
    if ((sub === "true" || sub === "false") && sup === "bool") return true
    if (sub.startsWith("class:")) {
      if (sup === "object") return true
      if (sup.startsWith("class:")) return classSubtype(sub.slice(6), sup.slice(6))
      if (sup === "callable") return undefined // __invoke and accessibility need member analysis
    }
    return false
  }
  const subtype = (sub: string[][] | undefined, sup: string[][] | undefined): PhpTypeRelation => {
    if (!sub || !sup) return undefined
    return all(sub.map(sourceIntersection => any(sup.map(targetIntersection =>
      all(targetIntersection.map(target => any(sourceIntersection.map(source => atom(source, target)))))))))
  }
  const checks: PhpTypeRelation[] = []
  const parentRest = parent.parameters.at(-1)?.variadic
  const childRest = child.parameters.at(-1)?.variadic
  for (let i = 0; i < Math.max(parent.parameters.length, child.parameters.length); i++) {
    const base = parent.parameters[i] ?? (parentRest ? parent.parameters.at(-1) : undefined)
    const derived = child.parameters[i] ?? (childRest ? child.parameters.at(-1) : undefined)
    if (base && derived) checks.push(subtype(base.type, derived.type))
  }
  checks.push(subtype(child.returnType, parent.returnType))
  return all(checks)
}

/** Missing, duplicate and cyclic declarations leave subtype questions unresolved. */
export function phpClassSubtype(hierarchy: ReadonlyMap<string, readonly string[][]>, sub: string, sup: string): PhpTypeRelation {
  if (sub === sup) return true
  const visit = (identity: string, seen: Set<string>): PhpTypeRelation => {
    if (identity === sup) return true
    if (seen.has(identity)) return undefined
    const declarations = hierarchy.get(identity)
    if (declarations?.length !== 1) return undefined
    const next = new Set(seen).add(identity)
    return any(declarations[0].map(parent => visit(parent, next)))
  }
  return visit(sub, new Set())
}
