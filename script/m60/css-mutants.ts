/**
 * M14.0.F4 — the CSS mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit before
 * its wave, written generically off the result's own fields — never a name filter,
 * because a name filter silently stops matching the moment a fixture is renamed,
 * which is the failure mode that left `swift/drop-container-subscript-uses`
 * surviving. Each `description` names the `caughtBy` fixture, so a reader can see
 * which pin carries the class rather than having to trust that one exists.
 *
 * The lane had ZERO mutants when this set was written, and that is the finding
 * rather than a footnote. The CSS lane ran eleven gates green while carrying a
 * symbol identity collision in 36.6% of corpus files, a `font-family` that emitted
 * nothing for a declared `@font-face`, a `var()` read pointing at a name nothing
 * published, `@supports` scopes that attributed no rules, a complexity metric whose
 * distinguishing term could never fire, a 31x super-linear path, and a `@layer`
 * ordering form that published a name with no referent. A green suite that cannot
 * go red proves nothing about the thing it is green for.
 *
 * Two of these are the defects the CORPUS could never have found, which is why they
 * are here rather than left to the census. `@counter-style`, `@custom-media` and
 * `@font-feature-values` have zero occurrences in 533 corpus files across 13
 * repositories, so no corpus measurement could ever have found that all three
 * publish no symbol at all; and the line-carriage class is invisible to any gate
 * that counts symbols or edges rather than checking where they point.
 */

/** Strip a top-level field from every relationship — the M59/#855 line class. */
const dropRelField = (field: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

/** Strip a metadata key from every relationship — the evidence-tier class. */
const dropRelMeta = (key: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => ({
    ...x,
    metadata: Object.fromEntries(Object.entries(x.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

/** Strip a metadata key from every symbol. */
const dropSymMeta = (key: string) => (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => ({
    ...s,
    metadata: Object.fromEntries(Object.entries(s.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

/**
 * C0 REVERT — symbol IDENTITY collapses back to one node per syntactic occurrence.
 *
 * This is the lane's largest measured defect: 36.6% of corpus files published an
 * AMBIGUOUS symbol, the same selector repeated up to 12 times in one file, because
 * identity was the node's own range rather than `(kind, resolved name)`. A
 * `contains` edge then addressed one of N indistinguishable rows, so "what is inside
 * this rule" had no single answer. Measured across the wave: 27,321 duplicate
 * symbols removed, 0 remaining across 454 corpus files.
 *
 * The occurrence count is read from the SOURCE, because a result-derived count
 * cannot work: after the fix there are never two same-named symbols, so the first
 * version of this transform was a no-op and the mutant SURVIVED. A mutant that
 * cannot reconstruct the defect it names is worse than no mutant, because it
 * reports the class as covered.
 */
const collapseSymbolIdentity = (r: any, source?: string) => {
  // The count has to come from the SOURCE, not from the result. The first version
  // of this mutant duplicated each symbol up to the number of same-named symbols
  // ALREADY in the result — and after the fix that number is always 1, so the
  // transform was a no-op and the mutant SURVIVED. It could not reconstruct the
  // pre-fix state from post-fix data, which is precisely the case the `source`
  // parameter on `Mutant.transform` exists for.
  //
  // Counting the name's occurrences in the source text is a faithful
  // reconstruction: the pre-fix analyzer emitted one node per syntactic occurrence,
  // so a selector written N times produced N indistinguishable rows.
  const occurrences = (name: string): number => {
    if (!source) return 1
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // `.btn` must not match `.btn-group`, and `p` must not match `padding`: the
    // name is delimited on BOTH sides
    const m = source.match(new RegExp(`(^|[^\\w-])${esc}(?![\\w-])`, "g"))
    return m ? m.length : 1
  }
  const groups = new Map<string, any[]>()
  for (const s of r.symbols ?? []) {
    const k = `${s.kind} ${s.name}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }
  const out: any[] = []
  for (const members of groups.values()) {
    // Only SELECTOR-shaped names collided. The pre-fix identity was the node's own
    // range, so every rule re-published its selector; a `@layer` or a registration
    // was already deduplicated by name and is left alone.
    const name = String(members[0].name)
    const selectorish = /^[.#]?[A-Za-z][\w-]*$/.test(name)
    const copies = selectorish ? occurrences(name) : Math.max(1, members.length)
    for (let i = 0; i < copies; i++) out.push({ ...members[0] })
  }
  return { ...r, symbols: out }
}

/**
 * C1 REVERT — a `@property` registration publishes its keyword with the name.
 *
 * `var(--brand)` emits `references body -> --brand`, so the only symbol for
 * `--brand` must BE `--brand`. Before the fix the registration published
 * `@property --brand`, which made every read of every registered property dangle:
 * 273 registrations across 3 corpus files, and not one of their reads resolved. A
 * dangling endpoint in a lane whose chain-resolution rule is that BOTH ends must
 * resolve.
 */
const rePrefixPropertyRegistration = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) =>
    s.metadata?.isPropertyRegistration ? { ...s, name: `@property ${s.name}` } : s,
  ),
})

/**
 * C2 REVERT — the three late at-rules publish no symbol at all.
 *
 * `@counter-style`, `@custom-media` and `@font-feature-values` each DECLARE a named,
 * referable thing. Before the fix each published nothing, so every use of one had no
 * endpoint. Zero occurrences in 533 corpus files across 13 repositories, which is
 * exactly why no corpus measurement found it: the census recorded the constructs as
 * NO OCCURRENCE and the lane wrote that down as "not a defect".
 */
const dropCustomDefinitionSymbols = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).filter(
    (s: any) =>
      !s.metadata?.isCounterStyleDeclaration &&
      !s.metadata?.isCustomMediaDeclaration &&
      !s.metadata?.isFontFeatureValuesDeclaration,
  ),
})

/**
 * C3 REVERT — `@layer a, b, c;` publishes one symbol for the whole statement.
 *
 * The ORDERING form's prelude is the entire comma list, so the name became
 * `@layer reset, base, components`: a name with no referent (M60 R7's
 * placeholder-literal anti-pattern) that DUPLICATED the individually declared
 * layers, so one file carried both `@layer base` and `@layer base, special`.
 */
const collapseLayerOrderingName = (r: any) => {
  const names = (r.symbols ?? []).map((s: any) => String(s.name))
  return {
    ...r,
    symbols: (r.symbols ?? []).map((s: any) => {
      const m = /^@layer ((?:[\w-]+)(?:,\s*[\w-]+)+)$/.exec(String(s.name))
      if (m) return { ...s, name: `@layer ${m[1]}` }
      const joined = names.filter((n) => n.startsWith("@layer ") && !n.includes(",")).map((n) => n.slice(7))
      if (joined.length > 1 && String(s.name) === `@layer ${joined[0]}`) {
        return { ...s, name: `@layer ${joined.join(", ")}` }
      }
      return s
    }),
  }
}

/**
 * C4 REVERT — complexity is a constant.
 *
 * `metadata.cyclomaticComplexity` was hardcoded to `1` and the worker computed
 * `complexity: s.complexity || s.metadata?.complexity || 1`, so every CSS symbol
 * claimed complexity exactly 1 — measured 9,338 of 9,338, 100%. Replacing the
 * literal was only the first of FOUR defects in this metric; this mutant reverts the
 * OUTCOME, which is what the fixtures pin, and the outcome is the constant.
 */
const flattenComplexity = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => ({ ...s, complexity: 1 })),
})

/**
 * C5 REVERT — the SCOPE-carrying `contains` edges are dropped.
 *
 * `@layer` (7,601), `@media` (2,921), `@container` (11) and `@supports` (1,376, and
 * ZERO before its own fix) all scope their rules through a NAME. The scope symbol is
 * published, the rules are published, and without these edges nothing joins them — so
 * the graph can list a layer's rules and the layer, but never which rules are in it.
 * This is the single largest relationship class in the lane, and it is invisible to
 * any gate that counts symbols.
 */
const dropScopeContainment = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => {
    const m = x.metadata ?? {}
    return !(m.isLayerScope || m.isMediaScope || m.isContainerScope || m.isSupportsScope || m.isScopeScope)
  }),
})

/**
 * C6 REVERT — the font-family and counter-style USE edges are dropped.
 *
 * A `font-family` naming a family this file DECLARES with `@font-face` is a use of
 * that declaration. Before the fix 135 corpus files declared a `font-family`, 21
 * declared an `@font-face`, 344 family symbols were published, and NOTHING connected
 * a rule that uses a family to the declaration that provides it — the asymmetry being
 * historical, since the `animation:` -> `@keyframes` path was built and this one
 * never was. `list-style: thumbs` -> `@counter-style thumbs` is the same class.
 */
const dropDeclarationUseEdges = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter(
    (x: any) => !(x.metadata?.isFontFamilyRef || x.metadata?.isCounterStyleRef || x.metadata?.isFontFeatureValuesRef),
  ),
})

/**
 * C7 REVERT — the custom-property and custom-media READ edges are dropped.
 *
 * `var(--x)` is the `references` class, 13,218 edges in the corpus, and
 * `@media (--narrow)` is its at-rule twin. Dropping them leaves every custom
 * property published as a declaration with no reader, and every custom media scope
 * with no dependency — so the graph cannot answer "which rules read this token",
 * which is the question a token exists to answer.
 */
const dropVarReadEdges = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter(
    (x: any) => !(x.metadata?.isVarRef || x.metadata?.isCustomPropertyRef || x.metadata?.isCustomMediaRef),
  ),
})

/**
 * C8 REVERT — parse errors are swallowed.
 *
 * A stylesheet carrying an ERROR still yields symbols, because error recovery keeps
 * the surrounding rules. That is the correct behaviour and the reason this mutant is
 * about the COUNT rather than the recovery: a file that fails to parse and a file
 * that is silently reported clean look identical to every gate that does not read
 * `errors`. The fixtures pin `expectErrorCount`, so zeroing the array is exactly the
 * defect class — "extraction reported success on a file the grammar could not read".
 */
const swallowParseErrors = (r: any) => ({ ...r, errors: [] })

export const CSS_MUTANTS = [
  {
    id: "css/symbol-identity-collapsed",
    language: "css",
    defectClass: "unresolvable-identity",
    description:
      "C0 REVERT, the lane's largest measured defect: symbol identity collapses from `(kind, resolved name)` back to one node per syntactic occurrence, which is what 36.6% of corpus files emitted — the same selector up to 12 times in one file. 27,321 duplicate symbols removed across the wave, 0 remaining in 454 corpus files. Caught by layer-ordering-and-font-families' three `expectSymbolCount` rows, each pinning `equals: 1` for a layer named by BOTH an ordering statement and a block.",
    transform: collapseSymbolIdentity,
  },
  {
    id: "css/property-registration-name-prefixed",
    language: "css",
    defectClass: "unresolvable-identity",
    description:
      "C1 REVERT: a `@property` registration publishes `@property --brand` instead of the bare `--brand`, so every `var()` read of a registered property dangles — 273 registrations across 3 corpus files, no read resolving. Caught by font-faces-and-registered-properties, whose `references` row names target `--brand` exactly.",
    transform: rePrefixPropertyRegistration,
  },
  {
    id: "css/custom-definition-symbols-dropped",
    language: "css",
    defectClass: "relationship-loss",
    description:
      "C2 REVERT: `@counter-style`, `@custom-media` and `@font-feature-values` publish no symbol, so every use of one has no endpoint. Zero occurrences in 533 corpus files across 13 repositories, which is why no corpus measurement found it and why the census's NO OCCURRENCE cell read as an all-clear. Caught by declarations-the-corpus-never-uses' three `expectSymbols` rows.",
    transform: dropCustomDefinitionSymbols,
  },
  {
    id: "css/layer-ordering-name-collapsed",
    language: "css",
    defectClass: "unresolvable-identity",
    description:
      "C3 REVERT: the `@layer a, b, c;` ordering form publishes ONE symbol named for the whole statement — `@layer reset, base, components` — a name with no referent that also duplicates the individually declared layers. Caught by layer-ordering-and-font-families' `forbidSymbols` row, which names that exact string.",
    transform: collapseLayerOrderingName,
  },
  {
    id: "css/complexity-constant",
    language: "css",
    defectClass: "type-inaccuracy",
    description:
      "C4 REVERT: every symbol's complexity is 1, which is the pre-fix emission in full — measured 9,338 of 9,338 symbols at exactly 1. Caught by complexity-matrix, whose rows pin a `:is()` chain above 1 and a scope-conditional block above 1.",
    transform: flattenComplexity,
  },
  {
    id: "css/scope-containment-dropped",
    language: "css",
    defectClass: "relationship-loss",
    description:
      "C5 REVERT: the `contains` edges from every scoping construct are dropped — `@layer` (7,601), `@media` (2,921), `@container` (11) and `@supports` (1,376, and ZERO before its own fix). The scope symbol and the rules are all still published, so the graph can list both and never their membership. Caught by scope-conditions-and-custom-properties and layer-ordering-and-font-families, which pin `isLayerScope`/`isSupportsScope`/`isMediaScope` rows.",
    transform: dropScopeContainment,
  },
  {
    id: "css/declaration-use-edges-dropped",
    language: "css",
    defectClass: "relationship-loss",
    description:
      "C6 REVERT: the `uses` edges from a `font-family` to a declared `@font-face` are dropped, along with the `list-style` -> `@counter-style` and `font-feature-settings` -> `@font-feature-values` twins. Measured pre-fix: 135 corpus files declare a `font-family`, 21 declare an `@font-face`, 344 family symbols published, and nothing connected them. Caught by layer-ordering-and-font-families' `isFontFamilyRef` row and declarations-the-corpus-never-uses' two `uses` rows.",
    transform: dropDeclarationUseEdges,
  },
  {
    id: "css/var-read-edges-dropped",
    language: "css",
    defectClass: "relationship-loss",
    description:
      "C7 REVERT: every `var(--x)` read edge is dropped, which is the largest `references` class in the corpus at 13,218 edges, and with it the `@media (--narrow)` -> `--narrow` dependency. Every custom property stays published as a declaration with no reader. Caught by scope-conditions-and-custom-properties' `references` rows.",
    transform: dropVarReadEdges,
  },
  {
    id: "css/line-numbers-dropped",
    language: "css",
    defectClass: "line-provenance",
    description:
      "M59/#855 REVERT: every relationship loses its `line_number`, so 7,662 relationships that each point at a real line become unlocatable. No symbol or edge count changes, which is why this class is invisible to every gate that counts. Caught by M59 oracle-callsite and the CSS line oracle, which compare each edge's line against the source.",
    transform: dropRelField("line_number"),
  },
  {
    id: "css/evidence-class-dropped",
    language: "css",
    defectClass: "metadata-loss",
    description:
      "REVERT: every relationship loses `metadata.evidenceClass`, so a consumer can no longer tell a STRUCTURAL edge (containment, read from the tree) from a USAGE_CONTEXTUAL one (a `font-family` naming a family) or an IMPORT_BASED one (a `@import` target). The edges are all still there and all still correct, which is what makes the class worth a mutant: the defect is a claim becoming unverifiable rather than a count changing. Caught by the fixtures' `meta.evidenceClass` rows.",
    transform: dropRelMeta("evidenceClass"),
  },
  {
    id: "css/parse-errors-swallowed",
    language: "css",
    defectClass: "fabrication",
    description:
      "REVERT: the `errors` array is emptied, so a stylesheet the grammar could not read is reported as extracted cleanly. Error recovery is why a broken file still yields its surrounding rules, and that is correct — the defect is not the recovery but the COUNT, because every gate that does not read `errors` then sees a successful extraction of a file that failed. This is the class behind the lane's declared 25-file parse floor. Caught by the fixtures' `expectErrorCount` rows.",
    transform: swallowParseErrors,
  },
  {
    id: "css/scope-metadata-dropped",
    language: "css",
    defectClass: "metadata-loss",
    description:
      "REVERT: the `isLayerScope`/`isMediaScope`/`isContainerScope`/`isSupportsScope`/`isScopeScope` markers are stripped from relationship metadata, so a consumer must re-parse a scope's NAME to learn what KIND of scope it is. Caught by the fixtures' `meta.isLayerScope` and `meta.isSupportsScope` rows.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => ({
        ...x,
        metadata: Object.fromEntries(
          Object.entries(x.metadata ?? {}).filter(
            ([k]) => !/^is(Layer|Media|Container|Supports|Scope)Scope$/.test(k),
          ),
        ),
      })),
    }),
  },
  {
    id: "css/declaration-markers-dropped",
    language: "css",
    defectClass: "metadata-loss",
    description:
      "REVERT: the markers that say which construct DECLARED a symbol are stripped. `@custom-media` publishes a bare `--narrow`, which is the same shape as a registered `@property` symbol and a rule-level custom property, so without `isCustomMediaDeclaration` / `isPropertyRegistration` / `isCounterStyleDeclaration` the three are indistinguishable in the graph. Two fields holding one value, or three fields holding none, is the same 'two truths' defect the complexity metric carried. Caught by declarations-the-corpus-never-uses' three marker rows and font-faces-and-registered-properties' `isPropertyRegistration` row.",
    transform: (r: any) => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => ({
        ...s,
        metadata: Object.fromEntries(
          Object.entries(s.metadata ?? {}).filter(
            ([k]) =>
              !/^is(PropertyRegistration|CounterStyleDeclaration|CustomMediaDeclaration|FontFeatureValuesDeclaration)$/.test(k),
          ),
        ),
      })),
    }),
  },
]
