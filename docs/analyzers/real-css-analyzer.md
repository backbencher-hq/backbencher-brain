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

- The 14 corpus `grammarErrorFiles` are genuine modern CSS that the newest
  available tree-sitter-css grammar (0.25.0) cannot parse — all valid CSS,
  recorded honestly in the manifest (precedent: kotlin 51, fsharp 108,
  typescript 5): range media/container queries (`@media (width >= 600px)`,
  `(400px <= width <= 1000px)`, `@container (0 <= width < 300px)`), CSS
  nesting forms (`& &`, `&&`, `&div`), `@page` rules (`@page :right`),
  `[attr i]`/`[attr s]` case-sensitivity flags, escaped unicode identifiers
  (`#\31\32\33`), float keyframe steps (`33.3%` — integer `50%` parses),
  HTML-style comments (`<!-- ... -->`), `chrome://` `@import` URLs, empty
  custom-property values (`--foo: ;`), `selectedcontent`/`::picker(select)`
  selectors, braces-in-attribute-values
- `@supports`/`@media` query text is used verbatim as the scope name — no
  decomposition of query conditions

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

From `validation/m12/results/css-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 2 | 22 | 10 | 774.8 | 28 | 13 | 191.5 MB |
| corpus_subset | 181 | 722 | 1854 | 2252.5 | 321 | 823 | 279.5 MB |

Declared budgets: fixtures < 2 s (met: 0.77 s); 181-file corpus < 60 s
(met: 2.25 s).

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
