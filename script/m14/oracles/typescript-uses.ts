/**
 * The TypeScript `uses` oracle — LANE-OWNED.
 *
 * ## Measured state: 22.2% agreement, and NOT usable as evidence yet
 *
 * 429 edges agree over 200 tracked files, 1302 the analyzer lacks, 205 it
 * invents. It is committed for its RULE and its measurements, not as assurance,
 * and the number is in the header so nobody cites it as a cross-check.
 *
 * What IS settled, and is the reusable part, is that `uses` is four surfaces
 * rather than one, and that they disagree with each other in two specific ways:
 *
 *   - the TYPE surface REQUIRES resolution while the `references` type surface
 *     does not. `const a: Array<Ty>` yields `f -> Ty` and never `f -> Array`.
 *   - the EXPR surface suppresses a name bound by a local DECLARATOR but not one
 *     bound by a PARAMETER, which is precisely the asymmetry R12 and R13 had to
 *     protect, and the reason a `uses` oracle is what makes that class of
 *     over-suppression visible from the other side.
 *
 * What is NOT settled is the FIELD surface's gating. Resolving a member read
 * against every declared name rather than only declared MEMBERS is measured
 * correct — it took the field-surface disagreements from 25 invented to 11 — but
 * the oracle then emits 699 field edges the analyzer does not, so the analyzer
 * applies a further context test the oracle has not identified. Until that is
 * found, the field surface is a hypothesis with one measured half, and the honest
 * next step is to locate the gate rather than to widen the rule again.
 *
 * It shares the file-content facts with `typescript-references.ts`
 * (`declaredNames`, `typePositionNodes`, `patternNames`, `paramNames`,
 * `PRIMITIVES`) because "what names does this file declare" is an observation,
 * not a rule. It shares NO rule, no surface test, no owner attribution and no
 * key set with the analyzer, and those are the parts that carry the meaning.
 *
 * ## Why this oracle exists
 *
 * `uses` is the third-largest relationship TypeScript emits — 7,525 edges over
 * 1000 tracked files, behind `calls` (100,711) and `references` (12,940) — and
 * it had no independent cross-check at any scale. The committed lane evidence is
 * `truthSource: manual_audit` over five hand-written fixtures.
 *
 * It is also the class where the lane's two shadowing fixes were most at risk of
 * doing harm rather than good. R12 (parameters) and R13 (loop variables and catch
 * bindings) both had to suppress a *name* in the reference pass while leaving the
 * `uses` edge to that same name intact, because `locals` gates both. Seeding
 * `locals` with parameters deleted 891 `uses` edges over 1200 files — the largest
 * single regression in this lane's history, caught only because a fixture pinned
 * `greet -> name`. A `uses` oracle is what makes that class of error visible from
 * the other side: if suppression ever starts eating `uses`, the two surfaces stop
 * agreeing about who binds what.
 *
 * ## The rule
 *
 * A declaration USES a name in one of four positions. Each is a distinct question
 * with a distinct answer, and the surfaces differ on the one point a reader would
 * assume they share — whether the target has to resolve.
 *
 *   1. TYPE      a name written in a type position, and it RESOLVES. So
 *                `function f(x: Ty)` gives `f -> Ty`, but `const a: Array<Ty>`
 *                gives `f -> Ty` and NOT `f -> Array`, because `Array` is not
 *                declared in the file. This is the OPPOSITE of the `references`
 *                type surface, which publishes unresolvable builtin names
 *                (`Record` 674 times over 600 files); measured, and recorded here
 *                as an asymmetry between two surfaces of the same word rather
 *                than smoothed into one rule.
 *   2. FIELD     `receiver.member`, where `member` is a declared member of some
 *                type in the file — an interface property, a class field, or a
 *                `#private` one, which the graph spells with the `#`. The
 *                receiver is a VALUE, so the member does not have to be reachable
 *                from the receiver's own type: `k.count` yields `f -> count`
 *                whenever `count` is a field declared anywhere in the file.
 *                `k.zzz` yields nothing, and `k.m()` yields a `calls` edge and
 *                NOT a field one — a method read is a call, not a property read.
 *   3. EXPR      an identifier read inside a template substitution, `${name}`.
 *                And here is the asymmetry that R12 exists for: a name bound by
 *                a local DECLARATOR in the enclosing function is suppressed,
 *                because the substitution reads the local, while a PARAMETER is
 *                NOT suppressed. `${name}` for a parameter gives `f -> name`;
 *                `${n}` for a `let n` gives nothing. Suppressing both would be
 *                tidier and wrong.
 *   4. JSX       a capitalized JSX tag that names a declared symbol.
 *
 * ## What the oracle deliberately does NOT settle
 *
 * Whether a FIELD target that happens to share a name with an unrelated
 * declaration is the member that was read. The analyzer resolves field names
 * against the file's whole member table, so `o.a` can attach to any `a` declared
 * anywhere in the file. That is a resolution the graph cannot express with a bare
 * name, and the oracle records the mention and lets the comparison speak.
 */

import { declaredNames, typePositionNodes, patternNames, paramNames, PRIMITIVES, type TruthEdge } from "./typescript-references"

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): string | null => n?.childForFieldName?.(f)?.text ?? null

export type { TruthEdge }

/** Declaration nodes that own mentions, and are therefore `uses` sources. */
const SOURCES = new Set([
  "class_declaration",
  "abstract_class_declaration",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "internal_module",
  "module",
  "variable_declarator",
])

/** Function-like nodes whose parameter list binds for its own extent. */
const PUSHES = new Set([
  "function_declaration",
  "function_expression",
  "arrow_function",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
  "function_type",
  "method_signature",
  "abstract_method_signature",
  "call_signature",
  "construct_signature",
  "function_signature",
])

/** True when `id` is the property half of `recv.member`. */
function isMemberAccessProperty(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type !== "member_expression" && p.type !== "optional_chain") return false
  return p.childForFieldName?.("property")?.startIndex === id.startIndex
}

/** True when the member access is CALLED, i.e. `k.m()` — a call, not a field read. */
function isCalledMember(id: any): boolean {
  const p = id?.parent
  if (!p) return false
  if (p.type !== "member_expression" && p.type !== "optional_chain") return false
  if (p.childForFieldName?.("property")?.startIndex !== id.startIndex) return false
  const g = p.parent
  return !!g && g.type === "call_expression" && g.childForFieldName?.("function")?.startIndex === p.startIndex
}

export function deriveTypeScriptUsesTruth(root: any): TruthEdge[] {
  const declared = declaredNames(root)
  const inTypePos = typePositionNodes(root)
  const isTypePos = (n: any): boolean => inTypePos.has(`${n.startIndex}:${n.endIndex}:${n.type}`)
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const add = (from: string, to: string, why: string): void => {
    const k = `${from}|${to}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "uses", from, target: to, why } as TruthEdge)
  }

  /**
   * Walk one declaration's extent. `bound` holds names bound by LOCAL DECLARATORS
   * in scope — and only those, which is the whole of surface 3: a parameter is not
   * in this set, so a template reading a parameter still publishes.
   */
  const walk = (n: any, source: string, bound: Set<string>): void => {
    if (!n) return
    const t = n.type

    if (PUSHES.has(t)) {
      const next = new Set(bound)
      const fp = n.childForFieldName?.("parameters")
      if (fp) for (const b of paramNames(fp)) next.add(b)
      for (const c of named(n)) walk(c, source, next)
      return
    }

    let childBound = bound
    if (t === "variable_declarator" || t === "for_in_statement" || t === "catch_clause") {
      childBound = new Set(bound)
      const target = t === "variable_declarator" ? n.childForFieldName?.("name") : n.namedChild(0)
      for (const b of patternNames(target)) childBound.add(b)
    }

    // Surface 2: a member read. The member must be a declared member, and a
    // CALLED member is a call rather than a field read.
    if ((t === "property_identifier" || t === "private_property_identifier") && isMemberAccessProperty(n)) {
      // The target resolves against EVERY name the file declares, not only its
      // members. A member read is a property of a VALUE, and the value's static
      // type is not consulted here, so `estimateScale -> bucket` is a field edge
      // whenever `bucket` is any declared symbol. Restricting this to `members`
      // was the single largest error in the first draft: 659 missing edges on 200
      // files, nearly all of them ordinary property reads.
      if (declared.has(n.text) && !isCalledMember(n) && source !== n.text) add(source, n.text, "field")
      return
    }

    // Surface 3: a template substitution reads an identifier. Only a local
    // declarator suppresses it — a parameter does not.
    if (t === "template_substitution") {
      for (const c of named(n)) {
        if (c.type === "identifier" && !childBound.has(c.text) && source !== c.text) {
          add(source, c.text, "expr")
          continue
        }
        walk(c, source, childBound)
      }
      return
    }

    // Surface 1: a name in a type position, and it RESOLVES. This is the one
    // point where `uses` and `references` deliberately disagree: `references`
    // publishes builtin type names with no declaration behind them, `uses` does
    // not, so `Array<Ty>` yields `Ty` alone.
    if (t === "type_identifier" || t === "nested_type_identifier" || (t === "identifier" && isTypePos(n))) {
      const name = t === "identifier" ? field(n.parent, "name") ?? n.text : n.text
      if (name && declared.has(name) && !PRIMITIVES.has(name) && !childBound.has(name) && name !== source) {
        add(source, name, "type")
      }
      return
    }

    // Surface 4: a capitalized JSX tag naming a declared symbol.
    if ((t === "jsx_opening_element" || t === "jsx_self_closing_element") && declared.has(n.namedChild(0)?.text ?? "")) {
      const tag = n.namedChild(0)
      if (tag && tag.text !== source) add(source, tag.text, "jsx")
      return
    }

    for (const c of named(n)) walk(c, source, childBound)
  }

  const visit = (n: any): void => {
    if (!n) return
    let name: string | null = null
    if (SOURCES.has(n.type)) name = field(n, "name")
    if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      const bound = new Set<string>()
      const fp = n.childForFieldName?.("parameters")
      if (fp) for (const b of paramNames(fp)) bound.add(b)
      for (const c of named(n)) walk(c, name, new Set(bound))
    }
    for (const c of named(n)) visit(c)
  }
  visit(root)

  return edges
}
