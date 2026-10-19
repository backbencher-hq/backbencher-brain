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
 *  (module path as written + selectors appended per group; excluded selectors skipped; source "(file)"). */
export function deriveScalaImportTruth(root: any): TruthEdge[] {
  const out: TruthEdge[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "import_declaration") {
      // Split the declaration into comma-separated GROUPS at the top level: `import a._, b._` is two
      // dependencies with independent prefixes (the analyzer's `groups` reset at each comma).
      const groups: { prefix: string[]; names: string[] }[] = []
      let cur = { prefix: [] as string[], names: [] as string[] }
      const pushGroup = (): void => { if (cur.prefix.length > 0 || cur.names.length > 0) groups.push(cur); cur = { prefix: [], names: [] } }
      const walk = (node: any, inSelectors: boolean): void => {
        for (let i = 0; i < (node.childCount ?? 0); i++) {
          const c = node.child(i)
          if (!c) continue
          if (c.type === "identifier") {
            if (inSelectors) cur.names.push(stripQuoting(c.text))
            else cur.prefix.push(stripQuoting(c.text))
          } else if (c.type === "namespace_wildcard") {
            if (!inSelectors) pushGroup()
          } else if (c.type === "namespace_selectors") {
            for (let j = 0; j < (c.namedChildCount ?? 0); j++) {
              const s = c.namedChild(j)
              if (!s) continue
              // `X => _` excludes X: not a dependency. `X => Y` introduces Y (renamed target is Y).
              if (s.type === "arrow_renamed_identifier") {
                const kids: any[] = []
                for (let k = 0; k < (s.namedChildCount ?? 0); k++) kids.push(s.namedChild(k))
                const arrowText = s.text
                const rhs = arrowText.split("=>")[1]?.trim() ?? ""
                if (rhs === "_") continue
                const leaf = kids.length > 1 ? kids[kids.length - 1] : kids[0]
                const nm = stripQuoting((leaf?.text ?? rhs).replace(/^_/, "").trim())
                if (nm && nm !== "_") cur.names.push(nm)
              } else if (s.type === "given_pattern" || s.type === "given") {
                // `{given C}` imports the given C: leaf is its type identifier
                for (let k = 0; k < (s.namedChildCount ?? 0); k++) {
                  const nm = superTypeNames(s.namedChild(k))[0]
                  if (nm) { cur.names.push(stripQuoting(nm)); break }
                }
              } else if (s.type === "identifier" || s.type === "type_identifier") {
                cur.names.push(stripQuoting(s.text))
              }
            }
          } else if (c.type === ",") {
            // A comma between GROUPS (not inside a selector clause): close the group.
            if (!(node.type === "namespace_selectors")) pushGroup()
          } else if (c.type !== ".") {
            walk(c, inSelectors || c.type === "namespace_selectors")
          }
        }
      }
      walk(n, false)
      pushGroup()
      // Dependency target: prefix joined + selector names appended; wildcard/exclusion-only -> prefix.
      const emitted = new Set<string>()
      for (const g of groups) {
        const base = g.prefix.join(".")
        if (base.length === 0) continue
        const targets: string[] = []
        if (g.names.length === 0) targets.push(base)
        else {
          const alreadyFull = g.names.every((nm) => base.endsWith(`.${nm}`) || base === nm)
          if (alreadyFull) targets.push(base)
          else for (const nm of g.names) targets.push(`${base}.${nm}`)
        }
        for (const t of targets) {
          if (!emitted.has(t)) { emitted.add(t); out.push({ label: "imports", from: "(file)", target: t }) }
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

/** Module/file sentinel name — the analyzer's emitExportSurface `moduleName` (file basename without
 *  extension; the surface channel's source). */
function moduleNameOf(filePath: string | undefined): string {
  if (!filePath) return "(file)"
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "(file)"
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/** exports: both published channels — (a) `(file)` -> public top-level declaration names, (b) the
 *  module sentinel -> public-top-level surface + Scala 3 export-clause names. Kinds are not needed by
 *  the comparison (label+target is the row key); names are. */
export function deriveScalaExportTruth(root: any, filePath?: string): TruthEdge[] {
  const out: TruthEdge[] = []
  const SURFACE_DECLS = new Set([
    "class_definition", "trait_definition", "object_definition", "enum_definition",
    "val_definition", "var_definition", "val_declaration", "var_declaration",
    "function_definition", "given_definition",
  ])
  const moduleName = moduleNameOf(filePath)
  const seen = new Set<string>()
  const push = (from: string, target: string): void => {
    const k = `${from}\u0000${target}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "exports", from, target })
  }
  const isPrivateish = (decl: any): boolean => {
    const mods = childOfType(decl, "modifiers")
    const text = (mods?.text ?? "").slice(0, 200)
    return /\bprivate\b/.test(text) || /\bprotected\b/.test(text)
  }
  const nameOf = (decl: any): string => {
    const nm = decl.childForFieldName?.("name") ?? childOfType(decl, "identifier") ?? childOfType(decl, "type_identifier")
    return stripQuoting(nm?.text ?? "")
  }
  // top-level scope: root's children plus package-clause / package-object bodies (the analyzer's
  // collectSurface rule).
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n !== root && (n.type === "package_clause" || n.type === "package_object")) {
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
        const b = n.namedChild(i)
        if (b && (b.type === "block" || b.type === "template_body")) stack.push(b)
      }
      continue
    }
    if (n !== root && SURFACE_DECLS.has(n.type) && !isPrivateish(n)) {
      const nm = nameOf(n)
      if (nm) { push("(file)", nm); push(moduleName, nm) }
      // members of a declaration are NOT top-level: do not descend into it for the surface
      continue
    }
    for (let i = (n.namedChildCount ?? 0) - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  // Scala 3 `export a.b.{x, y}` clause: the names introduced into THIS file (leaf / renamed-to).
  const visit = (n: any): void => {
    if (n.type === "export_declaration") {
      const names: string[] = []
      const walk = (x: any, inSel: boolean): void => {
        for (let i = 0; i < (x.childCount ?? 0); i++) {
          const c = x.child(i)
          if (!c) continue
          if (c.type === "namespace_selectors") { walk(c, true); continue }
          if (inSel) {
            if (c.type === "identifier" || c.type === "type_identifier") names.push(stripQuoting(c.text))
            else if (c.type === "arrow_renamed_identifier") {
              const rhs = c.text.split("=>")[1]?.trim() ?? ""
              if (rhs && rhs !== "_") names.push(stripQuoting(rhs))
              else {
                const kids: any[] = []
                for (let k = 0; k < (c.namedChildCount ?? 0); k++) kids.push(c.namedChild(k))
                const nm = kids.length > 1 ? stripQuoting(kids[kids.length - 1].text) : ""
                if (nm && nm !== "_") names.push(nm)
              }
            }
          } else if (c.type === "identifier" || c.type === "type_identifier") {
            names.push(stripQuoting(c.text))
          }
        }
      }
      walk(n, false)
      // the LAST segment is the leaf for the plain `export a.b.c` form; selectors already name leaves
      const hasSelectors = n.text.includes("{")
      const finalNames = hasSelectors ? names : names.length > 0 ? [names[names.length - 1]] : []
      for (const nm of finalNames) if (nm) push(moduleName, nm)
    }
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)
  return out
}
