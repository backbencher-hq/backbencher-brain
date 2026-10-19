/**
 * scala-truth — the SCALA LANE'S OWN oracle module (fleet phase, 2026-10-19).
 *
 * WHY IT EXISTS. The analyzer emits eleven labels; the shared differential audited eight of them
 * (calls, uses, contains, references, instantiates, extends, overrides + the heritage split) and had NO
 * derivation for `imports`, `exports` (the spec's own `label_coverage.declared_no_truth` names both) —
 * so a missing import/export surface could never turn red. The fleet-phase MIXIN RULING (2026-10-19,
 * Lead) additionally moves `with`-clause traits from `implements` to `mixes_in`, and `implements` becomes
 * RULED NOT-APPLICABLE for scala — so `mixes_in` needs an INDEPENDENT derivation before it may be
 * admitted to the compared set (the ruling's condition (ii): the truth must derive the same split
 * independently of the analyzer change).
 *
 * CONTRACT COPIED FROM THE ANALYZER'S PUBLISHED FORMS (not from its implementation internals), and the
 * source comments in `real-scala-analyzer.ts` are the evidence for each rule:
 *   imports  — one dependency edge per DISTINCT target, source "(file)"; the target is the module path
 *              as written, with a selector clause's imported names appended to the clause's own prefix
 *              (excluded selectors `X => _` are not dependencies; wildcard `*` keeps the package path;
 *              a multi-clause `import a._, b._` is one dependency PER GROUP).
 *   exports  — two published channels: (a) `(file)` -> every public top-level declaration name (the
 *              analyzer's ExportInfo flush); (b) the module SENTINEL -> the public-top-level surface
 *              (reachability-filtered) plus the names a Scala 3 `export a.b.{x, y}` clause introduces
 *              (leaf / renamed-to names). Both are derived because both are published.
 *   mixes_in — for class/trait/object/enum definitions: position 0 of the extends clause is `extends`,
 *              every further type is `mixes_in`. Trait lists are included (a trait's own supertype list
 *              is the same composition construct — ruling condition (i) names class-extends-with AND
 *              trait-extends-with).
 *
 * INDEPENDENCE. This module walks the tree-sitter-scala AST itself; it does not call the analyzer, and it
 * is not a copy of the analyzer's walk order. It is deliberately the SIMPLEST derivation that produces
 * the published edge set, so the differential's MISSING/unexplained buckets measure the analyzer against
 * an independent reading of the same source.
 *
 * HONESTY NOTE (window work): the imports/exports halves are first-cut derivations of the documented
 * contract. Their row classes will be validated against the fresh draws in the STEP-2 window; any
 * disagreement is reported as a row class, never smoothed. `mixes_in` is the load-bearing one for the
 * ruling and is exact by construction (one declaration clause -> one split).
 *
 * LABELS DECLARED (read by script/m60/rel-type-coverage-gate.ts's readOwnOracleLabels, which gives a
 * lane-owning oracle precedence over the shared allowlist): every label the analyzer still emits and this
 * module/differential audited. `implements` is NOT in it: the analyzer no longer emits it (ruled
 * NOT-APPLICABLE for scala).
 */
export const SCALA_ORACLE_LABELS: ReadonlyArray<string> = [
  "calls", "uses", "contains", "references", "instantiates", "extends", "overrides",
  "mixes_in", "imports", "exports",
]

type TruthEdge = { label: string; from: string; target: string }

/** Mirror of the analyzer's `stripScalaQuoting` (M60 #924/S7): backticks are not part of a NAME. */
function stripQuoting(text: string): string {
  if (!text.includes("`")) return text
  return text.split("`").join("").replace(/\s+/g, " ")
}

function childOfType(node: any, type: string): any {
  for (let i = 0; i < (node?.namedChildCount ?? 0); i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

/** Head type NAME of one supertype node — the analyzer's extractSupertypes rule (M14.1 convention):
 *  type_identifier/identifier -> text; stable_type_identifier -> FULL dotted name; generic_type ->
 *  the first stable/type identifier child (head), never the arguments; compound_type -> its members. */
function superTypeNames(node: any): string[] {
  if (!node) return []
  const t = node.type
  if (t === "type_identifier" || t === "identifier" || t === "user_type") return [node.text]
  if (t === "stable_type_identifier") return [node.text]
  if (t === "generic_type") {
    for (let i = 0; i < (node.childCount ?? 0); i++) {
      const c = node.child(i)
      if (c && c.type === "stable_type_identifier") return [c.text]
    }
    for (let i = 0; i < (node.childCount ?? 0); i++) {
      const c = node.child(i)
      if (c && c.type === "type_identifier") return [c.text]
    }
    return [node.text.split("[")[0]]
  }
  if (t === "compound_type") {
    const out: string[] = []
    for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
      for (const n of superTypeNames(node.namedChild(i))) if (!out.includes(n)) out.push(n)
    }
    return out
  }
  return []
}

/** mixes_in: every extends-clause type AFTER position 0 of a class/trait/object/enum definition.
 *  This is the ruling's split, derived from the declaration syntax alone (not from the analyzer). */
export function deriveScalaMixesInTruth(root: any): TruthEdge[] {
  const out: TruthEdge[] = []
  const DECL = new Set(["class_definition", "trait_definition", "object_definition", "enum_definition"])
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (DECL.has(n.type)) {
      const extendsClause = childOfType(n, "extends_clause")
      if (extendsClause) {
        const nameNode = n.childForFieldName?.("name") ?? childOfType(n, "identifier") ?? childOfType(n, "type_identifier")
        const owner = stripQuoting(nameNode?.text ?? "")
        if (owner) {
          const names: string[] = []
          for (let i = 0; i < (extendsClause.namedChildCount ?? 0); i++) {
            for (const nm of superTypeNames(extendsClause.namedChild(i))) {
              const clean = stripQuoting(nm)
              if (clean && !names.includes(clean)) names.push(clean)
            }
          }
          for (let i = 1; i < names.length; i++) out.push({ label: "mixes_in", from: owner, target: names[i] })
        }
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** imports: dependency targets per import_declaration, mirroring the analyzer's published import facts
 *  (module path as written + selector names appended per group; excluded selectors skipped; source
 *  "(file)"). Targets are the depended-on module paths — never a truncated prefix. */
export function deriveScalaImportTruth(root: any): TruthEdge[] {
  const out: TruthEdge[] = []
  const emitted = new Set<string>()
  const emit = (target: string): void => {
    if (!target || emitted.has(target)) return
    emitted.add(target)
    out.push({ label: "imports", from: "(file)", target })
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "import_declaration") {
      type Group = { prefix: string[]; names: string[] }
      const groups: Group[] = []
      let cur: Group = { prefix: [], names: [] }
      const closeGroup = (): void => {
        if (cur.prefix.length > 0 || cur.names.length > 0) groups.push(cur)
        cur = { prefix: [], names: [] }
      }
      for (let i = 0; i < (n.childCount ?? 0); i++) {
        const c = n.child(i)
        if (!c) continue
        if (c.type === "identifier") cur.prefix.push(stripQuoting(c.text))
        else if (c.type === "namespace_wildcard") closeGroup()
        else if (c.type === "namespace_selectors") {
          const base = cur.prefix.slice()
          // the selector clause CONSUMES the group prefix: it is emitted as base.name rows, never
          // as an extra bare-prefix group (that would publish `java.io` alongside `java.io.File`)
          cur = { prefix: [], names: [] }
          const localNames: string[] = []
          for (let j = 0; j < (c.namedChildCount ?? 0); j++) {
            const sel = c.namedChild(j)
            if (!sel) continue
            if (sel.type === "identifier" || sel.type === "type_identifier") localNames.push(stripQuoting(sel.text))
            else if (sel.type === "arrow_renamed_identifier") {
              // A dependency edge names what is DEPENDED ON — the imported (left-hand) name.
              // `X => Y` renames the LOCAL binding; `X => _` imports nothing.
              const text = sel.text
              const rhs = text.split("=>")[1]?.trim() ?? ""
              if (rhs === "_") continue
              const kids: any[] = []
              for (let k = 0; k < (sel.namedChildCount ?? 0); k++) kids.push(sel.namedChild(k))
              const lhs = kids.length > 0 ? stripQuoting(kids[0].text) : stripQuoting(text.split("=>")[0]?.trim() ?? "")
              if (lhs && lhs !== "_") localNames.push(lhs)
            } else if (sel.type === "given_pattern" || sel.type === "given") {
              for (let k = 0; k < (sel.namedChildCount ?? 0); k++) {
                const t = sel.namedChild(k)
                if (t && (t.type === "type_identifier" || t.type === "identifier")) { localNames.push(stripQuoting(t.text)); break }
              }
            }
          }
          const baseStr = base.join(".")
          for (const nm of localNames) {
            if (!baseStr) continue
            emit(baseStr.endsWith("." + nm) ? baseStr : baseStr + "." + nm)
          }
          if (localNames.length === 0 && baseStr) emit(baseStr)
        } else if (c.type === ",") closeGroup()
      }
      closeGroup()
      for (const g of groups) {
        const base = g.prefix.join(".")
        if (!base) continue
        if (g.names.length === 0) emit(base)
        else for (const nm of g.names) emit(base.endsWith("." + nm) ? base : base + "." + nm)
      }
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

/** Module/file sentinel name — the analyzer's emitExportSurface `moduleName` (file basename without
 *  extension; the surface channel's source). */
function moduleNameOf(filePath: string | undefined): string {
  if (!filePath) return "(file)"
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "(file)"
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/** exports: the published channels — (a) `(file)` -> every public top-level declaration name (the
 *  analyzer's ExportInfo flush), (b) the package/module sentinel -> the public-top-level surface, and
 *  (c) Scala 3 `export` clauses: introduced names with the clause's OWNER (or the file sentinel for a
 *  top-level clause) AND the surface channel's module-named rows. Only NAMES are targets — a clause's
 *  dotted path is never an export target. */
export function deriveScalaExportTruth(root: any, filePath?: string): TruthEdge[] {
  const out: TruthEdge[] = []
  const SURFACE_DECLS = new Set([
    "class_definition", "trait_definition", "object_definition", "enum_definition",
    "val_definition", "var_definition", "val_declaration", "var_declaration",
    "function_definition", "given_definition",
  ])
  const seen = new Set<string>()
  const push = (from: string, target: string): void => {
    if (!from || !target) return
    const k = from + "\u0000" + target
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "exports", from, target })
  }
  // module sentinel = the file's package name (namespace), or FILE_MODULE "(file)" when none
  let packageName = ""
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      if (n.type === "package_clause") {
        const ids: string[] = []
        for (let i = 0; i < (n.childCount ?? 0); i++) {
          const c = n.child(i)
          if (c && c.type === "identifier") ids.push(stripQuoting(c.text))
        }
        if (ids.length > 0) { packageName = ids.join("."); break }
      }
      for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  const moduleName = packageName || "(file)"
  const nameOf = (decl: any): string => {
    const nm = decl.childForFieldName?.("name") ?? childOfType(decl, "identifier") ?? childOfType(decl, "type_identifier")
    return stripQuoting(nm?.text ?? "")
  }
  const isPrivateish = (decl: any): boolean => {
    const mods = childOfType(decl, "modifiers")
    const text = (mods?.text ?? "").slice(0, 200)
    return /\bprivate\b/.test(text) || /\bprotected\b/.test(text)
  }
  const introducedNames = (clause: any): string[] => {
    const names: string[] = []
    const hasSelections = clause.text.includes("{")
    if (!hasSelections) {
      // `export a.b.c` introduces the LEAF c
      const ids: string[] = []
      for (let i = 0; i < (clause.childCount ?? 0); i++) {
        const c = clause.child(i)
        if (c && c.type === "identifier") ids.push(stripQuoting(c.text))
      }
      if (ids.length > 0) names.push(ids[ids.length - 1])
      return names
    }
    const sel = childOfType(clause, "namespace_selectors")
    if (!sel) return names
    for (let j = 0; j < (sel.namedChildCount ?? 0); j++) {
      const x = sel.namedChild(j)
      if (!x) continue
      if (x.type === "identifier" || x.type === "type_identifier") names.push(stripQuoting(x.text))
      else if (x.type === "arrow_renamed_identifier") {
        const rhs = x.text.split("=>")[1]?.trim() ?? ""
        if (rhs === "_") continue
        const kids: any[] = []
        for (let k = 0; k < (x.namedChildCount ?? 0); k++) kids.push(x.namedChild(k))
        const nm = rhs || (kids.length > 1 ? stripQuoting(kids[kids.length - 1].text) : "")
        if (nm && nm !== "_") names.push(stripQuoting(nm))
      } else if (x.type === "given_pattern" || x.type === "given") {
        for (let k = 0; k < (x.namedChildCount ?? 0); k++) {
          const t = x.namedChild(k)
          if (t && (t.type === "type_identifier" || t.type === "identifier")) { names.push(stripQuoting(t.text)); break }
        }
      }
    }
    return names
  }
  // one walk: declarations contribute the top-level channels; export clauses contribute introduced names
  const walk = (n: any, owner: string | null, topLevel: boolean): void => {
    if (!n) return
    if (n.type === "package_clause" || n.type === "package_object") {
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
        const b = n.namedChild(i)
        if (b && (b.type === "block" || b.type === "template_body")) walk(b, null, true)
      }
      return
    }
    if (n.type === "export_declaration") {
      const names = introducedNames(n)
      const clauseOwner = owner ?? "(file)"
      for (const nm of names) {
        push(clauseOwner, nm)
        push(moduleName, nm)
      }
    }
    if (SURFACE_DECLS.has(n.type)) {
      const nm = nameOf(n)
      if (nm && !isPrivateish(n)) {
        if (topLevel) { push("(file)", nm); push(moduleName, nm) }
      }
      // descend for nested export clauses, attributing them to this declaration
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) walk(n.namedChild(i), nm || owner, false)
      return
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) walk(n.namedChild(i), owner, topLevel)
  }
  walk(root, null, true)
  return out
}
