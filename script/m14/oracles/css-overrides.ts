/**
 * The CSS `overrides` oracle — LANE-OWNED, and the lane's one DERIVATION finding.
 *
 * Beside this file rather than in `differential.ts`, for the reason that file's own
 * header records: the shared file is edited by several lanes at once, and every line a
 * lane keeps out of it is a line that cannot conflict. The same reasoning is why
 * `css-ruled.ts` lives beside the gate rather than inside it.
 *
 * ## Why this oracle exists
 *
 * `overrides` is EMITTED by `src/ast/real-css-analyzer.ts` and derived by NOTHING.
 * `deriveCssEdges` (`script/m14/differential.ts`) walks the tree and pushes exactly four
 * labels — `contains`, `uses`, `references`, `imports` — and the css comparison
 * allowlist is those same four. So the type was stored and compared against no truth at
 * all, which is what a DERIVATION finding is: the differential's silence about a label is
 * indistinguishable from agreement about it.
 *
 * That is not a hypothetical risk for CSS. The type's own corpus population is 97.3%
 * one shape — a vendor-prefixed pair, `@-webkit-keyframes fa-spin` beside `@keyframes
 * fa-spin` — and emitting `overrides` for those would fabricate a replacement CSS does
 * not perform, on both endpoints that are REAL symbols. Nothing else in the lane's
 * evidence can catch that class: the edges resolve, the labels are in the ontology, and
 * a consumer reading `bb_impact` on a keyframes name is told something false.
 *
 * ## THE WIRING THIS FILE NEEDS, and it is the supervisor's
 *
 * Four changes, all outside this lane (ONTOLOGY-WORKSTREAM.md §Ownership):
 *
 *   1. `script/m14/differential.ts` — `import { deriveCssOverridesTruth } from
 *      "./oracles/css-overrides"` beside the other oracle imports.
 *   2. `script/m14/differential.ts:22172`, the `if (lang === "css")` branch — after the
 *      `deriveCssEdges` loop, a second loop over `deriveCssOverridesTruth(root, cssModule)`
 *      pushing the same `{ label, from, target }` shape.
 *   3. `script/m14/differential.ts:23373` — add `"overrides"` to
 *      `...(lang === "css" ? [...] : [])`. NOT OPTIONAL, and the trap is recorded in that
 *      file's own comments as having happened twice: the allowlist filters the ANALYZER
 *      side, so a label the oracle derives and the allowlist omits is not merely dropped,
 *      it is read as a MISSING truth row.
 *   4. The comparison must be MULTIPLICITY-AWARE for this label. `source === target` by
 *      construction — the lane publishes one symbol per name, so a supersession is a
 *      self-edge — which means `(label, from, target)` does not discriminate a file with
 *      one redefinition from a file with three. This file therefore returns ONE ROW PER
 *      SUPERSESSION and carries `supersedesLine` on each, so a set-based comparison
 *      degrades to "is the name right" and a multiset comparison can check the payload.
 *
 * `validation/m14/census/css-overrides-differential.ts` applies the wiring to a COPY of
 * the differential the way `ruled-gate.ts` applies the gate's, and reports agreement,
 * MISSING and extra over the whole admitted corpus — so the numbers below are measured
 * rather than projected.
 *
 * ## THE RULE, in three parts, and why each part is a decision
 *
 * An `overrides` edge asserts that a LATER DECLARATION REPLACES an EARLIER one of the
 * same name. Everything hard about CSS's version is in the boundary.
 *
 * 1. **`@keyframes` — the at-keyword is the discriminator.**
 *    CSS Animations L1 §3: "the last @keyframes rule with a given name wins", so a
 *    second `@keyframes fade` replaces the first and the first block is dead. A
 *    DIFFERENT at-keyword is a different animation: `@-webkit-keyframes fade` beside
 *    `@keyframes fade` declares two animations and the user agent picks one. Measured
 *    over the corpus: 142 of the 146 same-name second declarations are a prefixed pair,
 *    so this one clause is 97.3% of the type's correctness, and it is the clause a
 *    naive implementation drops.
 *    The "live" declaration is the LAST one read, so a THIRD declaration supersedes the
 *    second rather than the first.
 *
 * 2. **`@property` — a re-REGISTRATION.** Properties & Values API §2.1: "the last such
 *    one in document order is the registration." Same shape, different spec, and 0
 *    occurrences over the corpus, which is a fact about the corpus and not about the
 *    construct.
 *
 * 3. **`--custom-property` inside ONE declaration block, at EQUAL importance.**
 *    Cascade 5 §6.1, "The last declaration in document order wins", applies only when
 *    nothing else separates the two — and inside one `rule_set` / `keyframe_block` nothing
 *    does: the pair shares origin, context, layer, specificity and importance, so
 *    position is the only separator. Two guards follow, and both are the expensive
 *    direction:
 *
 *    - **THE BLOCK IS THE UNIT.** `:root { --x: 1 }` then `.dark { --x: 2 }` assigns
 *      `--x` twice in one file and is NOT an override: the two apply to different
 *      elements and the cascade picks per element. Cross-block pairs must not be emitted.
 *      The corpus's cross-block population is far larger than its same-block one, so an
 *      oracle that ignored the boundary would "agree" with a fabricated analyzer on
 *      thousands of edges.
 *    - **EQUAL IMPORTANCE.** `--x: 1px !important; --x: 2px` does not redefine: Cascade
 *      5 §6.1 sorts importance ABOVE document order, so the later declaration LOSES and
 *      the edge would point the wrong way. Measured over the corpus: every occurrence is
 *      an equal-importance pair, so this guard costs nothing there — which is exactly why
 *      it is stated, since a guard that costs nothing is indistinguishable from one that
 *      was never needed.
 *
 * ## WHAT IS DELIBERATELY NOT DERIVED, and it is most of the corpus
 *
 * - **A repeated SELECTOR.** 11,452 repeated selector-text groups across 522 corpus
 *   files, and none of it is `overrides`. Two rules matching one selector apply to the
 *   same elements and the cascade resolves them PER PROPERTY: a later rule redeclaring
 *   `color` wins for `color` while both survive for everything else. That is a merge.
 * - **A second `@font-face`.** 36 same-family pairs across 15 files, also a merge: two
 *   `@font-face` blocks for one family contribute faces to one family.
 * - **A second `@layer` / `@container` / `@scope` / `@page` block.** 9 `@layer base`
 *   blocks in one file (`phoenix/installer/templates/phx_static/default.css` writes it
 *   four times) and 5 differently-parameterised `@container` blocks in
 *   `bulma/css/versions/bulma-no-helpers-prefixed.min.css`. All are merges, and the
 *   lane's `widenScopeSymbol` treats them as one node for the same reason.
 *
 * These are counted and reported by `css-ontology-probe.ts` so the decision is visible
 * rather than an omission.
 *
 * ## INDEPENDENCE, and its limit stated rather than assumed
 *
 * This file imports nothing from `src/ast/real-css-analyzer.ts` and shares no helper
 * with it. That is the whole of the independence available here, and its limit is the
 * harness's declared one: both are walkers over the SAME pinned
 * `wasm/tree-sitter-css.wasm`, so a grammar bug — an at-rule shape the grammar
 * mis-spans, a `;` the lexer attaches to the wrong parent — is invisible to this oracle
 * exactly as it is invisible to the analyzer. Two implementations of one rule is the
 * price of independence at this layer, and it is worth paying in a rule this small.
 */

/** One derived row. `from === target` for `overrides` by construction — see the header. */
export interface TruthEdge {
  label: string
  from: string
  target: string
  /** The line of the declaration this one KILLS. Present so a multiset comparison can
   *  check the payload and not only the name. */
  supersedesLine?: number
  /** The line of the superseding declaration. */
  line?: number
  /** Which of the three rules produced the row, so a disagreement is attributable. */
  rule?: "keyframes-redefinition" | "property-re-registration" | "custom-property-redefinition"
}

const named = (n: any): any[] => (n?.namedChildren ?? [])

function line1(n: any): number {
  return n.startPosition.row + 1
}

/** Strip one layer of matching quotes. */
function unquote(text: string): string {
  const t = text.trim()
  if (t.length >= 2) {
    const a = t.charAt(0)
    const b = t.charAt(t.length - 1)
    if ((a === '"' || a === "'") && a === b) return t.slice(1, -1)
  }
  return t
}

/**
 * The `at_keyword` of an at-rule, lowercased, or `""`.
 *
 * Read off the node rather than off the text. The gate's own header records a ruling
 * overturned by a text probe matching `class voice` inside a telnet IAC word list in a
 * string literal, and `@keyframes` is a word that appears in comments, in
 * `animation:` values and in vendor bundles' names.
 */
function atKeywordOf(n: any): string {
  const kw = named(n).find((c: any) => c.type === "at_keyword")
  return kw ? String(kw.text).trim().toLowerCase() : ""
}

/** The `;` child of a statement, or null. */
function terminator(n: any): any | null {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.text === ";") return c
  }
  return null
}

/**
 * The DECLARED NAME of a `@keyframes` / `@property` at-rule, or `""`.
 *
 * Taken as the text BETWEEN the `at_keyword` node and the `;` node, because the grammar
 * has both as children and a substring search would be strictly worse. The one thing
 * this must not do is normalise: the analyzer publishes the bare name (`fade`,
 * `--brand`) and a `--` name is namespaced so it cannot collide with a selector, while a
 * keyframes name is a bare identifier that could — which is why the analyzer keys
 * `@keyframes` declarations by name alone and `@property` registrations by name alone
 * too. Two spellings of one keyframes name (`fade` and `"fade"`) therefore must NOT be
 * folded together here either, or the oracle would derive a redefinition the analyzer
 * does not.
 */
function declaredNameOf(n: any): string {
  const kw = named(n).find((c: any) => c.type === "at_keyword")
  const semi = terminator(n)
  const start = kw ? kw.endIndex - n.startIndex : 0
  const end = semi ? semi.startIndex - n.startIndex : n.text.length
  if (end <= start) return ""
  return unquote(n.text.slice(start, end))
}

/** Is this `declaration` node carrying `!important`? */
function isImportant(decl: any): boolean {
  // Walk the declaration's own subtree. A `!important` token on ANOTHER declaration, or
  // in a comment inside this one, is not this declaration's importance — so the test is
  // scoped to the node rather than to the file or the line.
  const stack: any[] = [decl]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "comment") continue
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (!c.isNamed && c.text === "!important") return true
      stack.push(c)
    }
  }
  return false
}

/** The property name of a `declaration`, or `""`. */
function propertyOf(decl: any): string {
  const p = named(decl).find((c: any) => c.type === "property_name")
  return p ? String(p.text).trim() : ""
}

/**
 * Derive the file's `overrides` truth.
 *
 * `moduleName` is accepted for signature compatibility with `deriveCssEdges` and is
 * unused: no rule here needs the file's name, which is worth saying because an
 * unused parameter that LOOKS load-bearing is how an oracle quietly starts depending on
 * something the analyzer does not have.
 */
export function deriveCssOverridesTruth(root: any, _moduleName?: string): TruthEdge[] {
  const edges: TruthEdge[] = []
  const add = (name: string, laterLine: number, priorLine: number, rule: TruthEdge["rule"]): void => {
    edges.push({ label: "overrides", from: name, target: name, supersedesLine: priorLine, line: laterLine, rule })
  }

  // ---- rule 1: `@keyframes` ------------------------------------------------------
  // name -> { keyword, line } of the LIVE declaration. Last one read wins, so a third
  // declaration supersedes the second.
  const keyframeLive = new Map<string, { keyword: string; line: number }>()
  // ---- rule 2: `@property` --------------------------------------------------------
  // name -> line of the live registration.
  const propertyLive = new Map<string, number>()

  const visitTop = (n: any): void => {
    if (n.type === "keyframes_statement") {
      // The name node first, then the prelude: `@keyframes "fade"` carries a
      // `string_value` and `@keyframes fade` an `identifier`, and both are the same
      // declaration of the same animation name.
      const nameNode = named(n).find(
        (c: any) => c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value",
      )
      const name = nameNode ? unquote(String(nameNode.text)) : ""
      if (name.length > 0) {
        const keyword = atKeywordOf(n)
        const line = line1(n)
        const live = keyframeLive.get(name)
        if (live !== undefined && live.keyword === keyword) add(name, line, live.line, "keyframes-redefinition")
        // EITHER WAY the block just read becomes the live one.
        keyframeLive.set(name, { keyword, line })
      }
    }
    if (n.type === "at_rule") {
      const keyword = atKeywordOf(n)
      if (keyword === "@property") {
        const name = declaredNameOf(n)
        if (name.length > 0) {
          const line = line1(n)
          const prior = propertyLive.get(name)
          if (prior !== undefined) add(name, line, prior, "property-re-registration")
          propertyLive.set(name, line)
        }
      }
    }
    // ---- rule 3: `--custom-property` inside ONE declaration block -------------------
    // A `rule_set` and a `keyframe_block` are the two node types that ARE a declaration
    // list. A `@media` / `@supports` / `@layer` body is itself a `rule_set` and is
    // visited on its own, so nesting depth is irrelevant and the BLOCK identity is the
    // unit — which is the boundary the whole rule turns on.
    if (n.type === "rule_set" || n.type === "keyframe_block") {
      const seen = new Map<string, { line: number; important: boolean }>()
      const decls: any[] = []
      const collect = (x: any): void => {
        for (let i = 0; i < x.namedChildCount; i++) {
          const c = x.namedChild(i)
          if (!c) continue
          if (c.type === "declaration") decls.push(c)
          else if (c.type !== "comment") collect(c)
        }
      }
      collect(n)
      for (const d of decls) {
        const prop = propertyOf(d)
        if (!prop.startsWith("--")) continue
        const line = line1(d)
        const important = isImportant(d)
        const prior = seen.get(prop)
        if (prior !== undefined && prior.important === important) add(prop, line, prior.line, "custom-property-redefinition")
        seen.set(prop, { line, important })
      }
    }
    for (const c of named(n)) visitTop(c)
  }
  visitTop(root)
  return edges
}
