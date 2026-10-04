# RealScssAnalyzer

The SCSS lane. `.scss` was routed to the CSS analyzer until 2026-09-27, which meant
254 files were being handed to a grammar with no `$variables`, no `@mixin`/`@include`
and no interpolation: **43 of 244 non-empty files parsed clean (17.6%)** with 30,767
ERROR nodes. It now has its own grammar, its own analyzer and its own fixtures.

- Analyzer file: `src/ast/real-scss-analyzer.ts`
- Parser: `tree-sitter-scss@1.0.0` (vendored at `grammars/tree-sitter-scss/`, two
  local patches), wasm `wasm/tree-sitter-scss.wasm` (sha256 `729731fb83e4…`, 206,409 B,
  195 ids / 84 named / 7 fields), pinned in `validation/m14/grammar-pins.json`
- Language detection: `.scss` → `scss` in `src/ast/language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealScssAnalyzer`

## Measured state

| | |
| --- | --- |
| files parsing clean | **149 / 244 (61.1%)**, from 43 (17.6%) |
| grammar patches | 2, both strictly additive: 76 files fixed, **0 regressed** |
| ERROR nodes | 5,624 → 3,900 (and 30,767 → 3,900 against the CSS grammar) |
| symbols / relationships / imports | 5,170 / 2,829 / 714 |
| `contains` both-ends resolve | 2,225 / 2,225 (100%) |
| `uses` both-ends resolve | 41 / 41 (100%) |
| fixtures | 8 / 8 |
| mutants | 18 / 18 caught |
| M12 ground truth | precision **1.000**, recall **1.000** (9/9), `truthSource: manual_audit` |
| M12 manifest | H1–H7 clean; `grammarErrorFiles` 72 backed by a full-corpus artifact |
| M59 line oracle | 0 INCONSISTENT; every SCSS-authored edge carries a line |

Per corpus, because an aggregate that averages a hard corpus with an easy one is how a
lane looks healthier than it is:

| corpus | clean before | clean after | still failing | measured by |
| --- | --- | --- | --- | --- |
| element-plus | 16 / 160 | **90 / 160** | 70 | grammar A/B (`scss-grammar-ab.ts`) |
| phpmyadmin | 50 / 74 | 52 / 74 | 22 | grammar A/B |
| vue-element-admin | 6 / 9 | 6 / 9 | 3 | grammar A/B |
| vue-core | 1 / 1 | 1 / 1 | 0 | grammar A/B |

**Two instruments, two counts, and the difference is real.** The A/B above asks whether
the *tree* carries an ERROR node; `validation/m12/results/scss-corpus-errors.json` asks
whether the *analyzer* reported an error, and over the same 160 element-plus files it
measures **88 clean / 72 with errors** against the A/B's 90/70. A file can carry an ERROR
span the analyzer recovers through without reporting, and a file can be reported for a
node the A/B does not classify as an error. Neither number is wrong and the manifest pins
the artifact's, because a manifest claim has to be checkable against something and the
artifact is the something. Quoting the higher number because it reads better is how a
floor becomes a rounding error.

## Architecture: it delegates to the CSS analyzer, and that is the design

The SCSS grammar is `grammar(require('tree-sitter-css/grammar'), {…})` — it **extends**
the CSS grammar, so every CSS node type exists here too. The CSS walk already handles
rule sets, `&` nesting chains, `@media`, `@layer`, `@container`, `@scope`, `@supports`,
`@keyframes`, `@font-face`, registered `@property`, `var()` reads and `@import`, all of
which occur in `.scss` because a Sass file is a superset of a CSS file.

Reimplementing that would be ~2,700 duplicated lines whose only possible outcome is two
implementations that agree today and drift tomorrow. Delegating also means this lane
inherits every future CSS fix for free — which matters, because the **grammar** does
not: it is built on tree-sitter-css **0.20.0** and does not inherit the CSS lane's four
local patches. The cost of that is unquantified.

The boundary is measurable, not assumed: the CSS analyzer publishes the selectors and
their nesting chains and nothing for any SCSS statement, because `mixin_statement`,
`include_statement`, `use_statement` and the rest are different **node types** and its
`at_rule` dispatch never sees them.

## Symbol contract

| Field | Supported? | How extracted |
| --- | --- | --- |
| name | yes | `$var` for a variable, `@mixin name` / `@function name` with the keyword KEPT (a bare `button` could collide with a class), the construct's own collapsed text for a control-flow scope, the module path for a namespace |
| kind | yes | `variable` (`$x`), `function` (`@mixin`/`@function`), `interface` (`@if`/`@each`/`@for`/`@while` — the same shape `@supports` gets in the CSS lane), `namespace` (`@use … as ns`) |
| parameters | yes | from the `parameter` nodes; `defaultValue` read from the `default` **field**, so a default that is itself an expression keeps the expression |
| range | yes | the declaring node's own span; a repeated `$var` keeps the **first** occurrence, so the symbol points where the variable is introduced, not at its last override |
| complexity | yes | 1 + parameters for a callable; 1 + binary expressions / calls / maps / lists for a variable; 1 + condition + branch count for a control flow |
| scope | yes | the innermost enclosing published symbol, resolved by **range** |
| documentation/comments | n/a | declared absent rather than pinned with a fabricated value |

### Identity

`(kind, resolved name)`, unchanged from the CSS lane, and it is load-bearing here
rather than incidental: a Sass variable is assigned in several places **by design** — a
`!default` at the top and an override inside a theme — so `$brand` assigned twice is
ONE symbol. `variables-flags-and-identity` pins `$brand` at exactly 1.

## Relationship ontology

### What each of the ontology's ten types means IN SASS

Not in general — in this language, where the general definition and the Sass fact part
company for four of the ten.

| Type | In Sass | Verdict | Edges (4,394 files / 21 repos) | Evidence class |
| --- | --- | --- | --- | --- |
| `contains` | a scope contains the rules attributed to it — `@media`, `@layer`, `@supports`, a `@mixin` body, a control-flow block | EMITTED | **11,779** in 2,306 files | `structural` |
| `uses` | one thing draws on another **this file publishes**: `@include m`, `f(x)` for a declared `@function`, `@extend s` | EMITTED | **799** in 238 files | `usage_contextual` / `structural` |
| `references` | a `$var` READ names a `$var` this file declares; plus every delegated CSS `var()` read | EMITTED | **6,260** in 571 files | `usage_contextual` / `import_based` |
| `exports` | a `.scss` file IS a Sass module: `@use './theme'` exposes its **top-level** variables, mixins and functions. An assignment in a rule, mixin, function or control-flow block is local and is not exposed; a name beginning `-` or `_` is private and is not exposed either | EMITTED (added 2026-10-03) | **3,465** in 303 files, **100%** both-ends resolved | `structural` |
| `overrides` | one declaration REPLACES a prior one. In Sass the only case that means it is `$x: … !global` where `$x` was already assigned at this file's top level | EMITTED (added 2026-10-03) | **16** in 6 files, **100%** both-ends resolved | `structural` |
| `imports` | `@use` / `@forward` / `@import` name another **file**. The lane records all of them on `ParseResult.imports` | **GAP — the array only, 0 relationships** | **0 relationships**; 1,571 `@use` + 165 `@forward` + 3,562 `@import` in the array | `import_based` |
| `calls` | `f(x)` where `f` is a `@function` this file declares. 211 such call sites exist and the lane reads every one | **GAP (label)** — emitted as `uses` | 0 as `calls`; **144** as `uses` | `usage_contextual` |
| `extends` | `@extend` — Sass's inheritance: the extending selector takes on the extended selector's declarations. 437 `@extend` statements exist | **GAP (label)** — emitted as `uses`; 329 of the 437 name a selector in ANOTHER file (correct silence, SCSS-L7) | 0 as `extends`; **414** as `uses` | `structural` |
| `implements` | nothing in Sass is a supertype clause. Instrument A | RULED-SOUND | 0 | — |
| `instantiates` | nothing in Sass constructs a value. Instrument A | RULED-SOUND | 0 | — |

The three verdicts are the workstream's, and each carries its measurement below. Counts
come from the production entry point — `parseFile` from `src/ast/pool-worker.ts`, never
`analyze()` — over **every** tracked `.scss` file the router admits across 21 corpus
repositories (4,394 files; `consul` 3,042, `bulma` 179, `element-plus` 170,
`wagtail` 133, `bootstrap` 122, `primer-css` 113, `vault` 108, `nomad` 98,
`hasura-engine` 90, `spectre` 76, `phpmyadmin` 74, `pico` 54, `waypoint` 54,
`r-pkgdown` 36, `sass-spec` 18, `riverpod` 13, `vue-element-admin` 9, `dart-sdk` 2,
`r-air` 1, `snacks.nvim` 1, `vue-core` 1). No sampling: the whole admitted population,
so a count cannot be a rotation of a sample. Instrument: `script/m14/tmp/scss-ontology-harness.ts`
→ `script/m14/tmp/scss-ontology-harness.json`; the ruling probes are
`script/m14/tmp/scss-ontology-probes.ts`.

### The two RULED types, with the instrument, the probe and the overturn

Both use **instrument A — grammar-inventory**, because each needs a node type the
language does not have. The inventory is the grammar's OWN vocabulary observed across
the whole corpus: **150 distinct node types** the wired `tree-sitter-scss` wasm produces,
enumerated in the harness artifact.

| node type that would MEAN it | occurrences in 4,394 files |
| --- | --- |
| `class_declaration`, `class`, `interface_declaration`, `trait_declaration`, `struct_declaration`, `class_body` | **0** each |
| `implements_clause`, `extends_clause`, `superclass`, `base_class`, `interface_implementation`, `inheritance_specifier` | **0** each |
| `new_expression`, `object_creation_expression`, `constructor_invocation`, `new` | **0** each |
| `module_definition` | **0** |
| `class_name` | 37,835 — **present, and it means nothing here** |

`class_name` is the row worth reading twice. It is the CSS `.foo`'s own name, inside a
`class_selector`, and it is the plausible-looking name that makes an inventory-by-substring
wrong: a first version of the supertype probe was written as the shape regex
`/^(class|interface|struct|trait|…)/` and reported **64,744** occurrences, every one of
them a `class_selector` or a `class_name`. Instrument A asks whether the grammar HAS the
construct, by exact name, and it does not.

- **`implements` — RULED.** Sass has no supertype clause: a stylesheet declares mixins,
  functions, variables and rules, and none of them declares what it is a member of. The
  probe is the inventory above. **Overturn:** one occurrence of any of the six supertype
  node types above. A Sass mixin is NOT the case — a mixin is textual inclusion with no
  declared relationship to the including scope, and mapping it onto `implements` would be
  a fabricated edge (see "the wide readings are wrong" below).
- **`instantiates` — RULED.** Sass has no constructor and no value type. The probe is the
  same inventory. **Overturn:** one occurrence of `new_expression`,
  `object_creation_expression`, `constructor_invocation` or `new`. The nearest candidate
  was a `%placeholder`, because Sass's own documentation calls a placeholder a selector
  that exists only to be extended and one could argue an `@extend` "instantiates" it —
  2,668 `placeholder` nodes, 350 `@extend`s naming one. That argument is rejected on the
  label, not on the count: nothing in Sass instantiates anything, and an `instantiates`
  edge would be the fabricated edge this workstream prices highest. The placeholders are
  published and the `@extend`s are emitted (as `uses`) because those are real.

### `overrides`: the three candidate classes, counted apart

A wrong ruling here is the `overrides` mistake the ontology gate exists to catch, so the
three readings of "override" are measured separately rather than one of them being chosen.

| class | occurrences | verdict and why |
| --- | --- | --- |
| a SECOND `@mixin <name>` / `@function <name>` in one file | **0** / **0** across 4,394 files | the construct is expressible; this corpus does not use it. The branch is not emitted from, and the probe that says so is a parse-tree count, not an absence of evidence |
| a plain same-scope `$var` reassignment | **422** in 52 files, of which **171 read the variable they assign** | NOT an override. `$_args: append($_args, …)` in bootstrap's `_functions.scss` is an accumulator mutating one binding, and the other 251 are a `$x: 1; … $x: 2` pair that the lane's identity ruling already collapses into ONE symbol — so an edge between the two assignments would be a self-edge |
| `!global` on a name already assigned at this file's top level | **16 emitted**, and it is the only one that means what the type means | EMITTED. `!global` is the flag that reaches past the enclosing scope and reassigns the binding outside it, so the prior declaration is replaced. bootstrap's `_box-shadow.test.scss` is the model: `$enable-shadows: false !global;` … `$enable-shadows: true !global;` … and a final restore are three overrides of one variable |

The prior assignment must be a **top-level** one. `!global` beside a name that exists only
inside another mixin CREATES a global rather than replacing one, and 14 of the
`!global` assignments in element-plus fail that test — which is why element-plus's
60-file differential sample carries 10 of the 16 edges and the other 6 repositories carry
one each. **Overturn for the ruling half:** a same-file second `@mixin`/`@function`
declaration, which would make the emitted class incomplete rather than wrong.

### `exports`: what a module offers, and what it does not

Two exclusions, each pinned by a `forbidRelationships` row, because "every top-level
declaration" is the over-reach and each exclusion is a different rule:

- **SCOPE.** `$local: 1` inside `.card { … }` is a local. Measured: 3,315 top-level `$`
  assignments against 523 scoped ones in 4,394 files.
- **Sass's private-member rule.** A name beginning `-` or `_` is private to its module
  and `@use` does not expose it. Measured: **30** top-level private assignments.

Both ends resolve by construction — the source is the file's own module symbol, the
target is a symbol the file publishes — which is the reason to model a module's surface
as edges at all: `@use 'a', 'b'` binds members from two files, and nothing else in the
graph can say which file offered a name. The module symbol's name is the file's basename
**with** its extension, for the reason the bash lane gives for its script symbol (BD2):
deterministic, no machine path in the index fingerprint, and unable to collide with a
selector, a variable or a mixin name because a bare type selector has no dot.

Two deliberate non-behaviours, both of which keep the addition measurable:

1. **The module symbol is NOT an owner.** `ownerForNode` skips it. A module is not a
   lexical scope, so making it the owner would re-source every top-level statement onto a
   file-level name — a different edge from the one the lane emitted before this symbol
   existed, and 1,491 top-level `@include`s plus 156 top-level `$var` reads currently emit
   **no edge at all** precisely because nothing published encloses them. That silence is
   pre-existing and unchanged; this lane did not widen it.
2. **The `exports` EDGE and the `exports` ARRAY are not the same set.** The delegated CSS
   analyzer puts every ownerless symbol in `ParseResult.exports`, which includes rule
   selectors such as `.card`; Sass does not expose a selector through `@use`, so the edges
   cover variables, mixins and functions only. Each entry carries its provenance
   (`metadata.via: "sass-module-top-level"` on the array, `metadata.isScssModuleMember` on
   the edge) so a consumer can tell the two claims apart instead of reading one as the
   other.

### The three GAPs that are reported rather than implemented, and why

Each is a real construct with a measured population, and each needs a change in
`script/m14/differential.ts` — shared machinery this lane does not own (§8 of the
workstream). The workstream's own rule for this is the **full mirror**: truth AND the
allowlist entry in one commit, or the label is compared against nothing. Applying half of
it is the documented failure — java (81 edges), kotlin (54), php (163) and javascript all
carried a label no oracle backed while publishing 0% unexplained.

| type | what the lane emits now | the construct | what the shared change must be |
| --- | --- | --- | --- |
| `imports` | 0 relationships; 1,571 `@use` + 165 `@forward` + 3,562 `@import` on the `imports` array | a file dependency, and the CSS lane already emits it as a relationship sourced from the importing stylesheet's own name. `@use`/`@forward` are `use_statement`/`forward_statement` node types, which the CSS lane's `at_rule` dispatch never sees, so a `.scss` file produces **none** | `deriveScssEdges(root)` must take the module name the way `deriveCssEdges(root, moduleName)` does and source `imports` from it. Measured cost of the analyzer half on element-plus: **594 edges**, which is why it is not applied unilaterally against a floor of `unexplained ≤ 3` |
| `calls` | `uses` for `f(x)` where `f` is a declared `@function` — **144** edges, 100% resolved | 211 such call sites across 16 files; the oracle already derives them, as `uses` | change `case "call_expression"` in `deriveScssEdges` to push `calls`, and add `calls` to the scss allowlist. The analyzer half alone reads as N MISSING against an oracle that still says `uses` |
| `extends` | `uses` for `@extend` — **414** edges | 437 `@extend` statements; `@extend` IS inheritance and `uses` is a neighbour that loses the meaning | change `case "extend_statement"` in `deriveScssEdges` to push `extends` and to read a `placeholder` (which sits under an `ERROR` node, so the read has to be a deep search, not `kidOf`). `extends` is admitted by the harness's base allowlist for every language, so no allowlist edit is needed |

These are declared deferrals with reproductions, not oversights — the same posture the
lane took on the CSS oracle's comma-group defect, and for the same reason: the file is
shared with a gated lane and the change has to be measured on both sides at once.

### The `@extend` resolution finding, measured on the tree

`uses` resolves at both ends on **439 / 799 (54.9%)**, and the aggregate hides three
constructs with three different reasons for an absent endpoint
(`script/m14/tmp/scss-uses-resolution.ts`):

| construct | edges | both-ends resolved |
| --- | --- | --- |
| `@include` → a declared mixin | 153 | **153 / 153 = 100%** |
| `f(x)` → a declared `@function` | 144 | **144 / 144 = 100%** |
| `@extend`, top-level shape | 90 | 2 / 90 = 2.2% |
| `@extend`, recovered shape (inside a rule body) | 320 | 49 / 320 = 15.3% |
| delegated CSS (`@keyframes`, `@mixin` references) | 88 | 88 / 88 = 100% |
| `exports` | 3,465 | 3,465 / 3,465 = 100% |
| `overrides` | 16 | 16 / 16 = 100% |

The low `@extend` rate is a **cross-file** property, and it is measured on the parse tree
rather than asserted (`script/m14/tmp/scss-extend-tree-witness.ts`): of the corpus's 437
`@extend` statements, **108 name a selector their own file writes** and **329 name one in
another file** — `%block` is declared in bulma's `_utilities.scss` and extended from
`docs/_sass/docs/code.scss`, `h1` is extended from bootstrap's `_type.scss` and declared
in `_reboot.scss`. Silence on the 329 is SCSS-L7 doing its job; publishing an endpoint for
them would be the phantom M60 R7 forbids.

The residue that IS addressable: 108 declared-here targets against 54 resolving edges, so
**at most ~54 edges name a selector the file writes and the lane does not publish under
that name**, overwhelmingly a `%placeholder` the CSS lane publishes under its resolved
(nested) name. The two probes spell a small number of targets differently — one reads
`&.is-transparent` where the other reads `.is-transparent` — so the figure is an upper
bound and is stated as one.

### The recovered `@extend` shape: 63 of 99 statements were invisible

A grammar fact, not a walk bug, and it is the largest single recall gain this lane has
measured. The `extend_statement` RULE is written for a top-level `@extend`; the same text
nested in a `block` parses as

```
block > ERROR > "@extend", placeholder, ";", ERROR("or", ":", …)
```

so the statement's own node type never appears, the keyword survives only as an
**anonymous** token, and a walk over named children never sees either. Measured: **676**
`@extend` tokens and **99** `extend_statement` nodes in 4,394 files — 85% of the tokens
are in the recovered shape — and `.card { @extend %badge; }`, which is where a BEM
codebase puts nearly every `@extend`, produced **no edge at all**. The lane now recognises
the recovered form **by its keyword**, not by shape (checking for "an ERROR containing a
selector" would fire on every broken declaration) and marks those edges
`scssRecoveredFromError` + `scssExtendShape: "recovered"`, so a claim read out of a region
the grammar gave up on is distinguishable from one read cleanly.

An **interpolated** placeholder is still refused: `%responsive-container-#{$bp}` leaves the
prefix `%responsive-container-`, which names no selector and resolves to no symbol, so the
guard requires the placeholder's text to end in an identifier character. Measured on the
tree: 1,081 of the 2,668 `placeholder` nodes sit under an `ERROR` and are interpolated
half-selectors, and 1,587 sit in a `selectors` node. Pinned by three `forbidRelationships`
rows in `placeholder-selectors-and-extend`.

### DERIVATION findings

**0 at handover, and the two types added here make it 2.** A DERIVATION finding is a type
the analyzer emits that the differential never audits. `exports` and `overrides` are both
emitted and both are compared against nothing, because the fix for each is in
`deriveScssEdges`:

- `exports` — the harness allowlist filters the **analyzer** side, and `exports` is in no
  scss entry, so the 3,465 edges are dropped from the comparison entirely. The row prints
  `COMPARED WITH NO TRUTH: exports (0 comparable, 0 truth)` once the entry exists; today
  they are unmeasured, which is the "349,468 rows went unmeasured across five review
  rounds" shape the differential's own header records.
- `overrides` — `overrides` IS in the base allowlist for every language except
  csharp/dart/swift/cpp/go, so all 16 edges are compared and all 16 land in
  `unexplained`. Measured on element-plus's 60-file sample: `unexplained` 1 → 11,
  `unexplained-by-label: overrides=10, references=1`, with `MISSING` unchanged at 30.

Paying either down needs the same shared change as the three reported GAPs, which is why
they are reported together.

## What is measured, and what is not

### The production census, 4,394 files / 21 repositories

Every count below comes from `parseFile` (`src/ast/pool-worker.ts`) over the whole
admitted corpus. Symbol hygiene, which the standing rules make non-negotiable and which no
count in this lane had been reporting:

| | |
| --- | --- |
| files admitted / parsed | 4,394 / 4,394 (0 threw) |
| symbols | **38,262** |
| symbols with an **empty name** | **0** |
| symbols with an **empty kind** | **0** |
| symbols with kind `unknown` | **0** |
| relationships whose source or target is the literal `unknown` | **0** |
| edges with `confidence < 0.7` | **0** — every SCSS-emitted edge is a deterministic parse fact |

Symbol kinds: `class` 23,074, `variable` 5,558, `module` 4,594, `type` 2,617,
`function` 1,083, `interface` 964, `namespace` 229, `property` 143. The `module` count is
4,594 because it is now one per file plus the CSS lane's `@media`/`@layer` scopes.

Two consecutive runs of the same census differ by ±1 file, ±3 symbols and ±1 `contains`
edge — `38,259`/`11,778` on one run and `38,262`/`11,779` on the next — and the difference
is SCSS-L14: `consul/.../check-hexagon/property-16.scss` either parses or trips the pooled
wasm path's 120-second stall, so its 6 symbols and its containment edge are present or
absent depending on the run. Every other number above is stable across the two runs.

### Resolution per type, on the current corpus

| type | edges | both ends resolve | one end |
| --- | --- | --- | --- |
| `contains` | 11,779 | **11,779 = 100%** | 11,779 |
| `exports` | 3,465 | **3,465 = 100%** | 3,465 |
| `overrides` | 16 | **16 = 100%** | 16 |
| `uses` | 799 | 439 = 54.9% | 799 |
| `references` | 6,260 | 2,759 = 44.1% | 6,260 |

`uses` and `references` are decomposed by construct in the ontology section above; the
short version is that every edge this lane emits from an SCSS-specific construct resolves
at both ends except `@extend`, whose targets are 76% cross-file by the language's own
modularity, and that the `references` shortfall is the delegated CSS `var()` class, which
is the CSS lane's behaviour meeting a stylesheet set that consumes Element Plus theme
tokens defined in a different file. The behaviour is identical when identical input is run
through both lanes.

**Both-ends resolve is a property of the corpus, not of the lane.** On the 244-file corpus
this lane was measured on before `consul`, `vault`, `nomad` and `waypoint` were added, the
same three numbers were `contains` 2,225/2,225, `uses` 41/41, and `references` 223/223 for
the lane's own `$var` reads — so the aggregate moves with the corpus while the per-construct
resolution does not.

## Declared limitations

- **95 of 244 files still do not parse.** All modern Sass the 1.0.0 grammar plus two
  patches cannot represent. The residual is a **long tail** — the largest class is 24
  error spans and most are under 20, against a single 277-span class before patch 1/2.
  The largest coherent group remaining is a **namespaced function call**,
  `map.merge($a, $b)`, at 12 spans. Evidence: `validation/m14/results/scss-grammar-ab.json`.
- **`@forward 'x' as prefix-*;`** — the *prefix* form of the `as` clause. Supporting it
  needs `repeat1(seq('-', …))` after the name, which tree-sitter reports as an
  unresolved conflict with `binary_expression`. It occurs **zero** times in 40,521 lines
  of corpus, where 359 uses are `as *` and 1 is `as common`. Declared, and carried in the
  A/B as `forward-as-dashed-prefix` with verdict `unchanged-broken` — an unsupported form
  named in the evidence is a different claim from one absent from it.
- **`#{$x}px`** — interpolation followed by a unit. Occurs **zero** times in the corpus;
  the 33 interpolations followed by anything are inside names and strings
  (`#{$prefix}body-bg`). A fixture that pinned this form was written and then corrected,
  because a fixture is supposed to pin constructs that exist.
- **A map literal in an `@each` list** — `@each $k in (a, b)` parses,
  `@each $k, $v in (a: 1)` does not. Zero corpus occurrences; pinned by
  `error-recovery-is-reported` at `atLeast: 1` so the failure stays **visible**.
- **SCSS-L8 — `map.merge((…), $default)`, the largest parse-failure class in the corpus.**
  A three-attempt patch was written, built and measured, and **reverted rather than
  shipped**; the evidence is here so the next attempt starts from it rather than from
  the idea.
  - *A `map_value` rule in the general `_value` hierarchy*, beside `list_value`, which is
    where a Sass value belongs by rights. It fixed 5 files and regressed none — and drove
    **ERROR nodes from 3,900 to 8,056** across the 244-file corpus. The file-level A/B
    reported "0 regressed" and saw none of it, because the files that gained errors were
    already failing and stayed in the same bucket. A metric that counts files cannot see a
    change in the quality of the recovery inside them; the error count is the measurement
    that noticed, which is why both are reported from here on.
  - *The same rule scoped to call arguments*, overriding the inherited CSS `arguments`
    rule: 4 files fixed and **9 regressed**. Overriding that rule perturbs every function
    call, `translate()` and `rgba()` included.
  - *That override with `prec.dynamic` inside the argument choice*: worse still.
  - The trailing-comma half alone was clean but thin — 0 files fixed, 0 regressed, 54
    fewer error nodes — below the bar patches 1/2 and 2/2 set, and not worth carrying a
    node type for.
  The reason the failure looked arbitrary is the thing to understand: a **single-pair**
  map `('a': 1)` is ambiguous with the CSS `parenthesized_value` rule and loses to it,
  while **two or more** pairs parse, because a comma resolves the conflict before
  precedence is consulted. `prec.dynamic` changed nothing because the conflict is
  resolved when the parser is *generated*, so a post-parse preference is never consulted.
  So this is a grammar **redesign** — how maps are represented in the value hierarchy —
  not one more rule beside `list_value`. The prize is 153 of 167 measured `map.merge`
  calls; the ceiling stands where the table above records it until then.
- **`.sass` and `.less` still route to the CSS analyzer** and are declared. Zero files of
  each across 13 corpora, so this repo can neither support nor refute a claim about them.
- **SCSS-L7 — cross-file resolution.** A `@function` call resolves only against functions
  the same file declares; so do an `@include` of a mixin and a `t.$brand` read through a
  namespace, where the module's declaration is in a partial this file never sees. This is
  the no-phantom rule doing its job rather than a shortfall in it — an undeclared
  `@include` was silent for exactly the same reason, and inventing the endpoint is the
  fabrication this lane removed once — but it is a real boundary, and it is the reason a
  function-call edge is emitted for `double(4px)` and not for a function two files away.
  Recorded because the alternative is a reader assuming the silence is an oversight.
- **The grammar is a dependency, not vendored source.** `grammar.js` line 9 is
  `require('tree-sitter-css/grammar')`, so the build needs
  `npm install --no-save tree-sitter-css@0.20.0` and is **not self-contained**. The
  package declares `^0.20.0`, a range, so the exact version is pinned in
  `verify-grammar-pins.ts` — a range is not a pin.
- **SCSS-L9 — `overrides` covers one class of three, and says so.** Only a `!global`
  reassignment of a top-level binding becomes an `overrides` edge (16 occurrences). A
  second `@mixin`/`@function` declaration is expressible in Sass and measures **0** across
  4,394 files, so no branch fires and a corpus that used one would still be silent. A plain
  same-scope reassignment (422, of which 171 read the variable they assign) is
  deliberately **not** an override: an accumulator mutating one binding is not the
  replacement of a declaration, and the identity ruling makes the two assignments one
  symbol, so the edge would be a self-edge. Stated because a reader seeing one `overrides`
  edge in a corpus with 422 reassignments would otherwise assume the other 422 were
  classified and rejected rather than not considered.
- **SCSS-L10 — `exports` and `overrides` are compared against nothing.** Both are
  implemented and both are DERIVATION findings until `deriveScssEdges` derives them; the
  workstream's own remedy is the full mirror in one commit, and `deriveScssEdges` is shared
  machinery. Measured cost of leaving it: 3,465 `exports` edges unmeasured (the harness
  allowlist filters the analyzer side, and `exports` is in no scss entry) and 16
  `overrides` edges counted as confident fabrications — 10 of them on element-plus's
  60-file differential sample, which takes `unexplained` from 1 to 11 against a declared
  floor of 3.
- **SCSS-L11 — three GAPs are reported, not implemented**: `imports` as a relationship
  (594 edges on element-plus, sourced from the file's own module name the way
  `deriveCssEdges` already does for CSS), `calls` for the 144 `@function` call sites, and
  `extends` for the 414 `@extend` edges. Each is a label or a channel the shared oracle
  fixes in the same commit; see the ontology section for the exact change. Until then a
  consumer reading `uses` cannot tell a function call from a mixin inclusion by label alone
  — `metadata.isScssFunctionCall` and `metadata.isScssInclude` are what distinguish them,
  and they are pinned by fixtures and mutants.
- **SCSS-L12 — a module's surface is inferred from scope, not from a declaration.** Sass
  has no `export` keyword: a top-level declaration is public because that is what `@use`
  binds, and a `-`/`_` prefix is private by the same convention Python and Ruby use. The
  convention is read from the first character of the name, so a stylesheet that wants a
  private member under an ordinary name has no way to say so and this lane will report it
  as public. Measured: 30 private top-level assignments in 4,394 files, so the rule is
  exercised; nothing measures how often it is wanted and not expressed.
- **SCSS-L13 — 156 top-level `$var` reads and 1,491 top-level `@include`s emit no edge.**
  Nothing published encloses them: a statement at a file's top level has no owner, and the
  module symbol introduced for `exports` is deliberately **not** registered as one. Making
  it an owner would convert both populations, and every such edge would be new surface the
  shared oracle does not derive — so the silence is pre-existing, unchanged, and named here
  rather than left to be discovered as a bug.
- **SCSS-L14 — one corpus file stalls the wasm parser under concurrency.**
  `consul/ui/packages/consul-ui/app/styles/base/icons/icons/check-hexagon/property-16.scss`
  produced `[BB-HANG] parser stuck 120s` and `[BB-PARSE-ERR] … memory access out of bounds`
  in the 8-worker `parseFile` census, twice, while the same 842-byte file parses in **7 ms**
  with a fresh parser and the same wasm. So it is a concurrency/memory fault in the pooled
  wasm path, not a grammar fault in that file — and nothing here measures the rate, so
  "one file in 4,394" is an observation from one run and not a rate.

## Verification

- **grammar**: `script/m14/verify-grammar-pins.ts` — source↔wasm exact on all 84 declared
  names; A/B at `validation/m14/results/scss-grammar-ab.json` (76 fixed, 0 regressed,
  3 regression controls unchanged-clean).
- **fixtures**: **11 / 11** in `run-fixtures.ts --lang scss`. Expectations are authored
  from the rulings, never transcribed from analyzer output — which is the only reason they
  could fail. Two are new (2026-10-03): `module-exports-and-global-overrides` and
  `placeholder-selectors-and-extend`.
- **mutants**: **23 in the registry, 0 survivors**, via
  `bun run script/m60/scss-mutant-check.ts` → `script/m60/tmp/scss-mutant-check.json`.
  Five are new (S11–S15) and all five are caught by the fixtures above. Four survived the
  first run in an earlier wave and all four were gaps in the suite: two were **bugs in the
  mutants** (one rewrote only already-resolved sources, so it was a no-op; one wrote
  `{...s, ...rest}` after destructuring `parameters` out, which **restores** the key), and
  two were missing pins (no `line_number` assertion anywhere, and a `forbidRelationships`
  row that named only one spelling of a phantom target).
  **The registry is not wired into the shared runner**: `grep -rn SCSS_MUTANTS script/`
  returns the definition in `script/m60/scss-mutants.ts` and **no import site**, so
  `bun run script/m14/mutate-analyzer.ts` never executes this lane's mutants. The lane
  runner imports the transforms rather than mirroring them (a check that reimplements the
  transform is a check of itself) and declares its own scope: it evaluates
  `expectSymbols`, `expectSymbolCount`, `expectRelationships` and `forbidRelationships`
  and NOT `expectParameters`, `expectImports`, `expectErrorCount`, `expectMetadata`,
  `forbidSymbols` or `forbidDecorators` — so it reports 3 mutants as
  `OUT-OF-SCOPE` rather than as survivors, because their witnesses live in sections it
  does not read. §8 asks for the one-line shared change.
- **ontology census**: `script/m14/tmp/scss-ontology-harness.ts` →
  `script/m14/tmp/scss-ontology-harness.json`; ruling probes in
  `script/m14/tmp/scss-ontology-probes.ts`; per-construct resolution in
  `script/m14/tmp/scss-uses-resolution.ts`; the `@extend` cross-file witness in
  `script/m14/tmp/scss-extend-tree-witness.ts`.
- **census**: `script/m14/tmp/scss-analyzer-census.ts` →
  `validation/m14/results/scss-analyzer-census.json`.

### The shared ontology gate cannot run this lane, and that is a reportable fact

`script/m14/ontology-coverage-gate.ts` refuses any language with no entry in
`RULED_BY_LANG`, and `scss` has none:

```
ontology coverage gate — no RULING TABLE for scss.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

It exits 2 before printing a row, which is the correct refusal and leaves this lane
without an arbiter. `RULED_BY_LANG` is shared machinery (§8), so the gate was not edited.
The four verdicts this section carries are produced by
`script/m14/tmp/scss-ontology-harness.ts`, which reports the same four statuses with the
same two instruments over the same corpus; adding `scss: SCSS_RULED` to the shared table
and pointing it at this lane's two probes is the change that would let the shared arbiter
answer instead.

### Also verified

- **F1** (`audit-analyzer-grammar`): `refs=22 unknown=0 unknownFields=0`. Registering
  the lane is what found the two defects below — the gate asks whether every node-type
  name the analyzer mentions exists in the wired grammar, which reading the code cannot.
- **F8** (`verify-corpus-census`): `files=60 err=26 types=56 blind=0` on element-plus.
- **completeness spec** (`script/m14/spec/scss-completeness.json`, generated by
  `script/m14/tmp/scss-spec-generate.ts`, byte-reproducible):
  `16 handled_verified + 70 internal_silent + 0 gap` over 84 named types,
  **0 unadjudicated cells**, and 6 declared limitations (SCSS-L1..L6).

  The spec does NOT restate the 60 CSS-inherited types. The SCSS grammar extends the
  CSS one, so those are adjudicated in `css-completeness.json` and reached here through
  the delegated walk; 60 duplicated rulings would rot the moment either grammar moved
  and nobody would notice which half had gone stale. They are recorded as
  `adjudicated: "inherited"` with a pointer, which is a resolution with a source rather
  than a silence.

### Two more defects, found by F1 the moment the lane was registered

Both are in the SCSS analyzer, both shipped green through five fixtures and fourteen
mutants, and neither is visible by reading the code — a type literal that names nothing
is how an extractor silently stops matching, and the name is *plausible*.

1. **`content_statement` does not exist in this grammar.** The rule list has no such
   type and `@content` parses as a bare `at_rule > at_keyword`, so the `case` for it
   could never fire and `scssForwardsContent` was set by nothing, ever. Now matched on
   the keyword, which is what the tree actually offers.
2. **`type_selector` does not exist either.** The selector types are `class_selector`,
   `id_selector`, `universal_selector`, `attribute_selector`, the pseudo forms, the
   combinator forms and `nesting_selector` — and a bare element selector is a
   `plain_value`. So `@extend p` found nothing while `@extend .btn` worked.

### The differential: no fabrication, and the residue is characterised

```
CSS    svelte      100%  MISSING=0  unexplained=0 (0%)
       grails-core 100%  MISSING=0  unexplained=0 (0%)
SCSS   element-plus  95.6%  MISSING=32  unexplained=0 (0%)
```

**`unexplained=0` is the number that matters.** It is the fabrication direction: every
edge the analyzer emits is accounted for by an independent derivation. It went 21 → 0,
and getting there exposed three defects in the analyzer that the fixtures and the
mutants had both missed.

What the residue is, rather than a percentage — from
`script/m14/tmp/scss-diff-classify.ts`, which is read-only and prints a row it cannot
label instead of dropping it:

| class | direction | what it is |
| --- | --- | --- |
| unresolvable custom property | unexplained | the DECLARED `var()` class (SCSS-L6); this lane's own `$var` reads are 223/223 |
| interpolated-`&` naming | both | one naming disagreement in two error-free files, needing grammar-level reading of `&` inside a `#{…}` selector |
| `common/var.scss` | both | 1,716 lines with over 400 disjoint ERROR spans; the truth is unreliable there by construction |

### Three analyzer defects the differential found and the fixtures had not

1. **Two identically-named control-flow scopes collapsed into one.** `checkbox.scss`
   has two `@each $size in (large, small)` (L76 and L266). The identity rule is right for
   a `$variable` — one thing assigned in several places — and wrong for a *scope*: two
   loops in two nesting contexts are two constructs at two places in the file. Collapsing
   them lost the second scope, and with it the owner of everything inside it, so every
   `$var` read in the second loop emitted no edge. 7 MISSING rows that were the analyzer
   losing information. Now disambiguated the way the dart lane already does
   (`root.child` / `root.child#2`), pinned by `identically-named-scopes-are-distinct`
   and reverted by mutant S10.
2. **A `$var` read inside a `@return` emitted nothing.** The `return_statement` case was
   removed when the self-edge was fixed, and the read scan went with it because the two
   shared a case. A function published its own body variables and nothing recorded that
   it consumed them.
3. **The truth was blind where the grammar fails.** The oracle stopped at the first
   `ERROR` node while the analyzer recovers through them. `common/var.scss` is 1,716
   lines with over 400 disjoint ERROR spans, and the oracle saw almost none of it.

### The CSS lane, throughout

100% / 0 unexplained on both corpora, at every step. That is the result worth having:
registering a second lane against a shared oracle found **four defects in that oracle**
— comma-group unit resolution, the missing cross-product, the `&`-as-name class, and the
unquoted `url()` branch — none of which its own corpora could see. A fixed sample
proves the sample.

### F3 A–H: 8/8, and GATED — with a declared floor, not a clean one

```
scss: 92 types classified; sections A-H: 8/8 pass
```

and `scss` is in `GATED_LANGS`. It is the **second** lane to arrive with a documented
residual floor rather than a clean 0/0 — `c` (C-D4) is the first, on the same grounds: a
language whose honest floor carries ruled residuals records them, and the gate checks the
row against the ruling exactly, so a regression above **60/4** fails while the declared
residue does not.

The floor came **down** from 64/4 during 2026-09-28, and the direction matters as much as
the number: two recall defects were fixed, found by checks that were independent of this
lane's own fixtures. Both are recorded in full below and in `reviews/m49-scss-review.md`.
Current full-extent row:

```
truth 1606   covered 1546 (96.3%)   MISSING 60   unexplained 4 (0.9%)   13.8 ms/file
```

The floor is FULL-EXTENT — all 149 corpus files — because a 60-file sample is a
**rotation**: the same corpus produced `MISSING=32`, `36` and `106` across three draws,
and a gate that fails at random teaches people to re-run it.

Three sections needed real work to reach green, and each found something:

- **B (relationship kinds)** reported `imports` unpinned for a lane whose fixtures pin
  it correctly. The check read `expectRelationships` only, and an `imports` edge is
  pinned through the result's `imports` array — a gate checking the wrong channel
  produces a false failure, which is worse than no gate.
- **C (payload matrix)** wanted a complexity pin, and the CSS matrix fixture is written
  in CSS — it cannot exercise a mixin's parameter count or an `@if`/`@else` chain, which
  are exactly the constructs that make SCSS complexity differ. New fixture
  `scope-containment-and-complexity` pins both, and the `contains` edge it adds is the
  one thing a **delegation** can silently stop doing without any local test noticing.
- **Loading the spec** failed four times on `spec.gap.gaps` and
  `spec.design_decision.decisions` being absent. A spec with no gaps is the GOOD case,
  and the loader was reading it as a crash.

### Two independent checks, and the five defects they found

Until 2026-09-28 this lane's lines were pinned only by its own fixtures, and it had no M12
ground truth at all. Both gaps are closed, and neither closed cleanly — which is the point
of recording them, because in both cases a self-consistent check would have passed.

**M59 line oracle.** `scss` was absent from the oracle's lane table, so nothing checked its
lines against source: the only pins were authored by the same person who wrote the
analyzer, which is weaker in kind and not in degree. Registering it found two things.

1. *A false INCONSISTENT, in the checker.* The oracle chose its name-reading rules with
   `lang === "css"`, so `scss` fell through to the generic call-name reader, which cannot
   read a selector group — it took the last comma part and looked for it on a line
   carrying the first. A correct edge was failed by a checker that had never been told
   the lane exists. A lane that reuses another lane's edges must be routed to the same
   verifier; it is now a named set with four self-tests.
2. *Ten real defects, in this analyzer.* The five scope edges (`@media`, `@supports`,
   `@layer`, `@container`, `@scope`) claimed the `selectors` node's line unconditionally,
   but the target is the **resolved** name and a nested rule's resolved name composes to
   parent + own. The line writes `&:nth-child(odd)` or `th`; the edge named
   `table tbody:first-of-type tr:nth-child(odd) th`. This was the lane's own rule applied
   to one edge family too few — the nested-selector edge beside it already compared
   written text against composed name and dropped the line when they differed. Both
   families now read one hoisted answer, and the 10 edges moved from with-line to no-line,
   which is the honest outcome: a name the line does not write is never checkable rather
   than silently unaccused.

Nothing in pure CSS nests the way SCSS does, so the CSS corpus rarely reaches this and read
86/86 on the strength of that rarity. A corpus chosen because it parses cleanly measures
the grammar's comfort, not the lane's health.

**M12 hand audit.** `validation/m12/ground-truth/scss.json` is a hand audit of the fixture
written from the source and the Sass specification — `truthSource: manual_audit`, and only
the SCSS-specific constructs, because auditing the shared CSS subset twice would exercise
one code path under two names. On its first run: **9 expected, 8 observed, recall 0.889.**

3. *A called function was invisible.* `width: double(4px)` produced no edge while
   `$radius` on the line above did — the same class of claim, one of the two implemented.
   A declared function could not be reached from its call site. Both ends must resolve,
   which is what keeps `calc`, `var`, `rgba`, `min` and `url` silent; that is also Sass's
   own precedence, since a user function shadows a builtin of the same name.
4. *The walk stopped at ERROR.* Reads and calls were found by a walk that `continue`d on
   an error node, so every claim nested inside a region the grammar had lost was
   invisible — while the rest of this lane recovers through errors and the differential's
   own SCSS oracle descends into them on purpose. That asymmetry is not neutral: it made
   the lane miss claims exactly where element-plus concentrates its residue.
   `common/var.scss` alone carries over 400 error spans.
5. *The oracle could not see the new class.* An edge the analyzer produces and the truth
   cannot derive reads as `unexplained` — the signal that the truth is blind, not that the
   analyzer invented something. It sat at 8 with every new call edge counted against the
   lane until `deriveScssEdges` grew the matching case.

Recovered claims now carry `metadata.scssRecoveredFromError`, because a claim recovered
from a broken region should be distinguishable from one read cleanly. The fixture that
pins this carries a **contrast** rather than a count, because a count cannot catch it: the
same `$brand` is read once inside the error region and once cleanly three lines later, so
a walk that never looked inside the error and one that looked and found nothing produce the
same edge count.

### Still not verified, or bounded

- **Cross-file resolution (SCSS-L7).** A `@function` call, an `@include` of a mixin from
  another partial, and a `t.$brand` read through a namespace resolve only against what
  *this file* declares. That is the no-phantom rule doing its job — an undeclared
  `@include` was silent for the same reason — and it is the honest boundary of the
  function-call fix. Cross-file resolution is not implemented and is not claimed.
- **The remaining residue is characterised, not eliminated.** 8 unexplained rows are the
  declared `var()` class, 3 are a `&` whose referent is a call site outside the file,
  and the rest are in the file with 400+ ERROR spans. See the table above.

### The differential runs, and it is NOT green — with a measured cause

`deriveScssEdges` exists (in `script/m14/differential.ts`, importing nothing from
`RealScssAnalyzer`) and the lane is registered in the differential. On element-plus,
40 files:

```
TR=231  cov=122 (52.8%)  MISSING=109  unexplained=11 (9.6%)
```

That row is **not** 52.8% good, and the cause is measured rather than guessed. Every
divergence is in two classes, and both are the **CSS oracle's**, not this lane's:

| class | count | cause |
| --- | --- | --- |
| `contains` | 44 missing, 7 unexplained | the CSS oracle does not resolve a comma group through a nesting parent |
| `references` | 9 unexplained | the analyzer emits a `var(--x)` read unconditionally; the oracle only derives a read whose property the file declares |

The first has a four-line minimal reproduction that is **grammar-independent** — it
reproduces identically under `tree-sitter-css` and `tree-sitter-scss`:

```scss
.doc-content {
  h1, h2 { color: red; }
}
```

```
analyzer publishes   .doc-content h1, .doc-content h2   <- each item resolved
CSS oracle derives   .doc-content h1, h2                 <- the authored text
```

The analyzer's spelling is the correct one: it is what makes both ends of the edge
resolve, and resolving each item is why a comma group's members are individually
addressable at all. The CSS lane's own differential is 100% because its corpora do not
exercise this shape — which is the same lesson the lane has learned twice today, in a
third place. It is a real defect in a **shared, gated** component, discovered by a lane
that is not the one that owns it.

It has deliberately **not** been fixed here. `deriveCssEdges` is shared with a gated
lane that currently passes 8/8 and 100%, it lives in a file another lane is editing, and
the change needs to be measured against **both** lanes at once — a fix that improves
SCSS and moves CSS is not obviously a fix. That is a deliberate, declared deferral with
a reproduction attached, not an oversight.

The registration itself is still correct and was needed to get here: with `scss` in no
comparable-label allowlist, **every** analyzer edge was filtered out and the row read
`cov=0 MISSING=45` — which looks like an analyzer that emits nothing rather than a
comparison that was never switched on. That is the fourth instance of the same harness
gap the `#910` (c imports), `G7` (groovy uses) and powershell-`contains` notes record.

## Three defects the fixtures found in the first implementation

Worth recording because none of them was visible by reading the code, and all three were
in code that had already been committed:

1. **`!default` / `!global` were never detected**, so 210 assignments in the corpus were
   recorded as carrying no flag. Two bugs stacked: the walk used `namedChild` and the
   flag is two **anonymous** nodes (`declaration > integer_value, "!", "default", ";"`),
   and the test looked for the string `!default` in a single node's text when the `!`
   and the word are separate nodes. Now matched on the anonymous node's **type**.
2. **`@use 'sass:map' as map;` published no namespace**, because the code excluded
   `sass:` modules as "not the file's own" — a rule nobody wrote down, and wrong, since
   the statement binds the name `map` in this file exactly as `@use './theme' as theme`
   does.
3. **A `@return` emitted a self-edge.** `contains` from a function to itself makes a
   relationship count look like evidence while connecting nothing. It is recorded as
   `scssReturns` on the function symbol instead.
