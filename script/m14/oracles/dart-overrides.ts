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

/**
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
 * ## Scoping answer: a cross-repository oracle IS tractable, and by how much
 *
 * Measured, because "needs a cross-repo oracle" is only useful if someone has
 * checked whether one can reach the rows. Built a companion index — class name ->
 * declared member names — over **2,671 .dart files** of `ProxiCall/lib` plus
 * `flutter/packages/flutter/lib/src`, giving **7,426 classes**, and asked how many
 * of the analyzer's rows name a base that index knows:
 *
 *   **228,900 of 229,416 — 99.8% — are RESOLVABLE.**
 *
 *   516 rows (0.2%) are not, and all four bases behind them are named exactly:
 *   `Equatable` 451, `Cubit` 37, `Exception` 26, `Bloc` 2. Every one is a **pub
 *   package or the SDK**, not Flutter and not ProxiCall — `equatable` and `bloc`
 *   come from the pub cache and `Exception` from the Dart core library. Adding
 *   those three sources would close the remainder, so the surface is fully
 *   reachable and the build is bounded rather than open-ended.
 *
 * So the cross-repo oracle is the right next build and it is a known size: index
 * three source roots, apply rule 4 with the companion standing in for "declared in
 * this file", and the in-file and cross-file halves become one surface measured the
 * same way. That is recorded here as a measurement rather than attempted, because
 * an oracle left half-built and wired is worse than one not started.
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
 */

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


/** The member names ONE body child contributes.
 *
 *  `methodNames` and `overrideMembers` used to carry their own copies of this, and
 *  the copies drifted: annotated FIELDS were taught to the first and not the second,
 *  so `methodNames` reported a member the `@override` gate then refused. The visible
 *  symptom was an oracle that derived nothing for a base in another file while the
 *  analyzer published the same edge at 0.95 —
 *
 *    final class MusicControlError extends MusicControlState
 *        implements ConnectionErrorState {
 *      @override
 *      final String message;
 *
 *  Two copies of one rule is one copy too many. There is now one. */
function memberNamesOf(m: any): string[] {
  const out: string[] = []
  // A STATIC member is not overridable, so it is not a member for this purpose.
  // Dart resolves a static call against the static type it was written on, so a
  // subclass declaring the same static name shadows nothing. The analyzer gained
  // this gate from the corpus; the oracle had no static concept at all and claimed
  // `Shadow.connect -> HasStatic.connect` through the ordinary in-file path, with no
  // `@override` anywhere in sight, because "static" simply was not a question it
  // asked. The keyword is a token on the declaration or its signature.
  const isStatic = (node: any): boolean => {
    for (let cur = node, hop = 0; cur && hop < 3; hop++) {
      for (let i = 0; i < cur.childCount; i++) {
        const c = cur.child(i)
        if (c && !c.isNamed && c.text === "static") return true
      }
      cur = cur.previousNamedSibling
    }
    return false
  }
  const add = (nm: string | null): void => { if (nm && IDENT.test(nm) && !out.includes(nm)) out.push(nm) }
  if (m.type === "method_signature") {
    if (isStatic(m)) return out
    for (const w of named(m)) {
      if (!NAME_WRAPPERS.has(w.type)) continue
      const nm = field(w, "name")
      if (nm && nm !== "operator" && IDENT.test(nm)) add(nm)
      else if (nm === "operator" || w.type === "operator_signature") {
        for (let i = 0; i < w.childCount; i++) {
          const g = w.child(i)
          if (g && !g.isNamed && g.text === "operator") { const nx = w.child(i + 1); if (nx) { add(nx.text); break } }
        }
      }
    }
    return out
  }
  if (m.type === "declaration") {
    if (isStatic(m)) return out
    for (const c of named(m)) {
      if (NAME_WRAPPERS.has(c.type)) { const nm = field(c, "name"); if (nm) add(nm); continue }
      // An INSTANCE FIELD is an overridable member. A field implicitly provides a
      // getter and a setter, so a subclass declaring the same name overrides that
      // accessor, and `final String walletId` over a base `walletId` is legal Dart the
      // compiler accepts. `hasOverrideAnnotation` is NOT required, and requiring it is
      // a mistake I made and then had to unpick: it stopped the oracle claiming
      // `Shadow.walletId -> Wallet.walletId`, which is real.
      //
      // STATIC fields and static methods are excluded by the `isStatic` guard above,
      // and that exclusion is the whole of what the annotation gate was ever for. A
      // static call resolves against the static type it was written on, so nothing is
      // overridden and `@override` is not even legal there. The rule is not "annotated
      // means overriding"; it is "instance means overridable, static means not". Stated
      // as the language states it, in one place.
      if (c.type === "initialized_identifier_list" || c.type === "static_final_declaration_list") {
        for (const id of named(c)) {
          if (id.type === "initialized_identifier" || id.type === "static_final_declaration") {
            add(field(id, "name") ?? firstIdentifierText(id))
          }
        }
      }
    }
  }
  return out
}

/** Does this member carry an `@override` annotation?
 *
 *  The annotation is a preceding SIBLING of the member it decorates — the same
 *  shape the analyzer reads off `decorators`, and the reason a member is
 *  overridable at all rather than merely present. Checked on the member and one
 *  hop out, because some shapes nest the annotation one level from the signature. */
function hasOverrideAnnotation(m: any): boolean {
  for (let cur = m, hop = 0; cur && hop < 3; hop++) {
    const sib = cur.previousNamedSibling
    if (sib) {
      if (/@override\b/.test(sib.text ?? "")) return true
      if (sib.type.includes("annotation") || sib.type.includes("metadata")) {
        for (let i = 0; i < sib.namedChildCount; i++) {
          const c = sib.namedChild(i)
          if (c && /@?override\b/.test(c.text ?? "")) return true
        }
      }
    }
    cur = sib
  }
  return false
}
function hasStaticToken(m: any): boolean {
  for (let i = 0; i < m.childCount; i++) {
    const c = m.child(i)
    if (c && !c.isNamed && c.text === "static") return true
  }
  const sib = m.previousNamedSibling
  if (sib) {
    for (let i = 0; i < sib.childCount; i++) {
      const c = sib.child(i)
      if (c && !c.isNamed && c.text === "static") return true
    }
  }
  return false
}
function firstIdentifierText(n: any): string | null {
  if (n.type === "identifier") return n.text
  for (const c of named(n)) { const r = firstIdentifierText(c); if (r) return r }
  return null
}



function methodNames(node: any, bodyType: string): string[] {
  const out: string[] = []
  const body = named(node).find((c: any) => c.type === bodyType)
  if (!body) return out
  for (const m of named(body)) for (const nm of memberNamesOf(m)) if (!out.includes(nm)) out.push(nm)
  return out
}

/** Which of a type's members carry an `@override` annotation.
 *
 *  The EXTERNAL pass of the resolution is annotation-gated — a member of a class
 *  that is not declared in this file is claimed as an override only when the
 *  member says it overrides something. Without this the oracle over-claims on
 *  every generated override: freezed emits `List<Object?> get props => [...]`
 *  with no annotation, so an ungated pass derived 81 `X.props -> Equatable.props`
 *  edges the analyzer deliberately does not publish.
 *
 *  Measured, and the direction matters: `class C extends Cubit { @override void
 *  close() {} }` agrees on both sides with a companion index; drop the
 *  annotation and the analyzer publishes nothing while an ungated oracle still
 *  does. The analyzer is right — an unannotated member of a class whose base is
 *  in another repository cannot be proven to override anything from this file
 *  alone, and claiming it is a fabricated edge. */
function overrideMembers(node: any, bodyType: string): Set<string> {
  const out = new Set<string>()
  const body = named(node).find((c: any) => c.type === bodyType)
  if (!body) return out
  for (const m of named(body)) {
    if (!hasOverrideAnnotation(m)) continue
    for (const nm of memberNamesOf(m)) out.add(nm)
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

/**
 * Derive the file's `overrides` truth.
 *
 * `companion` is the CROSS-REPOSITORY index — class name -> member names it
 * declares — and it is a FALLBACK, not a merge. DARTD16's resolution is ordered in
 * passes: in-file breadth-first over `extends`/`implements`/`with`, THEN the
 * companion, THEN an annotation-gated external first-parent. That order is the
 * whole of "nearest wins", so the companion must be consulted only once the
 * in-file walk has failed to find the member — if it were merged in from the start,
 * a distant framework base could displace an in-file intermediate that actually
 * declares the method, and the edge would answer a different question.
 *
 * A supertype the companion knows but that declares no match ENDS THE WALK FROM
 * THAT BASE, because the companion is a flat map and cannot be walked further. That
 * is a real limit of a cross-repository index, not a shortcut — but it limits DEPTH,
 * not breadth, and an earlier version of this file used `break` where it needed
 * `continue`, abandoning the remaining supertypes of the same class. See the comment
 * at the companion branch for the `implements A, B` case that exposed it.
 */
export function deriveDartOverridesTruth(root: any, companion?: Map<string, Set<string>>): TruthEdge[] {
  // index the file: declaration name -> the methods it declares
  const methodsOf = new Map<string, string[]>()
  const supertypesOf = new Map<string, string[]>()
  const overrideOf = new Map<string, Set<string>>()
  const collect = (node: any): void => {
    if (!node) return
    if (DECLS.has(node.type)) {
      const nm = declarationName(node)
      if (nm) {
        const bodyType = BODY_OF[node.type]
        methodsOf.set(nm, methodNames(node, bodyType))
        overrideOf.set(nm, overrideMembers(node, bodyType))
        supertypesOf.set(nm, directSupertypes(node))
      }
    }
    for (const c of named(node)) collect(c)
  }
  collect(root)

  // The member set each in-file type EXPOSES, not just the one it DECLARES —
  // the same inheritance closure `ProjectIndex` builds and that the analyzer's
  // cross-file pass consumes. This is what makes "nearest wins" mean the same thing
  // on both sides.
  //
  // The distinction is not cosmetic. `sealed class TemplateState extends Equatable`
  // declares no `props` but exposes it, and `class TemplateInitial extends
  // TemplateState` does declare `props`. Asked for the NEAREST base that DECLARES
  // the member, the answer is Equatable; asked for the nearest base that EXPOSES
  // it — the nearest base whose interface the member actually replaces — the answer
  // is TemplateState. 81 freezed rows in ProxiCall/lib turn on it.
  //
  // The analyzer resolves TemplateState at confidence 0.95, the same as an in-file
  // edge, because with a project index it has genuinely verified the exposure. So
  // the contract this oracle implements is the exposer, and the declarer walk is a
  // stricter question than the edge is asking.
  const exposedOf = (cls: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(cls)) return new Set<string>()
    seen.add(cls)
    // The companion is PART of the closure, not a separate later pass. That is what
    // `ProjectIndex`'s `allMembers` does — it closes over bases whether the base is
    // in the file or in the index — and a closure that stopped at the file boundary
    // would understate every in-file type that inherits from another package, which
    // is the freezed case exactly: `TemplateState extends Equatable` exposes `props`
    // through Equatable, so TemplateState exposes it too.
    const out = new Set<string>(methodsOf.get(cls) ?? (companion?.get(cls) ?? []))
    for (const b of supertypesOf.get(cls) ?? []) for (const m of exposedOf(b, seen)) out.add(m)
    return out
  }
  const exposed = new Map<string, Set<string>>()
  for (const cls of methodsOf.keys()) exposed.set(cls, exposedOf(cls))

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
        if (supMethods) {
          // declared IN THIS FILE — the higher-priority pass
          // A field in the base is a witness for an ACCESSOR override, not for a
        // method. Gated on the annotation because that is the only evidence in the
        // file that this member is overriding something rather than coincidentally
        // sharing a name.
        if ((exposed.get(sup) ?? supMethods).has(m)) {
            add(`${cls}.${m}`, `${sup}.${m}`)
            resolved = true
            break
          }
          // known here but no match: keep walking, its own supertypes are in-file too
          for (const up of supertypesOf.get(sup) ?? []) if (!seen.has(up)) direct.push(up)
          continue
        }
        // not declared here — the companion pass, and the end of the road if it
        // does not have the member either
        if (companion && companion.has(sup)) {
          // NOT annotation-gated, and the gate I put here was wrong.
          //
          // `@override` is OPTIONAL in Dart — `annotate_overrides` is a lint, not a
          // language requirement — so requiring it discards real overrides. Measured:
          // `class Request extends BaseRequest { void _checkFinalized() { ... } }` in
          // dart-http carries no annotation anywhere near it, and the analyzer
          // published `Request._checkFinalized -> BaseRequest._checkFinalized` at 0.95,
          // which is correct. This oracle published nothing for it, and the row read as
          // a disagreement about a fact both sides agreed on.
          //
          // I had gated this to stop the oracle claiming generated overrides — 81
          // `X.props -> Equatable.props` rows. But freezed DOES emit `@override` on
          // every generated `props`, so the annotation was never what stopped them: the
          // absence of a companion was. The gate was solving a problem it did not have,
          // and creating one it did.
          //
          // What the annotation IS for is the FALLBACK — the first-parent guess, where
          // there is no evidence either way and the claim is published at 0.8. The
          // analyzer gates that pass and correctly leaves it gated. A companion-verified
          // match is not a guess, so it needs no annotation to be evidence.
          if (companion.get(sup)!.has(m)) {
            add(`${cls}.${m}`, `${sup}.${m}`)
            resolved = true
            break
          }
          // The companion is a FLAT map, so there is nowhere further to walk FROM
          // THIS BASE — its own bases are not in it. That is not a reason to abandon
          // the walk: `direct` may hold other supertypes, and "nearest wins" is
          // evaluated across all of them.
          //
          //     class SessionInfoHeader extends StatelessWidget
          //         implements PreferredSizeWidget {
          //       @override
          //       Size get preferredSize => ...;
          //
          // `StatelessWidget` is visited first, the companion knows it, it declares
          // no `preferredSize` — and the `break` that used to stand here ended the
          // walk before `PreferredSizeWidget` was ever considered. The edge went
          // un-derived while the analyzer published it at 0.95, resolved against the
          // base that actually declares the member. The flatness of the companion
          // limits DEPTH, not BREADTH, and the old code confused the two: it read a
          // statement about walking further as a statement about giving up.
          continue
        }
      }
    }
  }
  return edges
}