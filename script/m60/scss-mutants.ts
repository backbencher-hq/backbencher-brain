/**
 * M14.0.F4 — the SCSS mutant set.
 *
 * Every entry is a faithful REVERT of a shape this lane was MEASURED to emit, written
 * generically off the result's own fields — never a name filter, because a name filter
 * silently stops matching the moment a fixture is renamed. Each `description` names the
 * `caughtBy` fixture, so a reader can see which pin carries the class rather than
 * having to trust that one exists.
 *
 * The lane had ZERO mutants when this set was written, which is the finding rather
 * than a footnote. It is the same finding the CSS lane had: a suite that cannot go red
 * proves nothing about the thing it is green for. The CSS lane's own mutants then found
 * that its LARGEST defect — an ambiguous symbol in 36.6% of corpus files — was not
 * pinned by any fixture at all, which is a thing no amount of reading the code
 * establishes.
 *
 * THREE OF THESE REVERT DEFECTS THAT THE FIXTURES FOUND IN THIS LANE'S FIRST
 * IMPLEMENTATION, minutes before this file was written:
 *
 *   `scss-visibility-flag-dropped`   `!default`/`!global` were never detected
 *   `scss-module-namespace-dropped` `@use … as ns` published no namespace
 *   `scss-return-self-edge`          `@return` emitted a self-edge (added, not removed)
 *
 * A mutant for a defect you just fixed is worth more than one for a defect you only
 * remember, because the fixture that caught it is already known to be load-bearing.
 */

const dropRelField = (field: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => {
    const { [field]: _dropped, ...rest } = x
    return rest
  }),
})

const dropRelMeta = (key: string) => (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).map((x: any) => ({
    ...x,
    metadata: Object.fromEntries(Object.entries(x.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

const dropSymMeta = (key: string) => (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => ({
    ...s,
    metadata: Object.fromEntries(Object.entries(s.metadata ?? {}).filter(([k]) => k !== key)),
  })),
})

/**
 * S0 REVERT — a `$variable` is published once per ASSIGNMENT instead of once per name.
 *
 * A Sass variable is assigned in several places by design: a `!default` at the top of a
 * file and an override inside a theme. Identity is `(kind, resolved name)`, so
 * `$brand` assigned twice is ONE symbol and a `references` edge addresses it without
 * ambiguity. Publishing one per assignment is the identity collision this project has
 * spent a wave removing, and `.scss` is where it recurs most naturally.
 *
 * The count comes from the SOURCE, because a result-derived count cannot reconstruct
 * the pre-fix state: after the fix there are never two same-named symbols, so reading
 * the count from the result yields 1 and the transform is a no-op. (That is exactly the
 * bug the CSS lane's first `symbol-identity-collapsed` mutant had, and it SURVIVED.)
 */
const collapseVariableIdentity = (r: any, source?: string) => {
  const occurrences = (name: string): number => {
    if (!source) return 1
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const m = source.match(new RegExp(`(^|[^\\w$-])${esc}(?![\\w-])`, "g"))
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
    const name = String(members[0].name)
    // only `$variables` recurred; a class or a mixin is not re-declared per use
    const copies = name.startsWith("$") ? occurrences(name) : Math.max(1, members.length)
    for (let i = 0; i < copies; i++) out.push({ ...members[0] })
  }
  return { ...r, symbols: out }
}

/**
 * S1 REVERT — `!default` and `!global` stop being recorded.
 *
 * This is not a hypothetical: it is what the first implementation did, for two stacked
 * reasons. The walk used `namedChild` and the flag is two ANONYMOUS nodes, and the test
 * looked for the string `!default` in a single node's text when the `!` and the word are
 * separate nodes. 210 `!default` assignments in the corpus were recorded as carrying no
 * flag, and nothing noticed until a fixture asked.
 */
const dropVisibilityFlags = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    if (!s.metadata?.isScssVariable) return s
    const { scssFlagDefault: _d, scssFlagGlobal: _g, ...rest } = s.metadata
    return { ...s, metadata: rest }
  }),
})

/**
 * S2 REVERT — an `@use … as <ns>` namespace stops being published.
 *
 * Also not hypothetical: the first implementation excluded `sass:` modules on the
 * reasoning that a built-in is "not the file's own", so `@use 'sass:map' as map` bound
 * the name `map` in the file and published nothing. Caught by
 * `module-system-and-mixins`' `expectSymbols` row.
 */
const dropModuleNamespaces = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).filter((s: any) => !s.metadata?.isScssModuleNamespace),
})

/**
 * S3 REVERT — `@return` emits a SELF-EDGE.
 *
 * Note the direction: this mutant ADDS the fabrication rather than removing a feature,
 * because that is what the first implementation did. `contains` from a function to
 * itself makes a relationship count look like evidence while connecting nothing, and
 * `contains` between a thing and itself is not a claim a consumer can use.
 *
 * Caught by `functions-return-and-undeclared-uses`' forbidRelationships row. This is the
 * one class a mutant suite is better at than a fixture review, because the edge is
 * syntactically valid: it has two endpoints, they are both real symbols, and nothing
 * about it is malformed.
 */
const addReturnSelfEdge = (r: any) => {
  const edges = [...(r.relationships ?? [])]
  for (const s of r.symbols ?? []) {
    if (s.metadata?.isScssFunction && s.metadata?.scssReturns) {
      edges.push({
        source: s.name,
        target: s.name,
        type: "contains",
        line_number: s.range?.startLine,
        metadata: { evidenceClass: "structural", isScssReturn: true },
      })
    }
  }
  return { ...r, relationships: edges }
}

/**
 * S4 REVERT — an `@include` of a mixin the file does NOT declare gets an edge anyway.
 *
 * The edge's target is a name nothing publishes, which is the `global` phantom the CSS
 * lane removed once. A mixin may legitimately come from another stylesheet, and a
 * consumer following this edge lands nowhere.
 *
 * Caught by `functions-return-and-undeclared-uses`' forbidRelationships row naming
 * `not-declared-here`. The negative half matters more than the positive half: a lane
 * that only pins what it emits cannot be told apart from a faucet.
 */
const emitUndeclaredInclude = (r: any, source?: string) => {
  if (!source) return r
  const declared = new Set(
    (r.symbols ?? []).filter((s: any) => s.metadata?.isScssMixin || s.metadata?.isScssFunction).map((s: any) => s.name),
  )
  const published = new Set((r.symbols ?? []).map((s: any) => s.name))
  const edges = [...(r.relationships ?? [])]
  // every `@include <name>` in the source whose name is not a declared mixin gets an
  // edge to a name that resolves to nothing
  for (const m of source.matchAll(/@include\s+([A-Za-z_][\w-]*)/g)) {
    const bare = m[1]
    const publishedName = `@mixin ${bare}`
    if (declared.has(publishedName)) continue
    if (published.has(bare)) continue
    // attach to any real rule so the SOURCE resolves and only the target dangles,
    // which is the shape the phantom actually takes
    const host = (r.symbols ?? []).find((s: any) => s.kind === "class")
    if (!host) continue
    edges.push({
      source: host.name,
      target: publishedName,
      type: "uses",
      metadata: { evidenceClass: "usage_contextual", isScssInclude: true },
    })
  }
  return { ...r, relationships: edges }
}

/**
 * S5 REVERT — ownership falls back to something ADJACENT when no containing symbol
 * exists, which is the pre-fix behaviour and the source of three fabrications in one
 * file: `uses button -> @mixin button` (source was the mixin's own name),
 * `uses .btn -> .btn` (source was its own target), and
 * `references "color: $brand;" -> $brand` (source was raw declaration text).
 *
 * Every one of those has a SOURCE that is not an entity. The fix resolves ownership by
 * RANGE — the innermost published symbol containing the statement — and this mutant
 * puts back the fallback that the range lookup replaced.
 *
 * Caught by `control-flow-and-extend` (`uses .card -> .btn`, where the naive fallback
 * makes it `.btn -> .btn`) and by `variables-flags-and-identity`.
 */
const adjacentOwnership = (r: any) => ({
  ...r,
  // Every edge is renamed after its own TARGET. That is the pre-fix fallback with the
  // ambiguity stripped out: the original code did `source: owner || <something
  // adjacent>`, and after the RANGE fix `owner` is never empty, so a mutant that only
  // renames UNRESOLVED sources rewrites nothing and cannot fail. (Same shape as the CSS
  // lane's first identity mutant: a transform that reconstructs the defect from
  // post-fix data is a no-op, and a no-op mutant reports its class as covered.)
  relationships: (r.relationships ?? []).map((x: any) => ({ ...x, source: x.target })),
})

/** S6 REVERT — a mixin's or function's `parameters` are dropped. */
const dropCallableParameters = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    if (!s.metadata?.scssCallable) return s
    // `{ ...s, ...rest }` would RESTORE `parameters`, because spreading an object that
    // lacks a key does not delete that key from the target — so the first version of
    // this mutant was a no-op and the suite could not fail on a mixin losing its
    // signature. The key has to be omitted from the object that is actually returned.
    const { parameters: _dropped, ...rest } = s
    return rest
  }),
})

/** S7 REVERT — the `@extend` edge is dropped, so extending is invisible. */
const dropExtendEdges = (r: any) => ({
  ...r,
  relationships: (r.relationships ?? []).filter((x: any) => !x.metadata?.isScssExtend),
})

/** S8 REVERT — `@use`/`@forward` stop producing imports. */
const dropModuleImports = (r: any) => ({
  ...r,
  imports: (r.imports ?? []).filter((i: any) => i.metadata?.scssModuleType === undefined),
})

/**
 * S9 REVERT — a control-flow scope stops recording its loop variables.
 *
 * `@each $key, $value in $palette` is the only place a stylesheet says what it is
 * iterating, and dropping it loses the construct's entire statement of intent while
 * leaving the scope symbol looking complete.
 */
const dropLoopVariables = (r: any) => ({
  ...r,
  symbols: (r.symbols ?? []).map((s: any) => {
    if (!s.metadata?.isScssControlFlow) return s
    const {
      scssEachKey: _k,
      scssEachValue: _v,
      scssForFrom: _f,
      scssForThrough: _t,
      scssCondition: _c,
      ...rest
    } = s.metadata
    return { ...s, metadata: rest }
  }),
})

/**
 * S10 REVERT — identically-named scopes collapse back into one.
 *
 * Identity is `(kind, resolved name)`, which is right for a `$variable` and wrong for a
 * scope: two `@each $size in (large, small)` in two nesting contexts are two constructs
 * at two places in the file. Collapsing them loses the second scope AND the owner of
 * everything inside it, so every `$var` read in the second loop emits no edge.
 *
 * Measured on `element-plus/packages/theme-chalk/src/checkbox.scss`: two
 * `each_statement`s (L76, L266) with identical text collapsed into one, and the
 * differential reported 7 MISSING rows that were the ANALYZER losing information.
 *
 * A mutant for a defect the DIFFERENTIAL found rather than a fixture, which is the
 * first time that has happened in this lane and the reason the differential earns its
 * maintenance cost.
 */
const collapseIdenticallyNamedScopes = (r: any) => {
  const byName = new Map<string, any[]>()
  const out: any[] = []
  for (const s of r.symbols ?? []) {
    if (!s.metadata?.isScssControlFlow) {
      out.push(s)
      continue
    }
    // the disambiguated name with its `#N` suffix stripped, so a collision reads as one
    const base = String(s.name).split("#")[0]
    if (!byName.has(base)) byName.set(base, [])
    byName.get(base)!.push(s)
  }
  for (const members of byName.values()) {
    // keep the FIRST and drop the rest — the pre-fix behaviour
    out.push(members[0])
  }
  return { ...r, symbols: out }
}

export const SCSS_MUTANTS = [
  {
    id: "scss/identically-named-scopes-collapsed",
    language: "scss",
    defectClass: "unresolvable-identity",
    description:
      "S10 REVERT: two control-flow scopes with identical text collapse back into one symbol, so the second publishes nothing and the owner of everything inside it disappears. Identity by (kind, name) is CORRECT for a $variable — one thing assigned in several places — and wrong for a scope. Measured: two each_statements (L76, L266) in checkbox.scss, and 7 MISSING differential rows that were the analyzer losing information rather than the truth being wrong. Caught by identically-named-scopes-are-distinct, which pins BOTH the plain name and the #2 disambiguation.",
    transform: collapseIdenticallyNamedScopes,
  },
  {
    id: "scss/variable-identity-collapsed",
    language: "scss",
    defectClass: "unresolvable-identity",
    description:
      "S0 REVERT: a `$variable` is published once per ASSIGNMENT rather than once per name, so `$brand` assigned twice is two indistinguishable symbols and a `references` edge addresses one of them. The occurrence count is read from the SOURCE, because a result-derived count is always 1 after the fix and the transform would be a no-op — the exact bug the CSS lane's first identity mutant had, where it SURVIVED. Caught by variables-flags-and-identity's `expectSymbolCount` rows, which pin `$brand` and `$pad` at exactly 1 while the source assigns `$brand` twice.",
    transform: collapseVariableIdentity,
  },
  {
    id: "scss/visibility-flag-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "S1 REVERT: `scssFlagDefault` and `scssFlagGlobal` stop being recorded, so a `!default` assignment is indistinguishable from an ordinary one. This is the first implementation's actual behaviour, for two stacked reasons: the walk used `namedChild` and the flag is two ANONYMOUS nodes, and the test looked for `!default` inside one node's text when the `!` and the word are separate nodes. 210 occurrences in the corpus. Caught by variables-flags-and-identity's two `meta.scssFlag*` rows.",
    transform: dropVisibilityFlags,
  },
  {
    id: "scss/module-namespace-dropped",
    language: "scss",
    defectClass: "relationship-loss",
    description:
      "S2 REVERT: an `@use '<mod>' as <ns>` namespace stops being published, so `map.merge(…)` has no endpoint and the binding the statement creates is invisible. This is the first implementation's actual behaviour, which excluded `sass:` modules as 'not the file's own' — a rule nobody wrote down. Caught by module-system-and-mixins' `{ name: 'map', kind: 'namespace' }` row.",
    transform: dropModuleNamespaces,
  },
  {
    id: "scss/return-self-edge",
    language: "scss",
    defectClass: "fabrication",
    description:
      "S3 REVERT, and it ADDS rather than removes: `@return` emits `contains` from a function to ITSELF. A self-edge makes a relationship count look like evidence while connecting nothing, and it is syntactically well-formed — two real endpoints, nothing malformed — so it is the class a mutant suite catches better than a reading. This is what the first implementation did. Caught by functions-return-and-undeclared-uses' forbidRelationships row.",
    transform: addReturnSelfEdge,
  },
  {
    id: "scss/undeclared-include-edge",
    language: "scss",
    defectClass: "fabrication",
    description:
      "S4 REVERT: an `@include` of a mixin the file does not declare gets a `uses` edge to a name nothing publishes — the `global` phantom the CSS lane removed once, which a mixin from another stylesheet would bring straight back. Caught by functions-return-and-undeclared-uses' forbidRelationships row naming `not-declared-here`. The negative half is the half that distinguishes a lane from a faucet.",
    transform: emitUndeclaredInclude,
  },
  {
    id: "scss/ownership-falls-back-to-target",
    language: "scss",
    defectClass: "unresolvable-identity",
    description:
      "S5 REVERT: when no published symbol contains a statement, the edge is named after its own TARGET rather than skipped. That is the pre-fix behaviour and it produced three fabrications in one file — `uses button -> @mixin button`, `uses .btn -> .btn`, and a source that was raw declaration text. Ownership is now resolved by RANGE. Caught by control-flow-and-extend's `uses .card -> .btn` row, which the fallback turns into `.btn -> .btn` and trips the fixture's own forbidRelationship.",
    transform: adjacentOwnership,
  },
  {
    id: "scss/callable-parameters-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "S6 REVERT: a `@mixin`/`@function` symbol loses its `parameters`, so a mixin's signature — the thing a call site is checked against — is absent while the symbol still looks whole. Caught by module-system-and-mixins' and functions-return-and-undeclared-uses' `expectParameters` rows.",
    transform: dropCallableParameters,
  },
  {
    id: "scss/extend-edge-dropped",
    language: "scss",
    defectClass: "relationship-loss",
    description:
      "S7 REVERT: `@extend` emits no edge, so a rule's inheritance by selector extension is invisible while both selectors still appear as symbols — the graph can list them and never their relation. Caught by control-flow-and-extend's `meta.isScssExtend` row.",
    transform: dropExtendEdges,
  },
  {
    id: "scss/module-imports-dropped",
    language: "scss",
    defectClass: "relationship-loss",
    description:
      "S8 REVERT: `@use`/`@forward` stop producing imports, so a stylesheet's entire dependency on the Sass module system disappears from the result while its symbols all remain. Caught by module-system-and-mixins' `expectImports` rows, which pin both the module and the `as` namespace.",
    transform: dropModuleImports,
  },
  {
    id: "scss/loop-variables-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "S9 REVERT: a control-flow scope stops recording its `@each` key/value, `@for` from/through and `@if` condition, so the scope symbol still looks whole while the only statement of intent the construct makes is gone. Caught by control-flow-and-extend's `meta.scssEachKey`/`scssEachValue`/`scssForFrom`/`scssForThrough` rows.",
    transform: dropLoopVariables,
  },
  {
    id: "scss/line-numbers-dropped",
    language: "scss",
    defectClass: "line-provenance",
    description:
      "M59/#855 REVERT: every relationship loses its `line_number`. No symbol or edge COUNT changes, which is why this class is invisible to every gate that counts. Caught by M59 oracle-callsite and the SCSS line oracle.",
    transform: dropRelField("line_number"),
  },
  {
    id: "scss/evidence-class-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "REVERT: every relationship loses `metadata.evidenceClass`, so a consumer cannot tell a STRUCTURAL edge (`@extend`, containment) from a USAGE_CONTEXTUAL one (`@include`, a `$var` read) or an IMPORT_BASED one (`@use`). All the edges are still there and all still correct, which is what makes the class worth a mutant: the defect is a claim becoming unverifiable rather than a count changing. Caught by the fixtures' `meta.evidenceClass` rows.",
    transform: dropRelMeta("evidenceClass"),
  },
  {
    id: "scss/parse-errors-swallowed",
    language: "scss",
    defectClass: "fabrication",
    description:
      "REVERT: the `errors` array is emptied, so a stylesheet the grammar could not read is reported as extracted cleanly. This class is the reason the CSS lane needed an `error-recovery-is-reported` fixture at all: every CSS fixture originally asserted `expectErrorCount: 0`, which an EMPTY array satisfies, so the suite could not tell a clean parse from a swallowed failure. Caught by error-recovery-is-reported's `atLeast: 1`.",
    transform: (r: any) => ({ ...r, errors: [] }),
  },
  {
    id: "scss/declaration-markers-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "REVERT: the markers that say which SCSS construct DECLARED a symbol are stripped, so a `$variable` is indistinguishable from a registered `@property` and a control-flow `interface` from a `@supports` one. Caught by variables-flags-and-identity's `meta.isScssVariable` and control-flow-and-extend's `meta.isScssControlFlow` rows.",
    transform: dropSymMeta("isScssVariable"),
  },
  {
    id: "scss/function-call-edge-dropped",
    language: "scss",
    defectClass: "recall",
    description:
      "REVERT: every `uses` edge to a `@function` CALLED in a value disappears, so a declared function can never be reached from its call site and the graph cannot answer \"who calls double\". Found by the M12 independent hand audit of validation/m12/fixtures/scss/Theme.scss — 9 facts expected, 8 observed, recall 0.889, and the single false negative was this edge. It survived because a `@var` read on the line above was caught and a call on the line below was not: the two are the same class of claim and only one of them was implemented, so no count-based gate could see the gap.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter(
        (x: any) => x.metadata?.isScssFunctionCall !== true,
      ),
    }),
  },
  {
    id: "scss/error-recovery-marker-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "REVERT: `metadata.scssRecoveredFromError` is stripped, so a claim the analyzer only recovered from inside a broken region becomes indistinguishable from one it read cleanly. The EDGES all survive this mutant, so every count-based gate passes; what is lost is the ability to tell a consumer which claims rest on a region the grammar could not read. The control for it is the same variable read twice in one fixture, once recovered and once clean.",
    transform: dropRelMeta("scssRecoveredFromError"),
  },
  {
    id: "scss/function-call-marker-dropped",
    language: "scss",
    defectClass: "metadata-loss",
    description:
      "REVERT: `metadata.isScssFunctionCall` is stripped, so a call to a user function is indistinguishable from an `@include` of a mixin — both are `uses`. A consumer could no longer tell a value-position call from a statement-position include, which is the difference between \"this function is called\" and \"this block is included\".",
    transform: dropRelMeta("isScssFunctionCall"),
  },
]
