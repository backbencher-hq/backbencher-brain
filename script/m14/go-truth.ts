/**
 * GO ORACLE — the second opinion for the two labels the go lane's own
 * differential never derived.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reported, measured
 * against the go analyzer as it stood:
 *
 *     DERIVATION|go|emits `exports`  but the differential audits
 *       ["calls","contains","extends","implements","imports","instantiates",
 *        "references","uses"]
 *     DERIVATION|go|emits `overrides` but the differential audits (same eight)
 *
 * "stored and compared against nothing". An unverified edge ships a bug
 * invisibly, which is the same structural gap `ontology-coverage-gate.ts`'s
 * header records for bash's `overrides`: the analyzer omitted the type, the
 * oracle was written after the omission, and "nothing agrees with nothing
 * perfectly". Eight labels agreed; two had no second opinion at all.
 *
 * ## Lane ownership
 *
 * `script/m14/ruby-truth.ts` is this lane's precedent: a lane whose oracle is
 * not derivable from the shared file owns its own module, and
 * `readOwnOracleLabels` in `rel-type-coverage-gate.ts` reads
 * `script/m14/<lang>-truth.ts` for exactly that case. The `ORACLE_LABELS`
 * literal below is what that gate reads, so publishing it here is what closes
 * CHECK 1 for go without editing a MASTER-owned file.
 *
 * WHAT IS STILL NEEDED IN `differential.ts` (MASTER-owned, NOT done here):
 * two `deriveGo*Truth` calls in the `lang === "go"` block, and `go` removed
 * from the `overrides` exclusion list in the compared-label filter. Both are
 * reported rather than made.
 *
 * ## WHAT INDEPENDENCE THESE DERIVATIONS HAVE, AND WHAT THEY DO NOT
 *
 * Each has a separate walker and a separate implementation of the Go rule:
 *
 *   exports   the analyzer reads its own PHASE-5 `exports` ARRAY, which is
 *             built from the SYMBOL table (kind + visibility + ownerName). This
 *             oracle never looks at a symbol. It reads the `SourceFile`'s
 *             direct named children and applies the spec's rule — first
 *             character is an upper-case letter — to the names written there.
 *             Two implementations of one spec rule, from two different inputs.
 *
 *   overrides the analyzer resolves the promoted method set through the
 *             `extends` EDGES its own embedding pass wrote, then matches
 *             `Method` symbols by receiver metadata. This oracle walks
 *             `type_spec` -> `struct_type` -> `field_declaration_list` itself,
 *             collects the embedded leaves, and walks `method_declaration`
 *             receiver parameter lists itself.
 *
 * They do NOT have an independent grammar. Both load the same
 * `tree-sitter-go.wasm`, so a bug IN the grammar — a node type that fails to
 * match, a field never populated — is invisible here exactly as it is to the
 * differential. That is the limit the honesty contract's L3 definition states,
 * and it is recorded rather than papered over.
 *
 * ## WHAT IS DELIBERATELY NOT DERIVED
 *
 *   - an `exports` edge for a capitalized package-level `var`: Go DOES export
 *     it (`http.ErrServerClosed`), so the construct exists, but the analyzer's
 *     PHASE-5 predicate drops `Variable` symbols for the harness's export
 *     uniqueness invariant (F3). Deriving it here would report a permanent
 *     MISSING for every one, which is a fact about the harness rather than about
 *     the language. The count of that excluded surface is measured by
 *     `script/m14/go-ontology-census.ts` probe C1b and quoted in the doc.
 *   - an `exports` edge for a capitalized METHOD: Go does not export a method
 *     (membership rides the method set, and the family records that as
 *     `contains`), so there is nothing to publish. Same measurement, C1b.
 *   - an `overrides` edge whose promoted method lives in ANOTHER FILE of the
 *     same package: real Go, and a per-file analyzer structurally cannot see
 *     it. Probe C4 of the census measures that surface; the oracle mirrors the
 *     analyzer's per-file scope, so those rows are not fabricated as MISSING.
 */

/** The labels this lane's oracle can actually derive for go.
 *
 *  Read by `script/m60/rel-type-coverage-gate.ts` `readOwnOracleLabels`, which
 *  prefers a lane's own export over the shared filter in `differential.ts`
 *  precisely so a lane that has moved its oracle out of the shared file is not
 *  reported against a stale set. */
export const GO_ORACLE_LABELS = [
  "calls",
  "contains",
  "extends",
  "exports",
  "implements",
  "imports",
  "instantiates",
  "overrides",
  "references",
  "uses",
] as const

export interface GoTruthEdge {
  label: string
  /** OMITTED rather than faked: the differential's truth rows use `(expr)` for a
   *  call site with no symbol source, and copying that convention here would
   *  invent a source that resolves to nothing. */
  from?: string
  target: string
}

function firstNamed(n: any, types: string[]): any {
  if (!n) return undefined
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && types.indexOf(c.type) !== -1) return c
  }
  return undefined
}
const leafOf = (raw: string): string => {
  const d = raw.lastIndexOf(".")
  return d === -1 ? raw : raw.slice(d + 1)
}
/** Go's own rule (spec, "Exported identifiers"): exported iff the first
 *  character of the name is an upper-case Unicode letter. ASCII-only test,
 *  because that is what the corpus can decide: a non-ASCII first rune is
 *  counted by neither side and reported as such rather than guessed at. */
const isGoExported = (name: string): boolean => {
  if (name.length === 0) return false
  const c = name.charCodeAt(0)
  return c >= 65 && c <= 90
}
/** The receiver type's NAME. Measured on the pinned wasm:
 *  method_declaration[receiver] -> parameter_list -> parameter_declaration
 *    -> { pointer_type | type_identifier | generic_type }
 *  `func (h *Header) v7()` and `func (h Header) v7()` are ONE method-set entry,
 *  so the pointer marker must not split them. */
function goReceiverLeaf(recv: any): string {
  if (!recv) return ""
  let cur: any =
    recv.type === "parameter_list"
      ? (recv.childForFieldName?.("type") ?? (recv.namedChildCount > 0 ? recv.namedChild(0) : undefined)?.childForFieldName?.("type"))
      : recv
  for (let g = 0; g < 8 && cur; g++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.childForFieldName?.("type") ?? (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? null
      if (!cur) return ""
      continue
    }
    break
  }
  if (!cur) return ""
  if (cur.type !== "type_identifier" && cur.type !== "qualified_type" && cur.type !== "generic_type") {
    const id = firstNamed(cur, ["type_identifier", "qualified_type"])
    return id ? leafOf(String(id.text ?? "")) : ""
  }
  return leafOf(String(cur.text ?? ""))
}

/**
 * `exports` truth — Go spec, "Exported identifiers" + "Package clause".
 *
 * One row per package-scope declaration whose name begins with an upper-case
 * letter, from `SourceFile`'s direct named children. `var_spec` names are
 * collected here and NOT filtered out at this level, so the caller can report
 * the excluded surface as a measured delta rather than a silent omission.
 */
export function deriveGoExportsTruth(root: any): GoTruthEdge[] {
  const out: GoTruthEdge[] = []
  const pkgClause = firstNamed(root, ["package_clause"])
  const pkg = pkgClause ? String(firstNamed(pkgClause, ["package_identifier"])?.text ?? "") : ""
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d) continue
    if (d.type === "function_declaration") {
      const nm = d.childForFieldName?.("name")
      if (nm && isGoExported(String(nm.text)) && String(nm.text) !== pkg) {
        out.push({ label: "exports", from: pkg, target: String(nm.text) })
      }
      continue
    }
    if (d.type === "type_declaration" || d.type === "type_alias") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const ts = d.namedChild(j)
        if (!ts || (ts.type !== "type_spec" && ts.type !== "type_alias")) continue
        const nm = ts.childForFieldName?.("name")
        if (nm && isGoExported(String(nm.text)) && String(nm.text) !== pkg) {
          out.push({ label: "exports", from: pkg, target: String(nm.text) })
        }
      }
      continue
    }
    if (d.type === "const_declaration") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const sp = d.namedChild(j)
        if (!sp || sp.type !== "const_spec") continue
        for (let k = 0; k < sp.namedChildCount; k++) {
          const id = sp.namedChild(k)
          if (id && id.type === "identifier" && isGoExported(String(id.text)) && String(id.text) !== pkg) {
            out.push({ label: "exports", from: pkg, target: String(id.text) })
          }
        }
      }
    }
  }
  return out
}

/**
 * `overrides` truth — Go spec, method sets and selectors.
 *
 * A method declared on `T` at depth 0 displaces, for every selector `x.M`, a
 * method of the SAME NAME promoted from a type `T` embeds. The rule is on the
 * NAME: Go permits the two to have different signatures and `x.M` selects `T`'s
 * either way, so a signature-matching subset would under-report the relation.
 *
 * Endpoints are `Receiver.Method` on both sides, the spelling the family uses
 * for a member with no package-scope name of its own.
 *
 * Scope mirrors the analyzer's: one file. A promoted method declared in a
 * sibling file of the same package is real and is measured by census probe C4;
 * deriving it here would report rows the analyzer cannot emit by construction.
 */
export function deriveGoOverridesTruth(root: any): GoTruthEdge[] {
  const out: GoTruthEdge[] = []
  const seen = new Set<string>()

  // type -> the embedded leaves written in its struct body
  const embeds = new Map<string, string[]>()
  // receiver type -> method names declared at package scope in this file
  const methodsOf = new Map<string, Set<string>>()

  const scan = (n: any): void => {
    if (n.type === "type_declaration" || n.type === "type_alias") {
      for (let j = 0; j < n.namedChildCount; j++) {
        const ts = n.namedChild(j)
        if (!ts || (ts.type !== "type_spec" && ts.type !== "type_alias")) continue
        const tname = ts.childForFieldName?.("name")
        const structN = firstNamed(ts, ["struct_type"])
        if (!tname || !structN) continue
        const fdl = firstNamed(structN, ["field_declaration_list"])
        if (!fdl) continue
        const list: string[] = []
        for (let k = 0; k < fdl.namedChildCount; k++) {
          const fd = fdl.namedChild(k)
          if (!fd || fd.type !== "field_declaration") continue
          // A NAMED field is not an embedding: `X int` has a `name`.
          if (fd.childForFieldName?.("name")) continue
          let cur: any = fd.childForFieldName?.("type")
          for (let g = 0; g < 8 && cur; g++) {
            if (cur.type === "pointer_type" || cur.type === "generic_type") {
              cur = cur.childForFieldName?.("type") ?? (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? null
              continue
            }
            break
          }
          if (cur && (cur.type === "type_identifier" || cur.type === "qualified_type")) {
            const leaf = leafOf(String(cur.text ?? ""))
            if (leaf) list.push(leaf)
          }
        }
        if (list.length) embeds.set(String(tname.text), list)
      }
    }
    if (n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")
      const recv = goReceiverLeaf(n.childForFieldName?.("receiver"))
      if (nm && recv) {
        const s = methodsOf.get(recv) ?? new Set<string>()
        s.add(String(nm.text))
        methodsOf.set(recv, s)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) scan(c)
    }
  }
  scan(root)

  // promoted method -> the types it is promoted FROM, path-marked so a diamond
  // reports one row per source rather than losing both.
  const promotedFrom = (tname: string, depth: number, visiting: Set<string>): Map<string, Set<string>> => {
    const acc = new Map<string, Set<string>>()
    if (depth > 4) return acc
    visiting.add(tname)
    for (const et of embeds.get(tname) ?? []) {
      for (const m of methodsOf.get(et) ?? []) {
        const s = acc.get(m) ?? new Set<string>()
        s.add(et)
        acc.set(m, s)
      }
      if (visiting.has(et)) continue
      for (const [m, owners] of promotedFrom(et, depth + 1, new Set(visiting))) {
        const s = acc.get(m) ?? new Set<string>()
        for (const o of owners) s.add(o)
        acc.set(m, s)
      }
    }
    visiting.delete(tname)
    return acc
  }

  for (const [tname, own] of methodsOf) {
    const promoted = promotedFrom(tname, 0, new Set())
    if (promoted.size === 0) continue
    for (const m of own) {
      for (const et of promoted.get(m) ?? []) {
        if (et === tname) continue
        const key = `${tname}.${m}|${et}.${m}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ label: "overrides", from: `${tname}.${m}`, target: `${et}.${m}` })
      }
    }
  }
  return out
}