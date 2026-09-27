# real-css-analyzer.md

## Language

- Analyzer file: `src/ast/real-css-analyzer.ts`
- Parser: `tree-sitter-css` **0.25.0** (npm, published 2025-09-28 — upgraded
  from the previously pinned grammar in this milestone; `stylesheet` →
  `rule_set`/`media_statement`/`keyframes_statement`/`at_rule`/
  `import_statement` tree; `selectors` → `class_selector`/`id_selector`/
  `tag_name`/`descendant_selector`/`attribute_selector`/
  `pseudo_class_selector`/`pseudo_element_selector`; `declaration` →
  `property_name` + value nodes; `nesting_selector` for `&`)
- Language detection: `.css` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealCssAnalyzer`
- Pure AST — symbols and relationships derive from Tree-sitter nodes/fields,
  never source-text scanning. The only string processing is on values already
  extracted from AST nodes (pure-String helpers, no regex).

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | full resolved selector text of each `rule_set` (e.g. `.card .title`, `#orders-table th, #orders-table td`, `tr[data-order="1001"]`); `--custom-property` name; `@keyframes` name; `@layer`/`@container`/`@mixin` at-rule name (`@layer base`); `@supports` query text | 
| kind | ✅ | by specificity composition: bare `#id` → `interface`; bare tag → `type`; `.class` → `class`; pseudo/attribute/complex/descendant → `class`; `--var` → `variable`; `@keyframes` → `function`; `@layer`/`@container` → `module`; `@mixin` → `function`; `@supports` → `interface` |
| qualified/container name | ✅ | `scope` = parent selector for nested rules (`.nav .item` scoped to `.nav`); empty for top-level rules |
| range (start/end line + column) | ✅ | the full `rule_set`/`declaration`/`keyframes_statement` node |
| parameters | — | n/a (selectors are not callables) |
| returnType / type | — | n/a |
| documentation/comments | — | n/a (CSS has no doc comments) |
| complexity metrics | ✅ | per-symbol metadata: `isSelector`, `isUtility`, `isComplex`, `hasPseudoClass`, `hasPseudoElement`, `isCssModule`, `classNames`, `specificity` ([id, class, tag] max), `selectorComposition` |
| syntax errors | ✅ | ERROR/missing nodes surfaced as warnings; counted in `parseErrors` |
| decorators/attributes | ✅ | selector composition + specificity in `metadata` |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| contains | ✅ | custom-property declaration scope (`:root contains --primary`); at-rule scope (`@layer base contains body`); media scope (`@media (...) contains .header` — `@media` itself is not a symbol, it is a structural scope); nested-selector scope (`.nav contains .nav .item`); selector-chain scoping (`.card contains .title`, `#orders-table contains th`) | 1.0 |
| uses | ✅ (emitted, filtered by production pipeline) | selector → property (`:root uses --primary` is NOT emitted — a custom-property declaration is a definition, so it only emits `contains`; `animation: fade-in` → `uses fade-in` resolved via the keyframe-name set) | 0.9 |
| references | ✅ (emitted, filtered by production pipeline) | `var(--primary)` → `references --primary` (walk of `call_expression` arguments) | 1.0 |
| imports | ✅ | `@import url("x.css")` / `@import "x.css"` → module name (unwrapped via pure-String `unwrapUrl`) | 1.0 |
| exports | ✅ | every symbol with empty scope (top-level declarations) | — |
| extends / overrides | — | n/a (CSS has no class heritage) | — |
| calls | — | n/a | — |

**Production note (honesty):** the pool pipeline (`filterNoiseRelationships`,
M11 port `d7b5015`) deliberately narrows CSS relationships to `contains`-only
as a hyphenated-property noise guard — `uses`/`references`/`@import`
relationships are emitted by the analyzer and verified by direct probe, but
not persisted for CSS. The M12 differential contract therefore covers symbols
+ `contains` relationships (what production stores).

## Supported constructs

- Rule selectors → symbols by specificity composition (Theme.css: `:root` →
  class, `body` → type, `.header`/`.card`/`.container` → class,
  `#orders-table` → interface, `#orders-table th, #orders-table td` → class,
  `tr[data-order="1001"]` → class, `.card:hover` → class)
- Custom properties (`--primary: #2563eb`) → variable symbols scoped to their
  selector with a `contains` edge
- `@keyframes` names → function symbols (`fade-in`, `spin`); `animation:
  fade-in` → `uses` reference
- `@layer base` → module symbol scoping its rules; `@media` → structural scope
  (contains edges, no symbol); `@supports` → interface symbol
- Real CSS nesting: `& .item` inside `.nav` resolves to ONE scoped symbol
  `.nav .item` with a `.nav contains .nav .item` edge (identity matches symbol
  naming — a fix found during the M12 audit: the legacy analyzer emitted
  dangling bare identities like `card contains title`)
- var() references → `references` relationships (`.callout references
  --primary`; two occurrences collapse by identity)
- Framework detection from class-name heuristics (Tailwind/Bootstrap/MUI/
  Vuetify/Bulma/Foundation) — pure-String scans, no regex
- Negative fixture (Negative.css): universal reset rules (`*`, `*::before`,
  `*::after`) are NOT symbols; `@media` is NOT a symbol (structural scope);
  keyframe `from`/`to` blocks are NOT symbols; top-level `&` (`.nav & .item`
  outside a nesting context) is invalid CSS — the grammar correctly reports it
  as an ERROR (verified: `&` is only valid inside a nesting context); nested
  `& .item` resolves to one symbol, not two; `var()` references are
  relationships, not symbols

## Unsupported / explicit-unknown constructs

Every item below was re-tested against the pinned wasm on 2026-09-26 rather than
carried forward, and the list is now what the grammar actually does. Four entries
the previous version of this file claimed were unparseable are not, and one of them
was unparseable only because of a defect this lane has since patched.

**The 13 corpus `grammarErrorFiles`** (`corpus-manifest.json` →
`analyzers[13].measured.grammarErrorFiles`, of 185 non-empty files) are genuine
modern CSS that the newest available tree-sitter-css (0.25.0) still cannot parse
(precedent: kotlin 51, fsharp 108, typescript 5):

- range media queries — `@media (width >= 600px)`,
  `@media (400px <= width <= 1000px)`
- range container queries — `@container (0 <= width < 300px)`
- CSS nesting forms `& &`, `&&`, `&div`
- `@page` rules — `@page :right`
- attribute case-sensitivity flags — `[attr i]`, `[attr s]`
- escaped unicode identifiers — `#\31\32\33`
- HTML-style comments — `<!-- ... -->`
- unquoted `chrome://` `@import` URLs
- empty custom-property values — `--foo: ;`

**Re-tested and NOW parsing, so no longer listed as unsupported:**

| Construct | Why it changed |
|---|---|
| `@keyframes f { 33.3% { … } }` | **Fixed by this lane's patch 1/2.** `float_value` was already in the grammar and already carried `%`; only the step `choice` omitted it. The previous version of this file still listed it, which is how a doc becomes a stale claim that outlives its own fix. |
| `::selectedcontent` | Ruled: a pseudo-element, handled by the generic path. |
| `::picker(select)` | Ruled: a functional pseudo-element. |
| braces inside an attribute value — `a[title="{"]` | Ruled: the attribute token already admits them. |

**Recovered despite the error.** An `@import url(chrome://…)` file still produces a
parse error, but error recovery keeps the statement, so the lane emits the
`imports` edge for it. A construct failing to parse and a construct being lost are
different claims, and only the first is true here.

- `@supports`/`@media` query text is used verbatim as the scope name — no
  decomposition of query conditions
- `progid:` IE filter values do not parse — the **largest** remaining class:
  37 of the 62 corpus `.css` files that still fail (60%), with the error sitting
  on the progid line in all 37. The other 13 are the genuine modern CSS listed
  above, so `progid:` and modern CSS are the only two classes left.
  Recorded as `CSS-L2`, and the diagnosis is the opposite of the obvious one: the
  `progid:` **token already lexes** (`plain_value`'s trailing repeat has always
  admitted `:`), and the failure is **inside the parentheses**. Adding `=` to the
  `arguments` rule's separator choice was built and A/B'd and is **provably
  inert** — 61 error files before, 61 after, 0 fixed, 0 regressed, 151 → 151 node
  types — because the value parses as `parenthesized_value`, whose rule is
  `seq('(', $._value, ')')`, exactly ONE value. A real fix has to widen that
  rule's **arity**, and it participates in every parenthesized value in CSS
  (`calc((1px + 2px) * 3)`, nested parens, `var()` fallbacks), so it is a
  different kind of change from the two additive hunks adopted here and needs its
  own A/B. Recorded so the inert patch is not written a second time

## The `.scss` / `.sass` / `.less` files this lane is also routed

The product routes all four extensions here — `src/ast/parallel-indexer.ts` lists
`.css`/`.scss`/`.sass` and `script/m13/corpus-map.ts` maps
`.scss`/`.sass`/`.less` → `css` — and **all 254 real `.scss` files in the corpus
route to this analyzer** (measured 254/254).

The CSS grammar does not support SCSS, and the numbers are:

```
244 non-empty .scss files
  42 parse CLEAN   (17.2%)
 202 with errors
   0 crashes
11,451 distinct error lines
4,477 symbols and 2,025 relationships still emitted
```

Cause breakdown over every distinct error line: `$variable` reference **17.9%**,
`@include` **12.8%**, `$variable` declaration **6.7%**, `//` line comment
**2.7%**, `@use` **1.6%**, `#{…}` interpolation **1.2%**, `@each`/`@for`/`@if`
**1.1%**, `@mixin` **0.6%**; the remaining 55.3% is the structural fallout of those
rather than a separate cause.

(`@use` looked like the dominant cause in a first pass and was not — that sample
read only the first error rows of files in name order, and `@use` sorts early.)

This is **declared, not a defect in the CSS contract**, and the reason is that
removing the routing would take away real capability: the plain-CSS rules inside an
SCSS file parse correctly and are worth keeping. Teaching the CSS grammar SCSS is
a different grammar (`tree-sitter-scss`) with its own A/B, not a third hunk on a
pinned 0.25.0 that has already been measured twice. What was missing was not the
behaviour but the **declaration** — nothing in the repo said this lane also
receives `.scss`, so an 82.8% parse-failure rate on 254 real files was invisible to
every gate. Recorded as `CSS-L1` in `script/m14/spec/css-completeness.json`.

## Regex inventory

From `validation/m12/results/regex-census.json`: the CSS analyzer has **0
regex usages** (15 in the previous analyzer eliminated — census 119 → 104;
4 more were in a dead `if (false && ...)` SCSS block removed entirely).
Replaced with pure-String helpers: `stripQuotes` (paired-quote strip),
`stripAllQuotes` (all quote chars), `unwrapUrl` (`url(...)` unwrap),
`replaceAll` (`&` substitution for nesting resolution), `isResetSelector`
(universal reset detection), `isTailwindClass`/`isBootstrapClass`/
`isBulmaClass`/`isFoundationClass` (framework heuristics).

## Complexity envelope

### The metric itself

`metadata.cyclomaticComplexity` was a literal `1` for every symbol in this lane
(measured 9,338 of 9,338), so a `complexity >= 1` check was satisfied
**vacuously** — it could not tell a one-line reset from a deeply nested selector
because both answered 1. It is now measured, and the corpus distribution is:

```
27,322 of 27,322 symbols carry a value (0 absent)
60.0% at complexity 1, 15 distinct values, max 52
max lands on Tailwind's
  .ltr\:group-hover\:translate-x-0\.5:where(:not(:lang(ae), :lang(ar), :lang(arc), …))
which is genuinely the hardest selector in the corpus
```

Terms, each counted where it is seen rather than inferred from text:

| Symbol kind | Complexity is |
| --- | --- |
| selector | 1, +1 per combinator, +1 per pseudo-class/element, +1 per attribute selector, +1 for a **functional** pseudo (counted from the `arguments` node), + nesting depth. A comma group aggregates as **max**, mirroring how specificity aggregates the same group. |
| `@media` / `@supports` / `@container` scope | 1, +1 per top-level `and` / `or` / `not` in the query |
| `@keyframes` name | 1 + the number of stops |
| `@font-face` / `@property` / `@mixin` | 1 + the count of its OWN descriptors |
| custom property | 1 + the number of `var(--other)` reads in its value |

60.0% at 1 is **correct, not a residual vacuity** — most CSS selectors are simple.
The point is that the metric can now tell.

Three defects the fixture lane found in this metric, all of which had shipped as
"working":

- the base was **0**, so the analyzer's metadata said 0 for `.plain { color: red }`
  while `pool-worker.ts`'s `s.complexity || s.metadata?.complexity || 1` turned the
  same symbol into 1 in the store — two truths for one number, and the visible one
  violated the `>= 1` convention every other lane meets;
- the **functional-pseudo term was dead code**: it looked for a
  `pseudo_class_arguments` node, but the grammar ALIASES that to `arguments`
  (`optional(alias($.pseudo_class_arguments, $.arguments))`, grammar.js:231), so
  the pre-alias name appears in no parse tree and every functional pseudo in the
  corpus was scored as a plain pseudo, one step cheap. A metric whose own
  distinguishing term can never fire cannot tell `:hover` from
  `:where(.a .b .c)`;
- complexity was measured for SELECTOR symbols only, so the other four kinds fell
  through to the `|| 1` fallback and **24% of the lane (6,486 of 27,322) carried a
  fabricated 1** — a 20-condition `@supports` scope read identically to `.plain`.

### The performance envelope

Re-cut 2026-09-26 on the current tree and grammar. The previous table was
measured on a 181-path sample drawn by a glob that could not match
`_*expected.css`, against a pre-patch wasm, and on a box whose load was not
recorded — so none of its numbers could be told apart from a heavy file set or a
loaded machine, which is exactly what #909 and #871 exist to prevent.

From `validation/m12/results/css-complexity.json`:

| Run | files | symbols | relationships | wall ms | userCpu ms/file | loadAvg1 | load quiet | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 24 | 19 | 1446.6 | 149.0 | 33.90 | no | 202.1 MB |
| corpus_subset | 185 | 788 | 125 | 6037.8 | 15.9 | 31.76 | no | 246.0 MB |

Corpus: `$HOME/fixtures/repositories/svelte` @ `26786e92`, 185
non-empty `*.css` files, 54,453 bytes total (avg 294 B/file) — the manifest and
the sample file now name ONE file set.

Declared budgets: fixtures < 2 s; 185-file corpus < 60 s. Both met
(1.45 s and 6.04 s), **but the rows are advisory**: `loadQuiet=false` on both,
because the box was at load 31–37 while a concurrent wave ran. `script/m60/
analyzer-complexity-gate.ts` therefore returns `unscorable` for this lane, which
is the correct verdict under #871 — a row without load context is not scored,
and a row measured on a loaded box is not scored either. The load-stable number
to compare is `userCpuMsPerFile`: 149.0 ms on fixtures, 15.9 ms on the corpus.

Note the relationship count fell from 1,854 to 125 while wall time rose 2.7x.
Both are the ontology ruling, not a regression: 1,770 of the removed edges were
to names that are not graph nodes (a CSS property name, a selector-chain leaf, a
`@media` scope with no symbol behind it, the literal source `global`), and the
wall-time rise is a loaded box, not more work.

Hot-path audit: single-pass DFS stack over AST children (no child-array
mapping); selector chain/specificity walk is one pass per selector node with a
bounded per-node stack; `detectFrameworksFromClasses`/`calculateMetrics`/
`generateInsights` iterate the symbol list once each. No O(n²) or per-symbol
O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/css.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the M11 CSS contract; 32 facts: 22 symbols + 10 contains relationships)
- Result: `validation/m12/results/css-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0` — verified both before and
  after the grammar upgrade (node shapes unchanged for the contract)

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `svelte@26786e92`
  (clean; the svelte repo's 181 tracked `expected.css` files under
  `packages/svelte/tests/css/samples` — Svelte compiler CSS-output fixtures,
  real language-representative CSS covering modern syntax)
- Sample: 181 tracked `.css` files (deterministic all-tracked sorted, 0
  excluded — no deliberately-broken fixtures in this set; sample file
  `validation/m12/results/css-corpus-sample.txt`, reproducible from
  `git ls-files`)
- Symbols 722 / relationships 1854 / wall 2.25 s / **0 crashes / 0 timeouts /
  14 error files** (7.7%) — down from 26/181 (14.4%) with the previous
  grammar; all 14 are genuine modern CSS gaps of the newest available grammar
  (see Unsupported). Scan script `script/m12/css-corpus-errors.ts`
- Grammar swap verified: `:has()`/`:is()`/`:where()`/`:not()` complex
  selectors, `[attr i]` flags, nesting combinators now parse; differential
  unchanged at 1.000/1.000; 0 regressions

## Evidence pointers

- Fixtures: `validation/m12/fixtures/css/`
- Ground truth: `validation/m12/ground-truth/css.json`
- Differential: `validation/m12/results/css-differential.json`
- Complexity: `validation/m12/results/css-complexity.json`
- Corpus scan: `script/m12/css-corpus-errors.ts`
- Grammar compare: `script/m12/css-wasm-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.15 (GitHub issue #154).
