# real-vue-analyzer.md

## Language

- Analyzer file: `src/ast/real-vue-analyzer.ts`
- Parser: `tree-sitter-vue` (SFC pass over the `.vue` file) + a per-block
  dispatch for `<script>` content. **Three-way** (M60/#903): `lang="ts"` →
  `RealTypeScriptAnalyzer`, `lang="tsx"` → the TypeScript analyzer over the JSX
  grammar, otherwise → `RealJavaScriptAnalyzer`. The dispatch is
  `real-vue-analyzer.ts`'s `isTs`, reading the block's own `lang` off the
  engine's `sfcScriptLangs`. **This row said "always JS" until 2026-09-30 and
  was false from #903 onward** — a `lang="ts"` block is analyzed as TypeScript,
  which is why a TS SFC yields `returnType`/`genericParameters`/decorator
  metadata and reports `hasTypeInference: true`. The reason the JS analyzer is
  still used for the *default* block is narrower and still true: it resolves
  `method_definition` scopes inside the Options-API default-export object, where
  the TS analyzer emitted call sources as `module` (M12.12).
  <!-- provenance: find-grammar-provenance -->
  Provenance of the shipped bytes: a **REDISTRIBUTOR BUILD**, not a build of this lane's own
  npm package. `wasm/tree-sitter-vue.wasm` is
  byte-identical to `tree-sitter-wasms@0.1.12`'s `out/` wasm (sha256 `6244521bb3fb60f3…`).

  **That collection publishes no source** — 0 `grammar.js`, 0 `parser.c`, only prebuilt wasms —
  so these bytes cannot be regenerated from it, and the underlying GRAMMAR version is recorded
  nowhere in this repository and must not be inferred from the collection's version.

  Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference from
  size or date); evidence in `validation/m60/results/G-PROVENANCE.json`. This matters for the
  web-tree-sitter 0.27.0 migration: this is one of the lanes whose wasm cannot simply be
  rebuilt from what we have, only re-sourced and re-admitted.
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
| extends | ✅ | **Options-API inheritance**, which this row previously denied outright and which is Vue's own class heritage: `extends: Base` and `extends: [A, B]` → `extends` from the component, and `mixins: [M]` likewise with `metadata.isMixin: true` so specialization and sharing stay distinguishable (F1). The inline-object form `extends: { methods: {…} }` is a *merge*, so it yields no base class and its members become the component's members. `extends` was already in this lane's audited relation set, so the oracle derives it (`deriveVueHeritageTruth`) and the rows are verified | 0.9 |
| imports | ✅ | script `import` directives → `${modulePath}:${item}` (`vue:ref`, `./Card.vue:Card`); `defineProps`/`defineEmits` are compiler macros — no imports, no calls, no symbols | 1.0 |
| exports | ✅ | via JS analyzer (`export default`) | 1.0 |
| overrides | — | genuinely not emitted, and now **derived as an absence** rather than asserted: the F1 oracle derives every `extends` base the analyzer emits and vue-element-admin reads `MISSING=0 / unexplained=0` with 9 `extends` rows and 0 `overrides` rows on both sides. An override needs a base whose members the analyzer can see; the only such bases here are same-file mixin literals, which carry no method list the analyzer treats as a hierarchy | — |
| contains | ✅ | Options-API members owned by the component (from `ownerName`); setup-scope top-levels have no owner (module scope) | 1.0 |
| uses | ✅ | script-side identifier reads from the JS/TS delegate (**2,225 rows** on the 400-file element-plus draw below, UNAUDITED — see the honesty note), PLUS template-expression reads: `{{ count }}`, `:label`, `@click`, `v-model`, `v-if` emit `uses` from the component to its member (V2). Template tokens are a hand-written stack machine: chain roots only (`item.id` reads `item`, not `id`), string/template contents skipped, v-for loop vars and slot props shadow same-named members (V4), and an **object-literal key is not a read** (F10) | 0.95 template / delegate |
| references | ✅ | **audited only for the component-contract family** — see the honesty note below. Measured 2026-09-30 on a 400-file element-plus draw through `ASTEngine.parseFile`: **3,275 rows, of which 315 are contract-marked and audited and 2,960 are not** — 1,774 unmarked delegate local reads, 656 `declared_type`, 317 `type_argument`, 181 `cast_target`, 25 `type_alias`, 6 `instanceof_check`, 1 `satisfies_target`. The audited family is F12/F13/F14 `defineProps`/`defineEmits` naming a declaration and F2 `provide`/`inject` naming a key | 0.8–1.0 |
| depends | — | not emitted (covered by imports) | — |

## What is and is not verified

The lane reads **100% / MISSING=0 / unexplained=0** on both corpora at 200-file
depth — and that figure is now honestly sized. Measured 2026-09-30:

- **Audited** (an oracle derives them independently from the same parse input):
  `calls`, `extends`, `instantiates`, `overrides`, and — since 2026-09-30 — the
  **component-contract `references` rows** (F12/F2), via a metadata-aware
  allowlist (`VUE_CONTRACT_ROW`) that admits ONLY rows carrying a contract
  marker.
- **Also audited, partially**: `contains`, via the lane-owned TypeScript oracle
  applied to the embedded script blocks. 216 of the label's 363 rows on a
  400-file element-plus draw — the DELEGATED half — matched 99/99, so it is in the
  audited set. The 147 the Vue analyzer owns (component → its own contract members)
  are **not**: an oracle exists at 141/163 (`oracles/vue-contains.ts`) and wiring it
  half-derived would manufacture failures rather than audit anything.
- **Not audited**: the other **2,960** `references` rows, and `uses` in full
  (**2,225** rows, of which **1,849** are the Vue analyzer's own template reads).
  `imports` (2,789) and `exports` (2) have no oracle in the instrument at all — `deriveTypeScriptEdges` emits only `calls` and
  `instantiates` — so those labels are unaudited for want of truth, not for want of
  scope. All of it is stored and compared against nothing, which the M60
  rel-type-coverage gate CHECK 1 reports as un-audited debt for this lane. The gate's debt baseline file
  (`validation/m60/rel-type-coverage-baseline.json`) does not exist, so its
  regression output is uninterpretable on a machine where most corpora are
  absent; writing one now would record absent corpora as verified debt.

Two measurement notes, because they changed what the numbers mean:

- The 200-file canonical draw reported this lane clean while the full 829-file
  element-plus draw reported 5 MISSING and 1 unexplained. Three defects (F13, F14,
  and the `withDefaults` interaction) were **invisible at 200 files**. The full
  draw is the stronger evidence and is what the 2026-09-30 deep review measured.
- The m60 surface draw counts relationships through the production entry point and
  walks the corpus in raw `readdir` order, not sorted order — so a probe that
  sorts file names first gets a different, much more `docs/`-heavy sample and
  numbers an order of magnitude apart — on the same nominal "400 files", a sorted
  element-plus draw reported `references` 254 against the audit's 3,275. **Every
  label count in this document is the element-plus-only 400-file draw**
  (`calls` 5,847 · `references` 3,275 · `imports` 2,789 · `uses` 2,225 ·
  `instantiates` 871 · `contains` 363 · `exports` 2), measured through the
  production `ASTEngine.parseFile`, so the audited and unaudited splits quoted
  below are all on the same population. The m60 surface audit's own L1 line covers
  both corpora and therefore prints slightly different totals — both are correct,
  and mixing them is the mistake this note exists to prevent.

So "100%" means *100% of the relation types the oracle derives, on the corpus it
derives them from* — not the whole `ParseResult`. The single highest-value
outstanding item in this lane is deriving the remaining `references` producers
(nine shapes, enumerated above) in the JavaScript oracle.

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

**0 usages.** The census is the authority (`validation/m12/results/regex-census.json`)
and this file now agrees with it: the six literals the census used to register here
were **deleted**, not re-registered, on 2026-09-30.

| removed pattern | replaced by |
|---|---|
| a case-insensitive test for the substring `line`, classifying a metadata **key name** so `decoratorLine`/`decoratorLines`/`line` get the script-block offset | `key.toLowerCase().includes("line")` |
| a character class stripping every quote from a `name:` value | the file's existing `unquote` helper |
| an identifier character class, used in **two** places | one shared hand-written tokenizer (`collectIdentifierNames`) |
| the `v-for` collection pattern and its tail-less sibling | `parseVForDirective` |

Three of those were not unavoidable. The identifier class was the interesting one:
the lane already had a hand-written stack machine tokenizing the *same* input class
one method away, so it ran **two tokenizers for one job and they disagreed on
method** — a disagreement the census itself recorded as a reason to review the
patterns. Deleting the class deleted the duplication with it.

The `v-for` pair was the hard one, and `parseVForDirective` reproduces three
behaviours a naive parser gets wrong: the alias head is the **shortest** run
without a `)` (lazy, not greedy), the `)` belongs to the **keyword match** rather
than the head, and `.` does not match a newline, so a collection spanning lines
fails the pattern and the caller falls back to the whole directive — while its
tail-less sibling still matches, which is why shadowing survives that case.

**Zero is a claim, so it is gated.** `script/m60/verify-vue-no-regex.ts` counts the
literals *and* re-derives the equivalence between the removed `v-for` patterns and
the shipped parser over 788 generated shapes on every run. That gate exists because
the first hand-written parser was **wrong**: it consumed the separator greedily
instead of backtracking, so `v-for="item in  "` reported no collection where the
regex reported one — differing on 170 of 799 shapes while **all 47 fixtures still
passed**. Equivalence was then confirmed end-to-end: byte-for-byte identical output
over all 1,139 corpus files (25,028 relationships, 7,078 symbols).

The legacy analyzer (source-text `indexOf("export ")` scanning) was rewritten to
pure AST and the engine's SFC pre-parse uses byte-offset `raw_text` slicing — both
still true.

One thing is deliberately still regex-shaped in the *tests* rather than the
analyzer: `oracles/vue-contains.ts` and the zero-regex gate quote the removed
patterns on purpose, because a gate that re-derives an equivalence has to have
both sides.

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
