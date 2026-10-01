/**
 * The Rust `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason the JSON oracle's
 * header records: that shared file is edited by several lanes at once, and every
 * line a lane keeps out of a shared file is a line that cannot conflict.
 *
 * The oracle is written from Rust's own item structure and shares no rule table, key
 * set, member list or resolver with `RealRustAnalyzer`. That is the only property
 * that makes a MATCH mean something: an oracle derived from the analyzer cannot
 * disagree with it.
 *
 * ## Why this oracle exists
 *
 * `contains` had truth for a handful of languages — java, kotlin, scala, csharp,
 * typescript, and since the M60 round also dart and erlang — while rust published
 * `contains` that the differential's allowlist dropped, so none of it was compared
 * and the lane's percentage did not know.
 *
 * ## The rule
 *
 * A Rust item CONTAINS the items declared inside it. Both ends are names written in
 * the file, so no name resolution is involved — this is a "what did the programmer
 * declare here" question.
 *
 * From tree-sitter-rust's own node types:
 *
 *   mod_item    -> identifier       + declaration_list
 *   struct_item -> type_identifier  + field_declaration_list
 *   enum_item   -> type_identifier  + enum_variant_list
 *   trait_item  -> type_identifier  + declaration_list
 *   impl_item   -> type_identifier  + declaration_list
 *
 * ## The two decisions worth stating
 *
 * 1. **An `impl` block is contained by the TYPE it implements, not by a block
 *    symbol.** `impl S { fn new() }` makes `new` a member of `S`. There is no
 *    `impl` entity in Rust to own it, and inventing one would put a node in the
 *    graph that the language does not have. This also composes correctly with the
 *    inherent impls and the trait impls of the same type.
 * 2. **A `use` declaration is not a member.** It brings a name INTO scope; it does
 *    not declare one here. `use_declaration` is therefore never read as a member,
 *    and the lane's `imports` label covers it separately.
 *
 * A trait's members arrive as `function_signature_item` (a bodiless signature) and
 * are read the same way as a function — a declaration is a declaration whether or
 * not it has a body, which is the whole point of `contains`.
 */

export type RustContainsEdge = { label: "contains"; from: string; target: string }

/** Items that declare a member inside a `declaration_list`. */
const MEMBER_ITEM = new Set([
  "function_item",
  "function_signature_item",
  "const_item",
  "static_item",
  "type_item",
  "type_alias",
  "mod_item",
  "struct_item",
  "enum_item",
  "union_item",
  "trait_item",
  "macro_definition",
])

/** Items whose NAME is a `type_identifier` rather than an `identifier`. */
const TYPE_NAMED_ITEM = new Set([
  "struct_item",
  "enum_item",
  "union_item",
  "trait_item",
  "type_item",
  "type_alias",
])

/** Items that own a `declaration_list` or a variant/field list. */
const CONTAINER_ITEM = new Set([
  "mod_item",
  "struct_item",
  "enum_item",
  "union_item",
  "trait_item",
  "impl_item",
])

export function deriveRustContainsTruth(root: any): RustContainsEdge[] {
  const out: RustContainsEdge[] = []
  const seen = new Set<string>()
  const named = (n: any): any[] => (n?.namedChildren ?? [])
  const firstOfType = (n: any, t: string): any => named(n).find((c: any) => c?.type === t) ?? null

  const add = (from: string, target: string): void => {
    const o = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!o || !t || o === t) return
    const k = `${o}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from: o, target: t })
  }

  /**
   * A TYPE item is named by a `type_identifier`; a VALUE item (fn, const, static) is
   * named by an `identifier`. These must not share one lookup that prefers
   * `type_identifier`, because a function's RETURN TYPE is also a `type_identifier`
   * and comes later in the node: `fn new() -> Self` was being named `Self`. The
   * minimal repro is two lines — `struct S; impl S { fn from_x(a: i32) -> i32 { a }
   * pub fn new() -> Self { S } }` — where `from_x` (no return type) came out right
   * and `new` came out as `Self`, i.e. the oracle was publishing a type where the
   * language declares a function.
   */
  /**
   * A type's name, tolerant of the three ways a type is spelled at a use site.
   *
   * A GENERIC impl is the case that matters: `impl<W: Write> CounterWriter<W> { ... }`
   * puts the self type in a `generic_type` node, not a bare `type_identifier`, so the
   * first draft read an empty owner and DROPPED every method in the block — 159
   * analyzer rows on a 40-file ripgrep draw, all of them real methods
   * (`new`, `reset_count`, `get_mut`, `into_inner`). Same failure shape as erlang's
   * module-less header: an empty owner silently removes the whole subtree rather than
   * producing an unmatched row. A `scoped_type_identifier` is the third spelling
   * (`std::fmt::Display`), where the base type is the last segment.
   */
  const typeItemName = (n: any): string => {
    const bare = firstOfType(n, "type_identifier")
    if (bare?.text) return bare.text
    const generic = firstOfType(n, "generic_type")
    if (generic) {
      const inner = firstOfType(generic, "type_identifier")
      if (inner?.text) return inner.text
    }
    const scoped = firstOfType(n, "scoped_type_identifier")
    if (scoped) {
      const parts = String(scoped.text).split("::").map((x) => x.trim()).filter(Boolean)
      const last = parts[parts.length - 1]
      if (last) return last
    }
    const ident = firstOfType(n, "identifier")
    return ident?.text ?? ""
  }
  const valueItemName = (n: any): string => {
    const t = firstOfType(n, "identifier") ?? firstOfType(n, "field_identifier")
    return t?.text ?? ""
  }
  const itemName = (n: any): string => (TYPE_NAMED_ITEM.has(n.type) ? typeItemName(n) : valueItemName(n))

  /** the members declared directly inside a container's body list */
  const membersOf = (list: any, owner: string, kind: "decl" | "field" | "variant"): void => {
    if (!list || !owner) return
    for (const c of named(list)) {
      if (kind === "field") {
        if (c.type !== "field_declaration") continue
        const id = firstOfType(c, "field_identifier") ?? firstOfType(c, "identifier")
        if (id?.text) add(owner, id.text)
        continue
      }
      if (kind === "variant") {
        if (c.type !== "enum_variant") continue
        const id = firstOfType(c, "identifier")
        if (id?.text) add(owner, id.text)
        continue
      }
      if (!MEMBER_ITEM.has(c.type)) continue
      const nm = itemName(c)
      if (nm) add(owner, nm)
    }
  }

  /**
   * A FUNCTION can own things too. Rust allows `impl` blocks and nested `fn`s inside
   * a function body, and the analyzer's owner is `ownerName || scope`, so a
   * declaration inside a function is contained BY that function:
   * `with_separator -> replace_separator`. Reading only module/type containers left
   * those rows with no truth — 6 on a 40-file ripgrep draw, which is small enough to
   * look like noise and is not: each one is a real nested declaration.
   */
  const FUNCTION_CONTAINER = new Set(["function_item", "function_signature_item"])
  /** What a function body can OWN: nested types and nested functions, not values. */
  const NESTED_TYPE_OR_FN = new Set([
    "function_item",
    "function_signature_item",
    "mod_item",
    "struct_item",
    "enum_item",
    "union_item",
    "trait_item",
    "impl_item",
  ])

  const walk = (n: any): void => {
    if (FUNCTION_CONTAINER.has(n.type)) {
      const owner = valueItemName(n)
      const block = firstOfType(n, "block")
      if (owner && block) {
        for (const c of named(block)) {
          // A nested function owns nested TYPES and FUNCTIONS, not nested values.
          // `static MANIFEST: &str` inside a `fn` is a local constant, and the
          // analyzer does not publish it as contained; including it added 3
          // truth-only rows on a 40-file ripgrep draw (`MANIFEST`, `BINARY`,
          // `ALPHABET`) — a fabrication on the truth side, which is the direction
          // that quietly inflates coverage.
          if (!NESTED_TYPE_OR_FN.has(c.type)) continue
          const nm = itemName(c)
          if (nm) add(owner, nm)
        }
      }
    }
    if (CONTAINER_ITEM.has(n.type)) {
      const owner = n.type === "mod_item" ? valueItemName(n) : typeItemName(n)
      if (owner) {
        const decl = firstOfType(n, "declaration_list")
        const fields = firstOfType(n, "field_declaration_list")
        const variants = firstOfType(n, "enum_variant_list")
        if (decl) membersOf(decl, owner, "decl")
        if (fields) membersOf(fields, owner, "field")
        if (variants) membersOf(variants, owner, "variant")
      }
    }
    for (const c of named(n)) walk(c)
  }

  walk(root)
  return out
}