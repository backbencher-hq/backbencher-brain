/**
 * rust-truth — LANE-OWNED independent truth for the three rust labels that had NO oracle in
 * `differential.ts`, plus the second half the `contains` gate already had (the contains oracle lives at
 * `script/m14/oracles/rust-contains.ts` and only needs WIRING, not a rewrite).
 *
 * WHY THIS FILE EXISTS. The differential's rust block admits six labels (calls/uses/references/extends/
 * implements/instantiates). `contains` is in the compared-label allowlist but its oracle is never pushed,
 * and `imports`/`exports`/`overrides` are not in the allowlist at all — so 41,737 emitted rows are
 * measured by nothing. This module derives those three labels from the TREE ONLY (no analyzer import, no
 * database, no resolution): a match means two independent implementations agreed, not one confirming
 * itself.
 *
 * CONTRACT PROVENANCE (what each derivation mirrors, so a disagreement can be attributed):
 *   - imports: the analyzer's published `imports` contract as documented in `real-rust-analyzer.ts`
 *     (`rustImportRows`): target = the module PREFIX of the written path (`use a::b::C` -> `a::b`),
 *     bindings are the items; a path rooted at crate/self/super keeps the WHOLE written path as target
 *     (the root is an anchor, not a dependency); source = the enclosing inline module or function, else
 *     the family's declared file-scope spelling `(file)`; one row per distinct (source,target).
 *   - exports: the file-scope publication rule: a top-level `pub` item (struct/enum/trait/fn/mod/type/
 *     const/static/union) publishes its NAME; a file-scope `pub use` publishes the names it RE-BINDS
 *     (alias-aware); one row per name. Source = `(file)` (the same declared spelling the store rewrites).
 *   - overrides: `impl Trait for Type` supplying a DIRECT function member of the impl body. Source =
 *     `Type.method` (the family's owner-qualified spelling), target = the method leaf. The method must be
 *     a member of a trait DECLARED IN THIS FILE that declares it (an impl that adds a member is not an
 *     override; a trait declared here that does not declare it is refused). Foreign traits keep the
 *     cross-file row at the analyzer's declared 0.85 contract (see trait-override fixture); a type that is
 *     a GENERIC PARAMETER OF THE IMPL is refused (it is not a type). Nested/local items inside a method
 *     body are never members (direct children of the impl's declaration_list only).
 *
 * The lane's two override fixtures currently encode CONTRADICTORY foreign-trait contracts (adjudication
 * owed — recorded in RUST-CENSUS.md §6); this module follows the cross-file variant the analyzer
 * implements and the trait-override fixture expects.
 */
export type RustTruthEdge = { label: string; from: string; target: string
  /** ALIAS of `target`, deliberately carried: the differential wiring in `script/m14/differential.ts`
   *  publishes truth rows as `target: e.to` (the scala-truth convention). Without this alias every row
   *  from this module reached the comparator with an UNDEFINED target and was dropped by its
   *  `String(t.target ?? "").trim().length > 0` filter — so the three labels it was written for measured
   *  NOTHING and their analyzer rows were charged as unexplained. Both keys always carry the same value. */
  to: string }

const RUST_FILE_SOURCE = "(file)"
const PATH_KEYWORD_ROOTS = new Set(["crate", "self", "super"])

const text = (n: any): string => String(n?.text ?? "")
const leaf = (pathText: string): string => pathText.replace(/^::/, "").split("::").filter(Boolean).pop() ?? ""
const stripGenerics = (t: string): string => {
  const lt = t.indexOf("<")
  return (lt > 0 ? t.slice(0, lt) : t).trim()
}

/** The full path text of a path-shaped use-tree node (mirrors the grammar's shapes, independently). */
const pathOf = (n: any): string => {
  if (!n) return ""
  const t = String(n.type)
  if (t === "identifier" || t === "type_identifier" || t === "crate" || t === "super" || t === "self") return text(n)
  if (t === "scoped_identifier") {
    const p = n.childForFieldName?.("path")
    const name = n.childForFieldName?.("name") ?? n.namedChild(n.namedChildCount - 1)
    if (p) { const base = pathOf(p); return base === "" ? "" : `${base}::${text(name)}` }
    return `${text(n).startsWith("::") ? "::" : ""}${text(name)}`
  }
  return ""
}

const splitLeaf = (full: string): { module: string; item: string } => {
  const parts = full.split("::")
  if (parts.length < 2) return { module: full, item: full }
  const prefix = parts.slice(0, -1).join("::")
  const item = parts[parts.length - 1]
  if (PATH_KEYWORD_ROOTS.has(prefix)) return { module: full, item }
  return { module: prefix, item }
}

const ancestors = (n: any): any[] => {
  const out: any[] = []
  let cur = n?.parent ?? null
  while (cur) { out.push(cur); cur = cur.parent }
  return out
}
const enclosingMods = (n: any): string[] => {
  // outermost-first inline module names (mirrors the analyzer's `enclosingMods` walk semantics)
  const mods: string[] = []
  for (const a of ancestors(n).reverse()) if (a.type === "mod_item") { const nm = a.childForFieldName?.("name") ?? a.namedChild(0); if (nm) mods.push(text(nm)) }
  return mods
}
const enclosingFunction = (n: any): string => {
  for (const a of ancestors(n)) if (a.type === "function_item") { const nm = a.childForFieldName?.("name"); if (nm) return text(nm) }
  return ""
}

/** imports truth — one row per distinct (source, module) per file. */
export function deriveRustImportsTruth(root: any): RustTruthEdge[] {
  const out: RustTruthEdge[] = []
  const seen = new Set<string>()
  const push = (source: string, module: string) => {
    if (module === "") return
    const k = `${source}\u0000${module}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "imports", from: source, target: module, to: module })
  }
  const walk = (start: any) => {
    const stack = [start]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "use_declaration") {
        const mods = enclosingMods(n)
        const fn = mods.length === 0 ? enclosingFunction(n) : ""
        const source = mods.length > 0 ? mods[mods.length - 1] : fn !== "" ? fn : RUST_FILE_SOURCE
        const arg = (() => {
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && c.type !== "visibility_modifier") return c }
          return n.namedChild(0)
        })()
        // A group's leaves are BINDINGS; only a bare path contributes its own dependency. Nested
        // groups/paths inside a group add the dependency they name (`use std::{env, path::PathBuf}`
        // depends on `std` AND `std::path`), mirroring the analyzer's own nested_group rule.
        const collectLeaf = (leafNode: any, base: string): void => {
          if (!leafNode) return
          const lt = String(leafNode.type)
          if (lt === "scoped_identifier") {
            const full = pathOf(leafNode)
            if (full === "") return
            const { module } = splitLeaf(full)
            if (module !== "" && module !== base) push(source, base === "" ? module : `${base}::${module}`)
            return
          }
          if (lt === "scoped_use_list") {
            const nestedBase = pathOf(leafNode.childForFieldName?.("path") ?? leafNode.namedChild(0))
            const list = leafNode.childForFieldName?.("list") ?? leafNode.namedChild(leafNode.namedChildCount - 1)
            const full = base === "" ? nestedBase : nestedBase === "" ? base : `${base}::${nestedBase}`
            if (full !== "") push(source, full)
            if (list) for (let i = 0; i < list.namedChildCount; i++) collectLeaf(list.namedChild(i), full)
            return
          }
          // bare identifiers / self / aliases / wildcards inside a group are bindings, not dependencies
        }
        const collect = (node: any): void => {
          if (!node) return
          const t = String(node.type)
          if (t === "scoped_use_list") {
            const base = pathOf(node.childForFieldName?.("path") ?? node.namedChild(0))
            const list = node.childForFieldName?.("list") ?? node.namedChild(node.namedChildCount - 1)
            if (base !== "") push(source, base)
            if (list) for (let i = 0; i < list.namedChildCount; i++) collectLeaf(list.namedChild(i), base)
            return
          }
          if (t === "use_list") { for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c && c.type !== "use_as_clause") collectLeaf(c, "") } return }
          if (t === "use_as_clause") {
            const p = pathOf(node.childForFieldName?.("path") ?? node.namedChild(0))
            const { module } = splitLeaf(p)
            push(source, module)
            return
          }
          if (t === "use_wildcard") {
            // WILDCARD CONVENTION (analyzer contract, module-surface fixture): the dependency is the
            // written path MINUS `::*` — `use ignore::WalkState::*` names the enum's module path
            // `ignore::WalkState`, not the truncated module prefix `ignore` (the D4 residual's one
            // imports row was exactly this spelling difference).
            const p = pathOf(node.namedChild(0))
            push(source, p)
            return
          }
          if (t === "identifier" || t === "type_identifier" || t === "crate" || t === "super" || t === "self" || t === "scoped_identifier") {
            const full = pathOf(node)
            const { module } = splitLeaf(full)
            push(source, module)
          }
        }
        collect(arg)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  walk(root)
  return out
}

const isPublicItem = (n: any): boolean => {
  // EXTENRAL publication requires `pub` and NOTHING ELSE: `pub(crate) use ...` and `pub(super) use ...`
  // are visible inside the crate only, so they publish nothing outside it (the module-surface fixture's
  // D3 rule). The previous "any visibility_modifier" test over-derived 126 restricted names on ripgrep.
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || c.type !== "visibility_modifier") continue
    const txt = text(c).trim()
    return txt === "pub"
  }
  return false
}

/** exports truth — file-scope published NAMES (pub items + pub-use re-binds), deduped by name. */
export function deriveRustExportsTruth(root: any): RustTruthEdge[] {
  const names = new Set<string>()
  const decl = root?.type === "source_file" ? root : root
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i)
    if (!c) continue
    const t = String(c.type)
    if (["struct_item", "enum_item", "trait_item", "function_item", "mod_item", "type_item", "const_item", "static_item", "union_item"].includes(t) && isPublicItem(c)) {
      const nm = c.childForFieldName?.("name") ?? c.namedChild(0)
      if (nm) names.add(text(nm))
    }
    if (t === "use_declaration" && isPublicItem(c)) {
      // the re-bound names of a file-scope pub use, ALIAS-AWARE and BINDINGS-ONLY: a path's own
      // segments are not published names (`pub use self::decompress::X` publishes X, never "self" or
      // "decompress"); a wildcard binds no name.
      // The names a `pub use` RE-BINDS, base-path aware: a nested group's leaves bind their own names
      // (`crate::cli::{self, flags::{IgnoreMatcher}}` binds `cli`, `IgnoreMatcher`); `self` binds the
      // last segment of the group's base (`use a::b::{self}` binds `b`); aliases bind the alias; a
      // wildcard binds no name. Path segments are never bindings.
      const boundNames = (node: any, base: string): string[] => {
        if (!node) return []
        const nt = String(node.type)
        if (nt === "use_as_clause") {
          const al = node.childForFieldName?.("alias") ?? node.namedChild(node.namedChildCount - 1)
          return al ? [text(al)] : []
        }
        if (nt === "use_wildcard") return []
        if (nt === "identifier" || nt === "type_identifier") return [text(node)]
        if (nt === "self") {
          const parts = base.split("::").filter(Boolean)
          const last = parts.length > 1 ? parts[parts.length - 1] : ""
          return last && !["crate", "self", "super"].includes(last) ? [last] : []
        }
        if (nt === "scoped_identifier") {
          const nm = node.childForFieldName?.("name") ?? node.namedChild(node.namedChildCount - 1)
          return nm && nm.type !== "scoped_identifier" ? [text(nm)] : []
        }
        if (nt === "use_list") {
          const out: string[] = []
          for (let j = 0; j < node.namedChildCount; j++) out.push(...boundNames(node.namedChild(j), base))
          return out
        }
        if (nt === "scoped_use_list") {
          const inner = pathOf(node.childForFieldName?.("path") ?? node.namedChild(0))
          const nextBase = inner === "" ? base : (base === "" ? inner : (["crate", "self", "super"].includes(base) ? `${base}::${inner}` : `${base}::${inner}`))
          const list = node.childForFieldName?.("list") ?? node.namedChild(node.namedChildCount - 1)
          const out: string[] = []
          for (let j = 0; j < (list?.namedChildCount ?? 0); j++) out.push(...boundNames(list.namedChild(j), nextBase))
          return out
        }
        return []
      }
      const useTree = (() => {
        for (let i = 0; i < c.namedChildCount; i++) { const ch = c.namedChild(i); if (ch && ch.type !== "visibility_modifier") return ch }
        return c.namedChild(0)
      })()
      for (const nm of boundNames(useTree, "")) if (nm) names.add(nm)
    }
  }
  const edges = [...names].sort().map((name) => ({ label: "exports", from: RUST_FILE_SOURCE, target: name, to: name }))
  // ROUTE ATTRIBUTES: `#[get("/users")]` on a function publishes an exports row (source = the function,
  // target = the route path) — the analyzer's actix contract, mirrored from the attribute syntax alone.
  const ROUTE_VERBS = ["get", "post", "put", "delete", "patch", "head", "options", "trace", "route"]
  const stack2 = [decl]
  while (stack2.length > 0) {
    const n = stack2.pop()!
    if (n.type === "attribute_item" || n.type === "inner_attribute_item") {
      const t = String(n.text ?? "")
      const body = t.startsWith("#![") ? t.slice(3) : t.startsWith("#[") ? t.slice(2) : ""
      let verb = ""
      for (const v of ROUTE_VERBS) { if (body.startsWith(v) && (body[v.length] === "(" || body[v.length] === " " || body[v.length] === "\t")) { verb = v; break } }
      if (verb !== "") {
        let target = n.nextNamedSibling
        if (!target || target.type !== "function_item") {
          // attribute list: walk siblings after this attribute
          let cur = n.nextNamedSibling
          while (cur && cur.type === "attribute_item") cur = cur.nextNamedSibling
          target = cur
        }
        if (target && target.type === "function_item") {
          const fnName = target.childForFieldName?.("name")
          const q1 = t.indexOf('"'), q2 = q1 >= 0 ? t.indexOf('"', q1 + 1) : -1
          if (fnName && q1 >= 0 && q2 > q1 + 1) { const routeTarget = t.slice(q1 + 1, q2); edges.push({ label: "exports", from: text(fnName), target: routeTarget, to: routeTarget }) }
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack2.push(c) }
  }
  return edges
}

const nominalTypeNode = (t: any): any => {
  let cur = t
  let guard = 0
  while (cur && guard++ < 12) {
    const ty = String(cur.type)
    if (ty === "reference_type" || ty === "pointer_type" || ty === "parenthesized_type" || ty === "array_type" || ty === "tuple_type") { cur = cur.namedChild(cur.namedChildCount - 1); continue }
    if (ty === "generic_type") { cur = cur.childForFieldName?.("type") ?? cur.namedChild(0); continue }
    if (ty === "scoped_type_identifier" || ty === "type_identifier") return cur
    return cur
  }
  return cur
}

/** overrides truth — direct members of `impl Trait for Type` blocks; the contract is in the header. */
export function deriveRustOverridesTruth(root: any): RustTruthEdge[] {
  // local traits and their declared method names
  const localTraitMethods = new Map<string, Set<string>>()
  {
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "trait_item") {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        const set = new Set<string>()
        for (let i = 0; i < n.namedChildCount; i++) {
          const d = n.namedChild(i)
          if (!d || d.type !== "declaration_list") continue
          for (let j = 0; j < d.namedChildCount; j++) {
            const f = d.namedChild(j)
            if (f && (f.type === "function_item" || f.type === "function_signature_item")) {
              const mn = f.childForFieldName?.("name"); if (mn) set.add(text(mn))
            }
          }
        }
        if (nm) localTraitMethods.set(text(nm), set)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  const out: RustTruthEdge[] = []
  const seen = new Set<string>()
  {
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "impl_item") {
        const traitNode = n.childForFieldName?.("trait")
        const typeNode = n.childForFieldName?.("type")
        if (traitNode && typeNode) {
          const tn = nominalTypeNode(typeNode)
          const typeName = tn ? stripGenerics(text(tn)).split("::").filter(Boolean).pop() ?? "" : ""
          const traitName = stripGenerics(text(traitNode)).split("::").filter(Boolean).pop() ?? ""
          // a generic PARAMETER of the impl is not a type (refuse the source endpoint):
          // collect the impl's OWN `type_parameters` bindings and compare by name.
          let genericParam = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const tp = n.namedChild(i)
            if (!tp || tp.type !== "type_parameters") continue
            const stack2 = [tp]
            while (stack2.length > 0) {
              const g = stack2.pop()!
              if (g.type === "type_parameter") {
                const id = g.namedChild(0)
                if (id && (id.type === "type_identifier" || id.type === "identifier") && text(id) === typeName) genericParam = true
              }
              for (let j = 0; j < g.namedChildCount; j++) { const c = g.namedChild(j); if (c) stack2.push(c) }
            }
          }
          for (let i = 0; i < n.namedChildCount; i++) {
            const d = n.namedChild(i)
            if (!d || d.type !== "declaration_list") continue
            for (let j = 0; j < d.namedChildCount; j++) {
              const f = d.namedChild(j)
              if (!f || f.type !== "function_item") continue
              const mn = f.childForFieldName?.("name")
              if (!mn) continue
              const method = text(mn)
              const declared = localTraitMethods.get(traitName)
              // a trait declared here that does not declare the member: the impl ADDS it — not an override
              if (declared && !declared.has(method)) continue
              // a generic-parameter type cannot own an implementation row
              if (genericParam) continue
              const from = `${typeName}.${method}`
              const k = `${from}\u0000${method}`
              if (seen.has(k)) continue
              seen.add(k)
              out.push({ label: "overrides", from, target: method, to: method })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  return out
}
