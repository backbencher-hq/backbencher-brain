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
`src/ast/pool-worker.ts`) over the whole admitted corpus — **1,180 `.css`/`.less`/`.sass`
files (1,123 + 54 + 3) across 76 repositories**, `validation/m14/census/css-parsefile-census.ts`.
"Both ends resolve" is the rate at which an endpoint binds to a symbol the same file
published, counting the bare name, the `scope.name` spelling and `qualifiedName` — the
three spellings the store binds — so the number is what a consumer gets rather than what
the analyzer wrote.

| Relationship type | Emitted? | Edges / files | Both ends resolve | How resolved |
| --- | --- | --- | --- | --- |
| contains | yes | 170,432 / 582 | 170,405 / 170,432 (99.98%) | custom-property declaration scope (`:root contains --primary`); at-rule scope (`@layer base contains body`); `@media`/`@supports`/`@container`/`@scope` scope; nested-selector scope; selector-chain edges, emitted only where both chain leaves are published symbols. Sub-shapes by flag: `isCustomPropertyScope` 137,315, `isMediaScope` 26,800, `isSelectorChain` 4,882, `isLayerScope` 505, `isNestedSelector` 420, `isSupportsScope` 368, `isContainerScope` 142 |
| uses | yes | 2,613 / 325 | 2,613 / 2,613 (100.0%) | `animation`/`animation-name` naming a `@keyframes` this file declares (`isAnimationRef` 2,565); `font-family` naming an `@font-face` family this file declares (`isFontFamilyRef` 48) |
| references | yes | 161,738 / 383 | 159,648 / 161,738 (98.7%) | `var(--x)` reading a custom property (`isVariableRef` 161,737); a selector using a declared `@namespace` prefix (`isNamespaceRef` 1) |
| imports | yes | 179 / 49 | 0 / 179 (0.0%) | `@import url("x.css")` / `@import "x.css"`, unwrapped by the pure-String `unwrapUrl` (`isCssImport` 179); the `@use`/`@forward` module form (`isSassModuleImport` **0**) |
| overrides | yes | 48 / 7 | 48 / 48 (100.0%) | `isKeyframesRedefinition` 4; `isCustomPropertyRedefinition` 44. Both audited by a second walker since this round — see "DERIVATION findings" |
| extends | no — RULED | 0 | — | instrument A: 0 of 103 node types is a type declaration. instrument B: **0** `@extend` at-rules on the tree |
| implements | no — RULED | 0 | — | instrument A: 0 of 103 node types is a supertype/implementation clause |
| calls | no — RULED | 0 | — | instrument A: 0 function-definition node types. instrument B: **0** CSS-Functions-L1 `@function` declarations on the tree |
| exports | no — RULED | 0 | — | instrument A: 0 export node types. instrument B: **0** `composes: … from …` and **0** `:export` blocks on the tree |
| instantiates | no — RULED | 0 | — | instrument A: 0 object-creation node types. instrument B for completeness: **162,440** `var(--x)` calls in 386 files, every one a READ already emitted as `references` |

**The `imports` resolution rate is 0%, and PASS 2 CORRECTED THE REASON THIS FILE GAVE FOR
IT.** The previous text said 0% "is the same handling every other language's top-level
cross-file import gets". That was a claim about other lanes, asserted rather than
measured, and it is false for the lanes that were checked:

| lane | what the `imports` edge names as its SOURCE | is that a published symbol? |
| --- | --- | --- |
| css | the file's basename (`real-css-analyzer.ts:312`, `importerName`) | **no** — 0 of 177, measured over the whole admitted corpus |
| json | `symbol.metadata.fullPath \|\| symbol.name` (`real-json-analyzer.ts:384`) | yes |
| yaml | the node path (`real-yaml-analyzer.ts:1123`) | yes |
| xml | the owning element's name (`real-xml-analyzer.ts:1787`) | yes |

So css's 0% is not a property of the language, it is a property of this analyzer: three
sibling lanes source the same relationship from a node they publish, and css has no
node to source it from because a stylesheet publishes selector symbols and no file
symbol. The rate is reported rather than improved, and the reason it is not improved is
a scope decision rather than a claim that 0% is right — publishing a file symbol per
stylesheet would change the lane's symbol count and every graph that reads it, which is
a wider change than an ontology lane should make on its own. Written out under
"Reported, not edited" below so it can be applied without re-deriving it.

The `global` phantom this lane removed once is not coming back: the source is the
importing stylesheet's own name, which is a real file, not a magic string.

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

## PASS 3 — every ontology number re-measured, the analyzer's last 11 regexes deleted, and the DERIVATION debt paid

This section is the current state. The pass-1 and pass-2 sections below it are kept as
history, and where they disagree with this table **this table is the one to read** — the
corpus grew from 1,114 to 1,180 files between those passes and every relationship count
moved for that reason alone, which is stated wherever a number moved.

| | pass 2 said | pass 3 measured | why it moved |
| --- | --- | --- | --- |
| corpus | 1,131 files / 65 repos | **1,180 files / 76 repos** (`.css` 1,123, `.less` 54, `.sass` 3) | other lanes cloned into the shared corpus. This lane cloned nothing: `df -h /` showed 24 GB free against a corpus already at **7.9 GB**, and the brief's budget is ~8 GB, so a clone would have breached it |
| files parsed | 1,131 / 1,131 | **1,180 / 1,180**, 0 failures, **0 degraded** (`fallback: true`) | — |
| grammar vocabulary | 103 node types | **103 node types** | the corpus grew by 49 files and produced no new node type, which is the cleanest available confirmation that instrument A's evidence of absence is a property of the grammar and not of the draw |
| symbols | 218,116 | **222,786** (188.8/file) | corpus growth |
| `contains` | 168,327 / 561 files | **170,432 / 582 files** | corpus growth |
| `uses` | 2,611 / 324 | **2,613 / 325** | corpus growth |
| `references` | 161,217 / 371 | **161,738 / 383** | corpus growth |
| `references` both-ends | 159,204 (98.8%) | **159,648 (98.7%)** | corpus growth; 2,090 cross-file `var()` reads in the new files |
| `imports` | 177 / 47 | **179 / 49** | corpus growth |
| `overrides` | 48 / 7 | **48 / 7** | unchanged, and now AUDITED (below) |
| `contains` both-ends | 100% | **170,405 / 170,432 (99.98%)** | 27 edges name an endpoint that does not bind; pass 2 reported 100% and this is the first pass to measure it |
| all relationships | 332,380 | **335,010** (283.9/file) | corpus growth |
| empty symbol names | 0 | **0** of 222,786 | — |
| empty / unknown `SymbolKind` | 0 | **0** of 222,786 | — |
| endpoints equal to `unknown` | 0 | **0** | — |
| edges below confidence 0.7 | 0 | **0** of 335,010 | — |
| edges missing `evidenceClass` | 0 | **0** | — |
| regex literals in the analyzer | 3 (then found to be 11) | **0** | this round; arbiter below |
| DERIVATION findings | 1 | **1 finding, 1 oracle written, 1 measurement** | paid |

**`contains` both-ends is 99.98%, not 100%, and pass 2's 100% was a measurement artefact.**
Pass 2 read parallel-indexer's insert-time binding rule; pass 3 reads the symbol set the
same file published, across all three spellings the store binds (`name`, `scope.name`,
`qualifiedName`). The 27 edges that do not bind are the selector-chain edges whose
source is a chain leaf rather than a rule, and the type is documented as
`emit only where both chain leaves are published symbols` — so 99.98% is the honest
number for what the type claims and 100% was the number for what the check could see.

### The 11 regexes, and what each became

`script/m12/verify-regex-census.ts` is the arbiter. At the start of this round it
reported **11 regex literals in `src/ast/real-css-analyzer.ts`**, in **8 call sites**, and
this document claimed 3. The document was wrong and the arbiter was right; the count had
grown after the census was last regenerated.

| # | Site | Regex | Became | Why that is not a narrowing |
| --- | --- | --- | --- | --- |
| 1 | `leadingCustomIdent` | `/^(--[A-Za-z0-9_-]+)/` | `leadingCustomIdent` prefix scan + `isCustomIdentChar` | the same character class, expressed as a comparison chain |
| 2 | `analyze`, importer name | `/[\\/]/` in `filePath.split(…)` | `lastPathSegment` — last `/`- or `\`-separated segment | the last element of the split, found by scanning for the last separator |
| 3 | `leafOf` | `/:\d+$/` in `n.replace(…)` | `stripOccurrenceSuffix` | digits-to-end preceded by `:`; `a:1b`, `123` and `a:` are all returned untouched, as the pattern returned them |
| 4 | identity merge | `/specificity\|omplexity/` | `k.includes("specificity") \|\| k.includes("omplexity")` | a substring test, which is what the alternation was |
| 5 | `atRulePrelude` | `/^@\S+/` | **the tree**: `at_keyword` (or the anonymous `@keyword`) child's `endIndex` | see below — this one carried a real defect |
| 6 | `atRulePrelude` | `/;\s*$/` | **the tree**: the `;` child's `startIndex` | same |
| 7 | `collectNamespacePrefixes` | `/^@namespace\s*/` | **the tree**: the `@namespace` child's `endIndex` | same |
| 8 | `collectNamespacePrefixes` | `/;\s*$/` | **the tree**: the `;` child's `startIndex` | same |
| 9 | `@media` custom-media reference | `/^\(/` | **the tree**: `customMediaRefsIn` walks for `parenthesized_query > keyword_query` | this one WIDENED the construct; see below |
| 10 | `@media` custom-media reference | `/\)$/` | **the tree**: same | same |
| 11 | `@use`/`@forward` module name | `/\s+/` in `namePart.split(…)[0] ?? namePart` | `firstToken` | the `?? namePart` fallback was **dead code**: `String.split` never returns `undefined`, so the branch could not be taken. Deleted rather than translated |

**Sites 5–8 removed a latent defect, not just a pattern.** `atRulePrelude` found the end
of an at-rule's prelude with `node.text.indexOf(block.text)` — a substring search from
offset 0 of the NODE's text. A prelude that CONTAINS the block's own text therefore
truncated at the wrong offset and published a scope name cut mid-word. The grammar hands
over both boundaries as child nodes, so the search was never necessary. Pin:
`css/at-rule-prelude-boundary-by-text-search`.

**Site 9–10 widened a construct, and the corpus cannot see that it did.** The old
implementation took the media query's whole text, peeled one leading `(` and one trailing
`)`, and asked whether what was left began with `--`. That answers `@media (--narrow)` and
nothing else: in `@media screen and (--narrow)` nothing is peeled at the front, the
string starts with `s`, and the reference is LOST — while the grammar hands it over as a
`keyword_query` inside a `parenthesized_query`, unambiguously. The new
`customMediaRefsIn` reads that shape, so the composed, negated and comma forms are all
covered, and it refuses a media TYPE (`print`, `screen`) because `keyword_query` is the
grammar's node for those too. Measured: **0 occurrences of the construct in the admitted
corpus**, so no corpus number distinguishes the two versions and the fixture
`css/custom-media-in-every-query-shape` is the only evidence — two of its seven
`expectRelationships` rows (`@media screen and (--wide)`, `@media not (--c)`) fail
against the old code and two `forbidRelationships` rows fail against an implementation
that keys on the node type alone.

**The A/B that says the other eleven changed nothing.** The whole corpus was censused
twice, once with the analyzer at HEAD and once with the analyzer as edited, and every
number is byte-identical: 222,786 symbols, 335,010 relationships, and the same per-type
edge counts, file counts and resolution rates. So the regex removal is
behaviour-preserving on real code, and the single behaviour change in this round has no
corpus witness at all. Both facts belong in the report; neither is visible without the A/B.

### The DERIVATION finding: oracle written, wired by measurement, wiring still owed

`overrides` was EMITTED and derived by NOTHING. `deriveCssEdges`
(`script/m14/differential.ts`) pushes `contains`, `uses`, `references` and `imports`, and
the css comparison allowlist is those same four — so the type was stored and compared
against no truth, which is what a DERIVATION finding is. The count was 1 and the type was
`overrides`; it is still 1, and this round it is no longer unaudited:

`script/m14/oracles/css-overrides.ts` is a second walker over the parse tree that imports
nothing from `src/ast/real-css-analyzer.ts` and shares no helper with it.
`validation/m14/census/css-overrides-differential.ts` runs it against production
`parseFile` over the whole admitted corpus. Measured:

```
admitted files                                  1,180   parsed 1,180/1,180, 0 degraded
analyzer `overrides` edges EMITTED                   48   distinct under the store key (source,type,target,line): 48
oracle rows derived                                110
AGREE                                              48
MISSING (oracle derives, analyzer does not)        62   -> the minified one-line collapse, limitation 3
EXTRA   (analyzer publishes, oracle derives 0)      0   -> NO FABRICATION
```

**EXTRA = 0 is the number this lane could not previously produce, and it is the expensive
one.** `overrides`'s corpus population is 97.3% one shape — 142 of the 146 same-name
second `@keyframes` declarations are a vendor-prefixed pair — and emitting for those would
assert a replacement CSS does not perform between two REAL symbols, which no resolution
check can catch. A second walker that derives the vendor-prefix rule and the block
boundary independently finds **zero** rows the analyzer invented, and **zero** rows it got
wrong in the other direction apart from the 62 that are a storage artefact.

**The 62 MISSING are limitation 3, now measured rather than asserted.** Pass 2 asserted
"62 of 106 same-block re-assignments are not emitted" from a shape count; the oracle
derives **110** rows (106 custom-property + 4 keyframes) and the analyzer publishes 48, so
**62 are unemitted** — the same number, from a different instrument. All 62 sit in
`bulma/css/versions/bulma-no-helpers{,-prefixed}.min.css`, whose second line is 181,071
characters, and `emitOverride`'s dedup key is `(name, line)`: every declaration in that
line shares one line, so N supersessions of one property collapse to one edge. The runner
**exits 1** on this, because the analyzer and the oracle genuinely disagree by 62 rows,
and a gate that returned 0 would be reporting a number the two sides do not share.

**The four wiring changes this needs are the supervisor's** (`ONTOLOGY-WORKSTREAM.md`
§Ownership) and are written out in full in the oracle's own header: one import beside the
other oracle imports, one loop in the `if (lang === "css")` branch, `"overrides"` added
to the allowlist at `differential.ts:23373`, and a **multiplicity-aware comparison** —
`source === target` by construction here, so `(label, from, target)` cannot tell one
redefinition from three and a set-based comparison degrades to "is the name right".

**Independence, and its limit.** The oracle and the analyzer are two walkers over the
SAME pinned `wasm/tree-sitter-css.wasm`, so a grammar bug shared by both is invisible to
this check. That is the harness's declared limitation and it is not upgraded by the
oracle agreeing on 48 of 48 emitted rows.

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
| Sampling | **NONE — the census is the whole admitted set.** No stride, no sample. **1,131 files / 65 repositories**, re-measured in pass 2 |
| Growth, milestone 1 | 681 → 1,114 files. Cloned `twbs/bootstrap`, `jgthms/bulma`, `primer/css`, `picocss/pico`, `kognise/water.css`, `picturepan2/spectre`, `sass/sass-spec`. `open-prose` and `less-js-doc` failed to clone and `mdn/content` was cloned then deleted: it carries 0 `.css` files (its stylesheets are inlined into markdown), so it was 260 MB of walk cost for no admitted file |
| Growth, pass 2 | 1,114 → **1,131 files, 61 → 65 repositories**, by OTHER lanes cloning into the shared corpus. Nothing was cloned by this lane in pass 2. Every count in this file was re-measured rather than carried forward, and the before/after table is under "Every number in this file, re-measured" below |
| Files the project states as its floor | 200+ per family; the census is 5.7× that |
| Files parsed | 1,131 of 1,131; 0 failed; 88 produced neither a symbol nor a relationship |
| Parse-robustness findings | **356 of 1,131 (31.5%)** carry a tree-sitter ERROR somewhere (`css-ontology-probe.ts`, re-measured in pass 2; it was 354 of 1,114 / 31.8% at handover). 1 file (`svelte/packages/svelte/tests/css/samples/preserve-specificity/expected.css`) reports `memory access out of bounds` from the wasm and trips `parseFile`'s own 120 s `[BB-HANG]` guard |

The 31.8% is a **grammar** figure, not an analyzer figure: the pinned tree-sitter-css is
0.25.0 and range media queries, `@page`, `[attr i]`, `&&` nesting and HTML comments are
still outside it. Listed under "Unsupported" below, unchanged.

### PASS 2 re-verified every RULED verdict, and all five still read 0

The instruction for pass 2 was to re-run the probes that produced the RULED verdicts and
check they still read 0 on the grown corpus, because a prose ruling that measurement
overturns is how R's and JULIA's and YAML's verdicts fell. `validation/m14/census/
css-ontology-probe.ts` was re-run over all **1,131 files / 65 repositories** (the
milestone-1 draw was 1,114 / 61) and the grammar inventory is **still exactly 103 distinct
node types** — the corpus grew by 17 files and produced no new node type, which is the
cleanest possible confirmation that instrument A's positive evidence of absence is a
property of the grammar and not of the draw.

| type | instrument | re-measured on 1,131 files | verdict |
| --- | --- | --- | --- |
| `calls` | A | 0 function-definition nodes; the grammar produces none | RULED holds |
| `calls` | B | **0** `@function` declarations (CSS Functions L4 `@function --add(a,b) { … }`) | RULED holds |
| `extends` | A | 0 type-declaration nodes | RULED holds |
| `extends` | B | **0** `@extend` directives, and **0** occurrences of the at-keyword itself — the directive is not even lexable by this grammar | RULED holds |
| `implements` | A | **0** supertype/implementation clause nodes | RULED holds |
| `exports` | A | 0 export nodes | RULED holds |
| `exports` | B | **0** `composes: x from "./y.css"`, **0** local `composes: y` of any kind, **0** `:export` blocks | RULED holds |
| `instantiates` | A | 0 object-creation nodes | RULED holds |
| `instantiates` | B | **161,919** `var(--x)` calls across 374 files (was 161,894 / 372 at handover) — every one a READ, already emitted as `references` | RULED holds |

Nothing was overturned and nothing was weakened. The one figure that moved —
`var(--x)` from 161,894 to 161,919 — moved because the corpus grew, and it moves in the
direction that makes `instantiates` MORE like a ruling and not less: 25 more
name-to-value reads, every one already accounted for as a `references` edge, and 0
constructions.

### The shared differential, re-run scoped to css, and its ONE remaining disagreement

`npx tsx script/m14/differential.ts --lang css`, at this commit:

```
[svelte]      css: files=60 tree-truth=41  covered=39  (95.1%) MISSING=2 | analyzer-edges=24  unexplained=0 (0%) heuristic=0
[grails-core] css: files=60 tree-truth=502 covered=502 (100%)  MISSING=0 | analyzer-edges=393 unexplained=0 (0%) heuristic=0
[css] 2 MISSING / undefined truth — samples:
  imports expected.css -> http://www.w3.org/1999/xhtml  (svelte/.../supports-namespace/expected.css)
  imports expected.css -> http://www.w3.org/2000/svg    (svelte/.../supports-namespace/expected.css)
probe run (--lang css): measured 2 lane(s) — M14.0.F5 NOT written (a scoped run is for inspecting lanes)
```

**`unexplained=0` on both corpora** is the fabrication column at zero against an
independent walker over the four labels the oracle derives, and `heuristic=0` is the
confidence question answered by the harness rather than by this document.

**`MISSING=2` is a real disagreement and this lane does not implement it.** The file is
`svelte/packages/svelte/tests/css/samples/supports-namespace/expected.css`:

```css
@namespace url(http://www.w3.org/1999/xhtml);
@namespace svg url(http://www.w3.org/2000/svg);
svg|a { color: green; }
```

The analyzer emits exactly one edge for it — `references svg|a -> @namespace svg
url(http://www.w3.org/2000/svg)`, the selector's use of the declared prefix — and no
`imports`. The oracle derives two `imports` rows, one per `@namespace` URI. **The reading
is that the analyzer is right and the oracle over-derives:** an `@namespace` URI is an XML
namespace NAME, a vocabulary identifier the user agent resolves against, while `@import
url(…)` names a stylesheet the user agent FETCHES. The two are different acts and one is
not a file dependency. That is an argument, and an argument is not a measurement, so it is
recorded as a §8 item against `deriveCssEdges` rather than settled here: the oracle is
supervisor-owned, and the honest state of this row is "two rows the oracle derives that the
analyzer declines, with a reason, pending the owner's decision". Emitting them would mean
asserting a fetch CSS does not perform.

### The two instruments

Both run on the parse tree of the same wasm `parseFile` loads, so a string in a comment,
in a `url()`, in an `@media` prelude or inside a LESS/SCSS import cannot produce a hit.
`validation/m14/census/css-ontology-probe.ts` prints the **full grammar vocabulary** —
103 distinct node types over this corpus — so the instrument-A claims are checkable
rather than asserted.

* **A: grammar-inventory.** Walk every node of every admitted file and tally node types.
  **103 distinct node types** over 1,131 files, printed in full by the probe, at handover
  and again in pass 2 — the corpus grew by 17 files and produced no new node type.
* **B: parse-tree-count.** Count a construct on the tree, where a raw-text regex cannot
  tell the directive `@extend` from the word "extend" in a comment.

### Per-type verdict

| Type | Verdict | Number | Where |
| --- | --- | --- | --- |
| `contains` | EMITTED | 168,327 edges, 561 files | e.g. `Exposed/docs/api/styles/main.css`, `bootstrap/dist/css/bootstrap.css`, `svelte/packages/svelte/tests/css/samples/*/expected.css` |
| `uses` | EMITTED | 2,611 edges, 324 files | `bootstrap/dist/css/bootstrap.css` (`.progress-bar-animated -> progress-bar-stripes`) |
| `references` | EMITTED | 161,217 edges, 371 files | `Exposed/docs/api/styles/main.css` (`:root -> --color-b08`) |
| `imports` | EMITTED | 177 edges, 47 files | `bulma/docs/assets/css/custom.css`, `bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/less/fontawesome.less` |
| `overrides` | EMITTED (was a GAP; implemented this milestone, and a second shape added in pass 2) | **48 edges, 7 files** | `hasura-engine/.../GraphiQL.css` (`rotation`, L1534 → L2214); `vue-element-admin/src/assets/custom-theme/index.css` (`v-modal-in`, `v-modal-out`, `progress`); `bulma/css/versions/bulma-no-helpers{,-prefixed}.min.css` and siblings (`--bulma-light-l` and 43 others — 106 same-block re-assignments on the tree, of which 44 are emittable; see limitation 10) |
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
| 1 Exists | yes | yes | yes | yes | yes — 2 sub-shapes: `@keyframes` redefinition, `@property` re-registration, and (pass 2) a `--custom-property` assigned twice in one block |
| 2 Fires | 561 of 1,131 files | 324 | 371 | 47 | 7 |
| 3 Correct | differential: svelte 60 files, 67 of 67 tree-truth rows covered, 0 missing; grails-core 60 files, **398 of 398** covered, 0 missing (the rotating 60-file sample moves, so the second corpus's tree-truth row count is 398 on this run and was 475 on milestone 1 — both are quoted with the run they came from) | same run | same run | same run | **no oracle — see DERIVATION below.** The differential now says so in its own output: `COMPARED WITH NO TRUTH: overrides (1 comparable, 0 truth)` |
| 4 Labelled | sub-shapes separable by metadata flag: `isMediaScope` 22,696 + 2,485 synthesized, `isCustomPropertyScope` 136,940, `isSelectorChain` 4,798, `isNestedSelector` 395, `isLayerScope` 318 + 187, `isSupportsScope` 182 + 184, `isContainerScope` 142 | `isAnimationRef` 2,563 + `isFontFamilyRef` 48 — no edge carries a second flag, so a mislabelled `uses` would be visible as a third label | `isVariableRef` 161,216 + `isNamespaceRef` 1 | `isCssImport` 177; `isSassModuleImport` 0 | `isKeyframesRedefinition` 4 + `isCustomPropertyRedefinition` 44 |
| 5 Resolved, both ends | 168,327/168,327 (100%) | 2,611/2,611 (100%) | 159,204/161,217 (98.8%) | 0/177 (0%) — and pass 2 showed this is a LANE property, not a language one (see the `imports` note above) | 48/48 (100%) |
| 6 Confident | `evidenceClass: structural`, `confidence` absent → treated as 1.0; **0** edges below 1.0 and **0** below 0.7 | `usage_contextual`, 0 below 0.7 | `import_based`, 0 below 0.7 | `import_based`, `confidence: 1.0` written explicitly, 0 below 0.7 | `structural`, `confidence: 1.0` written explicitly, 0 below 0.7 |

**Heuristic ratio for the whole lane: 0 of 332,380 relationships (0.0%) carry a
confidence below 0.7, and 0 carry a confidence below 1.0.** That is a real property and
also a limitation to read honestly: the lane writes `confidence` on only a few of its
emission sites, so the other edges are *absent* rather than measured at 1.0, and "0 below
1.0" partly reflects that absence. §4 of the honesty contract asks for a machine-readable
reason code on anything under 1.0; this lane emits nothing under 1.0, so there is
nothing to carry a reason code for.

#### PASS 2's adversarial answers to the same six questions

Question 1 is source derivation and cannot fail here. Questions 2–6 were re-asked with the
question inverted — "where is this wrong?" — and the per-question verdicts are:

| | verdict | the number that settles it |
| --- | --- | --- |
| 2 Fires | confirmed, with one caveat | 7 of 1,131 files emit `overrides`. 62 of the 106 same-block re-assignments on the tree collapse to 44 edges, because every declaration in a minified file shares one line and a relationship's store key is (source, type, target, line) — so two supersessions of the same property on the same line are the same row. Declared as limitation 10 |
| 3 Correct | **the oracle cannot see `overrides` at all** | `deriveCssEdges` pushes `contains`, `uses`, `references`, `imports` and nothing else, and the differential's css allowlist is exactly those four. The harness now prints `COMPARED WITH NO TRUTH: overrides (1 comparable, 0 truth)` and counts the svelte sample's one `overrides` edge as `unexplained`. The oracle's own limit is declared: it is a second walker over the SAME grammar, so a grammar bug shared by both paths is invisible to it |
| 4 Labelled | confirmed adversarially | The strongest available counter-argument was that `var(--fa-style-family, "Font Awesome 6 Free")` invents a family. It does not — the fallback IS the reference. 3 of the 4 such edges name the fallback; the 4th is a minified-file attribution artifact, verified by reading the file. For `overrides`, the labelling risk is the BLOCK boundary, and both directions are now pinned: 3 mutants, 3 caught |
| 5 Resolved | confirmed, and one claim CORRECTED | The 2,013 unresolved `references` edges: **0** name a property the same file writes, so "they are cross-file reads" survives adversarial testing. The `imports` 0% does NOT survive as a language property — json, yaml and xml all source `imports` from a symbol they publish, so css's 0% is this analyzer's shape and is reported as such |
| 6 Confident | confirmed | 0 of 332,380 below 0.7 and 0 below 1.0, per type. The caveat above stands: most sites write no `confidence` at all, so the ratio measures what is written, not what is known |

**The 2,008 unresolved `references` are the cross-file custom-property reads**, and that
is the claim they make: `var(--x)` in a stylesheet that does not declare `--x` is a real
dependency on another stylesheet, not a mistake. Sampled target names are Bootstrap's
`--bs-*` tokens read in a partial copy of the file. They resolve to 0% and are reported
at 98.8% rather than excluded from the denominator.

**The reference point this milestone was given — `references` resolving at both ends on
66.8% of its edges — does not reproduce on this corpus.** `validation/m14/results/
css-ontology-census-after.json` records 66.8% over 457 files from 13 corpora; the same
measurement over 1,131 files from 65 repositories is 98.8% (159,204 of 161,217), and
pass 2's adversarial reading of the 2,013 unresolved edges found **0** of them name a
property the same file writes — so "these are cross-file reads" survives the attack. The
resolution rule is the same one (parallel-indexer's insert-time binding), and the
difference is the file set:
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

### PASS 2 — the adversarial half: what pass 1 got wrong about itself

Pass 1 asked the six questions and every answer was affirmative with a number attached.
A lane that only ever asks "does it fire?" never finds out whether the edges it fires are
TRUE, so pass 2 assumed each label was WRONG and went looking for the case that proves
it. Three probes, each stating in its own header the result that would make it a finding:

| probe | what it attacks |
| --- | --- |
| `validation/m14/census/css-adversarial-probe.ts` | `references` resolution, `contains` scope containment, `uses` value shapes, `imports` endpoints, and the override shapes the rule does not reach |
| `validation/m14/census/css-adversarial-followup.ts` | the four `var()`-valued `font-family` edges and the `--x`-twice count, printed rather than aggregated |
| `validation/m14/census/css-boundary-probe.ts` | what survives `analyze()` → `parseFile`, and the containment check done in a way that can return non-zero |

#### Four findings. Two are defects this lane fixed; two are corrections to its own instruments.

**1. `overrides` was missing a shape the language HAS — 106 occurrences, now emitted.**
A `--custom-property` assigned twice inside ONE declaration block is the same construct
`@keyframes` already got: two declarations of one property in one block share origin,
context, layer, specificity and importance, so position is the only separator and CSS
Cascade 5 §6.1 resolves it — "The last declaration in document order wins." CSS Variables
1 §2 adds that custom properties are not special: "Custom properties are ordinary
properties, so they can be declared on any element, are resolved with the normal
inheritance and cascade rules." Measured on the parse tree of the whole admitted corpus:
**106 same-block re-assignments across 6 files**, every one of them Bulma's minified
bundles writing `--bulma-light-l: 90%` then `--bulma-light-l: 96%` inside one `:root`
block (read out of the file: both assignments are inside the same block, confirmed by
locating the enclosing `{`). `overrides` went **4 edges / 2 files → 48 edges / 7 files**.

The **block** is the boundary, and the boundary is the whole content of the claim, so two
shapes of the same size were measured and deliberately NOT emitted:

* **cross-block** — `:root { --x: 1px }` then `.dark { --x: 2px }` assigns `--x` twice in
  one file and is **not** an override: the two apply to different elements and the cascade
  chooses per element. Emitting there would claim a replacement CSS does not perform, and
  the lane's own identity merge is why it is unreadable: `--bg-1` under `:root` and again
  under `.dark` is ONE node, so a name-keyed edge could not be told apart from a
  same-block one.
* **differing importance** — `--x: 1px !important; --x: 2px` does not redefine, because
  Cascade 5 §6.1 sorts importance ABOVE document order and the later declaration LOSES.
  Measured: **106 of 106 corpus occurrences are equal-importance pairs, 0 are mixed** — so
  this guard costs nothing on this corpus and is recorded because a guard that costs
  nothing is indistinguishable from one that was never needed.

Pinned by `validation/m14/fixtures/css/custom-property-redefinition-overrides.css`, whose
three negative cases are the point: a fixture pinning only the positive direction would
not constrain where the boundary is. Three new mutants attack it — the block boundary
widened to the file (fabrication), the importance guard removed (fabrication), and an
adjacency requirement added (undershoot, which shrinks the type toward zero while every
adjacent case still passes).

**2. 7,257 of 25,181 `isMediaScope` containment edges pointed at a scope symbol that does
not contain the rule. Now 0.** `@media` publishes ONE symbol per name, at the FIRST
block, and the identity merge at the end of `analyze` never sees a second copy to fold —
so a file with `@media (min-width: 576px)` three times has one symbol for it recorded at
the first block, and every rule of the second and third blocks gets a `contains` edge
pointing there. The edge is TRUE (the rule is inside a block of that query) and its
endpoint is somewhere the rule is not. Worked example,
`bootstrap/dist/css/bootstrap-grid.css`: the edge for `.col-sm` carries L284 while the
symbol it names is recorded at L22–L26.

Measured before the fix (`css-boundary-probe.ts`, P2):

| flag | edges | contained rule outside the source symbol's line range |
| --- | --- | --- |
| `isMediaScope` | 25,181 | **7,257 (28.8%)** |
| `isLayerScope` | 505 | **40 (7.9%)** |
| `isSupportsScope` | 366 | 0 |
| `isContainerScope` | 142 | 0 |
| `isScopeScope` | 0 | — |

`@supports` and `@container` never had it because they publish a symbol per OCCURRENCE and
the merge folds them; `@media` and `@layer` deduplicate BEFORE publishing, so the merge
cannot reach them. The fix widens the one published symbol across its later blocks, which
is the same convention the merge already uses, applied where the merge cannot. **After the
fix: 0 of 25,181, 0 of 505, 0 of 366, 0 of 142.** `@layer base` in
`phoenix/installer/templates/phx_static/default.css` went from `L2442-L2474` to
`L39-L2474`, covering all four of its blocks.

Only `endLine` moves, so the byte span still describes the FIRST block while the line
extent describes all of them — a scope's range is therefore **not contiguous** when it has
several blocks. That is the lane's existing convention, and it is stated because a
consumer that assumes contiguity will be wrong for exactly the multi-block scopes this
describes.

**3. PASS 1's CONTAINMENT NUMBER WAS VACUOUS, and this lane's own probe is why that is
worth writing down.** Pass 1 reported no containment violation anywhere. The probe read a
scope symbol's extent as `symbol.range.start.line`; `parseFile` returns **no `range`
object at all** — it flattens the range to top-level `startLine` / `endLine` /
`startIndex` / `endIndex` — so every lookup missed, every edge took the
`if (!symbol) continue` branch, and 0 violations is exactly what a broken probe returns.
The non-zero figures above are from the corrected probe, and the correction is in
`css-boundary-probe.ts` rather than in this file's history, because a zero from a probe
that cannot return non-zero is not evidence of anything.

**4. PASS 2's OWN `uses` PROBE MANUFACTURED A FINDING, and that is recorded too.** The
first attempt decided "is this `uses` edge a fabrication?" by testing whether the edge's
TARGET string appeared in the declaration text. The target is the SYMBOL name
`@font-face Font Awesome 6 Free` while the declaration reads
`var(--fa-style-family, "Font Awesome 6 Free")`, so the substring test could never match
and 4 edges were reported as having "no literal fallback" when all four are a fallback.
Corrected test: **3 of 4 name the `var()` fallback family, and the 4th is a probe artifact
of its own** — line-range attribution is unsound inside a minified file, and
`bulma/docs/vendor/fontawesome-free-6.5.2-web/css/all.min.css` is 9 lines and 103 KB. The
edge `.fa-brands, .fab -> @font-face Font Awesome 6 Brands` was attributed to a
`var()`-valued declaration when it comes from a different declaration on the same line,
`.fa-brands,.fab{font-family:"Font Awesome 6 Brands"}` — read out of the file directly.
**No `uses` fabrication was found in this lane.** A probe that invents a finding costs a
reader a real defect hunt, which is a larger cost than having no probe.

#### What the adversarial pass found CLEAN, and that is a result

| attack | instrument | result |
| --- | --- | --- |
| "every unresolved `references` edge is a cross-file read" — the claim this file made | `css-adversarial-probe.ts` P1 | **CLEAN.** 2,013 unresolved `var()` edges; **0** of them name a property the same file WRITES (read off the tree, not off the symbol list — testing against published names would be vacuous, since an exact name binds by construction). Also **0** files write a custom property the analyzer does not publish, and **0** edges resolve without being an exact published name |
| "`font-family: var(--x)` invents a family" | `css-adversarial-followup.ts` Q1, corrected | **CLEAN.** 837 `var()`-valued `font-family` values in the corpus, 4 edges, all four naming a family the declaration genuinely references |
| the scope-containment attack | `css-boundary-probe.ts` P2 | **2 defects found and fixed** (above) |
| `overrides` shape coverage | `css-boundary-probe.ts` Q3 | **1 defect found and fixed** (above) |

#### Every number in this file, re-measured

The corpus grew between the two passes (1,114 → 1,131 files, 61 → 65 repositories, by
other lanes cloning into the shared corpus), so every count was re-run rather than
carried forward. Numbers moved; none of them moved because of the two fixes, which is
stated because "the number changed" and "the number changed because I changed the code"
are different claims.

| type | this file said (milestone 1) | re-measured, pass 2, BEFORE the fixes | after the fixes |
| --- | --- | --- | --- |
| files / repos | 1,114 / 61 | 1,131 / 65 | 1,131 / 65 |
| `contains` | 168,206 / 553 | 168,327 / 561 | 168,327 / 561 |
| `uses` | 2,609 / 323 | 2,611 / 324 | 2,611 / 324 |
| `references` | 161,192 / 369 | 161,217 / 371 | 161,217 / 371 |
| `references` both-ends | 159,184 (98.8%) | 159,204 (98.8%) | 159,204 (98.8%) |
| `imports` | 171 / 46 | 177 / 47 | 177 / 47 |
| `overrides` | 4 / 2 | 4 / 2 | **48 / 7** |
| symbols | — | 218,116 | 218,116 |
| all relationships | — | 332,336 | 332,380 (+44, exactly the new `overrides`) |

### DERIVATION findings

**One. The number is 1, the type is `overrides`, and pass 2 raised it from 4 unaudited
edges to 48.**

A DERIVATION finding is a type the analyzer emits that the differential never audits.
`deriveCssEdges` (`script/m14/differential.ts:20559`) pushes exactly four labels —
`contains`, `uses`, `references`, `imports` — walking the parse tree and importing
nothing from the analyzer. The differential's per-language comparison allowlist is
exactly those same four (`script/m14/differential.ts:23373`,
`...(lang === "css" ? ["uses", "contains", "references", "imports"] : [])`). Before this
milestone the lane emitted four types and the oracle derived four, so the count was 0,
which is what `docs/analyzers/ONTOLOGY-WORKSTREAM.md` records for `css` at handover.

`overrides` is emitted and derived by nothing: **48 edges on the corpus, 0 audited.**
Pass 2 turned this from a latent claim into a loud one, because the harness now names it
in its own output rather than leaving it to be counted by hand:

```
[svelte] css: COMPARED WITH NO TRUTH: overrides (1 comparable, 0 truth)
[svelte] css: files=60 tree-truth=67 covered=67 (100%) MISSING=0
              | analyzer-edges=34 unexplained=1 (2.9%) | unexplained-by-label: overrides=1
[grails-core] css: files=60 tree-truth=398 covered=398 (100%) MISSING=0
              | analyzer-edges=360 unexplained=0 (0%)
1 lane(s) COMPARED A LABEL WITH NO TRUTH — the published coverage for those labels is not coverage
```

The 1 `unexplained` edge is the DERIVATION finding made visible, not a fabrication: it is
an `overrides` edge in the svelte sample, and "unexplained" here means exactly what the
harness says it means — a label in the comparison set with no oracle behind it. A lane
that emitted `overrides` on every file would have printed the same `covered=67 (100%)
MISSING=0` and the same single line, which is the failure mode the ontology gate exists
for.

The lane's two fixtures and its eight mutants are the only checks on the type, and
neither a fixture nor a mutant is an oracle. **The strongest thing this lane can say
about `overrides` correctness is that a spec sentence and a fixture agree** — Cascade 5
§6.1 for the `@keyframes` and custom-property halves, Properties & Values API §2.1 for
`@property` ("the last such one in document order is the registration") — and that is
weaker evidence than a second walker, and it is not upgraded by being quoted twice.

The oracle this needs is written out under "Reported, not edited" below so it can be
implemented without re-deriving it.

### Declared limitations

CSS is not Turing-complete, but a blank list would still be a false claim for this lane.

1. **`overrides` is a thin census.** 48 edges in 7 files of 1,131 (0.62% of files), and
   44 of the 48 come from ONE construct in SIX files — Bulma's minified bundles. The
   construct is spec-defined and the implementation is exercised by two fixtures and eight
   mutants, but the corpus cannot say whether the rule is right about shapes it has never
   seen: a prefixed `@keyframes` pair nested inside a `@media` at-rule, or a
   same-block redefinition inside a `@supports` or `@layer` body, are cases no corpus file
   exercises.
2. **`overrides` has `source === target` by construction**, because the lane publishes one
   symbol per name and the two declarations share one. The payload is the line pair.
   `real-markdown-analyzer.ts:142` guards this shape (`source === target &&
   !distinctSites`) rather than forbidding it, and `distinctSites: true` is recorded in
   the metadata — but a consumer that treats a self-edge as noise will discard a real
   fact, and that is a cost of this shape rather than a defect in it.
3. **The line pair carries no information in a minified stylesheet, and this now costs
   measured edges.** All three `vue-element-admin` edges have
   `line_number === supersedesLine === 1`, because the file is one line. Pass 2's shape
   makes it worse than a cosmetic problem: the corpus has **106** same-block
   `--custom-property` re-assignments and the analyzer emits **44** edges for them.
   **62 of 106 (58.5%) are not emitted**, because every declaration in a minified file
   shares one line and `emitOverride`'s dedup key is (name, line) — and it has to be,
   since a relationship's store key is (source, type, target, line) (M59 #822), so two
   supersessions of one property on one line are the same row and `INSERT OR IGNORE`
   would keep one of them. Emitting both would produce two indistinguishable edges and
   one stored row, which is a worse artefact than one edge. The edge that IS emitted is
   true; it just cannot say which of the same-line assignments it replaces.
4. **`imports` resolves at 0% at both ends**, and pass 2 established that this is a
   property of THIS ANALYZER and not of the language: json, yaml and xml all source an
   `imports` edge from a symbol they publish, while css sources it from the file's
   basename, which css publishes no symbol for. 0 of 177, measured. The fix is a scope
   decision (see "Reported, not edited") and not a claim that 0% is right.
5. **Nine branches have zero corpus occurrences** (table above) and are pinned only by
   fixtures.
6. **The grammar is the ceiling.** 354 of 1,114 files carry an ERROR, and one file
   (`preserve-specificity/expected.css`) reports `memory access out of bounds` from the
   wasm and trips `parseFile`'s 120 s guard. Anything inside a damaged region is not
   extracted, and no analyzer change can lift that.
7. **Resolution is measured per FILE.** A name that binds in one stylesheet does not bind
   across two, so every rate here is a within-file rate. A cross-file `references` claim
   (a `var(--x)` defined in another stylesheet) is deliberately not made.
8. **`.sass` and `.less` are routed here and the corpus for both is thin.** Pass 2
   measured 0 files of each and this document said so; pass 3 measures **54 `.less` and 3
   `.sass`** after other lanes cloned. Three `.sass` files cannot support a claim about
   indented syntax, and the pinned `wasm/tree-sitter-css.wasm` is not the `.sass` grammar
   in any case. Every ruling in this file is measured over all 57 dialect files, so the
   `extends` and `calls` probes are not vacuous — they are simply unexercised.
9. **`overrides` has no differential oracle**, so its correctness rests on two fixtures,
   eight mutants, a spec sentence and a corpus census of 48 occurrences. That is the
   weakest evidence backing any emitted type in this lane, and it is the DERIVATION
   finding above. Pass 2 raised the edge count 12× without raising the evidence CLASS,
   which is worth saying plainly: more occurrences of an unaudited type is not more
   confidence in it.
10. **62 of 106 same-block re-assignments are unemittable** — limitation 3, counted
    separately because it is a storage limit rather than an analyzer limit, and because
    "48 edges" would otherwise read as the size of the construct when the size is 106.
11. **A scope symbol's range is not contiguous.** `@media` / `@layer` / `@container` /
    `@scope` widen one symbol across all its blocks, so `startLine` is the first block
    and `endLine` the last, with everything between them not in the block. Only `endLine`
    moves, which keeps the byte span (`startIndex`/`endIndex`) describing the FIRST block.
    A consumer assuming contiguity will be wrong for exactly the multi-block scopes this
    describes; 2,811 scope symbols over 422 files are in that state.
12. **The `@media` / `@layer` scope extent and its block count are dropped at the
    production boundary.** `pool-worker.ts` forwards a narrow allowlist of CSS `metadata`
    keys; `isMediaScope`, `mediaCondition`, `scopeBlocks`, `hasLayerBlock`,
    `isLayerOrdering` and `layerIndex` are not on it, so **2,804 of 3,084 at-rule scope
    symbols arrive from `parseFile` with NO metadata at all**, across 422 files. The NAME
    is therefore the only identity a consumer has for a scope, which is why limitation 11
    is the only available repair and why `scopeBlocks` is visible to a fixture and not to
    a store consumer. See "Reported, not edited".
13. **The largest override-shaped corpus figure is deliberately NOT emitted.** 506 files
    write some selector text more than once — 5,681 selector-text groups covering 16,735
    rule sets — and 3,376 declarations repeat inside a single block. None of it is
    `overrides`, and the reason is worth stating because "we found 5,681 more and left
    them" is otherwise indistinguishable from an oversight. Two declarations of one
    selector in one file are not a redeclaration: they apply to the same elements and the
    cascade resolves them PER PROPERTY, so a rule that redeclares `color` overrides the
    earlier one for `color` while both survive for every other property. `overrides`
    asserts a replacement; that is a merge. The cross-block `--x` case is refused for the
    same reason and is pinned. A per-property `overrides` would need a property symbol as
    its endpoint, and a CSS property name is a token in a declaration rather than a graph
    node — so that edge cannot be drawn without inventing the endpoint, which is the
    fabrication rule.
14. **`isCustomMediaRef` has 0 corpus occurrences, so the branch this round widened is
    pinned only by a fixture.** The corpus holds 0 `@custom-media` declarations and 0
    `@media (--x)` uses, so no corpus number distinguishes the tree walk from the text
    peel it replaced, and the A/B over 1,180 files is byte-identical for that reason. The
    fixture `css/custom-media-in-every-query-shape` is the whole of the evidence, plus two
    mutants from opposite directions. "0 in the corpus" is what a broken probe and a
    working branch both report, and this row is where that fact has to be read.
15. **The comma-list form of a custom-media query resolves only its FIRST query.**
    `@media (--a), (--b)` publishes ONE scope, named after the first query, so the `--b`
    dependency is dropped rather than attributed to a scope whose name does not mention it.
    Pinned in the fixture's `knownLimitation`. Widening the scope naming to cover a query
    list is a separate change with its own measurement, and attributing `--b` to a scope
    named `@media (--a)` would be the misleading alternative.
16. **`contains` resolves at both ends on 99.98%, not 100%, and pass 2's 100% was a
    measurement artefact.** 27 of 170,432 edges name an endpoint that does not bind to a
    symbol the file published. The selector-chain edges are documented as `emitted only
    where both chain leaves are published symbols`, so 99.98% is the honest number for what
    the type claims; pass 2 reported 100% because its check could only see the edges that
    bind. A resolution rate measured with an instrument that cannot return a lower number
    is a vacuous 1.0, and 99.98% is the first number for this lane that is not.
17. **`confidence` is ABSENT, not 1.0, on 197,468 of 335,010 edges** — all 2,613 `uses`,
    all 161,738 `references`, and 33,117 of 170,432 `contains`. The lane writes
    `confidence: 1.0` explicitly on 137,315 `contains`, 179 `imports` and 48 `overrides`
    edges, so "0 edges below 1.0" partly measures an ABSENCE rather than a measurement.
    Pass 2 said this and it is still true at pass 3's corpus: the reason code
    (`metadata.evidenceClass`) is present on 335,010 of 335,010 edges, which is what the
    honesty contract §4.1 asks for, but the numeric field is missing where a consumer
    expecting to threshold on it will read a default.
18. **Pass 1's containment figure was vacuous and its corrected replacement is in this
    file rather than in a changelog.** A probe that cannot return non-zero reports the
    same 0 as a correct one. The 28.8% it missed is now fixed, and the reason the first
    version could not see it is written into the probe's own header, because the failure
    mode is re-introducing the wrong field name rather than forgetting to re-run
    anything.

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

### Reported, not edited — three items that need a file this lane does not own

Each is written to be applied without re-deriving it: file, function, what it must do,
why, and the measurement that says it is needed. All three are §8 items under
`docs/analyzers/ONTOLOGY-WORKSTREAM.md`.

**(a) `script/m14/ontology-coverage-gate.ts` — `RULED_BY_LANG` has no `css` entry, so the
arbiter still exits 2 and reports nothing for this lane. TWO LINES, NOW PROVEN INSTEAD OF
SPECIFIED.** `script/m14/css-ruled.ts` is the table, in the gate's own `Ruled` shape, with
five entries (one per un-emitted type) and each `describe` carrying its measured number and
its overturn condition. `validation/m14/fixtures/css/ruled-gate.ts` copies the gate to
`/tmp`, applies EXACTLY these two lines, and runs the copy:

```ts
import { CSS_RULED } from "./css-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, lua: LUA_RULED, toml: TOML_RULED, fsharp: FSHARP_RULED, css: CSS_RULED }
```

Measured result of that proof run, over the whole admitted corpus:

```
ontology coverage gate — css
corpus: 1180 admitted files

type          status            detail
calls         RULED-SOUND       NOT EMITTED; the grammar produced 103 distinct node types across the corpus and NONE expresses it. Written ruling: script/m14/css-ruled.ts (RULED_BY_LANG.css)
uses          EMITTED           2,613 edges in 4+ files, e.g. Paket/.../font-awesome.min.css, bootstrap/dist/css/bootstrap.css
contains      EMITTED           170,432 edges in 4+ files, e.g. Exposed/docs/api/ui-kit/ui-kit.min.css, Exposed/docs/api/styles/prism.css
imports       EMITTED           179 edges in 4+ files, e.g. FSharp.Formatting/docs/content/fsdocs-default.css, Saturn/docs/static/css/landing_style.css
references    EMITTED           161,738 edges in 4+ files, e.g. Exposed/docs/api/ui-kit/ui-kit.min.css, Exposed/docs/api/styles/prism.css
exports       RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree. Written ruling: script/m14/css-ruled.ts (RULED_BY_LANG.css)
extends       RULED-SOUND       NOT EMITTED; the construct occurs 0x on the parse tree. Written ruling: script/m14/css-ruled.ts (RULED_BY_LANG.css)
implements    RULED-SOUND       NOT EMITTED; the grammar produced 103 distinct node types across the corpus and NONE expresses it. Written ruling: script/m14/css-ruled.ts (RULED_BY_LANG.css)
overrides     EMITTED           48 edges in 4+ files, e.g. bulma/css/versions/bulma-no-helpers-prefixed.min.css, bulma/css/versions/bulma-no-helpers.min.css
instantiates  RULED-SOUND       NOT EMITTED; the grammar produced 103 distinct node types across the corpus and NONE expresses it. Written ruling: script/m14/css-ruled.ts (RULED_BY_LANG.css)

emitted 5/10   ruled-sound 5   FALSIFIED 0   ruled-without-justification 0
gate exit code: 0
```

Two things to note if the wiring is applied. First, the `RULED_BY_LANG` literal in the
current gate also carries `lua`, `toml` and `fsharp`, so the second line must be the whole
literal replaced, not an append. Second, the runner needs **no third patch** — unlike
toml's, which must redirect `specPath` because toml's own spec writes its rulings in
`ruling` while the gate reads `resolution`. `rulingFor()` checks the TABLE first, so a
`CSS_RULED` entry is returned before the spec is opened; two fewer patches is a fact about
the gate's control flow and not a simplification.

**The corpus-figure divergence this item used to raise is resolved and the direction is
now known.** The gate's own admission printed `corpus: 1180 admitted files`; this lane's
copied admission rule measured 1,180 in `css-parsefile-census.ts` and 1,171 in
`css-ontology-probe.ts`. The 9-file difference is `css-ontology-probe.ts` skipping
zero-byte files (`if (statSync(abs).size === 0) continue`, probe line 86) and nothing
else — the gate and the census agree exactly. The probe's exclusion is deliberate and its
header states the admission rule as "non-empty"; the honest fix is to make the two headers
say the same thing rather than to change either.

**(b) `src/ast/pool-worker.ts:960-1011` — the CSS `metadata` allowlist drops every key a
scope symbol carries, so 2,804 at-rule scope symbols reach the store indistinguishable.**
The allowlist is deliberate and its own comment says so ("Deliberately NARROW, and
deliberately CSS-only … the keys below are the ones the CSS lane's F6/F8/CC1 checks
read"), and `isAtRule` / `atKeyword` / `isSupports` / `supportsCondition` are on it. What
is missing, measured by `css-boundary-probe.ts` over the whole admitted corpus, is:

| key | occurrences dropped | what it carries |
| --- | --- | --- |
| `isMediaScope` | 2,804 | this symbol is a media scope |
| `mediaCondition` | 2,804 | the condition text, which the NAME also carries |
| `scopeBlocks` | 2,811 | how many blocks the scope spans (new in pass 2) |
| `isPropertyRegistration` | 26 | a `@property --x` is a registration, not a declaration |
| `isLayerOrdering`, `layerIndex` | 11 each | `@layer` order statements and their index |
| `hasLayerBlock` | 7 | the symbol is a layer BLOCK, not the ordering statement |
| `cssSpecific` | 169,349 | the payload is css-specific (every symbol) |
| `hasPseudoClass`, `hasPseudoElement` | 169,349 each | the selector's shape |
| `occurrences` | 37,629 | how many sites one name was written at |
| `firstLine` | 37,629 | the first site, when `startLine` is the merge's |
| `scopes` | 31,749 | every scope a merged name was written under |

What it must do: add the keys a consumer reads. The minimum that changes behaviour is
`isMediaScope` + `scopeBlocks` (so a `@media` scope is identifiable as one and a
multi-block scope is countable), and `occurrences` + `scopes` (so a merged identity's
provenance survives — `--bg-1` written under both `:root` and `.dark` currently reaches
the store as one node with no record of either scope). Why: at the moment the NAME is the
only identity a scope symbol has, and a name cannot say how many blocks it spans. What
this lane did NOT do is widen the allowlist itself — the comment's reason for keeping it
narrow (widening `annotations` for every symbol in every language is a separate, larger
change needing its own measurement round) is a good one, and the fix belongs next to
that decision rather than in it.

**(c) `script/m14/oracles/css-overrides.ts` — WRITTEN, MEASURED, AND STILL UNWIRED.**
The oracle exists and has been run against production `parseFile` over the whole admitted
corpus; what is owed is the four changes that let `script/m14/differential.ts` use it. They
are reproduced here so they can be applied without reading the oracle:

1. `script/m14/differential.ts`, beside the other oracle imports (line ~44):
   `import { deriveCssOverridesTruth } from "./oracles/css-overrides"`
2. `script/m14/differential.ts:22172`, the `if (lang === "css")` branch: after the
   `deriveCssEdges` loop, a second loop over
   `deriveCssOverridesTruth(root, cssModule)` pushing the same `{ label, from, target }`
   shape. **The allowlist must be changed at the same time (item 3)**, because it filters
   the ANALYZER side and a label the oracle derives and the allowlist omits reads as a
   MISSING truth row — a trap that file's own comments record happening twice.
3. `script/m14/differential.ts:23373`: add `"overrides"` to
   `...(lang === "css" ? ["uses", "contains", "references", "imports"] : [])`.
4. The comparison must be **multiplicity-aware for this label**. `source === target` by
   construction — the lane publishes one symbol per name — so `(label, from, target)`
   cannot tell one redefinition from three. The oracle returns one row per SUPERSESSION and
   carries `supersedesLine` on each, so a multiset comparison can check the payload. If the
   shared comparison is set-based, this label degrades to "is the name right" and nothing
   more, which should be recorded rather than discovered later.

The measured result is in "PASS 3" above: **48 agree, 62 MISSING, 0 EXTRA** over 1,180
files, with the 62 being the minified one-line collapse (limitation 3) and the 0 being the
number that matters.

**(d) `script/m14/firing-check.ts:340` — the per-type `files` column cannot report a
number above 1, so it is the one row of the supervisor's table this lane cannot quote.**
`filesByType` is rebuilt for each file and the per-file counts are then ASSIGNED rather
than accumulated:

```ts
for (const [type, set] of filesByType) res.types[type].files = set.size
```

`set` is a `Set` of file paths built inside one file's loop, so `set.size` is 1 whenever
the type fired at all. Measured at a 300-file sample: every fired type reads `files=1`,
including `references`, which is present in **383 of 1,180** files and **298 of 300** in
the sample. What it must do: accumulate — `row[type].files.add(...)` per file, or hoist
the map outside the loop and union. Why it matters beyond this lane: `firing-check.ts` is
the instrument that produces the per-lane firing table the supervisor reads, and a column
that can only ever print 0 or 1 makes a type present in 98% of files look like it is
present in one. This lane computed the column correctly in
`validation/m14/census/css-parsefile-census.ts` rather than quote the broken one, and it is
reported rather than edited.

**(e) `validation/m12/results/regex-census.json` — the committed census does not describe
HEAD for FIVE analyzers, and the css rows are now wrong in the other direction.** The
arbiter prints `missing from census: 18` and `stale in census: 25` at this commit. For css
specifically: 11 rows are `MISSING` (present in HEAD, absent from the census) because the
census was never regenerated after the complexity work and the pass-1/pass-2 additions.
This round deletes all 11 from the analyzer, so at this commit's successor HEAD the css
rows become `STALE` (in the census, absent from the source) until the census is
regenerated by its generator. What it must do: re-run the census generator. Why this lane
does not do it: the file is a machine-emitted artifact covering 5 analyzers across 4
lanes, the honesty contract §5.1 says agents edit code and fixtures and never results, and
hand-editing another lane's rows to make a gate green is exactly the failure the contract
exists to prevent. Note also that the 11 rows currently MISSING belong to no lane's
accounting in either direction — `css 11` in the brief, `3` in the old doc, `0` measured
now — which is the "3 in between belonged to no lane" failure the gate's own header
records having been fixed by printing every row.

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

`.sass` and `.less` **still** route here. The corpus now holds **54 `.less` files and 3
`.sass` files** (pass 3: 1,180 admitted files = 1,123 `.css` + 54 `.less` + 3 `.sass`),
so the "0 files of each" this paragraph used to carry is superseded — but not by enough to
support a claim about either dialect. Three `.sass` files is a sample too small to
generalise from, and `.sass` is INDENTED syntax: a genuinely different grammar, not a
dialect flag, and the pinned `wasm/tree-sitter-css.wasm` is not its grammar. The 54
`.less` files do exercise this analyzer's LESS arms — they are the whole of the `imports`
population naming `_variables.less` and `_mixins.less` — and they are why `@extend` and
`@function`, which BOTH dialects can write, are measured over 57 real dialect files rather
than over none. All 57 are counted in every ruling and none uses either construct.

The general lesson, recorded because it is the second time in this lane: **a
limitation that lives only in a document is not a limitation, it is a paragraph.**
`CSS-L1` was in the spec and still nothing read it. What made it real the second time
was that the spec entry was replaced by a measurement another gate could fail on.

## Regex inventory

**0 regex literals, as of this round. The arbiter is `script/m12/verify-regex-census.ts`
and it is the instrument, not a grep.**

The count this section used to report — 3 — was wrong twice over. It was wrong when
written (the census had not been re-run after the complexity work, which took the lane to
9 and then back), and it was wrong at the start of this round: the arbiter reported
**11 literals in 8 call sites**. The per-literal accounting is the table in "PASS 3"
above, with what each became and why the replacement is not a narrowing.

The three this file used to adjudicate by hand:

| old | became |
| --- | --- |
| `split(/[\\\\/]/)` on a file path | `lastPathSegment` |
| `replace(/:\\d+$/)` in `leafOf` | `stripOccurrenceSuffix` |
| `split(/\\s+/)` for a symbol name | `firstToken` |

Three helpers this round WROTE and then DELETED, which is recorded because a helper
written and deleted and a helper never needed look identical in a diff:
`stripSigil`, `stripLeadingToken` and `stripTrailingSemicolon`. Each was written to
replace one anchored pattern and each became unnecessary the moment the call site was
moved onto the tree — `at_keyword`, `@namespace`, `;` and `block` are all child nodes
with `startIndex`/`endIndex`, so a position the parser already computed beat a substring
search for it. Only `stripOccurrenceSuffix` and `firstToken` survived, because their two
call sites genuinely have only a string.

Two properties of the replacements are worth stating because they are the ones a
cleanup usually loses:

- **The whitespace set is not narrowed.** `JS_WHITESPACE` lists every code point JS `\s`
  matches — ASCII six, `\v`, NBSP, the U+2000 block, the line and paragraph separators and
  the BOM — not the ASCII five. A replacement that quietly stops matching a code point is
  a behaviour change wearing a cleanup's commit message. There is now ONE such set in the
  file: the class's `JS_SPACE` was a second copy and now aliases the module-level one.
- **No replacement inspects a value.** Not one of the eleven was a pattern over a
  declaration's value, and that is the distinction that matters — a regex over a value is
  where a CSS analyzer starts inventing structure that is not there. The five that were
  removed from at-rule boundaries all became node reads for the same reason.

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

**PASS 3: 26 mutants, 26 caught, 0 survived.** Baseline 14 fixtures pass, 0 fail, measured
by `bun run validation/m14/census/css-mutant-run.ts`, which refuses to score anything
against a red baseline. 13 mutants are the pre-existing `script/m60/css-mutants.ts` set
and 13 are `script/m14/css-mutants.ts`. Four are new this round:

| mutant | direction | caught by |
| --- | --- | --- |
| `css/custom-media-ref-narrows-to-a-bare-query` | UNDERSHOOT — reinstates the peel-one-paren-each-side reach, so `@media screen and (--x)` loses its edge | `css/custom-media-in-every-query-shape` |
| `css/custom-media-ref-accepts-a-media-type` | FABRICATION — drops the `--` prefix test, so `@media print` names a device category as a declaration | the same fixture, via its two `forbidRelationships` rows |
| `css/import-source-taken-from-the-wrong-segment` | ENDPOINT — the `imports` source split on `.` instead of `/`, so the basename loses its extension | `css/scope-conditions-and-custom-properties`, whose two `imports` rows now pin `from` |
| `css/at-rule-prelude-boundary-by-text-search` | the replacement's own failure mode — re-cuts an at-rule scope name at its query's first `(` | three fixtures that pin at-rule scope NAMES |

**One of those four found a gap in the pins rather than in the code, and that is the
direction worth recording.** `css/import-source-taken-from-the-wrong-segment` SURVIVED its
first run: no css fixture constrained an `imports` edge's SOURCE, only its target, so a
mutant that corrupted the one field `lastPathSegment` produces passed the whole suite. The
pin was added because the mutant was written — the fixture did not fail first and teach us
— which is mutation-first rather than test-first, and the reverse of the direction this
repo's M13 retrospective was about. The mutant's first formulation (split on `/`, take
index 0) was also not reachable from the edge at all, because the source has already been
reduced to a basename and there is no separator left in it to get wrong; that is stated in
the mutant's own description rather than left for the next reader to work out.

**PASS 2: 18 mutants, 18 caught, 0 survived**, measured by running each transform against the
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
- PASS 2 adversarial probes: `validation/m14/census/css-adversarial-probe.ts` (P1–P5),
  `css-adversarial-followup.ts` (the printed cases), `css-boundary-probe.ts` (what
  survives the production boundary, and the containment check in a form that CAN return
  non-zero) — each → `--json <path>`
- `overrides` ORACLE and its measured differential (the DERIVATION finding, paid):
  `script/m14/oracles/css-overrides.ts` (a second walker, importing nothing from the
  analyzer) and `validation/m14/census/css-overrides-differential.ts` → `--json <path>`.
  Measured: 48 agree, 62 MISSING, **0 EXTRA** over 1,180 files.
- Ruling table, and the PROOF that it runs (applies the two shared-file lines to a copy
  of the gate in /tmp and runs it): `script/m14/css-ruled.ts` and
  `validation/m14/fixtures/css/ruled-gate.ts`. Gate result: `emitted 5/10 ruled-sound 5
  FALSIFIED 0 ruled-without-justification 0`, exit 0.
- Fixtures: `validation/m14/fixtures/css/` — 14 fixtures, including
  `keyframes-redefinition-overrides` and `custom-property-redefinition-overrides` for the
  type `overrides` and its block boundary, and `custom-media-in-every-query-shape` for the
  one branch with 0 corpus occurrences
- Ground truth: `validation/m12/ground-truth/css.json`
- Differential: `validation/m12/results/css-differential.json`;
  `bun run script/m14/differential.ts --lang css`
- Complexity: `validation/m12/results/css-complexity.json`
- Corpus scan: `script/m12/css-corpus-errors.ts`
- Grammar compare: `script/m12/css-wasm-compare.ts`
- Regex census: `script/m12/verify-regex-census.ts` is the ARBITER; the committed
  `validation/m12/results/regex-census.json` is stale for five analyzers including this one
  (see "Reported, not edited" (e)). **This analyzer's own count, measured: 0.**
- Docs: this file

## Issue

Closes M12.15 (GitHub issue #154).
