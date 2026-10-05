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
| fixtures | 12 / 12 |
| mutants | 26 / 26 caught (2 independent runners, below) |
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

| Type | In Sass | Verdict | Edges (run F: 4,433 files / 116 repos) | Evidence class |
| --- | --- | --- | --- | --- |
| `contains` | a scope contains the rules attributed to it — `@media`, `@layer`, `@supports`, a `@mixin` body, a control-flow block | EMITTED | **12,375** in 2,324 files, **100%** both-ends resolved | `structural` |
| `references` | a `$var` READ names a `$var` this file declares; plus every delegated CSS `var()` read | EMITTED | **9,350** in 1,179 files, **33.1%** both-ends resolved | `usage_contextual` / `import_based` |
| `exports` | a `.scss` file IS a Sass module: `@use './theme'` exposes its **top-level** variables, mixins and functions. An assignment in a rule, mixin, function or control-flow block is local and is not exposed; a name beginning `-` or `_` is private and is not exposed either | EMITTED | **4,019** in 325 files, **100%** both-ends resolved | `structural` |
| `imports` | `@use` / `@forward` / `@import` name another **file** | EMITTED | **3,621** in 824 files, **0%** both-ends resolved — see below | `import_based` |
| `extends` | `@extend` — Sass's inheritance: the extending selector takes on the extended selector's declarations | EMITTED (relabelled 2026-10-04) | **427** in 152 files, **13.3%** both-ends resolved | `structural` |
| `calls` | an INVOCATION of a name this file declares: `@include m` for a declared `@mixin`, and `f(x)` for a declared `@function`. 211 `f(x)` call sites exist | EMITTED (relabelled 2026-10-04) | **304** in 57 files, **100%** both-ends resolved | `usage_contextual` |
| `uses` | one thing draws on another this file publishes, **without invoking and without inheriting** — the surviving site is a rule consuming `animation: <declared @keyframes>` | EMITTED | **91** in 42 files, **100%** both-ends resolved | `usage_contextual` |
| `overrides` | one declaration REPLACES a prior one. In Sass the only case that means it is `$x: … !global` where `$x` was already assigned at this file's top level | EMITTED | **32** in 12 files, **100%** both-ends resolved | `structural` |
| `implements` | nothing in Sass is a supertype clause. Instrument A, 134 node types, 0 of 30 | RULED-SOUND | 0 | — |
| `instantiates` | nothing in Sass constructs a value. Instrument A, 134 node types, 0 of 10 | RULED-SOUND | 0 | — |

**8 of 10 EMITTED, 2 RULED-SOUND, 0 GAP.** Reproduce with
`npx tsx validation/m14/fixtures/scss/scss-relationship-census.ts 5000`, which takes the
gate's own admission rule — `detectLanguageFromPath(abs, text)` with BOTH arguments, over
`git ls-files`, under 512 KB — so the population here is the population the arbiter reads.
The arbiter's own figures, re-run on this branch's current code, walk 4433/4433 (100.0%):

```
walk: 4433/4433 files (100.0%)  newly walked 4433, resumed 0

calls         EMITTED           304 edges in 4+ files
uses          EMITTED            91 edges in 4+ files
contains      EMITTED     12,362 edges in 4+ files
imports       EMITTED      3,625 edges in 4+ files
references    EMITTED      9,337 edges in 4+ files
exports       EMITTED      3,996 edges in 4+ files
extends       EMITTED           421 edges in 4+ files
implements    RULED-SOUND       the grammar produced 150 distinct node types across the corpus and NONE expresses it
overrides     EMITTED            32 edges in 4+ files
instantiates  RULED-SOUND       the grammar produced 150 distinct node types across the corpus and NONE expresses it

emitted 8/10   ruled-sound 2   FALSIFIED 0   ruled-without-justification 0
[BB-HANG] parser stuck 120s on .../consul/.../components/informed-action/layout.scss — exiting
GATE_EXIT=1
```

Two numbers in that block are worth reading as a pair, because they are the same verdict from
two instruments over one population. The arbiter's walk is the census's file set plus the
arbiter's own admission difference, and it agrees with the census on every type to inside
the spread measured below — 12,362 vs 12,375 `contains`, 9,337 vs 9,350 `references`, 4,015
vs 4,019 `exports`. The one figure the census did NOT reproduce is `exports` 3,996 against
the census's 4,019, a gap of 23 that is larger than this lane's measured `exports` spread
of 29 across five runs only because both ends of it sit inside that spread.

**`GATE_EXIT=1` on a line reading `FALSIFIED 0` is not this lane's, and it is not the
arbiter's verdict either** — see "[BB-HANG] is an ORPHANED timer" below for the reproduction.
The verdict the arbiter computed is 8/10 with 2 sound rulings; the exit code is a stray
timer that fires after the verdict has been printed.

### `references` moved 6,594 → 9,350, and the added 2,756 edges resolve on 0 of them

This lane **delegates** its CSS half to `src/ast/real-css-analyzer.ts`, so a change there
moves this lane's edge counts without this lane changing. Merging the aggregate brought such
a change, and `references` is where it landed: **6,594 → 9,350 edges and 585 → 1,179 files**,
with the type's both-ends resolution falling **46.9% → 33.1%**. The cause is the CSS lane
publishing `@keyframes` as a scope, so a `var()` inside a `keyframe_block` now emits a
`references` edge where before it emitted none.

The resolution figure is the part that carries information rather than arithmetic. Before the
merge `references` read 6,594 edges with **3,093** resolved at both ends; after, 9,350 with
**3,093**. The numerator did not move at all across 2,756 added edges, so the added
population resolves at both ends on **0 of 2,756** — or on at most 10 of them, since the
resolved count itself moves 3,084–3,101 across five runs. A `var()` read inside a
`@keyframes` block names a custom property that the animation's own file does not declare,
which is why. This is a fact about the delegated half, not about SCSS, and it is stated here
because the lane's own doc would otherwise have kept quoting a resolution rate for a
population that no longer exists.

### `imports` was EMITTED all along, and this lane's doc said it was not

An earlier revision of this table read `imports` as **GAP — the array only, 0
relationships**, on the reasoning that `@use`/`@forward` are `use_statement`/
`forward_statement` node types which the CSS delegate's `at_rule` dispatch never sees.
**That was wrong**, and the measurement that shows it is the cheapest one in this lane:
200 admitted files through production `parseFile` produce **130 `imports` edges across 29
files**, and the whole corpus produces **3,621 across 824 files** (run F).

The reason is in the delegate, at `src/ast/real-css-analyzer.ts:3172`: it emits `imports`
for `@use` and `@forward` from an `at_rule` **keyword** test, which the SCSS grammar never
reaches — and it also emits `imports` from `case "import_statement"` at line 575, which
SCSS *does* produce. So `@import` was audited and `@use`/`@forward` were not, and the
table counted the array rather than the relationships.

`imports` resolves at both ends on **0 of 3,621 edges**, and that is not a defect to fix.
The target of an `imports` edge is a module path — `mixins/banner`, `variables-dark`,
`sass:map` — which is a string in this file and a file on disk in another, and the store
records an edge whose source is not a symbol in the file as `source_external`. The SOURCE
resolves (it is the file's own module symbol); the TARGET is external by construction, the
same handling every other language's top-level cross-file import gets. Reporting 0% here
without that sentence would read as a defect that does not exist.

The three verdicts are the workstream's, and each carries its measurement below. Counts
come from the production entry point — `parseFile` from `src/ast/pool-worker.ts`, never
`analyze()`. **The population every figure below is measured on is the gate's own: 4,433
admitted `.scss` tracked files across 116 repositories, all of them, no sampling**, so a
count cannot be a rotation of a sample. `consul` dominates it at 3,042 files with `bulma`
179 and `element-plus` 170 behind it.

An earlier revision of this paragraph quoted a DIFFERENT population for the same claims —
4,394 files across 21 repositories, named repo by repo — taken from an earlier census whose
admission rule was not the gate's. Two consequences, both of which are the reason the
population is now stated before the figures rather than after them: that list cannot be
checked against any instrument the reader can run, and it predates 95 repositories of
corpus, so the smaller per-repo numbers in it are not comparable with the ones above. The
instruments themselves are unchanged and still current —
`script/m14/tmp/scss-ontology-harness.ts` → `.json`, and
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
  published and the `@extend`s are emitted — **as `extends`**, since the 2026-10-04
  relabelling; an earlier revision of this line said `uses` and had not been updated.

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

### The three reported GAPs, and what happened to each of them

An earlier revision of this section declared three GAPs "reported rather than implemented"
on one ground: each needs a change in `script/m14/differential.ts`, which is shared
machinery this lane does not own (§8), and the workstream's rule for that is the **full
mirror** — truth AND the allowlist entry in one commit, or the label is compared against
nothing. Applying half of it is the documented failure: java (81 edges), kotlin (54),
php (163) and javascript all carried a label no oracle backed while publishing 0%
unexplained.

**That ground was sound for two of the three and wrong for the third, and the reason it was
wrong for the third is that nobody measured the oracle.** All three were re-derived
against `script/m14/differential.ts` itself, by deriving the oracle's own output:

```
$ npx tsx validation/m14/fixtures/scss/oracle-label-census.mts   # 100 admitted files
contains         449
references       323
imports           84     bootstrap-utilities.scss -[imports]-> mixins/banner
uses              33
```

| type | what this lane reported | what the oracle actually derives | verdict |
| --- | --- | --- | --- |
| `imports` | GAP — "0 relationships", needing `deriveScssEdges` to take the module name | `deriveScssEdges` **already** pushes `imports` from `use_statement`/`forward_statement` (differential.ts:20499), and the scss compared-label allowlist already admits `imports` | **The premise was false.** The lane emits 3,621 `imports` edges and the label is audited on both sides |
| `calls` | GAP (label) — emitted as `uses`, needs `case "call_expression"` to push `calls` | the oracle pushes `uses` for a `call_expression` resolving to a declared `@function` | implemented in the analyzer; the oracle half is a §8 item below |
| `extends` | GAP (label) — emitted as `uses`, needs `case "extend_statement"` to push `extends` | the oracle pushes `uses` for an `extend_statement` | implemented in the analyzer; the oracle half is a §8 item below |

The lesson is the same one the arbiter's own header records about a differential: the
analyzer and the oracle are two walkers over one grammar, so **reading the analyzer's
source cannot tell you what the oracle derives.** `imports` was written up as a GAP on the
strength of the CSS delegate's dispatch and cost this lane a wave; four lines of
`differential.ts`, read directly, said otherwise.

### The relabelling, and what it cost

`@include`, `f(x)` and `@extend` all carried `uses`. That is one label for three claims a
consumer most needs apart: a rule that **invokes** a mixin, a rule that **consumes** a
keyframes animation, and a rule that **inherits** a selector's declarations. The project's
own rule for the first two is the lua lane's, at `docs/analyzers/real-lua-analyzer.md:647`
— "a member that is called is not merely read" — and both call sites resolve to names
**this file declares**, so nothing reaches either emitter that is not a resolved
invocation. `@extend` is inheritance, and the ontology has a type for inheritance.

Measured before and after on the canonical 149-file element-plus sample:

| | before | after |
| --- | --- | --- |
| coverage | `covered=1558 (96.5%) MISSING=56` | `covered=1514 (93.8%) MISSING=100` |
| **unexplained** | **13** | **13** — unchanged |
| analyzer edges in the comparison | 437 | 423 |

The 44 new MISSING rows are the **oracle's** mislabelling, not a recall loss: the truth
rows still say `uses` and there is no longer an analyzer row with that label to match them.
The MISSING samples name it outright — `uses html.dark -> @mixin b`,
`uses @for $i from 1 through 9 -> @mixin set-color-mix-level`. And `unexplained` does not
move, because the scss compared-label allowlist filters the **analyzer** side: a
relabelled edge leaves the comparison rather than entering it as a fabrication. So the
change buys two correct labels at a cost measured entirely in MISSING rows that a
one-line oracle change deletes.

### `uses` nearly stopped firing, and that was the risk worth checking first

On a 200-file sample **every one** of this lane's 20 `uses` edges had been an `@include` or
an `@extend`. The relabel therefore took `uses` to **0**, which would have turned a
previously-EMITTED type into an unadjudicated one — the gate would have called it
RULED-UNJUSTIFIED and the lane would have gone from 8/10 to 7/10 while the graph got more
truthful.

It survives on the delegate's keyframes reference: a rule consuming
`animation: <declared @keyframes>` is neither an invocation nor an inheritance, and that is
what `uses` is for. Corpus-wide, **663 of 4,433** admitted files declare `@keyframes` and
**57** reference their own declared name through `animation`/`animation-name`; `@font-face`
(17 files) is the delegate's second such site. The fixture
`scss/invocation-and-inheritance-labels` pins all four rows in one file so this type can
never again be carried only by the two that were mislabelled.

### The `@extend` resolution finding, measured on the tree

**This section's per-construct table is a PRE-RELABELLING measurement and is kept for what
it separates, not for its aggregate.** It was taken when `@include` and `@extend` both
carried `uses`, so its rows 1, 2, 4 and 5 are now `calls` and `extends` respectively. Its
headline `uses` figure of 439/799 (54.9%) is therefore not the lane's current `uses` figure
and must not be quoted as one — the current one is **91 / 91 = 100.0%**, and the 799 is
listed again in "What is measured, and what is not" as the example of a narrower walk that
disagreed with the arbiter. What survives the relabelling is the per-construct split, which
is why the table is retained and relabelled rather than deleted
(`script/m14/tmp/scss-uses-resolution.ts`):

| construct | now labelled | edges | both-ends resolved |
| --- | --- | --- | --- |
| `@include` → a declared mixin | `calls` | 153 | **153 / 153 = 100%** |
| `f(x)` → a declared `@function` | `calls` | 144 | **144 / 144 = 100%** |
| `@extend`, top-level shape | `extends` | 90 | 2 / 90 = 2.2% |
| `@extend`, recovered shape (inside a rule body) | `extends` | 320 | 49 / 320 = 15.3% |
| delegated CSS (`@keyframes`, `@mixin` references) | `uses` | 88 | 88 / 88 = 100% |
| `exports` | `exports` | 3,465 | 3,465 / 3,465 = 100% |
| `overrides` | `overrides` | 16 | 16 / 16 = 100% |

The aggregate hid two constructs with two different reasons for an absent endpoint, and the
`uses` label was hiding one of them: the two `@extend` rows are `extends` now, so the type
whose resolution rate is low is the one the type NAME says inherits.

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

### The recovered `@extend` shape: 577 of 676 statements were invisible

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

**0 at handover; 4 now — `exports`, `overrides`, `calls`, `extends`.** A DERIVATION
finding is a type the analyzer emits that the differential never audits. All four are
emitted and all four are compared against nothing, and in every case the fix is three
lines in `deriveScssEdges` plus one allowlist entry (§8 above). The lane went from a
stated zero to four, which is a regression against the workstream's own starting position
and is recorded as one rather than netted out against the two labels it gained.

- `calls` — 304 edges. `calls` is in the base allowlist only for a fixed list of languages
  that excludes scss, and in no scss entry, so the allowlist drops them from the analyzer
  side. Before the relabelling these 304 edges were `uses` and WERE compared — so the
  relabelling converted an audited edge into an unaudited one, and that is the honest cost
  of the change, stated here rather than in the commit that made it.
- `extends` — 427 edges, same mechanism. `extends` is likewise in no scss entry.
- `exports` — the harness allowlist filters the **analyzer** side, and `exports` is in no
  scss entry, so the 4,019 edges are dropped from the comparison entirely. The row prints
  `COMPARED WITH NO TRUTH: exports (0 comparable, 0 truth)` once the entry exists; today
  they are unmeasured, which is the "349,468 rows went unmeasured across five review
  rounds" shape the differential's own header records.
- `overrides` — `overrides` IS in the base allowlist for every language except
  csharp/dart/swift/cpp/go, so all 32 edges are compared and all 32 land in
  `unexplained`. Re-measured on this branch over element-plus's 60-file sample:
  `unexplained=11 (8.1%)`, `unexplained-by-label: overrides=10, references=1`, with the
  harness printing `COMPARED WITH NO TRUTH: overrides (10 comparable, 0 truth)` — which is
  the DERIVATION condition stated by the instrument itself, not by this document.

**The allowlist was re-read against current code rather than trusted from this document.**
`script/m14/differential.ts:23331` carries the scss entry as
`["uses", "references", "imports", "contains"]` — and carries it twice, on adjacent lines,
which is harmless but is the kind of duplication that lets a later edit fix one and leave the
other. All four findings above are confirmed against that line rather than against a note
written when the relabelling happened.

Paying either down needs the same shared change as the three reported GAPs, which is why
they are reported together.

### A file can fail with no flag at all, and 134 of them do

**This section corrects the explanation the spread section above is built on.** That
explanation is "a degraded file is a total non-producer, so the run-to-run movement IS the
flaky files that happened to degrade". Three measurements on current code, and the first two
support it while the third breaks it.

**1. The degraded path contributes exactly nothing, and this is now measured directly rather
than inferred from files that happened to contribute 0.** `extractFallback`
(`pool-worker.ts:364`, exported) called over the 11 files that have each appeared in a run's
`DEGRADED_FILES` list returns **0 symbols and 0 relationships for all 11**, total `{}`. The
model holds, and for a stronger reason than the sidecar evidence gave: `extractFallback` does
build relationships, through `extractBasicRelationships`, and for scss that path yields
nothing at all.

**2. A complete per-file account of two runs over the same 4,433 files.**
`scss-census-run-diff.ts` over the run-G and run-H sidecars: 4,425 files stable, **8
differing**, 0 present in only one run. Five of the eight are flagged degraded in exactly one
run, and their deltas are exactly what (1) says they should be — `v4-shims.scss` imports −3,
`debug.scss` contains −4 / extends −4, and three `property-16.scss` sheets ±1 contains.
The instrument also prints, from the sidecars themselves: `3 of 8 differing files were NOT
flagged degraded in either run`.

**3. Those three are `brands.scss`, `regular.scss` and `solid.scss`, and the census could not
see them.** Run I's new per-file flags record, for each:

| file | `fallback` | `degraded` | parse errors | relationships | `imports` |
| --- | --- | --- | --- | --- | --- |
| `bulma/…/fontawesome-free-6.5.2-web/scss/brands.scss` | false | false | **44** | 1 | 1 |
| `bulma/…/regular.scss` | false | false | **44** | 1 | 1 |
| `bulma/…/solid.scss` | false | false | **44** | 1 | 1 |

Each is present in both sidecars — it did not throw — carries no flag, and records `{}` in
the run where it lost its edges. So a file can reach production `parseFile`, return nothing,
throw no error, and be counted as CLEAN by a census whose only health counter is a flag it
does not set. This is also what removes the sign problem from the spread section: the
8-degraded run read MORE `imports` and MORE `exports` than the 0-degraded run, which is
impossible if degradation only subtracts, and it is possible because unflagged files gain and
lose edges too.

**The population behind the mechanism, which is larger than the three movers.** The census now
counts it: **728 of 4,433 files carry at least one parse error, and 134 of those carry errors
AND zero relationships with neither `fallback` nor `degraded` set** — 3.0% of the corpus,
across 13 repositories (bootstrap 34, bulma 23, element-plus 17, pico 16, consul 12,
waypoint 8, sass-spec 6, wagtail 6, primer-css 4, spectre 3, hasura-engine 2, vault 2,
nomad 1). The candidate path is visible in the source: `engine.ts` returns a result whose
`relationships` are empty and whose `errors` are populated when a parse yields ERROR nodes,
and `pool-worker.ts:1180` forwards exactly that, leaving `fallback` unset.

**What is NOT established, stated rather than guessed.** Why a given file loses its edges in
one run and not the next. A dedicated probe parsed those three files 120 times each at
concurrency 8 through production `parseFile` — 360 parses — and read `rels=2` on **every**
one, so the trigger does not reproduce at this machine's current load.
`scss-flaky-files.ts` calls all three "stable 8/8" because it measures stability alone, and
alone they are stable; under the census's 8 workers over the whole corpus they are the least
stable files in it. The mechanism stays open, and no fix is proposed for a cause that has not
been identified.

## What is measured, and what is not

### The production census, 4,433 files / 116 repositories — the whole admitted corpus

Every count below comes from `parseFile` (`src/ast/pool-worker.ts`), over **every** admitted
file rather than a sample: `admitted .scss 4433 tracked files`, `sampled 4433`, `repos
represented 116`. Reproduce with `npx tsx validation/m14/fixtures/scss/scss-relationship-census.ts 5000`.

An earlier revision of this section reported `4,394 files / 21 repositories`. That was a
narrower walk and it disagreed with the arbiter on `uses` (799 edges there, 91 here) and on
four other types, so the arbiter's numbers and these are now the same population. Where this
document quotes a census figure and an arbiter figure as a pair, the residual difference is
the degraded-file class below.

Symbol hygiene, which the standing rules make non-negotiable and which no count in this lane
had been reporting:

| | |
| --- | --- |
| files admitted / parsed | 4,433 / 4,433 (0 threw) |
| files with >=1 edge | 4,009 / 4,433 (run F) |
| files on the degraded fallback path | **0** in run F; 0–8 across the five current-code runs |
| files carrying >=1 parse error, none flagged | **728**, of which **134** carry errors AND zero relationships |
| symbols | **39,665** (39,698 in run I) |
| symbols with an **empty name** | **0** |
| symbols with an **empty kind** | **0** |
| symbols with kind `unknown` | **0** |
| relationships whose source or target is the literal `unknown` | **0** |
| `ParseResult.imports` entries | 5,360 |
| edges with `confidence < 0.7` | **0** — every SCSS-emitted edge is a deterministic parse fact |

Symbol kinds (run F): `class` 23,682, `variable` 6,117, `module` 4,642, `type` 2,744,
`function` 1,103, `interface` 1,005, `namespace` 229, `property` 143. The `module` count is
4,642 because it is one per file plus the CSS lane's `@media`/`@layer` scopes.

### The census is NOT reproducible, and the spread is measured rather than described

Five runs of that one script over the same 4,433 admitted files
(`validation/m14/fixtures/scss/scss-relationship-census.ts 5000`, deterministic file set —
sorted admitted list, every Nth) disagree. **Two sets of runs are tabulated because they are
measured on different CODE, and the second set is the one that describes this branch.**

Current code (post-merge), runs E–I, 4,433 files each:

| run | degraded | `contains` | `imports` | `references` | `exports` | `extends` |
| --- | --- | --- | --- | --- | --- | --- |
| E | 8 | 12,373 | 3,625 | 9,336 | 4,021 | 427 |
| F (the table above) | 0 | 12,375 | 3,621 | 9,350 | 4,019 | 427 |
| G | 2 | 12,373 | 3,619 | 9,350 | 4,019 | 427 |
| H | 3 | 12,370 | 3,618 | 9,350 | 4,019 | 423 |
| I | 2 | 12,374 | 3,636 | 9,353 | 4,048 | 427 |
| **spread** | 0–8 | **5** | **18** | **17** | **29** | **4** |

`calls` 304, `uses` 91 and `overrides` 32 are identical in all five current-code runs, and in
every pre-merge run besides.

**`references` and `exports` are NOT invariant on current code, and the pre-merge table
below said they were.** That is the second time in this lane that a five-run invariant was
broken by a change to a shared file rather than to the lane, so the earlier table is kept
with its own population attached and the earlier claim is marked rather than deleted:

Pre-merge code, runs 1–5:

| run | degraded | `contains` | `imports` | `extends` | `exports` | symbols |
| --- | --- | --- | --- | --- | --- | --- |
| committed | 4 | 12,371 | 3,634 | 423/151 | 4,019 | 39,601 |
| re-run | 10 | 12,371 | 3,611 | 423/151 | 4,019 | 39,650 |
| A | 3 | 12,373 | 3,619 | 427/152 | 4,019 | 39,660 |
| B | 7 | 12,374 | 3,619 | 427/152 | 4,019 | 39,599 |
| E | 6 | 12,369 | 3,623 | 423/151 | 4,018 | 39,650 |
| **spread** | 3–10 | **5** | **23** | **4** | **1** | **61** |

`calls` 304, `uses` 91, `references` 6,594 and `overrides` 32 were identical in all five of
THOSE runs. Two of those four invariants (`references`, `exports`) do not survive the merge,
and the pre-merge `exports` spread of 1 is now 29. A property asserted from five samples is
still a sample; the difference is only that this one has now been falsified twice.

The cause is not the file set and not the degraded COUNT: run B's sidecar recorded that all 7
of its degraded files contributed **0 edges**, so a degraded file is a total non-producer
rather than a partial one, and the degraded count is not monotone against `imports`
(4/10/3/7/6 against 3,634/3,611/3,619/3,619/3,623). The variable is **which** files degrade,
and that set is largely disjoint run to run — only 2 of run E's 6 files appeared in an
earlier run's list, so 4 of 6 are new, drawn from the same two repos' icon-property and
theme-chalk shapes.

**And the degraded list does not account for all of it.** That is a later correction to the
paragraph above, made after this section's own instruments were re-run; the measurement and
its consequence are in "A file can fail with no flag at all" below.

**So every figure in this section is one run's, and the spread belongs beside it.** Read
`contains` as 12,370–12,375, `imports` as 3,618–3,636, `references` as 9,336–9,353,
`exports` as 4,019–4,048 and `extends` as 423–427 across current-code runs; `calls`, `uses`
and `overrides` are the three a reviewer can rely on. Two instruments bound the movement
rather than describing it: `scss-flaky-files.ts` parses the union of four runs' failure
lists 8× each and finds 22/22 stable in isolation, so their per-parse contribution caps the
whole spread at `contains` 11 / `imports` 35 / `references` 26 / `extends` 4 and 0 for
`calls`, `uses`, `exports` and `overrides`; and `scss-census-run-diff.ts` differences two
`BB_CENSUS_SIDECAR` dumps and attributes every edge of movement to a named file.

The `references` bound of 26 is worth reading next to the invariant claim the pre-merge
table made. The bound said `references` had 26 edges at risk while the observed movement
across five runs was **0** — and the instrument's own footer said at the time that a
movement of 0 is not stability. Across the five current-code runs the movement is **17**,
inside the bound that predicted it. `exports` is the one type where the bound says 0 at risk
and the movement is 29, which is the remaining unexplained movement in this section.

### Resolution per type, and the heuristic ratio — the whole admitted corpus

The census resolves both endpoints of every edge against the file's own symbol set.

| type | edges | files | both ends resolve | exactly one end | `conf < 0.7` |
| --- | --- | --- | --- | --- | --- |
| `contains` | 12,375 | 2,324 | **12,375 = 100.0%** | 0 | 0 |
| `exports` | 4,019 | 325 | **4,019 = 100.0%** | 0 | 0 |
| `calls` | 304 | 57 | **304 = 100.0%** | 0 | 0 |
| `uses` | 91 | 42 | **91 = 100.0%** | 0 | 0 |
| `overrides` | 32 | 12 | **32 = 100.0%** | 0 | 0 |
| `references` | 9,350 | 1,179 | 3,093 = **33.1%** | 6,257 | 0 |
| `extends` | 427 | 152 | 57 = **13.3%** | 370 | 0 |
| `imports` | 3,621 | 824 | **0 = 0.0%** | 3,621 | 0 |
| `implements` | 0 | — | n/a | — | — |
| `instantiates` | 0 | — | n/a | — | — |

The `exactly one end` column is `edges - both ends`. It was previously printed as the edge
total in every row, which made `contains` read as 12,371 edges resolving at both ends AND
12,371 at one — a contradiction that made the column unreadable rather than informative.
The corrected column is what separates the two failure shapes below: `imports` and
`references` resolve at ONE end and are therefore joinable in principle, while `extends`
resolves at one end on 370 of its 427 edges for the same reason.

**The heuristic ratio is 0.** No edge this lane emits carries `confidence < 0.7`, because
every one is a deterministic parse fact — a node the grammar produced — rather than a
name-match guess. That is a property of the derivations, not a coincidence, and it is why the
count of confidence-0.7-and-below edges is a meaningful zero rather than an unmeasured one.

The three low resolution rates are the three findings this lane reports, and all three are
explained rather than absorbed:

- **`imports` at 0.0%.** A `@use './theme'` names a FILE, and this lane resolves against the
  symbols of the file being parsed. The target file is a different file, so by construction
  zero of 3,621 edges can close here. This is the no-phantom rule working, not a defect:
  inventing a symbol to close the edge is precisely the fabrication the workstream bans. The
  rate is 0.0% and is EXPECTED; a future cross-file resolver is the only thing that can raise
  it, and doing so must not create a symbol that no file declares.
- **`extends` at 13.3%.** `@extend %placeholder` targets a placeholder, and 76% of the
  placeholders this corpus extends are declared in a different partial than the one extending
  them. Same cause, same boundary.
- **`references` at 33.1%**, against the CSS lane's 66.8% reference point, is the delegated
  `var(--x)` class: the analyzer emits a custom-property read unconditionally, while a token
  like Element Plus's is defined in a different file. The behaviour is identical when
  identical input is run through the CSS lane. The rate FELL from 46.9% because the delegate
  began emitting `var()` reads inside `@keyframes` blocks, and 2,756 of those edges resolve at
  both ends on **0** — see "`references` moved 6,594 → 9,350" above, which measures that
  rather than inferring it.

**Both-ends-resolve is a property of the corpus, not of the lane.** On the 244-file corpus
this lane was measured on before `consul`, `vault`, `nomad` and `waypoint` were added, the
same three numbers were `contains` 2,225/2,225, `uses` 41/41, and `references` 223/223 for the
lane's own `$var` reads — so the aggregate moves with the corpus while the per-construct
resolution does not.

## The six questions, per emitted type

The questions fail independently, so the table has a column each and none of the columns is
derived from another. "Exists" is read off the source; "Fires" is measured through production
`parseFile`; "Resolved" and "Confident" come from the full-corpus census above. Populations
are named per the honesty contract §2: census figures are run F over 4,433 admitted files /
116 repos; firing figures are `firing-check.ts --files 120 scss` re-run on this branch, which
reads **7 of 10 types firing** over its 120-file stride where the supervisor's 26-lane sweep
recorded 5 of 10 — the two extra are `calls` and `extends`, which exist because of the
2026-10-04 relabelling.

| type | 1 Exists | 2 Fires | 3 Correct | 4 Labelled | 5 Resolved | 6 Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 120/120 | yes — `structural`, a scope's own children | yes | **100.0%** (12,375/12,375) | `structural`, 0 under 0.7 |
| `references` | yes | 120/120 | yes — a `$var` read is a parse fact; `usage_contextual` on the delegated CSS half | yes | **33.1%** (3,093/9,350) | mixed `usage_contextual`/`import_based`, 0 under 0.7 |
| `exports` | yes | 120/120 | yes — scope-derived, and the `-`/`_` privacy rule is pinned by a `forbidRelationships` fixture | yes | **100.0%** (4,019/4,019) | `structural`, 0 under 0.7 |
| `imports` | yes | 120/120 | yes — derived from `use_statement`/`forward_statement` on both sides | yes | **0.0%** (0/3,621), expected | `import_based`, 0 under 0.7 |
| `extends` | yes | 120/120 | yes — `@extend` is the construct | **relabelled 2026-10-04** from `uses`; 1 label-reversion mutant pins it | **13.3%** (57/427) | `structural`, 0 under 0.7 |
| `calls` | yes | 120/120 | yes — both syntaxes, `@include m` and `f(x)` | **relabelled 2026-10-04** from `uses`; 1 label-reversion mutant pins it | **100.0%** (304/304) | `usage_contextual`, 0 under 0.7 |
| `uses` | yes | 120/120 | yes — one surviving class, a rule consuming a declared `@keyframes` | yes | **100.0%** (91/91) | `usage_contextual`, 0 under 0.7 |
| `overrides` | yes | **0 of 120** — and 32 edges over 12 files of 4,433; the stride does not reach 12 files | yes — the `!global` class, with the two rejected readings counted apart | yes | **100.0%** (32/32) | `structural`, 0 under 0.7 |

Four of these columns carry findings rather than confirmations, and they are the report:

- **Column 4 is where this lane's real work was.** `@include` and `@extend` both carried
  `uses`. `uses` is defined as drawing on a thing *without invoking and without inheriting*, so
  both were mislabelled by construction, not by accident: an invocation labelled `uses` and an
  inheritance labelled `uses` are both the neighbouring type. Fixed to `calls` and `extends`,
  and the honest cost recorded — it moved 304 + 427 edges out of the differential's compared
  set and into DERIVATION, audited against nothing until §8.1 is applied.
- **Column 2 reads 0 for `overrides` and that is not a gap.** The type fires on 12 files of
  4,433. A 120-file stride reaches 120 files and cannot reach all 12. Reporting this as a
  firing failure would be scoring the sampler rather than the analyzer; the full-corpus count
  is the measurement that answers the question, and the type is EMITTED.
- **Column 5 has three low rates and all three are explained rather than absorbed.**
  `imports` at 0.0% is the no-phantom rule: `@use './theme'` names a FILE, so closing the edge
  would mean inventing a symbol no file declares. `extends` at 13.3% and `references` at
  33.1% are the same cross-file boundary against the CSS lane's 66.8% reference point, and the
  second of those two moved for a reason this lane did not cause and has now measured.
- **Column 6 is a zero that means something.** All 30,219 edges are parse facts, so
  confidence-under-0.7 is 0 by construction rather than by measurement — which is the only
  reason a zero here is informative instead of merely absent. The delegated CSS half carries
  `usage_contextual` and `import_based` evidence classes, and this lane did not lower them to
  make the ratio tidier.

**Column 3's limitation, stated rather than implied.** The oracle is a separate walker
(`deriveScssEdges` in `script/m14/differential.ts`) over the SAME tree-sitter grammar, so a
grammar bug shared by both paths is invisible to it. Re-measured on this branch over
element-plus's 60-file sample: `covered=436 (90.8%) MISSING=44 | analyzer-edges=136
unexplained=11 (8.1%) heuristic=0`, with `unexplained-by-label: overrides=10, references=1`.
So column 3 for `exports` and `overrides` rests on the fixtures and the mutants, not on the
differential, and the 44 MISSING rows are the **oracle's** pre-relabelling labels rather than
analyzer recall loss — their truth rows still say `uses`. Do not read column 3 as a stronger
claim than the instrument behind that row.

## Declared limitations

- **134 of 1,000 sampled files do not parse clean.** All modern Sass the 1.0.0 grammar plus
  two patches cannot represent. Measured on **1,000 of the 4,433 admitted files** (every
  4th of the sorted admitted list, 0 parse failures):
  `files with a CLEAN tree 866 / 1000 (86.6%)`, `files with >=1 ERROR 134 / 1000 (13.4%)`,
  `ERROR nodes total 16,922`. An earlier revision of this bullet read `95 of 244`, which was
  a narrower walk of the same claim and is superseded — two populations for one number is how
  a reader ends up quoting the wrong one. The residual is a **long tail**: the largest single
  file is `bootstrap/scss/_variables.scss` at 3,796 ERROR nodes, and the shape is
  `include_statement` 5.2% in-error, `use_statement` 16.6%, `if_statement` 7.8%,
  `extend_statement` 7.7% — so most of what the lane needs is modelled cleanly and the loss
  is concentrated in `@use`/`@include` inside damaged regions. Evidence:
  `validation/m14/results/scss-grammar-ab.json`.
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
- **SCSS-L10 — `exports`, `overrides` and now `calls`/`extends` are compared against
  nothing.** All four are implemented; all four are DERIVATION findings until
  `deriveScssEdges` derives them, and the workstream's own remedy is the full mirror in
  one commit, and `deriveScssEdges` is shared machinery. Measured cost of leaving it:
  **4,019** `exports` edges unmeasured (the harness allowlist filters the analyzer side and
  `exports` is in no scss entry), **32** `overrides` edges counted as confident
  fabrications, and **304** `calls` plus **427** `extends` edges dropped from the
  comparison entirely. On element-plus's 149-file differential sample the arbiter's own
  instrument names it: `COMPARED WITH NO TRUTH: overrides (10 comparable, 0 truth)`.
  `unexplained` is **13** against a committed baseline of **3**, and the 10 `overrides`
  edges are the difference. See §8 below for the exact patch.
- **SCSS-L11 — the arbiter's own exit code cannot express "the construct exists and the
  label is wrong".** `script/m14/ontology-coverage-gate.ts` has four statuses:
  EMITTED, RULED-SOUND, FALSIFIED, RULED-UNJUSTIFIED. A type whose construct is present but
  whose label a neighbouring one has taken fits none of them — ruling it is dishonest and
  instrument B would falsify the ruling, and leaving it unruled reports it as
  RULED-UNJUSTIFIED. The workstream's third verdict is **GAP**, and the gate does not
  implement it. That is why `calls` and `extends` were implemented in the analyzer with a
  measured MISSING regression rather than reported: reporting them cost a permanently red
  gate row and taught nobody anything, and the numbers to fix it are now written down.
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
- **fixtures**: **12 / 12** in `run-fixtures.ts --lang scss`, exit 0, `fixture baseline
  gate: no regressions`. Expectations are authored
  from the rulings, never transcribed from analyzer output — which is the only reason they
  could fail. The unscoped invocation **cannot** verify them: it exits 6 on the orphan-lane
  gate having run nothing, because the `r` and `lua` fixture directories are not in `LANGS`
  (§8.3). Two are new (2026-10-03): `module-exports-and-global-overrides` and
  `placeholder-selectors-and-extend`; one is new since (2026-10-04):
  `invocation-and-inheritance-labels`, which pins the `calls`/`extends` labels themselves.
- **mutants**: **26 in the registry, 26 caught, 0 survivors**, confirmed by TWO independent
  runners on current code.
  1. `bun run script/m60/scss-mutant-check.ts` (this lane's) → **23 caught, 3
     OUT-OF-SCOPE**, exit 0, artifact `script/m60/tmp/scss-mutant-check.json` reproducing
     byte for byte against the committed copy. The three are out of scope **by
     construction** rather than uncaught — `callable-parameters-dropped` →
     `expectParameters`, `module-imports-dropped` → `expectImports`,
     `parse-errors-swallowed` → `expectErrorCount` — because it evaluates
     `expectSymbols`, `expectSymbolCount`, `expectRelationships` and `forbidRelationships`
     and NOT those three sections.
  2. `BB_MUTANT_ONLY="scss/" bun run script/m14/mutate-analyzer.ts` (the shared runner) →
     **`all 26 mutants caught - the gates can fail (BB_MUTANT_ONLY="scss/" filtered 1803
     -> 26)`**, exit 0. It reads the sections this lane's runner skips, which is exactly why
     its three OUT-OF-SCOPE mutants are caught here and not survivors.

  **The registry IS now wired into the shared runner.** An earlier revision of this bullet
  read "`grep -rn SCSS_MUTANTS script/` returns the definition and **no import site**", which
  was true of the code at the time and is false of this branch:
  `script/m14/mutate-analyzer.ts:32` is `import { SCSS_MUTANTS } from "../m60/scss-mutants"`.
  So §8's one-line request for it is already satisfied and only the lane runner's scope
  difference remains, which is a lane choice rather than a gap.

  Three mutants are the relabelling guards and all three are caught:
  `extend-label-reverted-to-uses`, `include-label-reverted-to-uses`,
  `function-call-label-reverted-to-uses`, which is what makes the relabelling of §"the
  relabelling, and what it cost" a pinned property rather than a claim in prose.
  Five more are new (S11–S15) and all five are caught by the fixtures above. Four survived the
  first run in an earlier wave and all four were gaps in the suite: two were **bugs in the
  mutants** (one rewrote only already-resolved sources, so it was a no-op; one wrote
  `{...s, ...rest}` after destructuring `parameters` out, which **restores** the key), and
  two were missing pins (no `line_number` assertion anywhere, and a `forbidRelationships`
  row that named only one spelling of a phantom target).
  **The shared runner cannot currently reach ANY lane's mutants**, for a reason outside every
  lane: `script/m14/protobuf-mutants.ts:815` declares
  `protobuf/qualified-id-stopped-being-published` with **no `language` field**, so
  `clean(undefined)` reaches `path.join(FIXTURES_DIR, undefined)` and throws
  `ERR_INVALID_ARG_TYPE` at `run-fixtures.ts:506`. A full unscoped run prints 24 protobuf
  `CAUGHT` rows and then dies with exit 1, before scss or any later lane is reached.
  `BB_MUTANT_ONLY` bypasses it, which is how row 2 above was obtained. §8 asks for the
  one-field fix.
- **ontology census**: `script/m14/tmp/scss-ontology-harness.ts` →
  `script/m14/tmp/scss-ontology-harness.json`; ruling probes in
  `script/m14/tmp/scss-ontology-probes.ts`; per-construct resolution in
  `script/m14/tmp/scss-uses-resolution.ts`; the `@extend` cross-file witness in
  `script/m14/tmp/scss-extend-tree-witness.ts`.
- **census**: `script/m14/tmp/scss-analyzer-census.ts` →
  `validation/m14/results/scss-analyzer-census.json`.
- **firing check**: `npx tsx script/m14/firing-check.ts --files 120 scss` → **`7/10` fired,
  2,245 edges, 120/120 files, degraded 0**, exit 0. Re-run on this branch; an earlier
  revision of this line read 2,151 edges on the same invocation, which is inside this lane's
  own measured `references` spread of 17 scaled to a 120-file population. The committed
  26-lane sweep (`validation/m14/measurements/firing-sweep-26-lanes.ndjson`) records this
  lane at `5/10`, 510 edges, `degraded 1`; the two types it gained are `calls` and
  `extends`, which is exactly what the relabelling did — they were `uses` before, and
  `uses` was already firing, so a type moved from one label to another and a second label
  started firing.
  `overrides` reads 0 here and is **not** a defect: it fires on 32 edges across 12 files of
  the 4,433 admitted corpus, and 120 files sampled at a stride does not reach 12 of them.
  **8/10 over the whole corpus**, which is the number the arbiter reports, so `overrides` is
  the difference between this column and that one and nothing else.
  `degraded 0` against the sweep's `1` is the load, not the lane.

### The shared ontology gate now runs this lane, and reports 10/10

It used to refuse, and the refusal was correct:

```
ontology coverage gate — no RULING SOURCE for scss.
Refusing to report: with no ruling anywhere, every un-emitted type would be called
RULED-UNJUSTIFIED, and that is a verdict about the absence of evidence, not about the lane.
Neither RULED_BY_LANG.scss nor script/m14/spec/scss-completeness.json supplies one.
$ echo $?
2
```

So this lane's two RULED verdicts had never been checked by the arbiter, which is the
entire reason that gate exists — a differential cannot adjudicate a type both halves omit.
The table was written in a file this lane owns, `script/m14/scss-ruled.ts`, in the gate's
own `Ruled` shape, and registered with two additive lines in the shared registry:

```ts
import { SCSS_RULED } from "./scss-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { …, sql: SQL_RULED, scss: SCSS_RULED }
```

The gate's own header states the rule that made this safe to do from a lane: a conflict in
that map is always "both sides added a lane", and the correct resolution is always the
UNION, because taking either side deletes the other lane's table silently and a deleted
entry does not fail loudly — the arbiter just exits 2 for a lane that WAS ruled, which
reads as "nobody has ruled on this yet" rather than "someone's work was dropped in a
merge". Both lines are additions, so the union is what is present.

The arbiter's verdict is at the top of this document: `emitted 8/10   ruled-sound 2
FALSIFIED 0   ruled-without-justification 0`.

### §8 — the shared change this lane needs, specified so it needs no re-deriving

#### §8.0 `src/ast/engine.ts` — the orphaned `parseBomb` (highest priority; affects every lane)

**File** `src/ast/engine.ts`, function containing line 1441. **What it must do:** clear the
self-destruct timer on every exit path from the parse, including a throw, and stop
asserting a hang it cannot observe.

**Why, measured:** a WASM heap fault in `parser.parse` (line 1446) throws, which skips
`clearTimeout(parseBomb)` at line 1447 and orphans a 120 s timer that then prints a false
`[BB-HANG]` and calls `process.exit(1)` — converting a completed `FALSIFIED 0` verdict into
a failed exit code. Reproduced: `validation/m14/fixtures/scss/scss-orphaned-parsebomb-repro.ts`.
Full evidence in "[BB-HANG] is an ORPHANED TIMER" above. **Every language's lane runs through
this function**, which is why it is filed first.

```ts
let done = false
const parseBomb = setTimeout(() => {
  process.stderr.write(done
    ? `[BB-STALE-TIMER] ${filePath} — parse returned but its timer was not cleared\n`
    : `[BB-HANG] parser exceeded 120s on ${filePath} — exiting\n`)
  process.exit(1)
}, 120000)
let tree: wts.Tree | null
try {
  tree = parser.parse(content)
} finally {
  done = true
  clearTimeout(parseBomb)
}
```

The `done` flag is what lets a reader tell the two apart, which is the whole defect: today
both print "stuck".

#### §8.1 `script/m14/differential.ts` — three edits, one commit

`script/m14/differential.ts` is supervisor-owned. Three edits, all in the scss lane's own
blocks, and all in one commit — the workstream's **full mirror** rule, because half of it
is the documented failure (java 81 edges, kotlin 54, php 163 and javascript each carried a
label no oracle backed while publishing 0% unexplained).

1. **`deriveScssEdges`, the `include_statement` case at differential.ts:20490** — change
   `push("uses", nextOwner, target)` to `push("calls", …)`. `target` there is already
   resolved to `@mixin name` / `@function name`, so it is the same resolution the analyzer
   makes.
2. **`deriveScssEdges`, the `extend_statement` case at differential.ts:20496** — change
   `push("uses", nextOwner, …)` to `push("extends", …)`, and read the target by DEEP
   search rather than `kidOf`: 6 of the 8 `extend_statement` nodes sit inside a `block`
   where the statement's own node type is absent and the keyword survives only as an
   anonymous `@extend` token under an `ERROR`. Reading only clean nodes derives 6 of the
   corpus's 427.
3. **The scss compared-label allowlist entry at differential.ts:23330** — currently
   `["uses", "references", "imports", "contains"]`. Add `"calls"` and `"extends"`.
   **Direction matters and is easy to get backwards:** the allowlist filters the ANALYZER
   side, so a label the oracle derives but the allowlist omits reads as MISSING, and a
   label the allowlist names that the oracle does not derive is compared against nothing.
   Both directions of that mistake are already in this file — the scss
   `cov=0 (0%) MISSING=45` shape is the first.

Expected effect, measured on element-plus's 149-file sample: MISSING falls from **100** to
at most **56**, `unexplained` stays at **13**, and coverage returns to **96.5%** while the
store keeps the correct labels. `exports` and `overrides` want the same treatment
(`emitModuleExports` and the `!global` emitter in `src/ast/real-scss-analyzer.ts`), and
paying those down removes the 10 `overrides` edges the differential currently calls
confident fabrications.

#### §8.2 `script/m14/differential.ts:21618` — the batch child drops the TS loader, so the whole sweep dies (affects every lane)

**File** `script/m14/differential.ts`, the batch spawn at line 21618. **What it must do:**
invoke the child with the same TypeScript loader the parent is running under, rather than
re-executing `process.argv[1]` with bare `node`.

```ts
spawnSync(process.execPath, [process.argv[1], ...args], { … })
```

`process.argv[1]` is a `.ts` file and `process.execPath` is `node`. The parent works because
`npx tsx` injects a loader; the child inherits `process.env` (line 21618 spreads it) but not
the loader, so it dies on the first extensionless relative import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/…/src/ast/js-builtin-prototypes'
  imported from /…/script/m14/differential.ts
Error: differential: batch 0/9 exited 1 — a lane in it failed; NOT writing evidence from an incomplete sweep
    at main (…/script/m14/differential.ts:21620:35)
```

**Why this is filed above the lane-specific items:** it is not scss. `src/ast/js-builtin-prototypes.ts`
exists and is tracked (`git ls-files` confirms); the import at `differential.ts:28` is simply
extensionless, which `tsx` resolves and bare `node` does not. **Batch 0 of 9 fails, so the
sweep writes no evidence for any of the 66 lanes** — the gate is doing the right thing by
refusing to write from an incomplete sweep, and the whole instrument is dark. Confirmed by
causation rather than inference: the identical command with the loader injected into the
environment the child already inherits runs the sweep.

```bash
NODE_OPTIONS="--import tsx" npx tsx script/m14/differential.ts --lang scss --sample 40
```

With that, scss measures: `element-plus:scss: files=40 tree-truth=342 covered=306 (89.5%)
MISSING=36 | analyzer-edges=94 unexplained=7 (7.4%) heuristic=0`, and the run still exits 6
because of the `overrides`-with-no-truth finding in §DERIVATION above — a second, separate
defect in the same lane.

#### §8.3 `script/m14/run-fixtures.ts` — the orphan-lane gate exits 6 before running any lane

**File** `script/m14/run-fixtures.ts`, the orphan check at lines 1576–1585. **What it must
do:** report the orphan lanes as a WARNING and still run every lane the caller named, or
require an explicit flag to make them fatal.

Unscoped, the runner exits **6 having executed zero fixtures**:

```
fixture-lane gate: 2 fixture director(ies) no runner lane claims: r, lua
  r: 18 expectation file(s) — evidence nothing executes.
  lua: 12 expectation file(s) — evidence nothing executes.
```

Neither `r` nor `lua` is this lane's, and `scss` **is** in `LANGS` (line 209), so this lane
is collateral damage: one unrelated lane's un-registered fixture directory prevents 46 lanes
from being verified. The scoped invocation exists and works —
`bun run script/m14/run-fixtures.ts --lang scss` → `{"scss":{"pass":12,"fail":0}}`,
`fixture baseline gate: no regressions`, exit 0 — which is the evidence that the fixtures are
healthy and the gate is the only thing standing in the way. Worth noting the runner already
distinguishes a scoped run from a full one in its output; the orphan gate just does not
respect that distinction.

### The arbiter's exit code is 1 on a verdict of FALSIFIED 0, and the cause is shared code

`npx tsx script/m14/ontology-coverage-gate.ts scss` prints its verdict and then exits
**1**:

```
emitted 8/10   ruled-sound 2   FALSIFIED 0   ruled-without-justification 0
[BB-HANG] parser stuck 120s on .../consul/.../icons/triangle-fill/index.scss — exiting
EXIT_CODE=1
```

Those two lines are not in conflict, and the second one is not this lane's. The gate sets
`process.exitCode = falsified.length + unjustified.length === 0 ? 0 : 1` from the line it
printed, so it asks for 0. What overrides it is `src/ast/engine.ts:1441`:

```ts
const parseBomb = setTimeout(() => {
  process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
  process.exit(1)
}, 120000)
const tree = parser.parse(content)
```

### `[BB-HANG]` is an ORPHANED TIMER, not a hang — and this section previously said otherwise

**This subsection corrects an earlier claim in this document, which was wrong.** It read:

> **The budget is WALL CLOCK, and the machine is 3.3× oversubscribed.** […] A 218-byte file
> cannot take 120 s to parse. […] the only way the budget is consumed is for the process to
> be **descheduled** for the duration. What the watchdog measures on a loaded machine is
> scheduler starvation, not parse cost.
>
> 1. **`[BB-HANG]` is not evidence of a pathological file.** It is evidence of load.

Load was measured and is real (25.5 on 8 cores). But it is **not the cause**, and the
conclusion drawn from it does not hold. A later run falsified it with two lines naming the
SAME file:

```
[BB-PARSE-ERR] scss | .../r-pkgdown/.../solarized.scss | memory access out of bounds
[BB-HANG] parser stuck 120s on .../r-pkgdown/.../solarized.scss — exiting
```

The first line is a WASM heap fault that **threw and returned**. The second is the
consequence. `src/ast/engine.ts` arms a hard self-destruct at **1441** and clears it at
**1447**, with the synchronous parse at **1446** between them:

```ts
1441    const parseBomb = setTimeout(() => {
1442      process.stderr.write(`[BB-HANG] parser stuck 120s on ${filePath} — exiting\n`)
1443      process.exit(1)
1444    }, 120000)
1446    const tree = parser.parse(content)      // can THROW
1447    clearTimeout(parseBomb)                 // skipped by that throw
```

`parser.parse` surfaces a WASM heap fault as a JS exception, and **a throw between 1444 and
1447 skips the `clearTimeout`.** The timer is then ORPHANED: still armed, no parse in
flight, still closing over `filePath`. `parseFile` then does precisely what it is written to
do — `pool-worker.ts:1222` catches, logs `[BB-PARSE-ERR]`, returns `extractFallback(...)`
(the degraded regex extractor, which is what stamps `DEGRADED` on a firing sweep), and the
caller moves to the next file with no way to tell. **120 s after the parse that already
returned**, the orphan fires and asserts a hang that did not happen, then `process.exit(1)`
turns a completed verdict into a failed exit code.

Every part of the message is false in this case: the parser was not stuck, no parse was in
flight for 120 s, and the file it names is the one that threw minutes ago.

**Reproduced deterministically** — `validation/m14/fixtures/scss/scss-orphaned-parsebomb-repro.ts`
(~2 min, exits non-zero by design, because the defect IS a non-zero exit):

```
injecting ONE parse throw for solarized.scss
[BB-PARSE-ERR] scss | .../solarized.scss | memory access out of bounds
parseFile RETURNED normally: symbols=0 rels=0 — the caller cannot tell this from a good parse
  alive at 35s
  alive at 65s
  alive at 95s
[BB-HANG] parser stuck 120s on .../solarized.scss — exiting
```

This one mechanism accounts for all four observations the earlier revision attributed to
load, which is why it is worth stating as the cause rather than alongside it:

| earlier observation | under the orphaned-timer reading |
| --- | --- |
| exit 1 after `FALSIFIED 0` | `process.exit(1)` from the orphan |
| 4 runs named 4 different files | each run orphaned a timer on whichever file faulted that run |
| named files were 205–773 B and parse-clean in isolation | a trap that returns in ms still orphans a 120 s timer |
| load 25–29 on 8 cores | a co-factor at most; a trap needs no load to orphan a timer |

**What is NOT established: the trigger.** The genuine fault is a WASM heap trap in the
pinned `wasm/tree-sitter-scss.wasm`, and it does not reproduce outside the gate's
concurrency — measured in isolation, `solarized.scss` (1,895 B) parses clean at
**1.7 / 2.1 / 13.8 / 15.0 / 52.3 ms** over 5 runs, and **48 parses at 16-way concurrency**
over the same directory gave **0 traps, 0 errors**. So the repro injects the throw rather
than provoking the fault, and the claim is deliberately the narrower one: **when
`parser.parse` throws, the timer is orphaned, and an orphaned timer produces a false
`[BB-HANG]` and a `process.exit(1)` from inside an otherwise completed run.** Establishing
the effect does not require reproducing the cause.

The fix is §8 and touches no code here: move `clearTimeout` into a `finally` around the
parse, and record completion in the timer so it can say `[BB-STALE-TIMER]` (parse returned,
timer not cleared) instead of asserting a hang it cannot observe.

The corpus numbers are also load-sensitive for the same reason, and the two arbiter runs
bracket it: `contains` 12,374 → 12,375 and `imports` 3,632 → 3,615 across two runs of the
identical command on the identical corpus. The type verdicts did not move; the counts did.
That is the reason this document quotes the census figure and the arbiter figure as a pair
rather than picking whichever is larger.

**The verdict itself exits 0, and here is the run that shows it.** On an independent
population — `BB_CORPUS_ROOT` pointed at a 7-repository symlink farm, **341 admitted
files**, no repository in common with the full corpus's largest contributors:

```
$ BB_CORPUS_ROOT=/tmp/opencode/scss/subset npx tsx script/m14/ontology-coverage-gate.ts scss
corpus: 341 admitted files

calls         EMITTED         47 edges     extends       EMITTED        20 edges
uses          EMITTED         15 edges     implements    RULED-SOUND   141 node types, none expresses it
contains      EMITTED      3,359 edges     overrides     EMITTED         5 edges
imports       EMITTED        318 edges     instantiates  RULED-SOUND   141 node types, none expresses it
references    EMITTED      1,143 edges
exports       EMITTED      1,415 edges

emitted 8/10   ruled-sound 2   FALSIFIED 0   ruled-without-justification 0
$ echo $?
0
```

All eight EMITTED types fire on a population with a different repository mix, including the
two rarest — `uses` at 15 edges and `overrides` at 5. So the verdict is not an artefact of
the full corpus, of the machine's load, or of one dominant repository. The population
differs from the numbers quoted elsewhere in this document and is labelled as such
everywhere: **341 files, not 4,433.**

Five `[BB-HANG]` filenames across five runs. The first four were measured in isolation and
are all parse-clean — which is what made this lane misread them as load. The fifth is the one
that falsified that reading, and a sixth instance below is what makes the mechanism
unambiguous:

| # | file named by the watchdog | bytes | parse time in isolation | `hasError` |
| --- | --- | --- | --- | --- |
| 1 | `consul/.../icons/lock/placeholders.scss` | 205 | 19 ms | false |
| 2 | `consul/.../icons/triangle-fill/index.scss` | 218 | 24–65 ms | false |
| 3 | `consul/.../icons/file-check/property-16.scss` | 773 | <1 ms | false |
| 4 | `riverpod/.../legend/DocuCode.scss` | 206 | 3 ms | false |
| 5 | `r-pkgdown/.../highlight-styles/solarized.scss` | 1,895 | 1.7–52.3 ms | false |
| 6 | `consul/.../components/inline-alert/debug.scss` | — | — | — |

**#5 is the falsifier.** Its run printed a `[BB-PARSE-ERR]` naming the same file immediately
before the `[BB-HANG]`:

```
[BB-PARSE-ERR] scss | .../r-pkgdown/.../solarized.scss | memory access out of bounds
[BB-HANG] parser stuck 120s on .../r-pkgdown/.../solarized.scss — exiting
```

**#6 is the corroboration, and it is the stronger of the two.** That was the full-corpus
census, and it printed its entire result first — the admitted count, the per-type table, the
symbol-kind table, the per-type file lists:

```
admitted .scss     4433 tracked files
…
contains       12,373   2323      12,373 (100.0%)         0
…
[BB-HANG] parser stuck 120s on .../consul/.../components/inline-alert/debug.scss — exiting
CENSUS_EXIT=1
```

The measurement was **finished and printed in full** before the process died, on a file the
census had read long before it printed its table. That is not a hang and cannot be one: a
hang cannot emit a completed result table. It is the orphaned timer, and it is why the exit
code is 1 on work that demonstrably succeeded.

### The lane's ceiling is the pinned grammar, not the analyzer

The firing sweep at the time recorded `scss 5/10 fired, 510 edges, 120/120 files, DEGRADED`;
on current code the same 120-file stride reads **7/10 and 2,245 edges**. The obvious
reading of a low score is that the analyzer is thin. Measured, the remaining ceiling is not
— the pinned `wasm/tree-sitter-scss.wasm` cannot read part of its own language:

```
$ npx tsx validation/m14/fixtures/scss/scss-parse-health.ts 1000
files with a CLEAN tree  866 / 1000  (86.6%)
files with >=1 ERROR     134 / 1000  (13.4%)
ERROR nodes total        16,922
```

(A 400-file run of the same script earlier read 81.3% clean; the 1,000-file figure above is
the one this document quotes, because 400 files is a sample of a 4,433-file population and
1,000 is a sample of the same population with the error bar roughly halved. Both populations
are named at each figure rather than one number being reused for both.)

The worst case is not a pathological file. `bootstrap/scss/_accordion.scss` is valid SCSS:

```scss
--#{$prefix}accordion-color: #{$accordion-color};
```

and it yields `rootNode.hasError === true`, **456 error nodes**, 1,104 root children, and
**0 relationships from 2 symbols**. So an edge count on this lane is a count of what
survived a parse, and the honest question is not "how many edges does the analyzer emit"
but "how much of the language does the pinned grammar reach".

The SCSS-only constructs split three ways, and the middle column is the one that decides
whether a type is EMITTED or merely recoverable:

| node type | clean | in ERROR | % recoverable |
| --- | --- | --- | --- |
| `include_statement` | 239 | 7 | 2.8% |
| `use_statement` | 103 | 19 | 15.6% |
| `mixin_statement` | 30 | 1 | 3.2% |
| `function_statement` | 3 | 2 | 40.0% |
| `extend_statement` | 6 | 2 | 25.0% |
| `each_statement` | 20 | 0 | 0% |
| `if_statement` | 19 | 0 | 0% |

`use_statement` has the highest recoverable share, and the shape the recovery has to read
is printed by the same script: **19 of the 21 SCSS-only nodes that appear inside an `ERROR`
are `use_statement` under `ERROR`**, with `include_statement` next at 4 under `block` and 3
under `ERROR`. `@extend` is the case the analyzer already handles this way — 99
`extend_statement` nodes against 676 `@extend` tokens, the other 85% in
`block > ERROR > "@extend", …`.

Two files in this corpus cannot be parsed at all under the pipeline's 120 s budget and are
excluded from every count here: `bulma/docs/vendor/fontawesome-free-5.15.2-web/scss/
_variables.scss` (7,053 error nodes) and `bootstrap/scss/_nav.scss` (681). They are
recorded as exclusions rather than counted as zeros.

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
