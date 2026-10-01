# real-vue-analyzer.md

## Language

- Analyzer file: `src/ast/real-vue-analyzer.ts`
- Parser: `tree-sitter-vue` (SFC pass over the `.vue` file) + the real
  JavaScript analyzer (`RealJavaScriptAnalyzer`) for `<script>` content —
  **always JS**, whether or not `lang="ts"` is set (family-consistent scoping;
  the TS analyzer has no method_definition scope resolution and emitted
  Options-API calls as `module`, so Vue scripts deliberately use the JS
  analyzer for uniform behavior, verified in M12.12)
- Script pre-parse wiring: `engine.ts` parses the `<script>` block content
  (exact `raw_text` byte offsets from the SFC tree, pure AST — no regex
  extraction) and passes the tree via `AnalyzeContext.vueScriptTree`; the
  analyzer never touches `embeddedScriptContent` (avoids the engine's
  polyglot-injection path double-counting symbols)
- Language detection: `.vue` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealVueAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | SFC component → file stem (PascalCase → class); `<script setup>` top-level `variable_declarator` → name identifier (const → Constant, let/var → Variable), `function_declaration` → name; Options API `export default` object: `props` keys → Property, `emits` array items → Event, `computed` keys → Property, `methods` keys → Method, lifecycle hooks (`mounted`/`created`/…) → Method, `data` → Method | 
| kind | ✅ | component → Class; const → Constant; let/var → Variable; function → Function; props/computed → Property; emits → Event; methods/hooks/data → Method |
| qualified/container name | ✅ | `ownerName`/`ownerKind` set for Options-API members (owner = component name); setup-scope symbols are module-scope (owner empty) |
| range (start/end line + column) | ✅ | script-content nodes offset to SFC line numbers via the script block's start position |
| parameters | ✅ | from the JS analyzer (recorded, never symbols) |
| returnType / type | — | Vue SFCs are not type-analyzed (script always parsed as JS — documented decision above) |
| documentation/comments | ✅ | via the JS analyzer (JSDoc / `//` comments on script symbols) |
| complexity metrics | ✅ | via the JS analyzer |
| syntax errors | ✅ | ERROR/missing nodes surfaced; `parseErrors` counted in the differential |
| decorators/attributes | — | n/a |

## Relationship ontology

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ | script calls via JS analyzer leaf identities (member expressions reduce to leaf: `this.title.slice()` → `slice`, `more.json()` → `json`); source = enclosing function/method leaf; `$emit` is a legit `$`-prefixed target (pool-worker `$` denylist removed in M12.12 — it was killing Vue/jQuery targets cross-language); console/Object builtins filtered | 0.9 |
| instantiates | ✅ | template pass: every non-builtin element tag (PascalCase `<Card />` or kebab-case `<router-link />`/`<router-view />`) → leaf tag name; builtin HTML tags (div/button/span/section/…) and Vue builtins (component/transition/keep-alive/…) filtered — `<Card/>`, `<Button/>`, router-link, router-view in fixtures | 0.95 |
| extends | — | Vue has no class heritage in SFCs (inheritance is composition) | — |
| imports | ✅ | script `import` directives → `${modulePath}:${item}` (`vue:ref`, `./Card.vue:Card`); `defineProps`/`defineEmits` are compiler macros — no imports, no calls, no symbols | 1.0 |
| exports | ✅ | via JS analyzer (`export default`) | 1.0 |
| overrides | — | n/a for SFCs | — |
| contains | ✅ | Options-API members owned by the component (from `ownerName`); setup-scope top-levels have no owner (module scope) | 1.0 |
| uses | — | not emitted for `this.x` property access (family contract) | — |
| references | — | covered by imports/calls leaf identities | — |
| depends | — | not emitted (covered by imports) | — |

## Supported constructs

- SFC decomposition: `<template>` + `<script>` + `<style>` blocks located via
  the tree-sitter-vue `element` tree; template pass and script pass are
  independent, no source-text scanning
- `<script setup>` (JS + TS): imports, top-level const/let/var, function
  declarations, `defineProps`/`defineEmits` macros (filtered as compiler
  macros) — `Button.vue`, `UserList.vue`, `App.vue`, `Negative.vue`
- Options API (`export default`): `name`, `props` → property, `emits` →
  event, `data` → method, `computed` → property, `methods` → method,
  lifecycle hooks → method — `Card.vue`
- Template components: PascalCase (`<Card />`) and kebab-case
  (`<router-link />`, `<router-view />`) → instantiates (leaf tag name;
  builtin HTML/Vue tags filtered) — `UserList.vue`, `App.vue`
- Calls: leaf targets, member-expression chains, `this.$emit(...)`,
  `await fetch(...)` → `fetch`, `more.json()` → `json` — all fixtures
- Negative fixtures: template bindings (`v-if`/`v-for`/`v-model`/`@input`/
  `{{ }}`) never become symbols or calls; builtin HTML tags never instantiate;
  locals/params (`tmp`, `e`) never become symbols; `defineProps` never emits
  a symbol or call — `Negative.vue`

## Unsupported / explicit-unknown constructs

- `lang="ts"` scripts are parsed with the **JS** analyzer, not the TS one —
  deliberate family-consistency decision (the TS analyzer lacks
  method_definition scope resolution, so Options-API call sources degraded to
  `module`; M12.12 verified the JS analyzer handles TS syntax with
  `rootHasError: false` on every fixture). Type annotations are ignored, not
  synthesized.
- Template event bindings (`@click="handler"`) do not emit calls — only
  component instantiation is extracted from the template pass. Documented
  scope boundary.
- Slotted/`<component :is>` dynamic components are not resolved (dynamic
  target, family contract).

## Regex inventory

From `validation/m12/results/regex-census.json`: the Vue analyzer has **0
regex usages**. The legacy analyzer (source-text `indexOf("export ")`
scanning + attribute/directive noise) was rewritten to pure AST; the engine's
vue script pre-parse uses byte-offset `raw_text` slicing, not the polyglot
regex path.

## Complexity envelope

From `validation/m12/results/vue-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 27 | 30 | 520.5 | 52 | 58 | 210.9 MB |
| corpus_subset | 400 | 2,033 | 8,532 | 7,907.8 | 257 | 1,079 | 352.9 MB |

Declared budgets: fixtures < 2 s (met: 0.52 s); 400-file corpus < 60 s
(met: 7.9 s).

Hot-path audit: SFC tree walked once (explicit stack); script subtree
delegated to the JS analyzer (single iterative traversal, scope per-frame
snapshots); Options-API extraction is a single pass over the `export default`
object's direct named children; template instantiates resolved with
O(1) name lookups (import map + builtin-tag set); containment from
`ownerName` in one pass. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/vue.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the TS/JS family contract; 55 facts)
- Result: `validation/m12/results/vue-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` → `element-plus@1b45ace0`
  (clean; 1,008 tracked `.vue` files — real component library source in
  `packages/components/`, SSR cases in `ssr-testing/`, docs examples)
- Sample: 400 tracked `.vue` files (deterministic: all 164
  `packages/components` + 62 `ssr-testing` + first-174 `docs` sorted; sample
  file `validation/m12/results/vue-corpus-sample.txt`, reproducible from
  `git ls-files`)
- Symbols 2,033 / relationships 8,532 / wall 7.9 s / **0 crashes /
  0 timeouts / 0 error files** — clean corpus validation (fresh parser per
  file, mirrors production pipeline; scan script
  `script/m12/vue-corpus-errors.ts`)
- The previous corpus target `vue_core@f8975657` had only 11 `.vue` files —
  retained as a candidate, replaced by the real corpus measurement

## Evidence pointers

- Fixtures: `validation/m12/fixtures/vue/`
- Ground truth: `validation/m12/ground-truth/vue.json`
- Differential: `validation/m12/results/vue-differential.json`
- Complexity: `validation/m12/results/vue-complexity.json`
- Corpus sample: `validation/m12/results/vue-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.12 (GitHub issue #151).
