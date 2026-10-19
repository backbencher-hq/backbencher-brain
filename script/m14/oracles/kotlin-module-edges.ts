/**
 * The kotlin `imports` / `exports` oracle — LANE-OWNED (`analyzer/DERIV_OVERRIDES`).
 *
 * Beside `oracles/` rather than inside `differential.ts`, for the reason
 * `oracles/dart-overrides.ts`'s header records: the shared file is edited by
 * several lanes at once and every line a lane keeps out of it is a line that
 * cannot conflict. Registration is the master's edit; this file is the lane's.
 *
 * ## Why these two labels need an oracle at all
 *
 * Both carried 0 edges on every corpus draw while the analyzer was doing the
 * work behind both of them — the import paths were in the graph as `references`
 * rows marked `isImportDep`, and the export set was in the symbol-level
 * `ExportInfo` array. An empty label is not a clean label: `verify-label-coverage`
 * exists because a label the analyzer emits and the harness drops is compared by
 * nothing, and a label nobody emits and nobody derives is compared by nothing in
 * the other direction — both read as a lane with no gap.
 *
 * So: the language HAS both constructs and the analyzer was not reading them as
 * relationships. That is GAP by the workstream's own definition, and the corpus
 * measurement that forbids RULED is in
 * `docs/analyzers/real-kotlin-analyzer.md` §3: 3,631 `import_header` nodes across
 * 197 of 200 files, and 37 top-level declarations carrying neither `private` nor
 * `internal` across 17 files.
 *
 * ## The rule, and the parts that are decisions
 *
 * **imports** — one edge per `import_header`: this file imports the path as
 * written. Two grammar facts, both probed on the pinned wasm rather than assumed:
 *
 *   - `import_header` is wrapped in an `import_list` node, so it is NOT a direct
 *     child of `source_file`. A direct-children read finds zero imports — which is
 *     what this oracle's first version did, and why its first run derived nothing.
 *   - `import x.y.*` serialises as `identifier("x.y")` PLUS a sibling
 *     `wildcard_import("*")`. The identifier text never contains `.*`, so the
 *     published target is the identifier text ALONE. An earlier kotlin oracle
 *     (`deriveKotlinReferencesTruth`) appended `.*` and produced 24 MISSING rows
 *     across nine files before the analyzer's own comment on that line was read
 *     as a specification rather than as background.
 *
 * **exports** — one edge per top-level declaration that carries NEITHER
 * `private` NOR `internal`. Kotlin writes that keyword explicitly, so this is
 * stronger evidence than go's capitalised-identifier rule or a package.json
 * `exports` key, both of which the ontology gate had to measure on the corpus
 * before believing.
 *
 * Four decisions, each stated because each could have gone the other way:
 *
 *   1. **The source is the COMPILATION UNIT's file name.** Kotlin has no
 *      importable module: the Gradle module is build configuration, and the JVM
 *      class a file compiles to is `FooKt` for `Foo.kt` — a convention the
 *      COMPILER applies, not something written in the source. Applying it here
 *      would be the name-guessing this lane has deleted twice. The consequence
 *      is that the source can collide with the file's primary type name
 *      (`Foo.kt` declaring `class Foo` gives `Foo -> Foo`); the two are different
 *      identities that coincide, and the coincidence is more honest than a
 *      synthesized class name.
 *   2. **`internal` is excluded.** It is visible to the module and not to a
 *      consumer, so publishing it makes the edge mean nothing. Kotlin's own
 *      reference calls `internal` "module API", which is exactly what the
 *      compilation-unit scope of this edge represents.
 *   3. **A class MEMBER is not exported.** It is reachable through its owner.
 *      The family contract is java JAD3; kotlin once had an `ownerKind === Class`
 *      hole that exported every member (probe `Outer{Inner;foo}`).
 *   4. **The target is the whole dotted import path, not a `module:item` pair.**
 *      `import a.b.C.d` names a declaration inside a package, so `a.b.C.d` is the
 *      name. The typescript shape (`modulePath:itemName`) is a real thing in
 *      typescript, where an import names both halves separately; kotlin does not
 *      write a separator and this oracle will not invent one.
 *
 * ## The limit of this oracle, stated up front
 *
 * It is a second walker over the SAME pinned grammar, so a grammar bug shared
 * with `real-kotlin-analyzer.ts` is invisible to it — the same limit the
 * workstream states for every oracle. It is also INDEPENDENT of the analyzer's
 * implementation: it does not call `processImportsExports`, does not read
 * `ImportInfo`, does not reuse `exports` predicate, and reaches the file name by
 * a different route (a basename + extension scan rather than a shared helper), so
 * a disagreement between the two is a real disagreement rather than a shared
 * mistake. And the differential's comparison is on `label + normTarget(target)`
 * and never on the source half, so `filePath` is optional here: without it the
 * derivation still matches, it just cannot name a source.
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

/**
 * The compilation unit's name: the file's base name with its extension removed.
 * A char scan, not a regex, and deliberately NOT the analyzer's
 * `kotlinCompilationUnitName` — a shared helper would make the two sides agree by
 * construction, which is the failure mode an oracle exists to catch.
 */
export function kotlinUnitName(filePath?: string): string {
  if (!filePath) return ""
  let norm = ""
  for (let i = 0; i < filePath.length; i++) norm += filePath[i] === "\\" ? "/" : filePath[i]
  const base = norm.slice(norm.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem
}

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

/** A top-level declaration — a DIRECT named child of `source_file`. */
const TOP_LEVEL = new Set(["function_declaration", "class_declaration", "property_declaration", "type_alias", "object_declaration"])

/** Backticks are quoting, not name — the same rule the published surface applies. */
function unquote(text: string): string {
  if (!text.includes("`")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.charCodeAt(i) === 96) {
      const close = text.indexOf("`", i + 1)
      if (close === -1) { out += text.slice(i); break }
      out += text.slice(i + 1, close)
      i = close + 1
    } else { out += text[i]; i++ }
  }
  return out
}

/**
 * The DECLARED NAME of a declaration.
 *
 * The shape is not uniform and reading it wrongly yields a silent zero, which is
 * how this oracle's first version lost `val literalBag = [1, 2]` (a property with
 * no explicit type): a `property_declaration`'s direct named children are
 * `binding_pattern_kind` (the `val`/`var` keyword) and `variable_declaration`, so
 * a direct-children search for an identifier never finds the name and the
 * declaration is skipped without a word. `variable_declaration > simple_identifier`
 * is where it lives, exactly as `extractProperty` reads it in the analyzer.
 */
function declaredName(n: any): string | null {
  const byField = field(n, "name")
  if (byField?.text) return byField.text
  const direct = named(n).find((c: any) => c.type === "type_identifier" || c.type === "simple_identifier")
  if (direct?.text) return direct.text
  const decl = named(n).find((c: any) => c.type === "variable_declaration")
  if (decl) {
    const inner = field(decl, "name") ?? named(decl).find((c: any) => c.type === "simple_identifier" || c.type === "type_identifier")
    if (inner?.text) return inner.text
  }
  return null
}

/**
 * Derive the file's `imports` and `exports` truth.
 *
 * `filePath` names the compilation unit the edges hang from. Omit it and only the
 * targets are derived — enough for the harness's comparison, which never reads the
 * source half, and not enough for anything that does.
 */
/** The FILE IDENTITY the KOTLIN4 contract sources imports/exports at: the primary top-level
 *  type/class/interface/object/enum name when the file declares one, else the compilation-unit
 *  (base) name. Derived independently of the analyzer's symbol table — a direct-child scan of
 *  `source_file`, so the two sides cannot agree by construction. */
function fileIdentity(root: any, filePath?: string): string {
  const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "object_declaration", "enum_class"])
  for (const c of named(root)) {
    if (!TYPE_DECLS.has(c.type)) continue
    const nm = declaredName(c)
    if (nm) return nm
  }
  return kotlinUnitName(filePath)
}

export function deriveKotlinModuleEdges(root: any, filePath?: string): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const unit = fileIdentity(root, filePath)
  const push = (label: string, from: string, target: string): void => {
    const t = unquote(String(target ?? "").trim())
    if (!t) return
    const k = `${label}|${from}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target: t })
  }

  // ── the import class ──────────────────────────────────────────────────────
  // FULL-TREE, because `import_header` sits inside `import_list`. Reading only
  // `source_file`'s direct children finds nothing, which is a silent zero rather
  // than a failure — the exact shape this workstream distrusts.
  {
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()
      if (n?.type === "import_header") {
        const id = field(n, "name") ?? named(n).find((c: any) => c.type === "identifier")
        if (id) push("imports", unit, id.text)
      }
      for (const c of named(n)) st.push(c)
    }
  }

  // EXPORTS ARE NOT DERIVED HERE: the independent `kotlin-exports` oracle owns that label (visibility
  // contract + file-level identity). This module's job is the import half only, which keeps one label per
  // oracle and no double-derived rows.
  return edges
}
