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
| fixtures | 5 / 5 |
| mutants | 14 / 14 caught |

Per corpus, because an aggregate that averages a hard corpus with an easy one is how a
lane looks healthier than it is:

| corpus | clean before | clean after | still failing |
| --- | --- | --- | --- |
| element-plus | 16 / 160 | **90 / 160** | 70 |
| phpmyadmin | 50 / 74 | 52 / 74 | 22 |
| vue-element-admin | 6 / 9 | 6 / 9 | 3 |
| vue-core | 1 / 1 | 1 / 1 | 0 |

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

| Relationship | Emitted for | Evidence class |
| --- | --- | --- |
| `contains` | scope → rules it attributes (delegated), plus all CSS containment | `structural` |
| `uses` | `@include` → a mixin **this file declares**; `@extend` → the selector extended | `usage_contextual` / `structural` |
| `references` | a `$var` read → a variable **this file declares**; plus every CSS `var()` read | `usage_contextual` / `import_based` |
| `imports` | `@use` / `@forward`, with the `as` namespace on the `ImportInfo` | `import_based` |

**Both ends must resolve.** An `@include` of a mixin from another stylesheet, or a
`$var` that arrived as a parameter, gets **no edge**. Inventing an endpoint is the
`global` phantom the CSS lane removed once, and `functions-return-and-undeclared-uses`
pins the absence with a `forbidRelationships` row.

## What is measured, and what is not

**Both-ends resolve, 2,503 / 2,829 (88.5%)** — and the aggregate is a property of the
corpus, not of this lane. Split by origin:

| origin | resolved |
| --- | --- |
| SCSS `$var` reads (this lane) | **223 / 223 = 100%** |
| CSS `var()` reads (delegated) | 14 / 220 = 6% |
| `imports` | 0 / 120 = 0%, **correct** — an import names another file |

The 6% is the CSS lane's own behaviour meeting a stylesheet set that consumes Element
Plus theme tokens (`--el-color-primary` and friends) defined in a **different file**.
Verified by running identical input through both lanes: the behaviour is identical. This
lane adds no unresolvable edge of its own, and "fixing" the 6% by publishing a symbol
per read would be publishing a use as a declaration.

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
- **`.sass` and `.less` still route to the CSS analyzer** and are declared. Zero files of
  each across 13 corpora, so this repo can neither support nor refute a claim about them.
- **The grammar is a dependency, not vendored source.** `grammar.js` line 9 is
  `require('tree-sitter-css/grammar')`, so the build needs
  `npm install --no-save tree-sitter-css@0.20.0` and is **not self-contained**. The
  package declares `^0.20.0`, a range, so the exact version is pinned in
  `verify-grammar-pins.ts` — a range is not a pin.

## Verification

- **grammar**: `script/m14/verify-grammar-pins.ts` — source↔wasm exact on all 84 declared
  names; A/B at `validation/m14/results/scss-grammar-ab.json` (76 fixed, 0 regressed,
  3 regression controls unchanged-clean).
- **fixtures**: 5 / 5 in `run-fixtures.ts`. Expectations are authored from the rulings,
  never transcribed from analyzer output — which is the only reason three of them could
  fail, and they did.
- **mutants**: 14 / 14 in `script/m60/scss-mutants.ts`. Four survived the first run and
  all four were gaps in the suite: two were **bugs in the mutants** (one rewrote only
  already-resolved sources, so it was a no-op; one wrote `{...s, ...rest}` after
  destructuring `parameters` out, which **restores** the key), and two were missing pins
  (no `line_number` assertion anywhere, and a `forbidRelationships` row that named only
  one spelling of a phantom target).
- **census**: `script/m14/tmp/scss-analyzer-census.ts` →
  `validation/m14/results/scss-analyzer-census.json`.

### Not yet verified

- **No independent oracle.** The CSS lane's differential derives its truth from the
  parse tree without importing the analyzer; the SCSS lane has **no equivalent**, so its
  output is currently checked only against its own fixtures and mutants. Both of those
  are pins this lane wrote, which is a weaker guarantee than a second derivation.
- **No completeness spec** and no F3 ladder position for this lane.

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
