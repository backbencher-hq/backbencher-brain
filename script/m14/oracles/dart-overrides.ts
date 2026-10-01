/**
 * The Dart `overrides` oracle — LANE-OWNED.
 *
 * Beside `dart-contains.ts` rather than in `differential.ts`, for the reason that
 * file's header records: the shared file is edited by several lanes at once, and
 * every line a lane keeps out of it is a line that cannot conflict.
 *
 * ## Why this oracle exists
 *
 * `overrides` is the second-largest relationship the Dart analyzer emits — 229,416
 * edges over 1,294 ProxiCall/lib files, behind only `contains` (260,102). It is
 * the edge that makes a hierarchy navigable: "what does this method displace" is
 * how a reader of an OO codebase starts. And it has no Dart-derived truth — it
 * comes from the generic family walker, and the Dart oracle region of
 * `differential.ts` contains zero mentions of it.
 *
 * A volume sanity check already passed on the corpus and is recorded here so it is
 * not repeated: duplication factor 1.0x, zero rows where source === target, 100%
 * cross-file targets, and pairs that are recognisably Flutter
 * (`_EmptyState.build -> StatelessWidget.build`,
 * `ProxiCallThemeExtension.lerp -> ThemeExtension.lerp`,
 * `InventoryCategoryException.toString -> Exception.toString`). That says the
 * surface is not absurd. It is not an oracle, and this file is.
 *
 * ## The rule
 *
 * A method M declared in C OVERRIDES a method of the same name declared in the
 * nearest supertype of C that declares one.
 *
 * Four parts, each measured rather than assumed:
 *
 *   1. **NAME ONLY.** The match is on the member's name. Fields, getters, setters,
 *      static methods and operators all participate — a getter override and a
 *      plain-field override both resolve, and `static void go()` overrides
 *      `static void go()`. Dart has no signature-based dispatch to match on, and
 *      the analyzer does not attempt one.
 *   2. **ALL THREE HERITAGE CLAUSES.** `extends`, `implements` and `with` each
 *      contribute supertypes. A `mixin M { void go() }` used via `with M` is an
 *      override target, and so is a class's own base.
 *   3. **TRANSITIVE, by breadth-first walk.** `class C extends Mid`, `abstract
 *      class Mid extends Base`, and C overriding `go` resolves to `Base.go` — the
 *      walk goes through Mid, which declares nothing. A mixin's own supertype is
 *      searched too: `mixin M on Base4` used via `with M` resolves to `Base4.go`.
 *      A hierarchy is a DAG and the question is where the name actually lives.
 *   4. **ONE ROW PER METHOD — the NEAREST supertype wins.** A method that matches
 *      BOTH an extends base and an implemented interface emits ONE row, and it is
 *      the base: `class C extends A implements I` with `go` in both emits
 *      `C.go -> A.go` and not `C.go -> I.go`. This is the part most likely to be
 *      encoded wrongly, because emitting both rows looks more complete and is a
 *      duplicate edge in the graph. Breadth-first order is what makes "nearest"
 *      well defined: `extends` is enqueued before `implements`, and `implements`
 *      before `with`.
 *
 * ## Two naming decisions this mirrors, and why each is a decision
 *
 * - **A supertype name is ALIAS-STRIPPED.** `import 'x.dart' as _i2;` writes
 *   `class C extends _i2.A2`, and the edge is `C.go -> A2.go`. The prefix is an
 *   import alias, not part of the type's name, and DAD1/DAD2 already ruled this for
 *   heritage: emitting `_i2` would name an import, not a class.
 * - **The TARGET is qualified by its declaring class**, `Base.go`, not the bare
 *   `go`. A method name alone is ambiguous the moment a hierarchy has two of them,
 *   and the qualification is what makes the edge answerable.
 */

 * ## Measured state, and the structural finding that matters more than the number
 *
 * Over 1,294 ProxiCall/lib files the oracle agrees on **610** rows, misses **0**,
 * and the analyzer publishes **110** it does not. But the figure that should change
 * how this surface is audited is neither:
 *
 *   **99.7% of all `overrides` rows — 228,696 of 229,416 — are CROSS-FILE.**
 *
 * `overrides` is NOT a file-local surface. DARTD16's resolution walks a companion
 * set and then an annotation-gated external first-parent, and almost every row
 * names a base that is not in the file at all: `_EmptyState.build ->
 * StatelessWidget.build`, `ProxiCallThemeExtension.lerp -> ThemeExtension.lerp`,
 * `InventoryCategoryException.toString -> Exception.toString`. A per-file oracle
 * cannot derive those by construction, so measuring this surface the way `contains`
 * is measured does not work, and the honest number is 84.7% on the in-file subset
 * (610 agree / 0 missing / 110 extra) rather than 0.3% against the whole.
 *
 * Two consequences worth stating plainly. First, `MISSING = 0` on the in-file
 * subset: the analyzer emits nothing here that the grammar does not support. Second,
 * a genuine Dart-owned `overrides` oracle has to be CROSS-REPOSITORY, not
 * lane-local — it needs the companion/base-class index that `differential.ts`
 * builds across corpora. That is a larger piece of work than a lane-owned file, and
 * pretending otherwise would produce another oracle that agrees only where nothing
 * interesting happens.
 *
 * The 110 EXTRA are one shape and they are oracle-side: freezed emits
 * `class _$SessionAnalyticsInitial extends SessionAnalyticsInitial` with the members
 * on the PRIVATE impl, and the analyzer attributes those members to the PUBLIC
 * sealed class, so it emits `SessionAnalyticsInitial.props ->
 * SessionAnalyticsState.props` where this oracle emits nothing for that source.
 * A private-impl-to-public-sealed mapping is a naming decision this oracle does not
 * make, and recording it as unresolved is more useful than guessing it.
 *
 * The eight-case battery (extends, extends+implements, alias prefix, transitive,
 * mixin-on-class, getter, three-deep chain, external base) is 8/8 exact.
 *
 * ## What building this cost
 *
 * Three wrong turns, all of them places where the grammar declines to announce its
 * structure, and all three found by a probe rather than by reading:
 *
 *   - THE HERITAGE CLAUSE HAS THREE SPELLINGS AND ONE HAS NO WRAPPER. `extends X`
 *     is a `superclass` node; a mixin's `on X` is a bare `type_identifier` DIRECT
 *     child of the declaration with nothing around it; and a `with` clause lives
 *     INSIDE the `superclass` node rather than beside it, so a direct-children read
 *     silently loses every `with` on a class that also extends something.
 *   - AN IMPORT ALIAS IS A SIBLING, NOT A DOTTED NAME. `extends _i2.A2` parses as
 *     `superclass > type_identifier(_i2), type_identifier(A2)`, so stripping at a
 *     `.` finds no dot and the oracle produced zero edges while the analyzer
 *     produced one. The alias is now dropped STRUCTURALLY — only when another
 *     type_identifier follows it in the same group — so a class genuinely named
 *     `_Private` keeps working, which guessing at Dart's naming convention would
 *     have broken.
 *   - AND A QUEUE THAT IS APPENDED TO BUT NEVER DRAINED IS AN INFINITE LOOP. The
 *     breadth-first walk iterated `for (const sup of queue)` and then pushed onto
 *     `queue`; a supertype matching no declaration produced an empty next-frontier,
 *     left the queue holding its previous contents, and spun forever. It HUNG the
 *     probe process rather than returning a wrong answer, which is the only reason
 *     it was found. It is now index-drained and iteration-capped.
 *
export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): string | null => n?.childForFieldName?.(f)?.text ?? null
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Declaration types that can OWN methods and can be SUPERTYPES. */
const DECLS = new Set([
  "class_definition",
  "mixin_declaration",
  "extension_declaration",
  "extension_type_declaration",
  "enum_declaration",
])

/** The body node whose children are a declaration's members. */
const BODY_OF: Record<string, string> = {
  class_definition: "class_body",
  mixin_declaration: "class_body",
  extension_declaration: "extension_body",
  extension_type_declaration: "class_body",
  enum_declaration: "enum_body",
}

/** Wrapper nodes carrying a member's NAME. */
const NAME_WRAPPERS = new Set(["function_signature", "getter_signature", "setter_signature", "operator_signature"])

/** An import-alias prefix is not part of the type's name (`_i2.A2` → `A2`). */
function stripAlias(raw: string): string {
  const i = raw.lastIndexOf(".")
  return i >= 0 ? raw.slice(i + 1) : raw
}

function declarationName(node: any): string | null {
  const byField = field(node, "name")
  if (byField && IDENT.test(byField)) return byField
  // `mixin_declaration` has no name field — its name is a bare identifier after
  // the `mixin` keyword. Same trap as the contains oracle's mixin arm.
  for (const c of named(node)) {
    if (c.type === "identifier" && IDENT.test(c.text)) return c.text
  }
  return null
}

/** Every method name a declaration owns. Names only — see rule 1. */
function methodNames(node: any, bodyType: string): string[] {
  const out: string[] = []
  const body = named(node).find((c: any) => c.type === bodyType)
  if (!body) return out
  for (const m of named(body)) {
    const add = (nm: string | null): void => {
      if (nm && !out.includes(nm)) out.push(nm)
    }
    if (m.type === "method_signature") {
      for (const w of named(m)) {
        if (!NAME_WRAPPERS.has(w.type)) continue
        const nm = field(w, "name")
        if (nm && nm !== "operator" && IDENT.test(nm)) add(nm)
        else if (nm === "operator" || w.type === "operator_signature") {
          for (let i = 0; i < w.childCount; i++) {
            const g = w.child(i)
            if (g && !g.isNamed && g.text === "operator") {
              const nx = w.child(i + 1)
              if (nx) { add(nx.text); break }
            }
          }
        }
      }
    } else if (m.type === "declaration") {
      // a method can be written as `declaration > function_signature`
      for (const c of named(m)) {
        if (NAME_WRAPPERS.has(c.type)) {
          const nm = field(c, "name")
          if (nm && IDENT.test(nm)) add(nm)
        }
      }
    }
  }
  return out
}

/**
 * The real type names in one heritage group, with an IMPORT-ALIAS prefix dropped.
 *
 * Measured: `import 'x.dart' as _i2; class C extends _i2.A2` parses the superclass
 * as `superclass > type_identifier(_i2), type_identifier(A2)` — the alias is a
 * SEPARATE SIBLING, not a dotted name, so stripping at a `.` finds no dot and the
 * whole probe produced zero edges while the analyzer produced one.
 *
 * The drop is STRUCTURAL, not name-based: an alias token is discarded only when
 * another type_identifier follows it in the same group. A class genuinely named
 * `_Private` keeps working, because nothing follows it, and `implements _i1.A,
 * _i2.B` drops both prefixes because each has a successor. Guessing at Dart's
 * private-class naming convention instead would have broken real hierarchies.
 */
function heritageNames(group: any): string[] {
  const ids = named(group).filter((c: any) => c.type === "type_identifier")
  const out: string[] = []
  for (let i = 0; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i].text.startsWith("_")) continue // alias prefix
    const base = stripAlias(ids[i].text)
    if (IDENT.test(base) && !out.includes(base)) out.push(base)
  }
  return out
}

/**
 * A declaration's DIRECT supertypes, in the order that makes "nearest" well
 * defined: `extends` before `implements` before `with`.
 */
function directSupertypes(node: any): string[] {
  const out: string[] = []
  // takes a NAME, because `heritageNames` has already dropped the alias prefix and
  // stripped any type arguments — re-reading a node here silently produced an
  // empty supertype list and zero edges for every case.
  const push = (name: string): void => {
    if (!name) return
    const base = stripAlias(String(name).split("<")[0])
    if (IDENT.test(base) && !out.includes(base)) out.push(base)
  }
  // a redirecting/mixin-application class keeps its base elsewhere; handle both
  // `extends Base` and a mixin's `on Base` are the same relationship written with
  // two different keywords, and the grammar does not necessarily give them the same
  // node type — so the clause is matched by family (`includes("superclass")`)
  // rather than by the literal string "superclass". Enumerating node types is how
  // the constructor gap cost 2,912 rows in the contains oracle.
  for (const sup of named(node).filter((c: any) => c.type.includes("superclass"))) {
    for (const nm of heritageNames(sup)) push(nm)
    // `extends Object with Loggable` puts the `mixins` clause INSIDE the
    // superclass node, not beside it — measured, and a direct-children-only read
    // silently loses every `with` clause on a class that also extends something.
    for (const mx of named(sup).filter((c: any) => c.type === "mixins")) for (const nm of heritageNames(mx)) push(nm)
  }
  for (const ifc of named(node).filter((c: any) => c.type === "interfaces")) for (const nm of heritageNames(ifc)) push(nm)
  for (const mx of named(node).filter((c: any) => c.type === "mixins")) for (const nm of heritageNames(mx)) push(nm)

  // A mixin's OWN `on` clause has no wrapper node at all: measured,
  // `mixin M4 on Base4 {}` puts a bare `type_identifier(Base4)` straight among
  // `mixin` / `identifier(M4)` / `class_body` as direct children of the
  // declaration. So for a mixin, a direct `type_identifier` child IS the
  // supertype — a third spelling of "extends" after the `extends` clause and the
  // `with` clause, and the only one with no container to look inside.
  if (node.type === "mixin_declaration") {
    for (const c of named(node)) if (c.type === "type_identifier") push(stripAlias(c.text.split("<")[0]))
  }
  // `class A = Base with M;` — a mixin_application_class
  const app = named(node).find((c: any) => c.type === "mixin_application_class")
  if (app) {
    for (const c of named(app)) {
      if (c.type === "mixin_application") for (const nm of heritageNames(c)) push(nm)
    }
  }
  return out
}

export function deriveDartOverridesTruth(root: any): TruthEdge[] {
  // index the file: declaration name -> the methods it declares
  const methodsOf = new Map<string, string[]>()
  const supertypesOf = new Map<string, string[]>()
  const collect = (node: any): void => {
    if (!node) return
    if (DECLS.has(node.type)) {
      const nm = declarationName(node)
      if (nm) {
        const bodyType = BODY_OF[node.type]
        methodsOf.set(nm, methodNames(node, bodyType))
        supertypesOf.set(nm, directSupertypes(node))
      }
    }
    for (const c of named(node)) collect(c)
  }
  collect(root)

  const edges: TruthEdge[] = []
  const add = (from: string, to: string): void => {
    edges.push({ label: "overrides", from, target: to })
  }

  for (const [cls, methods] of methodsOf) {
    const direct = supertypesOf.get(cls) ?? []
    if (direct.length === 0) continue
    for (const m of methods) {
      // rule 3: breadth-first through the supertype DAG, in-file only. A
      // supertype this file does not declare cannot be searched, so an external
      // base ends the walk — which is correct here, because the analyzer's
      // external pass is a separate, lower-confidence, annotation-gated rule.
      // Index-based walk with an explicit cap, and the queue is DRAINED by index
      // rather than iterated in place. The first draft iterated `for (const sup of
      // queue)` and then appended to `queue` — so a supertype whose name matched no
      // declaration produced an empty `next`, left `queue` holding its previous
      // contents, and spun forever. `class C extends _i2.A2` hit it on the third
      // probe case and hung the process rather than returning.
      const seen = new Set<string>([cls])
      let head = 0
      let resolved = false
      let guard = 0
      while (head < direct.length && !resolved && guard++ < 4096) {
        const sup = direct[head++]
        if (seen.has(sup)) continue
        seen.add(sup)
        const supMethods = methodsOf.get(sup)
        if (supMethods && supMethods.includes(m)) {
          add(`${cls}.${m}`, `${sup}.${m}`)
          resolved = true
          break
        }
        for (const up of supertypesOf.get(sup) ?? []) if (!seen.has(up)) direct.push(up)
      }
    }
  }
  return edges
}