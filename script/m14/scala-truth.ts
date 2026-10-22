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
  "mixes_in", "imports", "exports", "implements",
]

/**
 * ★ WHY `implements` WAS NOT IN THIS LIST UNTIL 2026-10-21, AND WHY IT IS NOW.
 *
 *   `script/m60/rel-type-coverage-gate.ts` reads a lane's OWN ORACLE_LABELS INSTEAD of the shared
 *   filter, because the export is the lane's claim about what its ORACLE covers — and the gate's
 *   DERIVATION check is that a label in that set really IS derived. So a label in the set with no
 *   derivation behind it is exactly the failure the gate exists to catch.
 *
 *   ⇒ Adding `implements` BEFORE the differential called `deriveScalaImplementsTruth` would have
 *   turned that gate's DERIVATION check GREEN for a label the differential did not compare — a FALSE
 *   PASS, in the direction of OVERSTATING coverage. So the word was HELD BACK.
 *
 *   ⇒ IT IS RELEASED NOW because the wiring exists and is MEASURED: `script/m14/differential.ts`
 *   imports `deriveScalaImplementsTruth` and pushes its rows in the scala truth branch (the Lead's
 *   commit `4c1abbe82`). The derivation is real, so the gate can say true.
 */

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

/** implements: the SELF-TYPE's conformance requirement, per the PUBLISHED contract.
 *
 *  ★ WHY THIS EXISTS — THE MIXIN RULING'S FALSIFIER FIRED, AND IT FIRED WITH A COUNT.
 *    The fleet MIXIN RULING (2026-10-19, option (b)) ruled `implements` NOT-APPLICABLE for scala
 *    on the falsifier "a Scala construct that declares conformance WITH NO COMPOSITION semantics",
 *    and it named the self-type `this: T =>` in the same sentence WITHOUT MEASURING it. Measured
 *    over the whole admitted population (script/m14/scala-construct-census.ts ->
 *    validation/m14/measurements/scala-construct-census.json): 1,017 self_type sites in 636 files,
 *    671 of them carrying a required type after the ":". The construct is ALREADY EXPRESSIBLE in the
 *    wired grammar (`self_type` is a NAMED node type of the pinned build, sha256
 *    393cc91ba940440f598a2102cddd6fee92217096cedaef7f793392598f0c9917, 189 named of 455 ids), so this
 *    is rung R3 of the remedy ladder and NO grammar change is taken. The analyzer now publishes the
 *    row, and the lane's oracle derives it INDEPENDENTLY, by the PUBLISHED contract below.
 *
 *  THE PUBLISHED CONTRACT (the source comments in real-scala-analyzer.ts are its evidence):
 *    source = the enclosing trait/class/object/enum's name;
 *    target = the type named after the ":" in the self type;
 *    a self type with NO ":" binds a NAME and requires nothing — no row;
 *    a SINGLETON type (`IO.type`, `acme.Module.type`) names the MODULE;
 *    a type ARGUMENT is a parameter of the required type, not a second requirement — not descended into;
 *    a STRUCTURAL type names no conformance target — no row;
 *    an X -> X row carries no information — no row.
 *
 *  INDEPENDENCE. This walks the tree itself and reads the SELF-TYPE node's own children; it does not
 *  call the analyzer and it is not a copy of the analyzer's walk.
 */
export function deriveScalaImplementsTruth(root: any): TruthEdge[] {
  const out: TruthEdge[] = []
  const DECL = new Set(["class_definition", "trait_definition", "object_definition", "enum_definition"])

  /** The declaration's own name, found by walking UP from the self type. */
  const enclosingName = (from: any): string => {
    let p = from?.parent ?? null
    while (p) {
      if (DECL.has(p.type)) {
        const nameNode = p.childForFieldName?.("name") ?? childOfType(p, "identifier") ?? childOfType(p, "type_identifier")
        const nm = stripQuoting(nameNode?.text ?? "")
        if (nm) return nm
        return ""
      }
      p = p.parent
    }
    return ""
  }

  /** The type named after the ":" — the self type's REQUIRED type. */
  const requiredTypeNode = (st: any): any => {
    let colon = -1
    for (let i = 0; i < (st.childCount ?? 0); i++) {
      const c = st.child(i)
      if (c && !c.isNamed && c.type === ":") { colon = i; break }
    }
    if (colon < 0) return null
    for (let i = colon + 1; i < (st.childCount ?? 0); i++) {
      const c = st.child(i)
      if (!c || !c.isNamed) continue
      if (c.type === "block_comment" || c.type === "comment") continue
      return c
    }
    return null
  }

  /** The names a required type names — a union names two, a type argument names none. */
  const requiredNames = (req: any): string[] => {
    if (!req) return []
    if (req.type === "structural_type") return []
    if (req.type === "singleton_type") {
      for (let i = 0; i < (req.namedChildCount ?? 0); i++) {
        const c = req.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "stable_identifier" || c.type === "stable_type_identifier")) {
          return [stripQuoting(c.text)]
        }
      }
      return []
    }
    const out: string[] = []
    const walk = (n: any): void => {
      if (n.type === "type_arguments" || n.type === "wildcard") return
      if (n.type === "type_identifier" || n.type === "stable_type_identifier") {
        const nm = stripQuoting(n.text)
        if (nm && !out.includes(nm)) out.push(nm)
        return
      }
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(req)
    return out
  }

  const stack: any[] = [root]
  /** ONE ROW PER (source, target) PAIR PER FILE — the analyzer's published contract.
   *
   *  ★ WHY THIS DE-DUPLICATION IS PART OF THE CONTRACT AND NOT A CONVENIENCE. A file can carry the
   *    same (source, target) pair twice: two declarations with the SAME NAME, each with a self type
   *    requiring the same type (`scala3/tests/pos/i18351.scala` — `Foo->CrudService` twice; also
   *    `scala3/tests/pos/i9844.scala` `Bar->Foo`, `scala3/tests/init/warn/inner11.scala`
   *    `Info->ThisInfo`, and the NEGATIVE test `scala3/tests/neg/i3083.scala` `Addition->Literal`).
   *    The row is a pair of NAMES, so the pair is one row. The analyzer publishes it once (its
   *    `emitted` set is keyed per file), and the oracle must publish it once too — an oracle that
   *    publishes it twice would report a MISSING row against a correct analyzer, and a truth that
   *    invents a disagreement is worse than one that misses a row. */
  const seen = new Set<string>()
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "self_type") {
      const owner = enclosingName(n)
      if (owner) {
        for (const raw of requiredNames(requiredTypeNode(n))) {
          const target = stripQuoting(raw)
          if (!target) continue
          // THE INFORMATION TEST — an X -> X row carries no information.
          const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
          if (target === owner || leaf === owner) continue
          const k = `${owner}->${target}`
          if (seen.has(k)) continue
          seen.add(k)
          out.push({ label: "implements", from: owner, target })
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
