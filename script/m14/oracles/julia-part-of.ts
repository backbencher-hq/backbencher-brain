/**
 * The Julia `part_of` oracle — LANE-OWNED.
 *
 * `include("path")` evaluates a file INSIDE the including module, so the file is a part of that
 * unit and shares its scope. The analyzer publishes the relation at R3 (the grammar already has
 * `call_expression` + `string_literal`), and this oracle derives it independently from Julia's own
 * `include` rule. It shares no helper, key set or resolver with `RealJuliaAnalyzer`.
 *
 * ## The rule
 *
 *   A call to the BUILTIN `include` whose first argument is ONE string literal names a part file.
 *   The edge is sourced at the scope executing the call and targets the BASENAME of the written
 *   path (the only spelling a file's own module symbol can carry).
 *
 * Three negatives are part of the rule rather than an afterthought, because a rule that fires on
 * every call is not a measurement:
 *
 *   1. A variable (`include(path)` where `path` is a binding) names no file.
 *   2. An expression (`include(joinpath(...))`) names no file.
 *   3. A scope that DECLARES `include` shadows the builtin, so a static call there is a call to
 *      that binding, not an inclusion. The shadow is scoped: a nested module's `include` does not
 *      shadow its parent's includes.
 *
 * ## What this oracle deliberately does NOT claim
 *
 * It does not resolve the path against the filesystem. `include("part.jl")` names `part.jl` by
 * basename even if no such file is in the repository; resolution is the graph's job and a
 * per-file oracle that guessed a directory would fabricate a target the source did not name.
 */

export type JuliaPartOfEdge = { label: "part_of"; from: string; target: string; path: string }

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

function nameOf(n: any): string {
  if (!n) return ""
  if (n.type === "identifier" || n.type === "operator" || n.type === "quote_expression") {
    return String(n.text ?? "").trim()
  }
  if (n.type === "field_expression") {
    const parts = kids(n).map(nameOf).filter(Boolean)
    return parts.join(".")
  }
  if (n.type === "parametrized_type_expression" || n.type === "where_expression" ||
      n.type === "parenthesized_expression" || n.type === "typed_expression" ||
      n.type === "type_head") {
    return nameOf(kids(n)[0])
  }
  if (n.type === "binary_expression") {
    const operands = kids(n).filter((c: any) => c.type !== "operator")
    return nameOf(operands[0])
  }
  return ""
}

function signatureName(sig: any): string {
  if (!sig) return ""
  if (sig.type === "signature") return signatureName(kids(sig)[0])
  if (sig.type === "typed_expression") return signatureName(kids(sig)[0])
  if (sig.type === "where_expression") return signatureName(kids(sig)[0])
  if (sig.type === "parenthesized_expression") return signatureName(kids(sig)[0])
  if (sig.type === "call_expression") return nameOf(kids(sig)[0])
  return ""
}

/** The name a declaration introduces, or "" when a node declares no callable/type/module. */
function declaredName(n: any): string {
  if (n.type === "function_definition" || n.type === "macro_definition") {
    return signatureName(kids(n).find((c: any) => c.type === "signature"))
  }
  if (n.type === "struct_definition" || n.type === "abstract_definition" ||
      n.type === "primitive_definition") {
    return nameOf(kids(n).find((c: any) => c.type === "type_head"))
  }
  if (n.type === "module_definition" || n.type === "baremodule_definition") {
    const byField = n.childForFieldName?.("name")
    if (byField) return String(byField.text ?? "").trim()
    return nameOf(kids(n)[0])
  }
  if (n.type === "assignment") {
    let lhs = kids(n)[0]
    for (let i = 0; i < 4 && lhs; i++) {
      if (lhs.type === "call_expression") return nameOf(kids(lhs)[0])
      if (lhs.type === "where_expression" || lhs.type === "typed_expression" ||
          lhs.type === "parenthesized_expression") {
        lhs = kids(lhs)[0]
        continue
      }
      break
    }
  }
  return ""
}

/** The literal path and basename of `include("…")`, or null when the argument is not one literal. */
function includePart(call: any): { path: string; target: string } | null {
  const args = kids(call).find((c: any) => c.type === "argument_list")
  if (!args) return null
  const first = kids(args)[0]
  if (!first || first.type !== "string_literal") return null
  if (kids(first).some((c: any) => c.type === "string_interpolation" || c.type === "escape_sequence")) return null
  const text = String(first.text ?? "")
  let body = ""
  if (text.startsWith('"""') && text.endsWith('"""') && text.length >= 6) body = text.slice(3, -3)
  else if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) body = text.slice(1, -1)
  else return null
  if (!body || body.endsWith("/") || body.endsWith("\\")) return null
  const cut = Math.max(body.lastIndexOf("/"), body.lastIndexOf("\\"))
  const target = body.slice(cut + 1)
  if (!target || target === "." || target === "..") return null
  return { path: body, target }
}

/** Every scope that declares a binding named `include`; "" is file scope and shadows everything. */
function includeOwners(root: any): Set<string> {
  const owners = new Set<string>()
  const walk = (n: any, scope: string) => {
    const declared = declaredName(n)
    if (declared === "include") owners.add(scope)
    const next = declared || scope
    for (const c of kids(n)) walk(c, next)
  }
  walk(root, "")
  return owners
}

export function deriveJuliaPartOfTruth(root: any): JuliaPartOfEdge[] {
  const out: JuliaPartOfEdge[] = []
  const seen = new Set<string>()
  const shadows = includeOwners(root)

  const walk = (n: any, scope: string) => {
    const declared = declaredName(n)
    const current = declared || scope

    if (n.type === "call_expression") {
      const callee = kids(n)[0]
      if (callee && callee.type === "identifier" && String(callee.text ?? "").trim() === "include") {
        const part = includePart(n)
        const shadowed = [...shadows].some((owner) =>
          owner === "" || current === owner || current.startsWith(owner + "."),
        )
        if (part && !shadowed) {
          const key = `${current}|${part.target}`
          if (!seen.has(key)) {
            seen.add(key)
            out.push({ label: "part_of", from: current || "global", target: part.target, path: part.path })
          }
        }
      }
    }

    // The scope advances for the CHILDREN of a declaration, exactly as Julia evaluates the body.
    for (const c of kids(n)) walk(c, current)
  }

  walk(root, "")
  return out
}
