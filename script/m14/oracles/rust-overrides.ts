/**
 * The Rust `overrides` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason its sibling
 * `rust-contains.ts` records: that shared file is edited by several lanes at
 * once, and every line a lane keeps out of a shared file is a line that cannot
 * conflict. It is written from Rust's own item structure and shares no rule
 * table, key set, member list or resolver with `RealRustAnalyzer`, which is the
 * only property that makes a MATCH mean something.
 *
 * ## Why this oracle exists
 *
 * `overrides` is in the differential's compared-label list for every lane except
 * csharp/dart/swift/cpp/go, so for rust the label was COMPARED while the oracle
 * derived none of it. That is the "compared against nothing" class the ontology
 * workstream names: nothing agrees with nothing, the harness prints
 * `COMPARED WITH NO TRUTH: overrides (35 comparable, 0 truth)`, and every true
 * row is counted as a confident fabrication. Measured on the pinned ripgrep
 * corpus before this oracle existed: 35 rows on the 60-file draw, 48 rows over
 * all 110 files.
 *
 * ## The rule, in Rust's own terms
 *
 * Rust has no `override` keyword and no base class. The one sense in which the
 * language overrides a member is structural: a method inside `impl Trait for
 * Type` IS the implementation of that trait's method of the same name, and it
 * replaces the trait's default body for that type. So an override edge is
 *
 *     Type.method  overrides  Trait.method
 *
 * for every method name the impl declares that the trait also declares.
 *
 * The family spells this edge `Owner.name -> Base.name` (scala, kotlin, java,
 * typescript), so this oracle uses the same spelling; the harness matches on
 * `label + normTarget(target)`, which reduces both spellings to the method name.
 *
 * ## The three decisions worth stating
 *
 * 1. **The trait must be declared IN THIS FILE.** A `trait` in a dependency is
 *    not in a per-file analyzer's world (cross-file resolution is the lane's
 *    declared M12.44 boundary), so an impl of a foreign trait produces no row
 *    here. On the pinned ripgrep corpus that costs 839 of 887 sites — a
 *    statement about the corpus and the analyzer's scope, not about the
 *    language, and counted rather than assumed.
 * 2. **A path-prefixed trait reference is not claimed.** `impl log::Log for L`
 *    can name a crate or a local module and a per-file analyzer cannot tell
 *    them apart, so only a bare name and the three path roots that cannot be a
 *    crate (`crate::`, `self::`, `super::`) are read as local. Guessing here
 *    would be inventing an edge the file does not support.
 * 3. **A cfg-gated duplicate is not an override.** ripgrep declares
 *    `DirEntryRaw::from_path` under `#[cfg(unix)]` and again under
 *    `#[cfg(windows)]`; those are alternative compilations that never coexist,
 *    and a name-counting probe reports 10 such sites on the corpus. They are
 *    deliberately NOT edges: the member that wins depends on the target
 *    platform, so the edge would be true for one build and false for the other.
 */

export type RustOverridesEdge = { label: "overrides"; from: string; target: string }

export function deriveRustOverridesTruth(root: any): RustOverridesEdge[] {
  const out: RustOverridesEdge[] = []
  const seen = new Set<string>()
  const named = (n: any): any[] => (n?.namedChildren ?? [])
  const firstOfType = (n: any, t: string): any => named(n).find((c: any) => c?.type === t) ?? null

  const add = (from: string, target: string): void => {
    const f = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!f || !t) return
    const k = `${f}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "overrides", from: f, target: t })
  }

  /**
   * The trait a reference NAMES, or null when the reference cannot be resolved
   * to a trait of this file.
   *
   * Three spellings occur at an impl head: a bare name (`impl Log for L`), a
   * generic application (`impl Visitor<'de> for V` — measured on the pinned
   * wasm as a `generic_type` whose FIRST named child is the base type and whose
   * second is `type_arguments`, with no `type`/`name` field on the node), and a
   * path (`impl crate::traits::Log for L`, a `scoped_type_identifier` whose
   * `path` is the prefix and whose `name` is the trait).
   */
  const localTraitName = (n: any, depth = 0): string | null => {
    if (!n || depth > 6) return null
    if (n.type === "generic_type") {
      const base = firstOfType(n, "type_identifier") ?? firstOfType(n, "scoped_type_identifier")
      return base ? localTraitName(base, depth + 1) : null
    }
    if (n.type === "type_identifier") return n.text ?? null
    if (n.type === "scoped_type_identifier") {
      const path = n.childForFieldName?.("path") ?? firstOfType(n, "scoped_identifier")
      const root = String(path?.text ?? "").split("::")[0]
      if (root !== "crate" && root !== "self" && root !== "super") return null
      const leaf = n.childForFieldName?.("name") ?? named(n).find((c: any) => c?.type === "type_identifier")
      return leaf?.text ?? null
    }
    return null
  }

  /**
   * The name of the type an impl implements. A reference is not a different
   * type: `impl ParallelVisitorBuilder for &'a mut P` is an impl of that trait
   * for the type `P`, and the family's edge names the type, so the reference and
   * pointer wrappers are stepped through and the innermost nominal name is the
   * answer. Measured: reading the text whole published `&'a mut P.method`, a
   * spelling no symbol has.
   */
  const implTypeName = (n: any, depth = 0): string | null => {
    if (!n || depth > 8) return null
    if (n.type === "reference_type" || n.type === "pointer_type" || n.type === "parenthesized_type") {
      const inner = n.childForFieldName?.("type") ?? named(n).find((c: any) => c?.type !== "lifetime")
      return inner ? implTypeName(inner, depth + 1) : null
    }
    if (n.type === "generic_type") {
      const base = firstOfType(n, "type_identifier") ?? firstOfType(n, "scoped_type_identifier")
      return base ? implTypeName(base, depth + 1) : null
    }
    // A primitive IS the type it names here: `impl IntoUsize for u64` is an impl
    // of a trait for the `u64` TYPE, and ruby's yjit has eight of them
    // (`as_usize`/`to_usize` over u8/u16/u32/u64/usize). Excluding them made the
    // analyzer's edges oracle-less on the full corpus — 4 residual rows — and the
    // edge is honest: the family names the implementing type, and `u64` is one.
    if (n.type === "type_identifier" || n.type === "primitive_type") return n.text ?? null
    if (n.type === "scoped_type_identifier") {
      const parts = String(n.text ?? "").split("::").map((x) => x.trim()).filter(Boolean)
      return parts[parts.length - 1] ?? null
    }
    return null
  }

  /** Member names declared by a trait body, in the file. */
  const traitMembers = new Map<string, Set<string>>()
  const collectTraits = (n: any): void => {
    if (n.type === "trait_item") {
      const nm = n.childForFieldName?.("name")?.text
      const body = named(n).find((c: any) => c?.type === "declaration_list")
      if (nm && body) {
        const set = traitMembers.get(nm) ?? new Set<string>()
        for (const c of named(body)) {
          if (c?.type !== "function_item" && c?.type !== "function_signature_item") continue
          const fn = c.childForFieldName?.("name")?.text
          if (fn) set.add(fn)
        }
        traitMembers.set(nm, set)
      }
    }
    for (const c of named(n)) collectTraits(c)
  }
  collectTraits(root)

  const walkImpls = (n: any): void => {
    if (n.type === "impl_item") {
      const traitRef = n.childForFieldName?.("trait")
      const typeRef = n.childForFieldName?.("type")
      if (traitRef && typeRef) {
        const traitName = localTraitName(traitRef)
        const declared = traitName ? traitMembers.get(traitName) : undefined
        const typeName = implTypeName(typeRef)
        if (traitName && declared && declared.size > 0 && typeName) {
          const body = named(n).find((c: any) => c?.type === "declaration_list")
          for (const c of named(body)) {
            if (c?.type !== "function_item") continue
            const fn = c.childForFieldName?.("name")?.text
            if (fn && declared.has(fn)) add(`${typeName}.${fn}`, `${traitName}.${fn}`)
          }
        }
      }
    }
    for (const c of named(n)) walkImpls(c)
  }
  walkImpls(root)
  return out
}