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
| syntax errors | ✅ | ERROR/missing nodes surfaced; `parseErrors` counted in the differential. The vue grammar's two error-recovery types are both classified HANDLED in `script/m14/spec/vue-completeness.json` (2026-10-12) and both EXERCISED by `vue/error-recovery`, which is what the pattern in the walk buys: each node becomes one warning at its own range, so a broken template reports WHERE rather than only THAT |
| decorators/attributes | — | n/a |

## Relationship ontology

**How to read this table.** Every row carries a MEASUREMENT taken through the
production entry (`src/ast/pool-worker.ts parseFile`, i.e. `getParser → parse →
analyze` with the SFC seam live) on one of three real corpora: `vuejs` (11 `.vue`,
the corpus the handoff assigned this lane), `vue-element-admin` (131, the Options-API
corpus) and `element-plus` (1,009 — the FULL draw, because this lane's own history
records that a 200-file draw reported clean while the full draw reported 5 MISSING
and 1 unexplained, so the full draw is the stronger evidence here too). Counts are
written `vue-element-admin / element-plus / vuejs` unless a row needs its own order,
and the full element-plus numbers are 4.6× its 400-file draw: `calls` 7,130 vs 852,
`references` 3,621 vs 244, `uses` 3,216 vs 597, `contains` 631 vs 86. A reader
comparing this document with an older 400-file figure is comparing different
populations, not a regression.
Script symbols/relationships exist only because `ASTEngine.parseFile` pre-parses
each `<script>` body with the JS/TS grammar and hands the trees over on the analyze
context (`engine.ts:1562-1593`). **A measurement that constructs the analyzer
directly — `new RealVueAnalyzer().analyze(root, content, file)`, which is what
`script/m14/firing-check-v2.mjs:167` does — reads 1/10 on the same 11 files,
because the script loop then runs zero times.** Both numbers are in this table and
the difference is a measurement, not a defect: on `vuejs`'s 11 files the same
analyzer emits 169 relationships + 25 `imports[]` through the seam and 10
relationships + 0 `imports[]` without it.

Verdicts: **EMITTED** = produced by production `parseFile` on a real corpus, with
the count and the files. **RULED (corpus)** = the construct does not occur on the
corpus, with the measurement that shows it. **CONSTRUCTIBLE, 0 corpus** = the
language has it, production `parseFile` emits it when it is present (pinned by a
fixture), and the corpus has no instance — the only honest label for a
construct the corpus cannot produce.

| Relationship type | Verdict | How resolved | Confidence |
| --- | --- | --- | --- |
| calls | EMITTED · 781 / 7,130 / 69 (files: 92 / 674 / 4) | script calls via the JS/TS delegate's leaf identities; source = the enclosing function/method leaf, re-pointed at the component identity by the F8 seam; `$emit` kept as a legit `$`-prefixed target; console/Object builtins filtered | 0.9 |
| uses | EMITTED · 2,080 / 3,216 / 32 (files: 112 / 716 / 4) | script-side identifier reads from the delegate PLUS template-expression reads (`{{ count }}`, `:label`, `@click`, `v-model`, `v-if`) emitted from the component to its member; template tokens are a hand-written stack machine, chain roots only, v-for/slot locals shadow same-named members (V4), an object-literal key is not a read (F10) | 0.95 template · **0.6 for 1,616 of the vue-element-admin rows** — see the honesty note below |
| contains | EMITTED · 826 / 631 / 12 (files: 112 / 163 / 2) | Options-API members owned by the component (`ownerName`), plus every shape a `provide(key, …)` publishes; setup-scope top-levels stay module-scope | 1.0 |
| references | EMITTED · 0 / 3,621 / 21 (files: 0 / 376 / 3) | component-contract family only: `defineProps`/`defineEmits` naming a declaration, `provide`/`inject` naming a key, plus the delegate's own type-level rows (`declared_type`, `type_argument`, `cast_target`, `instanceof_check`, …) | 0.8–1.0 |
| references · the `provide`/`inject` key row | EMITTED · the row is a BINDING question as of F21 (2026-10-12) | the pass matches a call by its callee TEXT and then asks what BINDS the name: a DECORATOR position (`@inject("db")`) publishes nothing; a name bound by `import … from 'vue'` (or `vue/…`, `@vue/…`) publishes; a name bound by any OTHER module (`vue-router`) or by a TOP-LEVEL declaration of the same name (`function inject`) publishes nothing; an UNBOUND name is Vue's global and publishes. Corpus-measured cost: 1,162 `.vue` files hold 96 provide/inject call sites and **all 96 are `import … from 'vue'`** — so the guard suppresses 0 corpus rows and the two fixtures are the whole of its effect. Before F21 the row was fabricated for all three non-Vue shapes | 0.9 |
| instantiates | EMITTED · 342 / 2,346 / 10 (files: 102 / 877 / 3) | template pass: every non-builtin element tag → the **registry name** (F31: `<el-button>` → `ElButton`, `<cardWidget>` → `CardWidget`, by Vue's `resolveAsset` order — written spelling, camelize, capitalize — with `metadata.tagSpellingsWritten`/`tagAsWritten`/`componentNameCandidates`/`resolution: "registry-name"` carrying what was written); builtin HTML/SVG tags and Vue builtins (`component`, `transition`, `keep-alive`, `teleport`, `suspense`) filtered **on the as-written spelling**, because the set holds camelCase natives (`linearGradient`) and normalizing first would turn markup into a component; a known namespace (`svg:circle`) is markup, an unknown one is a component; one component is one edge however many spellings reach it | 0.95 |
| exports | EMITTED · 0 / 2 / 0 after F19 | a **named** export → `module -> name`, target a real symbol: the two surviving corpus rows are `export interface StepItemState` / `export interface IStepsInject` in `packages/components/steps/src/item.vue`, both resolving 100%. The anonymous Options-API form `export default { … }` publishes NO edge (F19): `default` is a keyword, and that row resolved 0 of 121 both per-file and corpus-wide | 1.0 |
| extends | EMITTED · 9 / 1 / 0 (files: 9 / 1 / 0) | Options-API heritage: `mixins: [M]` → `extends` with `metadata.isMixin: true`, `extends: Base` with `isMixin: false`, so the two stay distinguishable (F1). 9 corpus rows, all mixins, 0 `extends:` options; the single element-plus row is the TS delegate's interface extension (`interface ActivityType extends Partial<TimelineItemProps>`) | 0.9 |
| imports | EMITTED · 197 / 3,685 / 25 relationship rows | the JS/TS delegates' import rows, carried by the seam. **The off-enum wording this row used to carry was stale and is corrected 2026-10-05**: `RelationshipType.Imports` read `"brain_import"` (the name of a TABLE) until `src/ast/types.ts:84` was repaired to `"imports"`, so the delegates were never off-enum in any sense a consumer could observe — they were emitting the value the enum has held since. `ParseResult.imports[]` is the SECOND channel and carries the same rows: 209 / 3,685 / 25 | 1.0 |
| implements | **CONSTRUCTIBLE, 0 corpus** | `class X implements I` inside a `<script lang="ts">` block → the TypeScript delegate's row, carried by the seam. **0 classes-with-implements across 897 script blocks in 1,151 corpus `.vue` files** — and 0 classes with a superclass either, so element-plus and vue-element-admin contain no class declaration of any kind inside any SFC. Re-verified 2026-10-05 by reachability probe through production `parseFile`: `class Widget implements Renderable` → `implements: Widget -> Renderable` conf 1.0, `structural`, `sfcDelegated`, plus `overrides: Widget.draw -> Renderable.draw` conf 0.95. Pinned by fixture `vue/ts-class-heritage-seam` | 1.0 |
| overrides | EMITTED on the in-file shape, **CONSTRUCTIBLE/0 corpus** for class heritage | two producers. (a) Options-API merge: a same-file `const` mixin literal + the component's same-named member → `overrides`, `meta.reasonCode: verified-in-file` (fixture `vue/options-mixin-overrides`). (b) delegated TypeScript class heritage → the delegate's row (same fixture). Corpus: 9 mixin bases, **all imported bindings**, 0 classes-with-superclass, 0 `override` modifiers → 0 corpus rows | 0.95 |
| depends | not emitted (covered by `imports`) | — | — |

### The two channel names, and why a ten-row enum table hides imports

**Corrected 2026-10-05.** This section previously explained `imports` by saying
`RelationshipType.Imports` was the string `"brain_import"` and that no emitter
produced it, so every instrument tallied against a type nothing writes. That was
true until `src/ast/types.ts:84` was repaired to `Imports = "imports"` — the value
`engine.ts:454` and `graph.ts` read, and the value the delegates always wrote.
**There is no off-enum import literal in this lane and there has not been since
that repair.** The reasoning below is kept because the trap it describes is real
and still open in older instruments; the claim about the enum is not.

`ParseResult` (`src/ast/types.ts:206-216`) carries imports on a **separate
channel** from relationships, and `parallel-indexer.ts:2169` writes them to the
`brain_import` TABLE. An instrument that tallies only `res.relationships` cannot
see that channel — which is why `firing-check-v2.mjs` reports the two separately
and why this lane's `imports` count has two numbers per corpus (relationship
rows, and `imports[]`). `firing-check-v2.mjs` also grades against
`engine.ts`'s enum rather than `types.ts`'s, which is the production vocabulary.

**The lane's own census got this wrong, and that is the worked example.**
`script/vue-fix/vue-ontology-census.ts` tallied the ten types against
`"brain_import"` and, on vuejs, printed in ONE run:

```
brain_import   ABSENT   0   0   -   -   0/0
RAW relationship labels: imports  25  4 files  OFF-ENUM  App -[imports]-> ./Header.vue:Header
```

A ten-row table saying ABSENT beside a raw histogram counting 25, in the same
printout. Repaired in this lane's census (the enum value, not the analyzer); the
raw-histogram block is deliberately retained because it is what made the
disagreement visible in one place.

### Corpus measurement of every RULED type (falsifiable)

`script/vue-fix/vue-construct-probe.ts`, Instrument B of the ontology gate
(a parse-tree semantic count, never a text pattern), over **1,151 real `.vue`
files** — `vuejs` 11 + `vue-element-admin` 131 + `element-plus` 1,009, 897 of them
with a script block, 941 blocks, lang distribution ts 769 / js 122 / tsx 10:

| construct that would produce the type | occurrences | what it rules |
| --- | --- | --- |
| `class … extends …` (script block) | **0** | no delegated class heritage ⇒ no corpus `extends` from a class, no `overrides` from a base class |
| `class … implements …` | **0** | `implements` — CONSTRUCTIBLE, absent from every corpus SFC |
| `override` modifier | **0** | `overrides` from TypeScript |
| `enum` / `decorator` | **0** / **0** | (no verdict depends on either) |
| Options API `extends:` option | **0** in 1,151 SFCs | the Vue-native heritage option never occurs; `mixins:` occurs **9** times (all imported bindings, so no in-file base exists ⇒ no in-file `overrides` either) |
| `export default` | **144**, all the object form | the Options-API shape; 0 `export default class` |
| `<script src=…>` on a script/style block | **0** | no SFC delegates its code to an external file |

A probe finding a non-zero count in any of those rows overturns the ruling; the
probe is lane-owned and re-runnable.

### 0 rows is not the same as a dead branch — reachability, measured 2026-10-05

The census and the construct probe both say 0 for `implements` and `overrides`
across 1,151 files. Neither number distinguishes two very different situations:

- a **dead branch** — the analyzer contains code that can never match, which is a
  defect in the analyzer, and which source derivation cannot see because the
  symbol is right there in the file;
- a **live branch the corpus cannot exercise** — the analyzer is correct and this
  corpus simply contains no instance.

`script/vue-fix/vue-branch-reach.ts` writes six shapes the Vue grammar and the
ts/js delegate both accept and runs each through production `parseFile`:

| case | fires |
| --- | --- |
| `implements-ts-class` — `class Widget implements Renderable` | `implements: Widget -> Renderable` conf 1.0 `structural` + `overrides: Widget.draw -> Renderable.draw` conf 0.95 |
| `overrides-inline-mixin` — `const base = {methods:{go,spare}}`, `mixins:[base]`, `methods:{go}` | `extends: InlineBase -> base` + `overrides: InlineBase.go -> base.go` conf 0.95 `reasonCode: verified-in-file` |
| `overrides-lifecycle-mixin` — lifecycle hook is a **shorthand method**, not a `pair` key | `overrides: L.mounted -> m.mounted` conf 0.95 |
| `extends-ts-class-superclass` — `export default class Widget extends Panel` | `extends: Widget -> Panel` conf 1.0 `sourceKind: class` |
| `overrides-ts-class-member` — the same, with a redeclared member | `overrides: Widget.go -> Panel.go` conf 0.95 `extendedClass: Panel` |

So both are live. **The honest statement of a 0/0/0 census row for this lane is
"this corpus cannot exercise it", not "the analyzer does not emit it"** — and that
distinction is the reason the two types are labelled CONSTRUCTIBLE rather than
RULED. A ruling asserts the construct does not occur; the construct does occur,
the corpus just has none.

### `instantiates` resolution, measured against the corpus and not against the file

Per-file resolution is the wrong question for a template component usage — a
`<Card/>` names a component declared in ANOTHER file by definition. Against all
symbol names the draw publishes (599 on vue-element-admin, 739 on the
element-plus draw) `instantiates` targets resolve **4.4%** and **1.5%**
respectively, against 0.3% / 0% per-file. The endpoints are real
(`el-tag`, `ElIcon`, `ClientOnly`, `i-ri-external-link-line`); most are globally
registered in a `components: {}` map or a UI library, so they resolve in neither
denominator. That is a RESOLUTION limit of the graph, not a wrong target: the
source end resolves 100% in both.

**F31 (2026-10-12) turned that paragraph's own conclusion into a measurement, and
the measurement moved the number.** The resolution limit had a FIXABLE half and a
non-fixable half, and the paragraph above conflated them. Measured on the 1,162-file
four-repo draw through production `parseFile` (`vuejs`, `element-plus`,
`vue-element-admin`, `vue-core`), 2,267 `instantiates` edges, exact string match
against the names the draw publishes:

| class of target | before F31 | after F31 |
| --- | --- | --- |
| names a symbol THIS file declares | 9 · 0.4% | 18 · 0.8% |
| names a symbol ANOTHER admitted file declares | 102 · 4.5% | **1,510 · 66.6%** |
| can be reached only through Vue's casing rule | 1,409 · 62.2% | 21 · 0.9% |
| nothing in the corpus declares it under any spelling | 747 · 33.0% | 718 · 31.7% |
| bound by an import in the carrying file | **0** | 0 |

So the WALKABLE share of this lane's `instantiates` payload moved from **111 edges
(4.9%) to 1,528 (67.4%)**, and the 21 that remain in the third row are the one shape
the rule deliberately does not touch (below). The class was named by the project's own
instrument for this question (`script/m14/vue-instantiates-targets.mts`), which rules
on it in its header — *"the as-written target does not [match]. The graph cannot walk
it and Vue resolves it. The analyzer owns this."* The rule was already written down
twice here and not applied: Vue's `resolveAsset` tries the written spelling, then
`camelize`, then `capitalize(camelize)` — which is what makes `<el-button>`, `<elButton>`
and `<ElButton>` one component — and this lane's own F9(b) ruling publishes the name
"the components registry holds and what a resolver must match" for a dotted tag
(`<Form.Input/>` -> `Form`, never `Form.Input`).

**The rule is two measurements, not one, and the second one corrected a first pass.**
A kebab (or camel) tag publishes the registry name, because that is the side the corpus
is on: **1,433 edges GAINED** (the written spelling resolves nowhere, `el-button` ->
`ElButton` 221 edges, `el-icon` -> `ElIcon` 101) against **16 LOST** (the written
spelling IS a declaration, the normalized one is not). A SINGLE ALL-LOWERCASE WORD is
published as written, because capitalizing it is genuinely two-sided and net-negative:
over the 53 such edges on the draw, **8 would gain and 20 would lose** (20 resolve as
written, 10 of those also resolve capitalized, 15 resolve neither way) — and Vue tries
the written spelling FIRST, which is why `<loading/>` names the component whose file is
`loading.vue`. The first version of this rule capitalized that shape too, on the false
generalization that a hyphenless tag is always better capitalized; the accounting
falsified it (36 lost, 19 of them single words) and the fixture now pins the corrected
branch with `<loading/>`/`<message/>` as controls.

**What the 16 LOST edges are, and why they are the next measurement rather than a
hole.** Every one is a component whose FILE is named the way the tag is written:
`guide-svg.vue`, `vp-link.vue`, `sponsors-button.vue`, `upload-dragger.vue` (15
distinct spellings). The tag rule spells such a component the way Vue registers it
(`GuideSvg`) while this lane's file-stem fallback spells it the way the FILE is named
(`guide-svg`), so the lane now holds two spellings for one component and those 16 edges
sit between them. Fixing it means normalizing the stem fallback the same way, which
moves SYMBOL names, not just targets — a separate change with its own measurement and
its own fixture, recorded here rather than smuggled into this one.

Instrument cross-check, quoted because it is a committed gate rather than a probe:
`script/m14/vue-instantiates-targets.mts` reports **RESOLVED 1,565 (69.5%) on the PRE-fix
tree and 1,527 (67.8%) after**, `CASING 0` in both. Its `RESOLVED` row counts the
rule-aware answer, so it credited the lane for the 1,409-edge class that the graph could
not walk, and the after figure is lower only because the single-lowercase-word shapes stop
being counted at all (it has no candidates for a hyphenless target). Exact match against
declarations — the thing a walk actually needs — moves the other way by 14x, which is the
pair in the table above.

Two-sided verification, because a target convention is exactly the kind of change two
readings of one specification can agree about while both are wrong. The F5 oracle now
derives the same name through its own implementation of the framework rule (a separate
function, not a copy of the lane's), and the scoped differential reports
`element-plus:vue` 400 files **tree-truth 2,883 covered 2,883 (100%) MISSING=0,
analyzer-edges 2,879, unexplained=0** and `vue-element-admin:vue` 131 files **882 covered
882 MISSING=0**, its 9 unexplained rows being the pre-existing `extends`-with-no-oracle
label. The oracle's own count moved with the lane's (2,927 -> 2,883), which is what
"both sides apply the same rule" looks like from outside.

**F32 (2026-10-12). The MISSING-SYMBOL half the F31 section above points at, and it was
bigger than the target question.** F17 (2026-10-31) ruled that a non-literal `name:`
keeps the file stem and records `declaredNameUnreadable`, on the premise — written into
its own rationale — that the value is "an IMPORTED IDENTIFIER, whose value lives in another
module". That premise is true of an import and was generalized to every identifier, which
is where it went wrong: element-plus declares nearly every component's name through a LOCAL
constant three lines above the option that consumes it.

```js
const COMPONENT_NAME = 'ElInput'          // input.vue, and the same shape in ~25 components
defineOptions({ name: COMPONENT_NAME })
```

Measured first, at the level that matters (the DECLARING file, not the using one — the first
probe asked the wrong question and returned 4 of 724): of the 724 unresolved component-usage
`instantiates` edges, **253 (34.9%) named a component whose own name is assigned as a string
literal in the declaring file** — `ElInput` 59 edges, `ElSelect` 42, `ElSwitch` 33, `ElForm`
20, 25 distinct names — while the lane published the stem and no consumer could bind the tag.
The rule now reads a top-level `const`/`let`/`var NAME = '<literal>'` in the same program,
refuses an IMPORTED identifier FIRST (F17's case, unchanged: `vue/component-name-identifier`
is the control and still publishes the stem plus the marker), and records
`metadata.nameFromLocalConst`, beside `identityFromFileStem`/`synthesized`, so the metadata
says HOW the identity was obtained.

The `<script setup>` path was wrong twice and both halves are fixed: it read the value with a
string-only lookup, so an identifier value produced no name AND no marker — a component that
named itself through a constant looked exactly like one that never named itself, and F17's
marker had never fired on this path at all.

| | before F32 | after F32 |
| --- | --- | --- |
| walkable `instantiates` targets (exact match) | 1,528 · 67.4% | **1,759 · 77.6%** |
| nothing in the corpus declares it under any spelling | 718 · 31.7% | **487 · 21.5%** |

So the lane's cumulative move on this payload is **4.9% (111 edges) -> 67.4% -> 77.6%**. The 231
edges that closed against the 253 the text-level probe predicted is itself a measurement: the
probe accepted any file carrying both the literal and a name shape, and a coarse probe
over-counts — `ElMenu` and `ElMenuItem` both pointed at one `menu-item.vue`, and one literal
per file can feed only one identity.

Two-sided again, and for a sharper reason than last time: this change RENAMES a component's
identity, so the oracle that derives `contains` from `name:` has to apply the same rule to
agree — its own implementation of it, with the import refusal written out separately. Scoped
F5 after the change: `element-plus:vue` 400 files **tree-truth 2,882 covered 2,882 (100%)
MISSING=0, analyzer-edges 2,878, unexplained=0** and `vue-element-admin:vue` **882 covered 882
MISSING=0** (its 9 unexplained are the pre-existing `extends`-with-no-oracle label). Fixtures
`--lang vue` exit 0 at 63 pass / 1 pre-existing failure, with
`vue/component-name-local-const`, `vue/options-name-local-const` and the imported control
pinning all three arms; the mutant `vue/local-const-name-revert` reverts the rename and the
re-point FROM the analyzer's own `nameFromLocalConst` metadata, and is CAUGHT by both new
fixtures.

**What did not move, and one thing that was wrong in the F5 instrument itself.**
(1) The edge COUNT is unchanged at 2,251 component usages: normalization renames a
target, it does not add or drop one, and moving the dedupe key from the written spelling
to the registry name moved **0** edges on this draw — no admitted file writes one
component two ways. That latent half is pinned by fixture, not by corpus:
`vue/kebab-registry-name` writes `ElButton` three ways and expects ONE edge carrying all
three (and normalization does not overreach: `<router-link/>` derives `RouterLink`, no
admitted file declares it, and the edge stays unresolved — **a right NAME is not a
fabricated DECLARATION**). (2) `script/m14/vue-instantiates-targets.mts` cannot report
the class this change closed, which is worth stating because its header does: its
`CASING` branch is UNREACHABLE. It tests `cands.some(c => c !== tag && corpusComps.has(c))`
after the `RESOLVED` branch has already returned for any candidate in `corpusComps`
OR `corpusNames`, so no input can reach `CASING` — measured by running it on the
PRE-fix tree, where it reported `CASING 0` while 62.2% of the payload was in that state.
Its `RESOLVED` row therefore counts the exact and the rule-aware answer in one number,
which is why the two-sided table above is quoted from the analyzer's own output instead.
Repairing that branch is a change to a committed instrument and is left as its own
task. (3) The 718 ABSENT edges are not a wrong target: 10 of the top 18 ABSENT names
(`ElInput`, `ElSelect`, `ElForm`, `ElMenu`, …) are components element-plus DOES declare,
behind an in-file indirection this lane cannot read
(`const COMPONENT_NAME = 'ElInput'; defineOptions({ name: COMPONENT_NAME })`) — measured:
0 of them has a direct `name: '<N>'` literal in any `.vue` on the draw, and 10 of 18
have the indirection — so that remainder is a MISSING-SYMBOL question (symbol naming),
not a target question.

## The six questions, per emitted type

`oracle` = does an independent walker agree? The oracle is a separate walker over
the SAME grammar, so a grammar bug shared by both paths is invisible to it; where
no oracle exists, that is stated rather than papered over. Counts are
`vue-element-admin / element-plus(full) / vuejs`.

| type | fires? | oracle agrees? | labelled right? | both ends resolve? | evidenceClass / confidence | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| calls | YES — 781 / 7,130 / 69 | YES for the script half: the vue `calls` oracle derives from the embedded script trees and `calls` is in the compared-label allowlist. **NOT audited for template calls**, because the analyzer emits none (see the template-call gap below) | YES — leaf targets; `sfcDelegated` on every delegated row | source 100% (the component identity); target 21.3% / 15.3% / 8.7% per-file, 26.1% / 25% corpus-wide — the JS family's convention is the callee LEAF, so `ref`, `slice`, `json` name no symbol in this or any file | `usage_contextual`, confidence 0.9 (≥0.7, deterministic per family contract) | 0 empty, 0 placeholder, 66 self-loops (recursion — `calls setData → setData`) |
| uses | YES — 2,080 / 3,216 / 32 | **NO.** `uses` is NOT in the vue compared-label allowlist, so the differential never sees a single row of it; the template half is asserted only by fixtures. 2,080 rows stored and compared against nothing | YES — template rows carry `isTemplateExpression`, delegated rows the JS family's own labels | 41.6% / 94.8% / 100% per-file | `usage_contextual`; **0.6 on 1,616 of the vue-element-admin rows** (the delegate's `isFieldAccess`/`bareRead` reads) — below 0.7, therefore a heuristic, with machine-readable reasons in metadata | 0 empty, 0 placeholder (after correcting my own word list — below), 18 self-loops |
| contains | YES — 826 / 631 / 12 | **YES, measured, 88.5%**: the lane-owned oracle derives 470 component-owned rows over the 1,151-file draw and the analyzer agrees on 416. The 54 disagreements are the ORACLE's false positives (a nested `name:` key read as the component identity), not the analyzer's. element-plus 253/253 and vuejs 12/12 | YES — `structural`, owner-derived | **100% / 99.8% / 100%** per-file and corpus-wide | `structural`, 1.0 | 0 empty, 0 placeholder, 0 self-loops |
| references | YES — 0 / 3,621 / 21 | **PARTIAL.** Only the component-contract family (F12/F2) is mirrored; the delegate's other producers (`declared_type`, `type_argument`, `cast_target`, `instanceof_check`, …) are audited for typescript/javascript, not for this lane | YES — `reference_qualified` | 59.1% / 60% on the full element-plus draw; per-file source 99.5%, target 59.1% | `reference_qualified`, 0.8 / 0.9 / 0.95 (all ≥0.7) | 0 empty, 0 placeholder, 18 self-loops |
| instantiates | YES — 342 / 2,346 / 10 | YES — the F1/F5 oracle derives them and `instantiates` is in the compared-label allowlist | YES — leaf tag name; `member`/`componentPath` in metadata for a dotted tag; a known namespace (`svg:circle`) is markup | source 100%; target 4.4% / 5.6% corpus-wide (most targets are globally registered in a `components: {}` map or a UI library, so they resolve in neither denominator) | `usage_contextual` 0.95, `structural` 1.0 for the 9 delegated rows | 0 empty, 0 placeholder |
| exports | YES — 0 / 2 / 0 after F19 (was 121 on vue-element-admin, every one `-> default`) | NO oracle derives it for this lane; `exports` is not in the compared-label allowlist | YES after F19: the surviving rows name real symbols and resolve 100%. Before F19, 121 of 121 targeted the keyword `default` | before F19 **0 of 121**, per-file AND corpus-wide; after F19 the 2 surviving corpus rows resolve 100% | `structural`, 1.0 | F19 removed 121 keyword endpoints |
| extends | YES — 9 / 1 / 0 | **NO in practice, and the harness says so.** The differential prints `COMPARED WITH NO TRUTH: extends (N comparable, 0 truth)` and then `unexplained-by-label: extends=N` (2 on one run, 6 on another — the lane's file sample rotates, so the count moves). Reproduced through production `parseFile` (`script/vue-fix/vue-extends-unexplained.ts`): all 9 vue-element-admin rows are `BarChart -> resize`, `SidebarItem -> FixiOSBug`, `Layout -> ResizeMixin` …, every one a `mixins:`/`extends:` option naming an IMPORTED module. The vue oracle reads the embedded script trees only, and in those trees the fact is an identifier plus the word `mixins` — no `class_heritage`, no `extends X` clause, nothing that states what the base declares. **The rows are correct**; the oracle cannot see them, because the fact lives in another file | YES — `isMixin` distinguishes the two forms (mutant `vue/mixin-label-swap` proves the distinction is pinned, not just present) | 77.8% corpus-wide on vue-element-admin (the mixin modules live outside the 131-file draw, so per-file 0% is expected); the element-plus row resolves 0% because `Partial` is a TypeScript built-in utility type with no symbol in any file | `usage_contextual` 0.9 / `structural` 1.0 | 0 |
| imports | YES — 197 relationship rows + 209 `imports[]` (vue-element-admin); 3,685 + 3,685 (element-plus full) | NO for this lane. The typescript/javascript oracle derives imports/exports from the DECLARED name while the delegate publishes the LOCAL BINDING, so switching it on would report every aliased import as MISSING. Aliasing is rare (4 of 622 on the 400-file draw) but the convention mismatch is a harness artefact, not a defect | YES — target is `${modulePath}:${item}` | n/a — a module-path endpoint is external by design | `import_based`, 1.0 | 0 |
| implements | **YES when the construct is present, 0 on this corpus.** Re-measured 2026-10-05: `script/class-with-implements` = 0 across 897 script blocks, and `class-with-superclass` = 0 too, so there is no class declaration of any kind inside any corpus SFC. Production `parseFile` on a written case emits `implements: Widget -> Renderable` conf 1.0 `structural` **and** `overrides: Widget.draw -> Renderable.draw` conf 0.95 — so the branch is LIVE, not dead, and a 0/0/0 census row cannot distinguish the two | the delegated shape is audited by the typescript lane's own oracle; nothing to audit here at 0 corpus rows | YES — `structural` | n/a at 0 corpus rows | 1.0 | 0 |
| overrides | **YES when the construct is present, 0 on this corpus, through TWO independent producers.** (a) Options-API merge — `overrides-lifecycle-mixin` → `overrides: L.mounted -> m.mounted` conf 0.95 `reasonCode: verified-in-file`; `overrides-inline-mixin` → `InlineBase.go -> base.go`. (b) delegated TypeScript class heritage — `overrides-ts-class-member` → `Widget.go -> Panel.go` conf 0.95 `extendedClass: Panel`. Corpus: 9 mixin bases, all imported bindings; `script:override-modifier` = 0 | the Options-API merge shape has a fixture, not an oracle — a DERIVATION-class gap | YES — `reasonCode: verified-in-file` on the in-file rows, `extendedClass` on the delegated ones | n/a at 0 corpus rows | 0.95 | 0 |

**DERIVATION findings: this lane is one of the 100, and the fraction is measured
here rather than asserted.** `script/m60/rel-type-coverage-gate.ts` CHECK 1 at
HEAD reports `vue 4 un-audited: ["contains","exports","references","uses"]`, plus
`imports`, which is invisible to that check because it rides `ParseResult.imports[]`
— a channel the gate does not read. The differential's compared-label allowlist
for `vue` is `["extends", "implements", "instantiates", "overrides", "calls"]`
(`differential.ts:23153`), so **five of the ten types sit outside it.**

As a fraction of this lane's real payload (production `parseFile`, every tracked
`.vue` file, population derived by `git ls-files`):

| corpus | total relationships | oracle-audited | un-audited |
| --- | --- | --- | --- |
| vuejs | 169 | 79 (46.7%) | **90 (53.3%)** |
| vue-element-admin | 4,235 | 1,132 (26.7%) | **3,103 (73.3%)** |
| element-plus | 20,632 | 9,477 (45.9%) | **11,155 (54.1%)** |

Un-audited by type across the three: `uses` 5,328 · `imports` 3,907 ·
`references` 3,642 · `contains` 1,469 · `exports` 2.

**Most of that payload is not this lane's own production — it is the JS/TS
delegate's, forwarded by the seam**, which changes where the cheapest repayment is:
`references` is 3,607 of 3,642 sfcDelegated (99.0%), so only 14 rows are
Vue-owned and `oracles/typescript-imports-exports.ts` — which already exists and
is wired for the typescript and javascript lanes — covers the same shapes.
`contains` is 292/631 delegated, `uses` 386/3,216. The genuinely Vue-specific
debt is the **3,169** rows that are this analyzer's own: the template `uses` reads
at 0.95 and the component-owned `contains`.

Not repaid here, and the reason is ownership rather than difficulty: the audited
set is `differential.ts` and its baseline is `validation/m14/differential-baseline.json`,
both master-owned, and CHECK 1 reads the differential's own filter by EVALUATING
it (the gate's header is explicit that restating the constant is what keeps an
instrument reporting a stale number). Editing the allowlist from this lane would
move 37 lanes of gate output including 56 repaid baseline entries. The allowlist
entry alone is also the `#910` trap the differential's own comments document — a
label the oracle derives but the allowlist omits reads as MISSING — so the oracle
and the entry have to land together. **Reported with the fraction, so master can
price it.** This is a statement that these rows are unCHECKED, which is different
from a claim that they are wrong.

**Two honesty notes that changed what the numbers mean.**

1. **`uses` at 0.6 is a heuristic, and it is 45% of that label's volume on the
   Options-API corpus** (1,616 of 2,080). Those rows are the JS delegate's
   field-access reads (`this.chart` → `chart`, `Math.sin` → `Math`) carrying
   machine-readable reasons (`isFieldAccess`, `bareRead`,
   `evidenceClass: usage_contextual`), which is what honesty-contract §4 asks for.
   They are still below the 0.7 line and must not be consumed as fact.
2. **The R7 word list produced 10 false positives in 10 raw hits** on the
   element-plus draw — `todo` (a real data property), `placeholder` (a real prop
   AND a real component: `docs/examples/image/placeholder.vue`), `symbol` (a real
   method in `views/icons/index.vue`). Re-measured 2026-10-05 over 1,140 `.vue`
   files and 24,867 relationships (`script/vue-fix/vue-r7-adjudication.ts`):
   **40 candidate-word endpoints, 40 of which resolve to a published symbol, 0
   real findings.** Empty endpoints are 0 in all 30 census cells across the three
   corpora and all ten types. The m60 ledger's 46 R7 sites deserve the same
   re-read: a word list is a candidate generator, not a verdict.

**The template-call gap, measured and deliberately not shipped.** The lane
documents "template event bindings do not emit calls" as a scope boundary. A
template expression is an expression: re-parsing all 8,526 template expressions on
the 1,151-file corpus with the javascript grammar finds **497 containing a
`call_expression`, in 143 files**, with 182 distinct callee leaves (`$emit` 28,
`t.toUpperCase()` 97, and the component's own handlers — `handleLink`,
`setVersion`, `downloadProject`, `submitForm`, `openMsg`…), and **0 shadowed by a
v-for/slot local**, so every one of them names a component member. That is a real,
common construct this lane does not publish. It is not shipped because the vue
`calls` ORACLE derives truth from the embedded script trees only
(`differential.ts:22288`) while `calls` IS in the compared-label allowlist, so 497
new analyzer rows would every one read as UNEXPLAINED against a master-owned
baseline. The svelte lane is the precedent and the size of the change: its oracle
carries an explicit template-call mirror (`differential.ts:22323`). Vue needs that
mirror first. Probe: `script/vue-fix/vue-template-call-probe.ts`.

## What is and is not verified

The per-type verdicts, the six questions per emitted type, every RULED
measurement and every gate result are in the next section, which supersedes the
2026-09-30 notes this file used to carry in this slot. Two of those notes were
wrong and are corrected there:

- `overrides` was recorded here as "genuinely not emitted". It IS emitted, on the
  one shape an SFC parse can read without leaving the tree (a same-file `const`
  mixin literal plus the component's same-named member), pinned by fixture
  `vue/options-mixin-overrides` since 2026-10-03.
- `exports` was recorded as "via JS analyzer (`export default`)" without saying
  what the row pointed at. It pointed at the keyword `default`, resolving 0 of 121
  on vue-element-admin. F19 removed that row on 2026-10-04.

## What is and is not verified — the 2026-10-04 re-measurement

Every number in this section was taken through production `parseFile` with the SFC
seam live, on 2026-10-04, by the two lane-owned instruments in `script/vue-fix/`.
Where an earlier figure in this document disagrees, THIS section is the current
one and the reason is given.

**What the differential says, and what it cannot say here.** The lane reads
`MISSING=0 / unexplained=0` on its compared labels (200-file draw, 2026-09-30),
and the compared-label set is only
`["extends", "implements", "instantiates", "overrides", "calls"]`
(`differential.ts:23153`). Everything else this lane emits is outside the
comparison, which is the DERIVATION debt quantified above.

**`bun script/m14/differential.ts --lang vue` did NOT run on this machine**, and
the reason is not this lane: `differential.ts:21418-21421` requires EVERY repo in
`LANG_REPOS ∪ SECOND_CORPUS` to exist before it starts a lane, and throws on the
first absent one. `grails-core` is absent here, so the sweep dies naming groovy's
corpus while being asked about vue; `vue-core` (typescript's second corpus) is
absent too, so it would die again. **No lane can be differentially checked on this
disk.** Corpus re-acquisition or a per-lane corpus precondition is a master
decision; the gate is untouched.

**What was run instead, with its result:**

| gate | result |
| --- | --- |
| `bun script/m14/run-fixtures.ts --lang vue` | pass **53**, fail **1** — `vue/decorator-metadata-868`, pre-existing at HEAD and caused by the shared matcher (below), not by the analyzer: the row's `decoratorLine` is the file's line 24, which is correct |
| `bun script/vue-fix/vue-mutation-proof.ts` | **6 mutants, 6 CAUGHT, 0 survived** |
| `bun script/m60/verify-vue-no-regex.ts` | **PASS** — 0 regex literals, 788 generated v-for shapes equivalent, header consistent |
| `bun script/m14/audit-analyzer-grammar.ts` | **vue PASS**, refs 45, unknown 0, unknownFields 0 (cpp/rust FAIL on 4 unregistered literals — pre-existing, recorded in the workstream) |
| `bun script/m14/vue-contains-oracle-run.mts --repo vuejs,vue-element-admin,element-plus` | oracle 470 rows, analyzer agrees 416 (**88.5%**); element-plus 253/253, vuejs 12/12, vue-element-admin 151/205 |
| `bun script/m14/ontology-coverage-gate.ts vue` | **exits 2 — no ruling table for `vue`.** `RULED_BY_LANG` (`ontology-coverage-gate.ts:194`) holds `bash` and `json` only, so the arbiter refuses to report rather than calling every un-emitted type unjustified. The lane's own construct probe (`script/vue-fix/vue-construct-probe.ts`) is the substitute, and a VUE entry in that table would let the arbiter run |
| `bun script/vue-fix/vue-ontology-census.ts` (three corpora, production path) | the per-type table above |
| `bun script/vue-fix/vue-construct-probe.ts` (1,151 `.vue` files) | the RULED-type measurements above |

**The 54 `contains` disagreements are the oracle's, measured.** `vueComponentName`
(`script/m14/oracles/vue-contains.ts:331`) takes the first `pair` whose key is
`name` with a string value ANYWHERE in the script tree, so an ECharts series entry
`series: [{ name: 'front' }]` (Keyboard.vue:132) becomes the component's identity:
the oracle then attributes all six members of Keyboard.vue to a component called
`front`, and LineMarker.vue's to `CUCC`. The analyzer's rule is the correct one —
`name:` is read only as a DIRECT named child of the `export default` object
(`real-vue-analyzer.ts:468`). Wired as it stands the oracle would report 54
permanent false MISSINGs, 11.5% of that corpus's oracle truth. The oracle is
marked "READ, never modified" and lives under the shared `script/m14` tree, so
this is reported rather than fixed.

**The one failing fixture is a shared-matcher defect, not an analyzer one.**
`run-fixtures.ts:345` intercepts a `null` constraint before the `meta.` branch at
`:369`, and unlike the array branch at `:331` it does not exclude `meta.` keys — so
`{"meta.decoratorLine": null}` compares against the non-existent top-level key
`actual["meta.decoratorLine"]`, which is always `undefined`, and therefore matches
EVERY row. In `expectRelationships` that turns the M59 "this edge must NOT carry x"
assertion into a wildcard (a false green); in `forbidRelationships` it forbids the
very edge the fixture requires (a false red, which is what
`vue/decorator-metadata-868` and `svelte/decorator-metadata-868` are showing).
7 assertions in 5 lanes are written against that branch. Master-owned; reported.

**Outgoing only.** Every edge this lane emits starts at the component being
analyzed. Resolving who points AT a given symbol — the reverse direction — is a
separate subsystem that is not built: the store persists `source_external` /
`target_external` for rows it cannot resolve inside the file, and nothing walks
them backwards. So "who calls this component?" is not answerable from this lane's
output alone, and any consumer that wants it needs the reverse pass.

So "100%" means *100% of the relation types the oracle derives, on the corpus it
derives them from* — not the whole `ParseResult`. The highest-value outstanding
items in this lane, in order: (1) the template `calls` mirror in the vue oracle, so
497 measured call expressions can be published; (2) an oracle + allowlist pair for
`uses` and `references`; (3) a VUE ruling table in `ontology-coverage-gate.ts`;
(4) the `meta.x: null` matcher fix, which unblocks two lanes' fixtures.

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
  (`<router-link />`, `<router-view />`) → instantiates (the registry name —
  `Card`, `RouterLink`, `RouterView`, by Vue's resolution rule; the written
  spelling travels in metadata; builtin HTML/Vue tags filtered) — `UserList.vue`,
  `App.vue`, `kebab-registry-name.vue`
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
  component instantiation is extracted from the template pass. **This is a
  measured GAP, not a scope boundary, and it is not closed here:** 497 of 8,526
  corpus template expressions contain a call expression (143 files, 182 distinct
  callee leaves). It cannot be closed from this lane because the vue `calls`
  oracle derives truth from the embedded script trees only while `calls` is in the
  compared-label allowlist, so the new rows would all read as UNEXPLAINED. The
  measurement, the shadow analysis and the svelte mirror to copy are in
  "What is and is not verified" above.
- Slotted/`<component :is>` dynamic components are not resolved (dynamic
  target, family contract). **Measured:** 82 occurrences in 51 files
  (`vue-construct-probe.ts`), so the construct is present and the ruling stands
  only because the target is computed at runtime.
- `lang="ts"` scripts ARE dispatched to the TypeScript analyzer (M60/#903), so
  the first bullet above is narrower than it reads: a `lang="ts"` block's
  type-level rows come from the TS delegate.

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

**Payload and latency re-measured 2026-10-05 on the FULL element-plus draw**
(1,009 files, `script/vue-fix/vue-ontology-census.ts --repo element-plus
--mode prod`, production `parseFile`):

| channel | bytes |
| --- | --- |
| relationships (20,632 rows) | 4,310,880 |
| symbols (6,157) | 5,721,079 |
| `imports[]` (3,685) | 328,148 |
| **total ParseResult payload** | **10,360,107** |

Wall 35,981 ms for 1,009 files through production `parseFile`, with the census's
own per-file JSON serialisation in the loop — that serialisation is **not** in the
production path, so the figure is an upper bound on the payload measurement and
the documented 7.9 s for 400 files is the like-for-like latency number.

**This lane ADDED no edges in this round** (the only commit touching
`src/ast/real-vue-analyzer.ts` in this branch is a revert to byte-identical, see
the duplicate-symbol entry below), so no budget is regressed and none is
re-baselined. The figures above are recorded because the workstream requires the
check to be re-run after adding edges and this is the state that check found.

Hot-path audit: SFC tree walked once (explicit stack); script subtree
delegated to the JS analyzer (single iterative traversal, scope per-frame
snapshots); Options-API extraction is a single pass over the `export default`
object's direct named children; template instantiates resolved with
O(1) name lookups (import map + builtin-tag set); containment from
`ownerName` in one pass. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/vue.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the TS/JS family contract; 58 facts)
- Result: `validation/m12/results/vue-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`
- **NOT re-run on 2026-10-04**: `bun script/m14/differential.ts --lang vue` aborts
  before any lane runs, because its corpus precondition demands every repo in
  `LANG_REPOS ∪ SECOND_CORPUS` and `grails-core` (and `vue-core`) are absent from
  this disk. The numbers above are therefore the 2026-09-30 M12 result and the
  2026-10-04 lane gates are the current evidence. The measured substitute is
  `bun script/m14/vue-contains-oracle-run.mts` (470 oracle rows, 88.5%
  agreement) plus the fixture and mutation runs recorded above.
- **Re-run 2026-10-05 with `--repo vue-element-admin`, which scopes the corpus
  precondition to one repo and gets past the abort.** The vue lane reports:

  ```
  [vue-element-admin] vue: files=60 tree-truth=375 covered=375 (100%) MISSING=0
        | analyzer-edges=375 unexplained=2 (0.5%) heuristic=0
        | unexplained-by-label: extends=2
  [vue-element-admin] vue: COMPARED WITH NO TRUTH: extends (2 comparable, 0 truth)
  ```

  (a second run of the same command reported `unexplained=6`, because the lane's
  file sample rotates between runs — the honest form of this number is a range
  over runs, not a single figure.)

  **The `extends` rows are correct and the oracle is what cannot see them.** All 9
  corpus heritage rows name an imported module, so the embedded script tree holds
  an identifier and the word `mixins` and nothing that states what the base
  declares. See the `extends` row in the six-questions table for the per-file
  reproduction. This is why the differential's own `unexplained` is not 0 for
  this lane and is recorded here rather than explained away.

  The run then aborts later, on an unrelated lane: `vue-element-admin:xml parsed
  46 file(s) and derived ZERO truth edges — the parser or the oracle is dead, not
  clean`. That is the harness's own anti-fabrication guard firing correctly on the
  xml lane, and it is outside this lane's ownership.

## A defect found at the seam, attributed OUTSIDE this lane

Recorded because "found in a .vue file" is not the same as "belongs to the vue
analyzer", and a fix applied at the wrong layer is worse than no fix.

```js
export default {
  extends: { methods: { hi() { return 0 }, spare() { return 7 } } },
  methods:  { hi() { return 1 } },
}
```

Production `parseFile` on that `.vue` publishes `OrderA/class`, `hi/method`,
`spare/method`, **`hi/method`** — two runtime methods, three symbols, which
contradicts the M49/#745 last-wins ruling this lane implements.

Measured three ways:

| # | how | result |
| --- | --- | --- |
| 1 | the same object literal in a **plain `.js` file** through `RealJavaScriptAnalyzer`, no vue anywhere | `hi/method spare/method hi/method` — duplicates |
| 2 | the `.vue` through production `parseFile` | same duplication |
| 3 | inline-`extends` census over all 1,151 corpus `.vue` files | **0 occurrences** |

So the duplicate is produced by the **JavaScript delegate** and the vue seam
forwards it faithfully. A fix here would have suppressed a row the javascript
lane owns, masked the defect at its source for every other consumer of that
delegate, and regressed this lane's contract — which is not to filter rows another
analyzer is responsible for emitting. The fix that was written was reverted;
`src/ast/real-vue-analyzer.ts` is byte-identical to the commit before the hunt.

Corpus prevalence is 0, which is why 54 passing fixtures did not catch it — the
same trap this lane's own zero-regex gate records (47 fixtures passed while a
hand-written parser disagreed with its removed regex on 170 of 799 shapes).
**Filed for the javascript lane**, with the repro above. Probe:
`script/vue-fix/vue-dup-symbol-probe.ts`.

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
- **2026-10-04, all three corpora, production `parseFile`, 0 parse failures and 0
  crashes on every one**: element-plus FULL 1,009 files → 6,154 symbols /
  20,632 relationships / 3,685 `imports[]` / 25 `exports[]` / 734 files carrying a
  delegated row / 69.5 s wall with this instrument's per-file JSON serialisation
  (not in the production path). vue-element-admin 131 → 996 / 4,235 / 209 / 121 /
  115 files. vuejs 11 → 66 / 169 / 25 / 0 / 4 files. The 1,009-file draw is the
  evidence the ontology verdicts rest on; the 400-file draw in the rows above is a
  subset of it and is 4.6× smaller per label.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/vue/` (M12 hand audit) and
  `validation/m14/fixtures/vue/` (53 passing at HEAD)
- Ground truth: `validation/m12/ground-truth/vue.json`
- Differential: `validation/m12/results/vue-differential.json` — NOT re-run on
  2026-10-04; see the corpus-precondition note above
- Complexity: `validation/m12/results/vue-complexity.json`
- Corpus sample: `validation/m12/results/vue-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- **Lane instruments (2026-10-04, lane-owned, re-runnable):**
  - `script/vue-fix/vue-ontology-census.ts` — per-type census through production
    `parseFile`, with `--mode prod|engine|direct` so the SFC-seam difference is a
    measurement rather than an argument, plus the RAW label histogram and a
    corpus-level resolution pass
  - `script/vue-fix/vue-construct-probe.ts` — Instrument B of the ontology gate,
    over 1,151 real `.vue` files; every RULED type's population
  - `script/vue-fix/vue-template-call-probe.ts` — the template-call population
  - `script/vue-fix/vue-mutation-proof.ts` — 6 mutants against the shared fixture
    runner
  - `script/vue-fix/evidence/*.json` — the census and probe output behind every
    number quoted here
- Docs: this file

## Recorded fixture baseline (2026-10-11)

`validation/m14/fixture-baseline.json` records this lane at **7 failing pins of 60**, and
`validation/m14/fixture-baseline.failing.json` names them, because a count cannot say WHICH fixture is
red — a fixed pin and a newly broken one can trade places invisibly (`7 -> 7`). Five were already red
when the baseline was written at `31b6cd908`: `contract-call-local-shadow`, `contract-call-name-shapes`,
`heuristic-evidence-floor`, `js-default-export-delegate-row` and `ts-default-export`. Two arrive with
the javascript round `4d1da43ed` — `options-rename-identity` and `payload-pins` — whose binding change
altered the rows the JS delegate this analyzer consumes produces (the missing rows are the delegate's:
`exports ActualName -> api`, `imports ActualName -> ./Child.vue:Child`, `calls payload-pins -> ref`).
Both are RECORDED rather than adjudicated: whether they are stale pins or rows the delegate owes back
is open. The bisect (this lane 55/5 at `31b6cd908`, 53/7 at HEAD, with the fixture files unchanged) and
the gate change are §18 of `docs/analyzers/BRANCH-INVENTORY-2026-10-07.md`.

**Re-measured 2026-10-12 (F21): this lane is at 59 pass / 1 fail of 60.** The four pins named above are
green: `contract-call-local-shadow` and `contract-call-name-shapes` at the CAUSE (F21 replaced the pass's
callee-text test with a binding test — see the `references · the provide/inject key row` entry in the
ontology table), and `js-default-export-delegate-row` / `ts-default-export` by re-pinning against the F19
ruling they were written before. The single remaining failure is `heuristic-evidence-floor`, the tier-floor
pin: its claim is `src/lsp/evidence_tier.ts` rule 2 (every sub-0.7 row reads `inferred`) and the
implementation applies that floor only inside `STRUCTURAL_KINDS`, so the disagreement is in the
implementation — but the consumer is every lane's stored `evidenceClass` and the LSP tier badge, so it is a
policy decision and is referred rather than fixed in a lane pass.

`validation/m14/fixture-baseline.json` still recorded the 2026-10-11 state (7 of 60) until
2026-10-12, because retiring an allowance is a FULL run's act (`--update-baseline`) and a scoped run
reports it STALE-HIGH and refuses to write — the gate's words for that pair were "vue: recorded 5,
measured 1 — 4 retirable". The ceremony has since been taken: a full run with `--update-baseline`
(50 lanes, exit 0) retired **13 failure(s) across 2 lane(s) — vue 5 -> 1, svelte 9 -> 0**, leaving this
lane recording exactly ONE failure, and `validation/m14/fixture-baseline.failing.json` now names it
alone (`heuristic-evidence-floor`) instead of the five pins the 2026-10-11 record carried. A full run
afterwards, without the flag, reports `fixture baseline gate: no regressions` with no stale-high and no
unrecorded report, and both artifacts are SHA-256 identical to the written ones.

**Re-measured 2026-10-12 (F28, the grammar census): still 60 pass / 1 fail of 60, and the ONE failure is
unchanged** — `heuristic-evidence-floor`, the tier-floor pin above. What this round added is the two
grammar node types the lane's completeness spec did not classify and no fixture exercised:
`script/m14/completeness-inventory.ts` section A reports every node type a lane's spec leaves in no
bucket, and the vue grammar's own ERROR-RECOVERY pair — `ERROR` and the zero-width MISSING token — was
unclassifiable while the svelte lane, which shares this seam's script machinery, had classified both.
They are HANDLED, and that is a measurement rather than a preference: `real-vue-analyzer.ts` walks
`rootNode.hasError` and turns every `n.type === "ERROR" || n.isMissing` node into a `ParseResult.errors`
warning at that node's OWN range, so a document that does not parse still reports WHERE. Classifying them
HANDLED then exposed the half that was missing, because `script/m14/verify-fixture-coverage.ts` (F6, no
dead analyzer literal) demands a fixture that EXERCISES every handled type: no vue fixture source carried
a markup-level parse error at all. `vue/script-error-offset` pins a SCRIPT-side error produced by the
JavaScript sub-parser and shifted to SFC coordinates, so it exercises neither vue-grammar node. The new
fixture `vue/error-recovery` supplies both shapes — measured on the pinned grammar, `<div class= >` yields
an ERROR at 29:13 and an unclosed `<p` yields a zero-width MISSING `>` at 30:5 — and pins that the
component's identity and its script declarations SURVIVE a template that does not parse, because the seam
parses the script block separately. Vue is 39 types classified, sections A-H 8/8, and the coverage gate
reads `handled=22 fixtureTypes=29 uncovered=0 ambiguous=0 deadLiterals=0`.

**Re-measured 2026-10-12 (F30, the SVG vocabulary): still 60 pass / 1 fail of 60, and the ONE failure is
unchanged** — `heuristic-evidence-floor`, the tier-floor pin above. F30 adds no fixture: it EXTENDS
`vue/modern-html-svg-builtin-tags`, which already pinned the builtin boundary, because the defect is the
same contract one vocabulary level deeper.

What it found, on this lane's 1,162-file draw (`vuejs`, `element-plus`, `vue-element-admin`, `vue-core`):
`instantiates` carried **2,708 edges of which 2,533 (93.5%) named a target nothing publishes**, and **441
of those were not unresolved components at all — they were markup**. The builtin list was the HTML spec's
element set plus 23 SVG names, so `<filter>` and every filter PRIMITIVE fell through it and were published
as component usages. That is not a hypothetical class of SVG: a filter chain is what every icon with a
shadow, a blur or a saturate carries, and the corpus proved it — 64 files, seven tag names, 61 to 64 edges
each (`filter` 64, `feGaussianBlur` 64, `feFlood` 63, `feColorMatrix` 63, `feOffset` 63, `feBlend` 63,
`feComposite` 61). Measured by a counterfactual probe that walks neither side of the fix: a template-scoped
census over the same 1,162 files with the PRE-F30 list, asking production `parseFile` for the file's
symbols only (F30 changed no symbol). Its own gate is that it reproduces the pre-fix number for the six
primitives — 377 — through a different route, and it does.

The 441/377 split is the part worth reading twice. The type lost 441 edges while the UNRESOLVED bucket lost
only 377, because 64 of them — every `<filter>` — resolved against a symbol published by a DIFFERENT file in
the corpus: markup wearing a real component's name, which is strictly worse than a dangling edge, since a
consumer cannot tell it from a usage of that symbol. Cross-checked in the other direction rather than
assumed: **zero** of the 441 matched a symbol the SAME file declares, so the fabrication was never local.

The fix is one vocabulary, three literals. This analyzer's `HTML_BUILTIN_TAGS`, the svelte lane's, and the
F5 oracle's `ORACLE_HTML_TAGS` are held IDENTICAL by `script/m14/verify-cross-language-consistency.ts`
(the #611 drift gate), so all three gained the same 62 names: SVG 2's filter module and the rest of the
element vocabulary, in two blocks that are labelled separately in the source — the seven measured on the
corpus, and the spec's remaining vocabulary, which is a claim about the specification and NOT a corpus
measurement (only 7 of the 62 occur anywhere on the draw). An unknown namespace still fails toward
VISIBILITY; a spec-defined element is markup.

Verification: the F5 oracle agrees with this analyzer at **100% coverage, MISSING=0, unexplained=0** on a
400-file `element-plus:vue` draw (truth 2,433) and a 131-file `vue-element-admin:vue` draw (truth 882,
whose 9 unexplained edges are the known `extends`-with-no-oracle label). The mutant
`vue/reemit-filtered-kebab-tags` was extended to re-emit the seven names and is CAUGHT by this fixture
alone. Both typechecks are clean, the fixture-provenance gate reports no edited fixture failing, and the
analyzer's own run moved 2,708 -> 2,267 instantiates with nothing else changed.

The lane's remaining 2,156 unresolved instantiates (95.1%) are NOT touched by this and are not claimed:
most are components imported from outside the file the edge was published in, which is a resolution
question rather than a fabrication one.

## Issue

Closes M12.12 (GitHub issue #151).
VUE_FIX lane (2026-10-04): F19 `exports → default` at the SFC seam, F20's
class-heritage seam fixture, and the per-type re-measurement recorded above.
VUE_FIX lane (2026-10-12): F21, the provide/inject BINDING guard, and the four
vue pins it moved — measurement and mutant in §24 of
`docs/analyzers/BRANCH-INVENTORY-2026-10-07.md`.
VUE_FIX lane (2026-10-12): F30, the SVG element vocabulary at the builtin
boundary — 441 fabricated `instantiates` edges measured over the lane's
1,162-file draw, and the three-way lockstep with the svelte lane and the F5
oracle; §27 of `docs/analyzers/BRANCH-INVENTORY-2026-10-07.md`.
