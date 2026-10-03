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

Measured through the production entry point (`parseFile` from
`src/ast/pool-worker.ts`) over the whole admitted corpus — 1,114 `.css`/`.sass`/`.less`
files across 61 repositories, `validation/m14/census/css-parsefile-census.ts`. "Both
ends resolve" is parallel-indexer's own insert-time binding rule, so the rate is what a
consumer gets and not what the analyzer wrote.

| Relationship type | Emitted? | Edges / files | Both ends resolve | How resolved |
| --- | --- | --- | --- | --- |
| contains | yes | 168,206 / 553 | 168,206 / 168,206 | custom-property declaration scope (`:root contains --primary`); at-rule scope (`@layer base contains body`); `@media`/`@supports`/`@container`/`@scope` scope; nested-selector scope (`.nav contains .nav .item`); selector-chain edges, emitted only where both chain leaves are published symbols |
| uses | yes | 2,609 / 323 | 2,609 / 2,609 | `animation`/`animation-name` naming a `@keyframes` this file declares (2,561); `font-family` naming an `@font-face` family this file declares (48) |
| references | yes | 161,192 / 369 | 159,184 / 161,192 (98.8%) | `var(--x)` reading a custom property (161,191); a selector using a declared `@namespace` prefix (1) |
| imports | yes | 171 / 46 | 0 / 171 | `@import url("x.css")` / `@import "x.css"`, unwrapped by the pure-String `unwrapUrl` |
| overrides | yes (this milestone) | 4 / 2 | 4 / 4 | a second `@keyframes` of one name under the SAME at-keyword, and a second `@property --x` registration. See "M14 ontology verdicts" below |
| extends | no — RULED | 0 | — | no supertype clause in 103 node types; 0 `@extend` directives on the tree |
| implements | no — RULED | 0 | — | no supertype/implementation clause node type exists in the grammar |
| calls | no — RULED | 0 | — | no function-definition node type; 0 CSS-Functions-L4 `@function` declarations on the tree |
| exports | no — RULED | 0 | — | no export node type; 0 `composes: … from …` and 0 `:export` blocks on the tree |
| instantiates | no — RULED | 0 | — | no object-creation node type |

**The `imports` resolution rate is 0% and that is the honest shape, not a defect.** The
source of an import edge is the importing stylesheet's own file name and the target is a
module path; neither is a symbol in the file, so the store records the edge as
`source_external`. That is the same handling every other language's top-level cross-file
import gets, and inventing an endpoint for it is the `global` phantom this lane removed
once already. The rate is reported rather than improved.

**The previous version of this table is superseded and was wrong in two rows.** It
claimed `exports` is emitted ("every symbol with empty scope") — the analyzer does push
an `ExportInfo` array for unscoped symbols, but emits **no `exports` relationship**, and
`export` as a *relationship type* is RULED below. And it carried a "Production note"
saying the pool pipeline "deliberately narrows CSS relationships to `contains`-only as a
hyphenated-property noise guard". That is no longer what `filterNoiseRelationships` does
(`src/ast/pool-worker.ts`, the CSS branch is now `return true`), and the census above is
the evidence: `uses`, `references` and `imports` all reach `parseFile`'s return value.
The note was removed rather than reworded because it described behaviour the code no
longer has.

## M14 ontology verdicts

Scope: the ten types of the workstream ontology, decided for **CSS** (`.css`, plus the
`.sass` and `.less` that `language-detection.ts` still routes here; `.scss` is its own
lane with its own analyzer and branch). Every number below is measured through
`parseFile` or on the parse tree of the pinned `wasm/tree-sitter-css.wasm`; none is
asserted from a comment or from a spec file.

### Corpus and how it was sampled

| | |
| --- | --- |
| Corpus root | `$HOME/fixtures/repositories` (override: `BB_CORPUS_ROOT`) |
| Admission rule | git-tracked, a real directory, non-empty, ≤ 512 KB, `detectLanguageFromPath(abs) === "css"` — the rule `ontology-coverage-gate.ts` uses, **copied** rather than imported so the file set cannot drift with an edit to shared machinery |
| Sampling | **NONE — the census is the whole admitted set.** No stride, no sample. 1,114 files / 61 repositories |
| Growth this milestone | 681 → 1,114 files. Cloned `twbs/bootstrap`, `jgthms/bulma`, `primer/css`, `picocss/pico`, `kognise/water.css`, `picturepan2/spectre`, `sass/sass-spec`. `open-prose` and `less-js-doc` failed to clone and `mdn/content` was cloned then deleted: it carries 0 `.css` files (its stylesheets are inlined into markdown), so it was 260 MB of walk cost for no admitted file |
| Files the project states as its floor | 200+ per family; the census is 5.6× that |
| Files parsed | 1,114 of 1,114; 0 failed; 89 produced neither a symbol nor a relationship |
| Parse-robustness findings | 354 of 1,114 (31.8%) carry a tree-sitter ERROR somewhere; 1 file (`svelte/packages/svelte/tests/css/samples/preserve-specificity/expected.css`) reports `memory access out of bounds` and trips `parseFile`'s own 120 s `[BB-HANG]` guard |

The 31.8% is a **grammar** figure, not an analyzer figure: the pinned tree-sitter-css is
0.25.0 and range media queries, `@page`, `[attr i]`, `&&` nesting and HTML comments are
still outside it. Listed under "Unsupported" below, unchanged.

### The two instruments

Both run on the parse tree of the same wasm `parseFile` loads, so a string in a comment,
in a `url()`, in an `@media` prelude or inside a LESS/SCSS import cannot produce a hit.
`validation/m14/census/css-ontology-probe.ts` prints the **full grammar vocabulary** —
103 distinct node types over this corpus — so the instrument-A claims are checkable
rather than asserted.

* **A: grammar-inventory.** Walk every node of every admitted file and tally node types.
* **B: parse-tree-count.** Count a construct on the tree, where a raw-text regex cannot
  tell the directive `@extend` from the word "extend" in a comment.

### Per-type verdict

| Type | Verdict | Number | Where |
| --- | --- | --- | --- |
| `contains` | EMITTED | 168,206 edges, 553 files | e.g. `Exposed/docs/api/styles/main.css`, `bootstrap/dist/css/bootstrap.css`, `svelte/packages/svelte/tests/css/samples/*/expected.css` |
| `uses` | EMITTED | 2,609 edges, 323 files | `bootstrap/dist/css/bootstrap.css` (`.progress-bar-animated -> progress-bar-stripes`) |
| `references` | EMITTED | 161,192 edges, 369 files | `Exposed/docs/api/styles/main.css` (`:root -> --color-b08`) |
| `imports` | EMITTED | 171 edges, 46 files | `bulma/docs/assets/css/custom.css`, `bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/less/fontawesome.less` |
| `overrides` | EMITTED (was a GAP; implemented this milestone) | 4 edges, 2 files | `hasura-engine/frontend/libs/console/legacy-ce/src/lib/components/Services/ApiExplorer/GraphiQLWrapper/GraphiQL.css` (`rotation`, L1534 → L2214); `vue-element-admin/src/assets/custom-theme/index.css` (`v-modal-in`, `v-modal-out`, `progress`) |
| `extends` | RULED | instrument A: 0 of 103 node types is a type declaration or a supertype clause. instrument B: **0** `@extend` at-rules on the tree, in 1,114 files | Overturn: any `@extend` at-rule, or any `class_declaration`/`superclass`/`implements_clause`/`base_class_clause` node type in the printed vocabulary |
| `implements` | RULED | instrument A: 0 of 103 node types is `implements_clause`, `extends_clause`, `superclass`, `interface_implementation`, `base_class_clause`, `type_inheritance_clause`, `mixin_declaration_list` or `super_interfaces` | Overturn: any such node type in the printed vocabulary |
| `calls` | RULED | instrument A: 0 of 103 node types declares a function (`function_declaration`, `method_definition`, `function_definition`, `arrow_function`, `function_item`, `custom_function_statement`, …). instrument B: **0** `@function` at-rules — CSS Functions and Mixins L4's `@function --add(a,b) { … }` — on the tree | Overturn: any `@function` at-rule on the tree, or any function-declaration node type |
| `exports` | RULED | instrument A: 0 of 103 node types is `export_statement`, `export_declaration`, `export_list`, `exports_clause`, `export_specifier` or `export_block`. instrument B: **0** `composes: … from …` declarations and **0** `:export` rule_sets (0 `composes` declarations of any kind) | Overturn: any `:export` rule_set or `composes … from …` declaration on the tree |
| `instantiates` | RULED | instrument A: 0 of 103 node types is `new_expression`, `object_creation_expression`, `constructor_invocation`, `object_creation`, `instantiation_expression` or `new_declarator`. instrument B for completeness: **161,894** `var(--x)` calls across 372 files, every one of them a READ of a declaration rather than a construction, and every one already emitted as `references` | Overturn: any object-creation node type in the printed vocabulary |

Two of those rulings are worth their reasoning here, because both are the shape a lazy
ruling takes:

**`exports` is NOT ruled on the grammar inventory alone.** The gate's own header records
that its json lane *removed* an `exports` ruling for exactly that reason — "a grammar
cannot see a CONVENTION" — and CSS has export conventions with no export syntax: CSS
Modules' `composes: x from "./y.css"` cross-file surface and its `:export` named-export
block. Both are counted on the tree and both are 0, so the ruling does not rest on the
inventory. It is still a ruling about **this corpus**: a CSS-Modules-heavy repository
would produce a non-zero count and overturn it, and the lane would then owe an
`exports` implementation. That is stated rather than buried because the corpus here is
dominated by framework stylesheets and has one CSS-Modules file.

**`extends` is not silently a SCSS answer.** `@extend` is real and it is SCSS's, and
`.scss` routes to `real-scss-analyzer.ts` under `analyzer/SCSS`, not here. Measured
inside this lane's own admitted set the count is 0, so `extends` is RULED for the css
lane and the SCSS lane is a separate verdict on a separate corpus.

### The six questions, per emitted type

They fail independently, so they are reported per type and not as one verdict.

| | `contains` | `uses` | `references` | `imports` | `overrides` |
| --- | --- | --- | --- | --- | --- |
| 1 Exists | yes | yes | yes | yes | yes (added this milestone) |
| 2 Fires | 553 of 1,114 files | 323 | 369 | 46 | 2 |
| 3 Correct | differential: svelte 60 files, 67 of 67 tree-truth rows covered, 0 missing, 0 unexplained; grails-core 60 files, 490 of 490 covered, 0 missing, 0 unexplained | same run | same run | same run | **no oracle — see DERIVATION below** |
| 4 Labelled | sub-shapes separable by metadata flag: `isMediaScope` 22,677 + 2,485 synthesized, `isCustomPropertyScope` 136,898, `isSelectorChain` 4,781, `isNestedSelector` 394, `isLayerScope` 276 + 187, `isSupportsScope` 182 + 184, `isContainerScope` 142 | `isAnimationRef` 2,561 + `isFontFamilyRef` 48 — no edge carries a second flag, so a mislabelled `uses` would be visible as a third label | `isVariableRef` 161,191 + `isNamespaceRef` 1 | `isCssImport` 171; `isSassModuleImport` 0 | `isKeyframesRedefinition` 4 |
| 5 Resolved, both ends | 168,206/168,206 (100%) | 2,609/2,609 (100%) | 159,184/161,192 (98.8%) | 0/171 (0%) — the file-to-module shape, declared above | 4/4 (100%) |
| 6 Confident | `evidenceClass: structural`, `confidence` absent → treated as 1.0; **0** edges below 1.0 and **0** below 0.7 | `usage_contextual`, 0 below 0.7 | `import_based`, 0 below 0.7 | `import_based`, `confidence: 1.0` written explicitly, 0 below 0.7 | `structural`, `confidence: 1.0` written explicitly, 0 below 0.7 |

**Heuristic ratio for the whole lane: 0 of 332,182 relationships (0.0%) carry a
confidence below 0.7, and 0 carry a confidence below 1.0.** That is a real property and
also a limitation to read honestly: the lane writes `confidence` on only three of its
emission sites, so the other edges are *absent* rather than measured at 1.0, and "0 below
1.0" partly reflects that absence. §4 of the honesty contract asks for a machine-readable
reason code on anything under 1.0; this lane emits nothing under 1.0, so there is
nothing to carry a reason code for.

**The 2,008 unresolved `references` are the cross-file custom-property reads**, and that
is the claim they make: `var(--x)` in a stylesheet that does not declare `--x` is a real
dependency on another stylesheet, not a mistake. Sampled target names are Bootstrap's
`--bs-*` tokens read in a partial copy of the file. They resolve to 0% and are reported
at 98.8% rather than excluded from the denominator.

**The reference point this milestone was given — `references` resolving at both ends on
66.8% of its edges — does not reproduce on this corpus.** `validation/m14/results/
css-ontology-census-after.json` records 66.8% over 457 files from 13 corpora; the same
measurement over 1,114 files from 61 repositories is 98.8%. The resolution rule is the
same one (parallel-indexer's insert-time binding), and the difference is the file set:
the 457-file draw did not contain the custom-property-dense stylesheets that dominate
the grown corpus. Both numbers are quoted with their denominators rather than one being
preferred.

### Per-BRANCH firing, because a type at 100% can hide a branch at 0

Question 2 asked per type is satisfied by `uses` at 2,609 edges. Asked per branch it is
not, and this is the table that says so:

| branch | corpus occurrences |
| --- | --- |
| `uses` ← `isAnimationRef` | 2,561 |
| `uses` ← `isFontFamilyRef` | 48 |
| `uses` ← `isMixinRef` (`@include`) | **0** |
| `uses` ← `isComposition` (`composes:`) | **0** |
| `uses` ← `isCounterStyleRef` (`list-style: thumbs`) | **0** |
| `uses` ← `isFontFeatureValuesRef` | **0** |
| `references` ← `isCustomMediaRef` (`@media (--x)`) | **0** |
| `imports` ← `isSassModuleImport` (`@use`/`@forward`) | **0** |
| symbols ← `isSelector` | 168,752 |
| symbols ← `isComplex` | 68,112 |
| symbols ← `isCustomProperty` | 44,407 |
| symbols ← `isUtility` | 29,296 |
| symbols ← `isKeyframes` | 1,123 |
| symbols ← `isSupports` | 242 |
| symbols ← `isAtRule` | 134 |
| symbols ← `isCssModule` | **1** |

Eight relationship branches and one symbol branch have never executed on this corpus.
That is not a claim that they are broken — it is the same situation the lane already
records for `@counter-style`/`@custom-media`/`@font-feature-values`, and the standing
answer is a fixture rather than a deletion. It IS a claim that **no corpus number in
this document is evidence about those nine branches.** They are covered by
`validation/m14/fixtures/css/declarations-the-corpus-never-uses.css` and by the
`overrides` fixture added here, and by nothing else.

### DERIVATION findings

**One, and it was introduced by this milestone.**

A DERIVATION finding is a type the analyzer emits that the differential never audits.
`deriveCssEdges` (`script/m14/differential.ts:20559`) derives exactly four labels —
`contains`, `uses`, `references`, `imports` — from the parse tree, importing nothing
from the analyzer. Before this milestone the lane emitted four types and the oracle
derived four, so the DERIVATION count was 0, which is what
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` records for `css` at handover.

`overrides` is now emitted and derived by nothing: **4 edges on the corpus, 0 audited.**
The lane's own fixture and its five mutants are the only checks on it, and neither is an
oracle. Paying this down needs a second walker over the tree in
`script/m14/oracles/` — which is supervisor-owned machinery this lane does not edit — so
the request is written out in the handover rather than attempted here. The rule the
oracle must implement is already pinned by the fixture, so it is derivable without
re-deriving it: walk each `@keyframes_statement`, read its `at_keyword` and its
`keyframes_name`, and for each name emit a row when a declaration's at-keyword equals the
previous declaration's.

Note the consequence for the differential's own numbers: `bun run script/m14/differential.ts --lang css`
reports 0 unexplained edges both before and after this change, and it would have
reported 0 for a lane that emitted `overrides` on every file. That is the failure mode
the ontology gate exists for, stated here in the lane's own record rather than left for
someone to rediscover.

### Declared limitations

CSS is not Turing-complete, but a blank list would still be a false claim for this lane.

1. **`overrides` is a thin census.** 4 edges in 2 files of 1,114 (0.36% of files). The
   construct is spec-defined and the implementation is exercised by a fixture, but the
   corpus cannot say whether the rule is right about the shapes it has never seen — a
   prefixed pair nested inside a `@media` at-rule, for instance, is a case the
   discriminator has not been measured on.
2. **`overrides` has `source === target` by construction**, because the lane publishes one
   symbol per name and the two declarations share one. The payload is the line pair.
   `real-markdown-analyzer.ts:142` guards this shape (`source === target &&
   !distinctSites`) rather than forbidding it, and `distinctSites: true` is recorded in
   the metadata — but a consumer that treats a self-edge as noise will discard a real
   fact, and that is a cost of this shape rather than a defect in it.
3. **The line pair carries no information in a minified stylesheet.** All three
   `vue-element-admin` edges have `line_number === supersedesLine === 1`, because the file
   is one line. The edge is still true; the location is not usable.
4. **`imports` resolves at 0% at both ends** and always will, while the source of an
   import is a file name and its target is a module path.
5. **Nine branches have zero corpus occurrences** (table above) and are pinned only by
   fixtures.
6. **The grammar is the ceiling.** 354 of 1,114 files carry an ERROR, and one file
   (`preserve-specificity/expected.css`) reports `memory access out of bounds` from the
   wasm and trips `parseFile`'s 120 s guard. Anything inside a damaged region is not
   extracted, and no analyzer change can lift that.
7. **Resolution is measured per FILE.** A name that binds in one stylesheet does not bind
   across two, so every rate here is a within-file rate. A cross-file `references` claim
   (a `var(--x)` defined in another stylesheet) is deliberately not made.
8. **`.sass` and `.less` are routed here and have no corpus.** 0 files of each across 61
   repositories, so this document can neither support nor refute a claim about either
   dialect. `.sass` in particular is indented syntax and a different grammar, not a
   dialect flag.
9. **`overrides` has no differential oracle**, so its correctness rests on one fixture
   plus five mutants and on a corpus census of 4 occurrences. That is the weakest
   evidence backing any emitted type in this lane, and it is the DERIVATION finding
   above.

### For the supervisor: the `CSS_RULED` table entry

`script/m14/ontology-coverage-gate.ts` exits 2 for `css` —

```
ontology coverage gate — no RULING TABLE for css.
Refusing to report: a gate with an empty table would call every un-emitted type
RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
```

`RULED_BY_LANG` (line 192) holds `bash` and `json` only, and it is supervisor-owned, so
the entry is specified here rather than written. Each entry, in the gate's own shape:

```ts
const CSS_RULED: Ruled[] = [
  { type: "calls",        instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["function_declaration","function_definition","method_definition","function_item","generator_function_declaration","arrow_function","function_expression","function_declarator","custom_function_statement"], describe: "a user-defined function definition" },
  { type: "exports",      instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["export_statement","export_declaration","export_list","exports_clause","export_specifier","export_block"], describe: "an export declaration node" },
  { type: "extends",      instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["class_declaration","class_specifier","interface_declaration","struct_declaration","inheritance_specifier","base_class_clause","superclass","base_list"], describe: "a type declaration another selector could inherit" },
  { type: "implements",   instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["implements_clause","extends_clause","superclass","interface_implementation","base_class_clause","type_inheritance_clause","mixin_declaration_list","super_interfaces"], describe: "a supertype/implementation clause" },
  { type: "instantiates", instrument: "A:grammar-inventory", nodeTypesThatWouldMeanIt: ["new_expression","object_creation_expression","constructor_invocation","object_creation","instantiation_expression","new_declarator"], describe: "a constructor call" },
]
// `overrides` needs NO entry: it is now EMITTED, so the gate takes the EMITTED branch.
const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, css: CSS_RULED }
```

Two of the five want instrument B rather than A, and the reason is that a grammar
inventory cannot see a construct the language reaches through a lenient path:
`calls` should carry a B probe for a `@function` at-rule and `exports` a B probe for a
`:export` rule_set and a `composes: … from …` declaration. Both count 0 on this corpus.
`validation/m14/census/css-ontology-probe.ts` contains both probe bodies, written against
the gate's own `countOnTree(root, fileLabel, hits)` signature, and prints the overturn
condition for every probe.

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
- `progid:` IE filter values — **no longer a residual.** This was the largest
  remaining class (37 of the 62 corpus `.css` files that still failed, 60% of the
  mass) and the doc previously carried a long explanation of why it was NOT fixed,
  including that the obvious patch was provably inert. It is now fixed, by widening
  the ARITY of `parenthesized_value` from one value to a separated list, because an
  IE filter argument is a `name = value` pair. Measured A/B over 533 files in 13
  repositories:

  ```
  61 error files -> 24      37 fixed      0 REGRESSED
  Q2 collateral: 0 files that parsed clean before now error
  Q3 shape:      node types 151 -> 152, added ['parenthesized_value_repeat1']
                 (this rule's own generated wrapper), 0 removed, 0 field changes
  grails-core:   20.94% -> 1.57%
  ```

  The first attempt is why the second one is written down: adding `=` to the
  separator choice of `arguments` was built, A/B'd, and **provably inert** (61 → 61,
  0 fixed). The value never parses as a `call_expression`, so `arguments` is never
  reached and the token's character set was never the problem — the rule's arity
  was. `parenthesized_value_repeat1` is classified `internal_silent` in the spec as
  a generated repetition wrapper.

- `@custom-media`, `@counter-style` and `@font-feature-values` — **not a residual
  either, and the corpus is why that was not known.** The census reported all three
  as NO OCCURRENCE, which was recorded as "not a defect". A probe then found all
  three DECLARED a named, referable thing and published **nothing**: no symbol, so
  `list-style: thumbs` had no endpoint, `@media (--narrow)` named itself by raw
  text, and `font-feature-settings` had nothing to point at. That is the
  `@font-face`/`@property` defect class a second time, and it survived precisely
  because the corpus is silent — NO OCCURRENCE means the corpus cannot speak about
  a construct, not that the construct works. Three of three were broken.

  Two of the three also could not be PARSED at all (4 and 6 errors): the grammar
  contains no mention of `custom-media` (measured: 0 occurrences), because an
  at-rule prelude had to be a comma-separated query list. Grammar patch 4/4 allows a
  leading run of identifiers, aliased to `keyword_query` so **no visible node type
  is added** — the new rule is hidden, absent from `node-types.json` and from every
  parse tree; only the wasm symbol table grows 152 -> 153 ids while named types stay
  at 64. It also drops real SCSS errors (`@mixin`/`@include` preludes).

  This is the one patch whose corpus win is **zero**, and that is stated rather than
  left for a reader to find:

  ```
  0 files fixed      0 REGRESSED      0 collateral
  Q3 shape: 0 clean files changed shape, 0 field changes
  ```

  Its justification is the minimal reproduction; the A/B's job was to prove it does
  no harm. A patch judged only by a corpus win would never have been written,
  because there was none to write. What each at-rule now publishes:

  | at-rule | publishes | resolved by |
  | --- | --- | --- |
  | `@counter-style thumbs` | `variable` + `isCounterStyleDeclaration` | `list-style`/`list-style-type` -> `uses` |
  | `@custom-media --narrow (...)` | `variable` named `--narrow` + `isCustomMediaDeclaration` | `@media (--narrow)` -> `references` |
  | `@font-feature-values Body Text` | `variable` + `isFontFeatureValuesDeclaration` | `font-feature-settings` inside a `@font-face` -> `uses` |

  `@custom-media` publishes the bare `--ident` for the same reason `@property`
  publishes `--brand`: the name is the referable part and the condition is its
  value — so the two are the same shape, and each carries a metadata marker saying
  which construct declared it. A rule-level `.x { font-feature-settings: "nice" }`
  is legal CSS and deliberately emits NO edge: which family's feature it names
  depends on the cascade, so an edge there would invent an endpoint.

- `@page` rules, `@starting-style`, `[attr i]`/`[attr s]`, escaped unicode
  identifiers, HTML-style comments, `chrome://` `@import` URLs, empty custom-property
  values, range media/container queries, `& &` / `&&` / `&div`, and a NAMED
  `@container` (`@container card (min-width: 400px)` — only the anonymous form
  parses) all remain. Together they are the whole of the 25 corpus files that still
  error, and every one is re-tested against the pinned wasm rather than carried
  forward.

## `.scss` is no longer routed here — it has its own lane

**This section used to be a declaration that the declaration was missing from.**

It said, in effect: all 254 real `.scss` files in the corpus route to this analyzer,
the CSS grammar does not support SCSS, 42 of 244 non-empty files parse clean (17.2%),
and "this is declared, not a defect in the CSS contract". The last sentence was the
error. It was declared **in this document only** — `CSS-L1` in
`script/m14/spec/css-completeness.json` was the record, and nothing else read it. An
82.8% parse-failure rate on 254 real files was therefore invisible to every gate while
being fully described in prose three screens away.

It also gave the wrong reason for leaving it: *"removing the routing would take away
real capability: the plain-CSS rules inside an SCSS file parse correctly."* That is
backwards. Keeping the routing was what cost the capability — 43 of 244 files parsed
at all, and the ones that did were parsed by a grammar that silently produced nothing
for every SCSS construct in them.

**What happened instead (2026-09-27).** `.scss` became its own language with its own
grammar, analyzer, pin, fixtures and mutants:

```
.scss routed here          254 files, 43 parsing clean (17.6%)
.scss under the scss lane  244 files, 149 parsing clean (61.1%)
ERROR nodes                30,767 -> 3,900
grammar patches            2, both strictly additive (76 fixed, 0 regressed)
```

`src/ast/language-detection.ts` maps `scss: "scss"`, `engine.ts` dispatches it to
`RealScssAnalyzer`, and the fixture lane claims `.scss` separately. See
`docs/analyzers/real-scss-analyzer.md`.

`.sass` and `.less` **still** route here and are **still declared** — 0 files of each
across 13 corpora, so this repo can neither support nor refute a claim about them, and
inventing coverage for a dialect with no corpus would be a claim with nothing behind
it. `.sass` in particular is indented syntax and is a genuinely different grammar, not
a dialect flag.

The general lesson, recorded because it is the second time in this lane: **a
limitation that lives only in a document is not a limitation, it is a paragraph.**
`CSS-L1` was in the spec and still nothing read it. What made it real the second time
was that the spec entry was replaced by a measurement another gate could fail on.

## Regex inventory

From `validation/m12/results/regex-census.json`: the CSS analyzer has **3**
regex usages (15 in the previous analyzer eliminated — census 119 → 104;
4 more were in a dead `if (false && ...)` SCSS block removed entirely).

**This section previously said 0, and that was wrong.** The complexity work added
five regexes — `queryComplexity` testing `/\s/` once per *character* of every
query, plus a `/var\(\s*--/` test — taking the lane from 0 to 9 while the census
sat unchanged in the tree, because nothing re-ran it. All five are now gone, so
the true count is 3, which is also the count before that work. The per-character
`/\s/` was a performance bug as well as a census regression: a regex test per
character is far slower than a set lookup, in a method that runs once per scope
symbol.

| # | Operation | Source | Adjudication |
| --- | --- | --- | --- |
| 1 | `split` | `/[\\/]/` | path separator on the file path — a 2-character alphabet, not content matching |
| 2 | `replace` | `/:\d+$/` | strips a trailing `:<digits>` in `leafOf` (a svelte-emitted `:123` suffix) |
| 3 | `split` | `/\s+/` | whitespace run in a symbol name |

All three are normalization on identifiers and paths. The census still labels them
`needs_review` because the classifier only auto-labels some shapes; the
adjudication above is the record, and none of them inspects a *value* — which is
the distinction that matters, since a regex over a declaration's value is where a
CSS analyzer would start inventing structure that is not there.

The whitespace replacement lists the full set JS `\s` matches (including \v, NBSP,
the U+2000 block, the line/paragraph separators and the BOM) rather than the ASCII
five, so it is not a narrowing: a predicate that quietly stops matching a code
point is a behaviour change wearing a cleanup's commit message. Verified directly
— the scan and the regex agree on all 14 `var(` shapes tested, including
`var( --x)`, `var(\t--x)` and `var(\n --x)`.
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
20,213 of 20,213 symbols carry a value (0 absent)
55.4% at complexity 1, 15 distinct values, max 52
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

55.4% at 1 is **correct, not a residual vacuity** — most CSS selectors are simple.
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
  through to the `|| 1` fallback and **24% of the lane (6,486 symbols, measured
  before the identity merge) carried a
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

## Verification

### The differential found four defects in its own oracle, from another lane's corpus

This lane read **67/67 and 490/490 covered with 0 unexplained on its two corpora**, and it read that way
at every step of the SCSS work below — while four defects in `deriveCssEdges` were live
and undiscovered. They were found because registering the `scss` lane pointed the same
oracle at element-plus, which is 170 of the 254 `.scss` files in 13 corpora and vendors
VitePress documentation styles:

1. a comma group was resolved as a **unit** — `.doc-content h1, h2` names only its first
   member correctly;
2. there was no **cross product** — `h1..h6 { .el-tag, .vp-tag {} }` is twelve selectors,
   and the intermediate fix asserted five the author never wrote;
3. the product **repeated members** — four parents times two children is eight entries of
   which four are duplicates;
4. **`&` did not expand per parent member** — `&:first-child` under a six-member parent is
   six selectors, and substituting the comma-JOINED parent suffixed only the last one.

Plus: a name still containing `&` after resolution is **not a name** (224 rules in 160
files, whose referent is a mixin call site outside the file), and the **unquoted `url()`
import branch never fired** — the payload is a grandchild, so four of the six imports in
one corpus file were silently absent from the truth. That file sits outside the rotating
60-file sample, which is why the row read 100% while the truth was quietly short.

None of this changed the ruling that a comma group is **one** symbol and **one**
endpoint. It sharpened it: one endpoint per RULE, with each member RESOLVED inside that
one name. Those are two different operations, and conflating them produced the original
error and all four of these.

A second opinion is only worth having if it is had. Nothing about this lane's own
evidence was wrong — it covered two corpora and nothing beyond them, and every defect lived
in the parts of CSS that two corpora happen not to contain.

### The gates

**18 mutants, 18 caught, 0 survived**, measured by running each transform against the
shared fixture runner — `bun run validation/m14/census/css-mutant-run.ts`, which
refuses to score anything against a red baseline. Baseline: 11 fixtures pass, 0 fail.

| set | file | mutants | caught | wired into `script/m14/mutate-analyzer.ts`? |
| --- | --- | --- | --- | --- |
| pre-existing | `script/m60/css-mutants.ts` | 13 | 13 | **no — nothing imported it** |
| this milestone | `script/m14/css-mutants.ts` | 5 | 5 | **no — needs a 2-line import** |

The first row is the finding. This section previously read "the mutants are 13 faithful
reverts … and **all 13 are caught**", and that claim described a file no gate executed:
`script/m14/mutate-analyzer.ts` wires only `FSHARP_MUTANTS` from its own sibling, so the
13 had never been run. They are run now, and all 13 do fail the suite — but the claim was
unearned when it was written and is now earned. `script/m14/fsharp-mutants.ts`'s own
header records the same hazard from the other side: a 259-line block written directly
into the shared registry was overwritten within the hour, silently, and the file stayed
syntactically valid so the gate kept reporting numbers with the lane's mutants absent
from them.

The 5 new mutants cover the new type's two failure directions, which are opposite and a
fixture that pins only one does not constrain:

* `css/overrides-dropped` — the type vanishes (the pre-fix state).
* `css/overrides-on-a-vendor-prefixed-pair` — **fabrication**: the `@keyframes` keyword
  discriminator is dropped, so `@-webkit-keyframes slide` / `@keyframes slide` is read
  as a redefinition. Measured cost if it shipped: 142 of the 146 same-name second
  declarations in the corpus are that shape, i.e. the whole type would be invented.
  Both of its endpoints are REAL symbols, which is the point — a fabricated edge between
  real nodes is the class no resolution check can catch.
* `css/overrides-line-pair-collapsed` — the payload class: `supersedesLine` dropped, so
  the edge says `fade overrides fade` and no reader can tell which block died. It also
  stops being storable-distinct, since a relationship's store key is
  (source, type, target, line) — M59 #822.
* `css/overrides-relabelled-as-extends` — the LABEL class, and the confusion this
  language is most likely to fall into: CSS's own preprocessor has an `extends`-shaped
  construct, so a lane reasoning from the family rather than from the measurement picks
  the wrong word. `extends` asserts inheritance between two different names; `overrides`
  asserts a later declaration replaces an earlier one of the same name.
* `css/animation-use-relabelled-as-a-call` — a regression guard on an existing emitted
  type: `animation: fade` → `uses`, relabelled to `calls`, which would name a callable
  CSS does not have.

Two of the pre-existing 13 did not survive their first run, and both gaps were in the
pins rather than in the mutants:

- `symbol-identity-collapsed` was unpinned because no fixture repeated a selector, so
  the lane's largest defect (36.6% of corpus files publishing an ambiguous symbol,
  27,321 duplicates removed across the wave) had no test at all.
  `repeated-selectors-are-one-symbol` now writes `.btn` and `.card` twice each and
  pins ONE symbol apiece.
- `parse-errors-swallowed` was unpinned because every fixture asserted
  `expectErrorCount: 0`, which an empty array also satisfies — so the suite could not
  distinguish a clean parse from a swallowed failure.
  `error-recovery-is-reported` pins `atLeast: 1` on a named `@page :first`, and
  deliberately not an exact count: a pin that fails when the grammar improves is a
  pin that gets deleted.

A fixture only proves what its author thought to write down. The mutants ask the
opposite question — what can the suite NOT fail on — and that is how the largest
defect in the lane turned out to be untested.

### Ten more, found by registering the lane that DELEGATES to this one

The mutants above all ask about CSS. The sharpest question about a delegating lane is
whether the delegate's rules were actually applied to it, and until 2026-09-28 nothing was
asking that: `scss` was absent from the M59 line oracle, whose name-reading rules were
selected with `lang === "css"`. So the SCSS lane's scope edges — emitted by *this*
analyzer, through delegation — were never checked by the CSS name rules, and when they
were, ten of them failed.

The defect was here, not there. The five scope edges (`@media`, `@supports`, `@layer`,
`@container`, `@scope`) claimed the `selectors` node's line unconditionally, on the
comment's own reasoning that the edge "is named by the rule's SELECTOR". That is true
only when the name is written on that line, and for a **nested** rule it is not: the
target is the *resolved* name, which composes to parent + own, so

```scss
table tbody:first-of-type tr {
  &:nth-child(odd) { … }   /* this line */
  th { … }                /* the edge named table … tr:nth-child(odd) th */
}
```

The fix was already in this file, one edge below: the nested-selector edge compared the
written text with the composed name and dropped the line when they differed, with a
comment explaining that testing for `&` is not enough because an implicit descendant
(`.a { .b { … } }`, no `&` at all) composes too. The scope edges were the same case with
that test missing, and both families now read one hoisted answer.

Ten edges moved from with-line to no-line, which is the correct outcome and not a
regression: a name the line does not write is never checkable rather than silently
unaccused. The differential is unmoved (0/0 on both corpora) because it compares
relationships, not line provenance.

Worth stating as a measurement: this class is rare in pure CSS, which is why the CSS
corpus read `86/86` and this survived. The SCSS corpus, which nests throughout, exposed
all ten at once. **A corpus chosen because it parses cleanly measures the grammar's
comfort, not the lane's health** — the same sentence the SCSS doc reaches from the other
direction, which is a fair measure of how much these two lanes have been teaching each
other.

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

- Ontology census (production `parseFile`, whole corpus, per-type resolution):
  `validation/m14/census/css-parsefile-census.ts` → `--json <path>`
- Ontology instruments A and B (grammar inventory + parse-tree counts):
  `validation/m14/census/css-ontology-probe.ts` → `--json <path>`
- `overrides` same-keyword / cross-keyword split (the measurement that separated the 4
  from the 142): `validation/m14/census/css-overrides-split.ts` → `--json <path>`
- Mutation run for both css mutant sets:
  `bun run validation/m14/census/css-mutant-run.ts --json <path>`
- Fixtures: `validation/m14/fixtures/css/` — 11 fixtures, including
  `keyframes-redefinition-overrides` for the new type
- Ground truth: `validation/m12/ground-truth/css.json`
- Differential: `validation/m12/results/css-differential.json`;
  `bun run script/m14/differential.ts --lang css`
- Complexity: `validation/m12/results/css-complexity.json`
- Corpus scan: `script/m12/css-corpus-errors.ts`
- Grammar compare: `script/m12/css-wasm-compare.ts`
- Regex census: `validation/m12/results/regex-census.json` (3 for this analyzer)
- Docs: this file

## Issue

Closes M12.15 (GitHub issue #154).
