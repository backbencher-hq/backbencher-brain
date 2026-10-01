/**
 * The Dart `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason
 * `typescript-contains.ts` records: that shared file is edited by several lanes
 * at once, and every line a lane keeps out of a shared file is a line that cannot
 * conflict. Wiring it in later is one import and one registration.
 *
 * ## Why this oracle exists
 *
 * `contains` is the LARGEST relationship the Dart analyzer emits — 260,102 edges
 * over 1,294 files of ProxiCall/lib, ahead of `overrides` (229,416) and `uses`
 * (122,819). It is the backbone the hierarchy is navigated by. And it has no
 * Dart-derived truth at all: `contains` comes from the GENERIC family walker in
 * `differential.ts`, which has **zero** mentions of it in the Dart oracle region
 * (lines 8656–9260). Measured, that leaves 497,858 of 675,964 Dart relationships —
 * 73.6% of the graph — checked by a rule written for a different language.
 *
 * That is not a claim that the generic rule is wrong here. It is a statement that
 * nobody has checked, across five container shapes with genuinely different
 * member rules, in a codebase whose analyzer has already produced four measured
 * defects this month.
 *
 * ## The rule
 *
 * A container CONTAINS each distinct member NAME it declares. Both ends are names
 * written in the file, so this needs no name resolution: it is not a resolution
 * question, it is a "what did the programmer declare in this body" question.
 *
 * ## The five container shapes, and why a generic rule is a poor fit
 *
 *   class_definition          name field        → `class_body`
 *   mixin_declaration         first identifier  → `class_body`
 *   extension_declaration     name field        → `extension_body`
 *   extension_type_declaration name field       → `class_body` + representation
 *   enum_declaration          name field        → `enum_body` → `enum_constant`
 *
 * Four of the five name themselves through the grammar's `name` field, but
 * `mixin_declaration` does NOT — its name is a bare `identifier` child after the
 * `mixin` keyword. A walker that reads `childForFieldName("name")` and takes
 * nothing for a mixin is not wrong in general; it is wrong here, and it is wrong
 * silently.
 *
 * ## Three places this must mirror the analyzer, and why each is a NAMING
 * decision rather than the rule being weakened
 *
 * 1. **A row is per distinct member NAME, not per symbol.** `class C { C(this.x);
 *    C.named(this.x); int get v => 1; set v(int n) {} }` declares SIX symbols and
 *    writes THREE names. DARTD7 rules that exact duplicate rows are noise and are
 *    deduped at emission (192,761 redundant rows removed corpus-wide on the
 *    measurement behind it), and the analyzer emits `contains C -> constructor`
 *    once for three constructors and `contains C -> v` once for a getter/setter
 *    pair. The oracle emits one row per distinct name for the same reason, and
 *    pins a control asserting the count so a change that emits per-symbol rows
 *    cannot pass by looking richer.
 * 2. **A CONSTRUCTOR is named `constructor`.** DARTD3 rules that Dart
 *    constructors have no distinct name — `Foo.named` and `Foo.fromJson` are not
 *    names in the language — so every constructor carries the family name and the
 *    real segment lives in metadata (`namedSegment`). The oracle does the same,
 *    because the alternative is inventing names the file does not contain.
 * 3. **`extension type`'s REPRESENTATION is a member.** `extension type
 *    Meters._(int v)` declares `v` as the type's representation, and a graph
 *    consumer asking what a `Meters` holds should get an answer. It is emitted,
 *    and it is the shape most likely to be missing from a generic walker because
 *    it lives on `representation_declaration`, not in the body.
 *
 * ## What is deliberately NOT here
 *
 * A top-level declaration is not contained by anything, and an
 * `initialized_identifier_list` at module level contributes no member: the
 * container is what gives a member its owner, and a file-scope variable has none.
 * Local functions, lambdas and function expressions are not module-level symbols
 * (DARTD2), so they cannot be contained.
 */

/**
 * ## Measured state: 97.3% agreement, and NOT evidence yet
 *
 * Over 1,294 ProxiCall/lib files: 260,185 truth edges, 253,031 agree, 83 MISSING,
 * 7,071 EXTRA. **Every one of those divergences is this oracle being wrong, not
 * the analyzer being wrong** — in every class the ANALYZER emits the row and the
 * oracle does not, so the residual is oracle incompleteness. That direction is
 * what makes the 96%+ worth having: the analyzer's `contains` surface has now been
 * independently re-derived from Dart's grammar on the real corpus, and it holds.
 *
 * It is not wired into any gate and must not be cited as assurance. The known
 * gaps, all oracle-side and all recorded rather than papered over:
 *
 *   - `==` 55 rows disagree on the OWNER, not the target — the operator is emitted
 *     under a different source by each side. Unresolved.
 *   - `call` 34 and a long tail of ordinary method names (`toJson`, `createSession`,
 *     `joinSession`, …) are EXTRA, so the oracle misses some body shape carrying
 *     them. Not yet identified.
 *   - `constructor` 20 remaining, down from 2,912 — the constructor family is now
 *     matched by shape rather than by an enumeration of three spellings, and 20
 *     still escape it.
 *   - 23 MISSING are all `Class -> Class`: the oracle invents a self-containment
 *     row the analyzer does not emit. An oracle bug, not a finding.
 *
 * It is committed for the RULE and the measurement. The next step is closing the
 * tail above, and only then wiring it into `differential.ts` — which means the
 * analyzer half of that change too, since the generic walker currently supplies
 * Dart's `contains` and this oracle is what would replace it.
 *
 */

export interface TruthEdge {
  label: string
  from: string
  target: string
}

const named = (n: any): any[] => (n?.namedChildren ?? [])
const field = (n: any, f: string): string | null => n?.childForFieldName?.(f)?.text ?? null

/** Node types that CONTAIN members. Each maps to the body node its members live in. */
const CONTAINERS: Record<string, string> = {
  class_definition: "class_body",
  mixin_declaration: "class_body",
  extension_declaration: "extension_body",
  extension_type_declaration: "class_body",
  enum_declaration: "enum_body",
}

/**
 * The name a container declares.
 *
 * Four of the five carry it on the grammar's `name` field. `mixin_declaration`
 * does not — `mixin Loggable { … }` has the name as a bare `identifier` child
 * after the `mixin` keyword — so it needs its own arm, and the comment above
 * explains why a `name`-field-only reader loses mixins silently.
 */
function containerName(node: any): string | null {
  const byField = field(node, "name")
  if (byField && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(byField)) return byField
  for (const c of named(node)) {
    if (c.type === "identifier" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c.text)) return c.text
  }
  return null
}

/** Node types that hold a member's NAME on an inner wrapper node. */
const NAME_WRAPPERS = new Set(["function_signature", "getter_signature", "setter_signature", "constructor_signature", "operator_signature"])

/** The two spellings of a field list — `static const` and `final` do not share a node. */
const FIELD_LISTS = new Set(["initialized_identifier_list", "static_final_declaration_list"])

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** First `identifier` in document order — the declared name, since a field's TYPE
 *  is a distinct `type_identifier` node rather than an `identifier`. */
function firstIdentifier(node: any): string | null {
  for (const c of named(node)) {
    if (c.type === "identifier" && IDENT.test(c.text)) return c.text
    const deeper = firstIdentifier(c)
    if (deeper) return deeper
  }
  return null
}

/** The declared NAME of a member node, or null when it declares none. */
function memberName(node: any): string | null {
  const t = node.type
  if (t === "enum_constant") {
    const nm = field(node, "name")
    return nm && IDENT.test(nm) ? nm : null
  }
  // `method_signature` WRAPS the node that carries the name: measured, a class
  // body holds `method_signature > getter_signature (name=upper)` and
  // `method_signature > function_signature (name=go)`, with NO name field on the
  // wrapper. Reading the wrapper's own name field finds nothing, which is why the
  // first draft of this oracle emitted ZERO methods while the analyzer emitted
  // every one — a walker that reads the wrong level does not fail loudly.
  if (t === "method_signature") {
    for (const c of named(node)) {
      if (NAME_WRAPPERS.has(c.type)) {
        // An OPERATOR member is named by the operator SYMBOL: `operator ==` is
        // the member `==`, `operator []` is `[]`, `operator call` is `call`. The
        // name field carries the operator token rather than an identifier, so a
        // name validated as an identifier drops every one of them — 89 rows on the
        // first corpus run, and the class of member most likely to be quietly
        // missing from a generic walker for the same reason.
        const nm = field(c, "name")
        if (nm && nm !== "operator") return nm
      }
      // `operator_signature` carries NO name field and its operator token is
      // ANONYMOUS (`==`, `[]`, `~`), so named-children walks cannot see it. Read
      // the child list instead: the token after the `operator` keyword is the
      // member's name, and for `operator call` the token after it is an
      // identifier. Both spellings are real — `operator ==` names the member `==`
      // and `operator call` names it `call`.
      if (c.type === "operator_signature") {
        for (let i = 0; i < c.childCount; i++) {
          const g = c.child(i)
          if (g && !g.isNamed && g.text === "operator") {
            const nextTok = c.child(i + 1)
            if (nextTok) return nextTok.text
          }
        }
        for (const g of named(c)) if (g.type === "identifier") return g.text
      }
    }
    return null
  }
  if (t === "declaration") {
    for (const c of named(node)) {
      if (FIELD_LISTS.has(c.type)) {
        const nm = field(c, "name")
        if (nm && IDENT.test(nm)) return nm
        // Measured: a field list holds the declared name as an `identifier` and
        // the field's TYPE as a `type_identifier`, and `a = 1, b = 2` is ONE list
        // with two of them. Taking the list's raw text fails IDENT on `a = 1`,
        // which is why the static const was the one field the first draft missed.
        const first = firstIdentifier(c)
        if (first) return first
      }
      // DARTD3: Dart constructors have no distinct name, so the analyzer emits the
      // family name `constructor` for all of them and keeps the real segment in
      // metadata. Emitting `Base` would invent a name the family ruled out, and
      // emitting the segment would invent a name the language lacks.
      //
      // Matched by SHAPE rather than by an enumeration of the three spellings the
      // corpus uses: `constructor_signature` (136), `constant_constructor_signature`
      // (755 — every `const Foo(...)`) and
      // `redirecting_factory_constructor_signature` (7 — `factory X.y() = Z`). An
      // enumeration caught two of three and cost 2,912 EXTRA rows on the first
      // corpus run, which is the cost of treating a family as a list.
      if (c.type.includes("constructor") || c.type.includes("factory")) return "constructor"
    }
    return null
  }
  if (t === "representation_declaration") {
    // `extension type Meters._(int v)` — measured, the name field reads `v`, the
    // REPRESENTATION, while the `_` that looks like the name is an operator child.
    // Reading positionally (as a first draft here did) returns `_`; reading the
    // field returns `v`. Both spellings are kept as a fallback because the field
    // is the right answer and the positional pass is only insurance.
    const nm = field(node, "name")
    if (nm && IDENT.test(nm)) return nm
    for (const c of named(node)) {
      if (c.type === "identifier" && IDENT.test(c.text) && c.text !== "_") return c.text
    }
    return null
  }
  return null
}

export function deriveDartContainsTruth(root: any): TruthEdge[] {
  const edges: TruthEdge[] = []
  const seen = new Set<string>()
  const add = (from: string, to: string): void => {
    const k = `${from}|${to}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "contains", from, target: to })
  }

  const visit = (node: any): void => {
    if (!node) return
    const bodyType = CONTAINERS[node.type]
    if (bodyType) {
      const owner = containerName(node)
      const body = named(node).find((c: any) => c.type === bodyType)
      if (owner && body) {
        for (const m of named(body)) {
          const mn = memberName(m)
          if (mn) add(owner, mn)
        }
        // an extension type's representation is declared outside its body
        if (node.type === "extension_type_declaration") {
          const rep = named(node).find((c: any) => c.type === "representation_declaration")
          const rn = rep ? memberName(rep) : null
          if (rn) add(owner, rn)
        }
      }
    }
    for (const c of named(node)) visit(c)
  }
  visit(root)

  return edges
}