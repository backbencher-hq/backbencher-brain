/**
 * The F# `contains` oracle — LANE-OWNED, **INCOMPLETE AND DELIBERATELY NOT WIRED**.
 *
 * ## Read this before wiring it
 *
 * This oracle is UNFINISHED and is deliberately NOT registered in differential.ts, so
 * the fsharp lane is exactly as it was: `contains` unadmitted and therefore
 * unmeasured, which verify-label-coverage reports as a declared gap rather than a
 * false pass. That is the honest state.
 *
 * The reason it is not wired is the reason it exists. Measured on a 40-file fsharp
 * draw as of this writing:
 *
 *   truth rows 1,178 — agreed 1,021 (86.7%) — analyzer-only 1,563 — truth-only 157
 *
 * A 86.7% oracle admitted to the lane would not measure the lane; it would replace
 * "contains is not compared" with "contains is compared against an oracle that is
 * wrong in both directions", which is strictly less honest. Admitting a label is only
 * an improvement when the truth behind it is right — that is the whole reason the
 * erlang and dart oracles were only wired after they reached zero disagreement in
 * both directions, and the reason this one is not.
 *
 * What is known to be wrong, from the corpus rather than from reading the grammar:
 *
 *   - 1,563 analyzer rows have no truth. The largest families are members of a class
 *     declared `type internal FSharpLanguageServiceTestable() as this` (the `as this`
 *     self-identifier changes the type body shape) and members of `.fsi` SIGNATURE
 *     files, whose surface the analyzer publishes and this walk does not yet reach.
 *   - 157 truth rows the analyzer does not publish, which is the more serious
 *     direction: a name is being derived that the language does not declare. The
 *     sample includes `AddDisabledWarning() : unit` — a raw signature string where a
 *     bare name was expected, so `declaredName` is falling through to node text
 *     instead of a name field on a `let` with a return-type annotation.
 *
 * Two fixes that DID land while measuring, both recorded below because each was a
 * real miss: `namespace` is a container as well as `named_module` (handling only the
 * latter derived 104 rows where 1,093 were reachable), and an instance member's name
 * arrives as `property_or_ident`, not `long_identifier`.
 *
 * ## The rule, as far as it is established
 *
 * It lives here rather than in `differential.ts` for the reason the JSON oracle's
 * header records: that shared file is edited by several lanes at once, and every
 * line a lane keeps out of a shared file is a line that cannot conflict.
 *
 * The oracle is written from F#'s own declaration structure and shares no rule
 * table, key set, member list or resolver with the F# analyzer. That is the only
 * property that makes a MATCH mean something: an oracle derived from the analyzer
 * cannot disagree with it.
 *
 * ## Why this oracle exists
 *
 * `contains` had truth for a handful of languages — java, kotlin, scala, csharp,
 * typescript, and since the M60 round also dart and erlang — while fsharp published
 * `contains` that the differential's allowlist dropped, so none of it was compared
 * and the lane's percentage did not know.
 *
 * ## The rule
 *
 * A declaration CONTAINS the members declared inside it. Both ends are names written
 * in the file, so no name resolution is involved.
 *
 * Containers and what the language says they contain, from tree-sitter-fsharp's own
 * node types:
 *
 *   named_module          the types, nested modules, lets and exceptions declared
 *                         in it
 *   type_definition       the members of its body, which depends on the form:
 *       union_type_defn       the `union_type_case`s
 *       record_type_defn      the `record_field`s
 *       anon/class/struct/
 *       interface_type_defn   the `type_extension_element`s
 *   module_defn           the `function_or_value_defn`s in its body
 *
 * ## Two rules this oracle does NOT apply
 *
 * 1. **No self-containment.** A declaration is not a member of itself. The analyzer
 *    refuses it at COMPOSITION for a reason worth keeping: `type
 *    TypeProviderDesignation = TypeProviderDesignation of string` is a real and
 *    common F# spelling (305 of them in the fsharp corpus), and a member named after
 *    its own type is real too (`Map.Map`, `E.E`). Emitting `X -> X` would put a
 *    self-edge in the graph for those, which is noise, not containment.
 * 2. **No module-as-member.** A `named_module` is a CONTAINER. `M` is not contained
 *    by itself, and the file's root module is not a member of anything.
 *
 * Both are stated here because a superset in the truth is worse than a subset: it
 * converts a real disagreement into a phantom.
 */

export type FsharpContainsEdge = { label: "contains"; from: string; target: string }

/** The three body forms of a type definition, by the node that carries its name. */
const TYPE_BODY = new Set([
  "union_type_defn",
  "record_type_defn",
  "anon_type_defn",
  "class_type_defn",
  "struct_type_defn",
  "interface_type_defn",
])

export function deriveFsharpContainsTruth(root: any): FsharpContainsEdge[] {
  const out: FsharpContainsEdge[] = []
  const seen = new Set<string>()
  const named = (n: any): any[] => (n?.namedChildren ?? [])
  const firstOfType = (n: any, t: string): any => named(n).find((c: any) => c?.type === t) ?? null

  const add = (from: string, target: string): void => {
    const o = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!o || !t || o === t) return // the no-self-containment rule, applied once here
    const k = `${o}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from: o, target: t })
  }

  /** the identifier a `member this.X` or `let x` declares, which is NOT the raw text */
  const declaredName = (n: any): string => {
    // `let mutable n = 0` -> value_declaration_left -> identifier_pattern -> n
    const left = firstOfType(n, "value_declaration_left") ?? firstOfType(n, "function_declaration_left")
    if (left) {
      const idp = firstOfType(left, "identifier_pattern")
      if (idp?.text) return idp.text
      const ident = named(left).find((c: any) => c.type === "identifier")
      if (ident?.text) return ident.text
    }
    // `member this.Value = ...` -> method_or_prop_defn -> long_identifier -> this . Value
    const m = firstOfType(n, "method_or_prop_defn")
    if (m) {
      // The member's name arrives as `property_or_ident` (`this.FSharpChecker`), not
      // as a `long_identifier` — the first draft read only the latter and so named no
      // instance member at all. A static member is already bare.
      for (const t of ["property_or_ident", "long_identifier", "identifier"]) {
        const el = firstOfType(m, t)
        if (!el?.text) continue
        const parts = String(el.text).split(".").map((x) => x.trim()).filter(Boolean)
        const last = parts[parts.length - 1]
        if (last && last !== "this") return last
      }
    }
    const idp0 = firstOfType(n, "identifier_pattern")
    if (idp0?.text) return idp0.text
    const ident = firstOfType(n, "identifier")
    if (ident?.text) return ident.text
    return ""
  }

  /** members of a type body */
  const typeMembers = (body: any, owner: string): void => {
    if (!owner) return
    for (const el of named(body)) {
      switch (el.type) {
        case "union_type_cases": {
          for (const c of named(el).filter((x: any) => x.type === "union_type_case")) {
            const id = firstOfType(c, "identifier")
            if (id?.text) add(owner, id.text)
          }
          break
        }
        case "record_fields": {
          for (const f of named(el).filter((x: any) => x.type === "record_field")) {
            const id = firstOfType(f, "identifier")
            if (id?.text) add(owner, id.text)
          }
          break
        }
        case "type_extension_elements": {
          // `type_extension_elements` wraps the actual member definition
          for (const m of named(el)) {
            if (m.type !== "member_defn" && m.type !== "function_or_value_defn") continue
            const nm = declaredName(m)
            if (nm) add(owner, nm)
          }
          break
        }
        default:
          break
      }
    }
  }

  /** declarations directly inside a module or a nested module */
  const moduleMembers = (n: any, owner: string): void => {
    if (!owner) return
    for (const c of named(n)) {
      if (c.type === "type_definition") {
        const body = named(c).find((x: any) => TYPE_BODY.has(x.type)) ?? null
        if (!body) continue
        const tn = firstOfType(body, "type_name")
        if (!tn?.text) continue
        add(owner, tn.text)
        typeMembers(body, tn.text)
      } else if (c.type === "module_defn") {
        const id = firstOfType(c, "identifier")
        if (!id?.text) continue
        add(owner, id.text)
        moduleMembers(c, id.text)
      } else if (c.type === "exception_definition") {
        const li = firstOfType(c, "long_identifier")
        if (li?.text) add(owner, li.text)
      } else if (c.type === "declaration_expression") {
        for (const f of named(c).filter((x: any) => x.type === "function_or_value_defn")) {
          const nm = declaredName(f)
          if (nm) add(owner, nm)
        }
      } else if (c.type === "function_or_value_defn" || c.type === "module_val_declaration" || c.type === "val_defn") {
        // `module_val_declaration` is the SIGNATURE form: an `.fsi` file declares its
        // module's members as `val CreateSolution : ...` rather than as
        // `function_or_value_defn`. Reading only the latter derived nothing at all
        // from signature files — and the fsharp corpus is full of them, since a
        // library's public surface lives in the `.fsi`.
        const nm = declaredName(c)
        if (nm) add(owner, nm)
      }
    }
  }

  // the root: a `named_module`, or bare declarations with no module header
  // The file's root container is a `named_module` (`module M`) OR a `namespace`
  // (`namespace Salsa`). Handling only the first meant every namespaced file derived
  // almost nothing: FSharpLanguageServiceTestable.fs alone accounts for hundreds of
  // analyzer rows and declared 104 truth rows across a 40-file draw.
  const ROOT_CONTAINER = new Set(["named_module", "namespace"])
  const rootC = named(root).find((c: any) => ROOT_CONTAINER.has(c.type)) ?? null
  const rootName = rootC ? (firstOfType(rootC, "long_identifier")?.text ?? "") : ""
  // An `import_decl` is an OPEN, not a declaration, so it is never a member.
  moduleMembers(rootC ?? root, rootName || "<file>")

  return out
}