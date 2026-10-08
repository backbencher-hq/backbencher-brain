/**
 * The kotlin `overrides` oracle for PROPERTY overrides — LANE-OWNED
 * (`analyzer/DERIV_OVERRIDES`).
 *
 * ## Why this file exists, and why it is PROPERTY-only
 *
 * `overrides` was kotlin's second-largest audited class before this wave and its
 * truth came from the generic `deriveTreeEdges` (differential.ts:19560), which
 * indexes `function_declaration` members. That covered `override fun` and
 * nothing else, and the analyzer matched it exactly — both sides were silent
 * about `override val`.
 *
 * MEASURED, on 200 real corpus files: **1,837 `override val`/`override var`
 * declarations and 0 edges.** An absent capability emits nothing, and every gate
 * on either side asks whether an edge that EXISTS is right, so neither the
 * analyzer nor the oracle could see the hole. That is the structural blindness
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md` opens with — "nothing agrees with
 * nothing perfectly" — reproduced inside a single lane.
 *
 * So this oracle derives the property half and deliberately leaves the method
 * half to `deriveTreeEdges`. Two derivations for one label is the arrangement
 * `oracles/dart-overrides.ts` uses (its own header records the same split), and
 * the alternative — re-deriving methods here too — would produce a second,
 * disagreeing answer to a question `deriveTreeEdges` already answers.
 *
 * ## The rule
 *
 * A member M declared with the `override` modifier in type C overrides a member
 * of the same name declared in the nearest ancestor of C that declares one.
 *
 * Three parts, each a fact about Kotlin rather than a choice:
 *
 *   1. **`override` is REQUIRED.** A same-named member without the modifier
 *      SHADOWS; it does not override. A name-only rule fabricates an edge for
 *      every shadowed property in the corpus, which is why the fixture
 *      (`kotlin/override-property-949`) carries that forbid.
 *   2. **THE SIGNATURE IS THE DECLARED TYPE.** `override val x: String` over
 *      `open val x: String` is the relation. Stored parenthesised — `(String)` —
 *      so the type-variable scan sees the same token boundary it sees in a
 *      parameter list, which is what keeps this oracle and the analyzer reading
 *      `(T?)` the same way (#949).
 *   3. **IN-FILE VERIFICATION ONLY.** A supertype this file does not declare
 *      cannot be searched, so the walk ends there and this oracle derives
 *      NOTHING for that member. That is deliberate and it is the same shape the
 *      generic method derivation has: the analyzer's cross-file tier publishes a
 *      first-supertype GUESS at confidence 0.5 carrying
 *      `reasonCode: first-supertype-guess` and `evidenceClass: inferred`, and the
 *      harness files an unmatched sub-0.7 edge as HEURISTIC rather than as a
 *      fabrication. An oracle that derived the guess would be deriving the
 *      analyzer's uncertainty rather than the language's structure.
 *
 * ## What this oracle therefore CANNOT see
 *
 * - A covariant property override (`override val x: Any` over `open val x:
 *   String`) is legal Kotlin and does NOT verify here — exact-type matching only.
 *   The analyzer's row stays at the guess tier and the fixture pins that, rather
 *   than a subtype test being invented to make the two agree.
 * - A cross-file declaring ancestor, by construction.
 * - The companion-index tier: `mergeSymbolsIntoOverrideCompanion`
 *   (src/ast/override-context.ts) indexes `kind === "method"` symbols only, so a
 *   property name is absent from every companion set. The analyzer skips that
 *   pass for properties and says so; this oracle has no companion to consult.
 * - A grammar bug shared with the analyzer, being a second walker over the same
 *   pinned wasm.
 *
 * NO REGEX (rule R2). Node types, fields and unnamed keyword tokens only.
 */

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): any => n?.childForFieldName?.(f) ?? null

/** Declaration types that can OWN a member and can be a SUPERTYPE. */
const TYPES = new Set(["class_declaration", "object_declaration"])
const BODY_OF: Record<string, string> = { class_declaration: "class_body", object_declaration: "class_body" }

/** Does this declaration carry a modifier whose keyword token is exactly `word`? */
function hasModifier(decl: any, word: string): boolean {
  for (const c of named(decl)) {
    if (c.type !== "modifiers") continue
    for (const m of named(c)) {
      for (let i = 0; i < m.childCount; i++) {
        const tok = m.child(i)
        if (tok && !tok.isNamed && tok.text === word) return true
      }
    }
  }
  return false
}

function typeName(n: any): string | null {
  const byField = field(n, "name")
  if (byField?.text) return byField.text
  for (const c of named(n)) if (c.type === "type_identifier" || c.type === "simple_identifier") return c.text
  return null
}

/** The first `type_identifier` anywhere under `n` — a delegation specifier nests it. */
function firstTypeIdentifier(n: any): any {
  if (!n) return null
  if (n.type === "type_identifier") return n
  for (const c of named(n)) { const r = firstTypeIdentifier(c); if (r) return r }
  return null
}

/**
 * A type's DIRECT supertypes, in declaration order.
 *
 * `class C : Base(), Iface` is two `delegation_specifier` children of the
 * declaration, and BOTH spellings carry the type the same way: a
 * `constructor_invocation` for `Base()` and a bare `user_type` for `Iface`. The
 * real discriminator is the `constructor_invocation` CHILD, which is probed rather
 * than guessed — the kotlin override review's fourth instrument bug came from
 * marking every supertype a constructor call.
 */
function directSupertypes(n: any): string[] {
  const out: string[] = []
  for (const c of named(n)) {
    if (c.type !== "delegation_specifier") continue
    const id = firstTypeIdentifier(c)
    if (!id?.text) continue
    if (!out.includes(id.text)) out.push(id.text)
  }
  return out
}

/** The DECLARED TYPE of a property member, parenthesised for the signature slot. */
function propertySignature(m: any): string {
  // `variable_declaration > user_type`, or a bare `user_type` under a delegate.
  const find = (n: any): any => {
    if (!n) return null
    if (n.type === "user_type" || n.type === "nullable_type") return n
    for (const c of named(n)) { const r = find(c); if (r) return r }
    return null
  }
  const decl = named(m).find((c: any) => c.type === "variable_declaration")
  const t = find(decl ?? m)
  return "(" + String(t?.text ?? "") + ")"
}

/** Is this signature generic (a single-capital type variable at a token boundary)? */
function sigHasTypeVar(sig: string): boolean {
  const n = sig.length
  let i = 0
  while (i < n) {
    const c = sig[i]
    if (c === "(" || c === "," || c === ":" || c === "|" || c === "[" || c === "<" || c === "&" || i === 0) {
      let j = i
      while (j < n && (sig[j] === "(" || sig[j] === "[" || sig[j] === " " || sig[j] === ":" || sig[j] === ",")) j++
      if (j < n && sig[j] >= "A" && sig[j] <= "Z") {
        let end = j + 1
        while (end < n && ((sig[end] >= "A" && sig[end] <= "Z") || (sig[end] >= "a" && sig[end] <= "z") || (sig[end] >= "0" && sig[end] <= "9") || sig[end] === "_")) end++
        if (end === j + 1) return true
        i = end
        continue
      }
      i = j > i ? j : i + 1
      continue
    }
    i++
  }
  return false
}

type Member = { name: string; sig: string }

/**
 * Derive the file's PROPERTY override truth.
 *
 * Breadth-first over the in-file hierarchy, capped and index-drained: an earlier
 * dart oracle iterated its queue in place while appending to it, so a supertype
 * matching no declaration left the queue holding its previous contents and spun
 * forever — it HUNG the probe process rather than returning a wrong answer.
 */
export function deriveKotlinPropertyOverrides(root: any): TruthEdge[] {
  // index: type name -> the property members it declares, and its own supertypes
  const members = new Map<string, Member[]>()
  const parents = new Map<string, string[]>()

  const collect = (n: any): void => {
    if (n && TYPES.has(n.type)) {
      const nm = typeName(n)
      if (nm) {
        const owned: Member[] = []
        const body = named(n).find((c: any) => c.type === BODY_OF[n.type])
        if (body) {
          for (const m of named(body)) {
            if (m.type !== "property_declaration") continue
            const decl = named(m).find((c: any) => c.type === "variable_declaration")
            const id = decl ? field(decl, "name") ?? named(decl).find((c: any) => c.type === "simple_identifier") : null
            if (!id?.text) continue
            owned.push({ name: id.text, sig: propertySignature(m) })
          }
        }
        members.set(nm, owned)
        parents.set(nm, directSupertypes(n))
      }
    }
    for (const c of named(n)) collect(c)
  }
  collect(root)

  // The overriding members, each attributed to the type that encloses it.
  const overriding: { owner: string; name: string; sig: string }[] = []
  {
    const walk = (n: any, owner: string | null): void => {
      if (n && TYPES.has(n.type)) {
        const nm = typeName(n)
        const body = named(n).find((c: any) => c.type === BODY_OF[n.type])
        if (nm && body) {
          for (const m of named(body)) {
            if (m.type !== "property_declaration") continue
            if (!hasModifier(m, "override")) continue
            const decl = named(m).find((c: any) => c.type === "variable_declaration")
            const id = decl ? field(decl, "name") ?? named(decl).find((c: any) => c.type === "simple_identifier") : null
            if (!id?.text) continue
            overriding.push({ owner: nm, name: id.text, sig: propertySignature(m) })
          }
        }
      }
      let next = owner
      if (n && TYPES.has(n.type)) { const nm = typeName(n); if (nm) next = nm }
      for (const c of named(n)) walk(c, next)
    }
    walk(root, null)
  }

  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  for (const o of overriding) {
    const start = parents.get(o.owner) ?? []
    let head = 0
    const seenTypes = new Set<string>([o.owner])
    let resolved = ""
    let guard = 0
    while (head < start.length && !resolved && guard++ < 4096) {
      const sup = start[head++]
      if (seenTypes.has(sup)) continue
      seenTypes.add(sup)
      const declared = members.get(sup)
      if (!declared) continue // not in this file: the walk ends here, by design
      const hit = declared.find((m) => m.name === o.name)
      if (!hit) continue
      // The NAME dimension is load-bearing, then the signature; a generic type
      // variable on either side falls back to name-only (the family's
      // substitution ruling — textual comparison is invalid across substitution).
      if (hit.sig === o.sig || sigHasTypeVar(hit.sig) || sigHasTypeVar(o.sig)) resolved = sup
      if (!resolved) for (const up of parents.get(sup) ?? []) if (!seenTypes.has(up)) start.push(up)
    }
    if (!resolved) continue // unknowable per-file: no truth row, no fabrication
    const key = `${o.owner}.${o.name}|${resolved}.${o.name}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ label: "overrides", from: `${o.owner}.${o.name}`, target: `${resolved}.${o.name}` })
  }
  return edges
}
