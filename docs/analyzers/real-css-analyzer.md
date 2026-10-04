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
`src/ast/pool-worker.ts`) over the whole admitted corpus — **1,255 `.css`/`.less`/`.sass`
files across 79 repositories**, `validation/m14/census/css-parsefile-census.ts --all`.
1,255/1,255 parsed, **0 failures, 0 degraded**. These are PASS 5 figures; the corpus grew
from 1,180 files / 76 repositories at pass 4 and every count below moved with it, so each
figure names the corpus it was measured on rather than being quoted bare. "Both ends
resolve" is the rate at which an endpoint binds to a symbol the same file published,
counting the bare name, the `scope.name` spelling and `qualifiedName` — the three
spellings the store binds — so the number is what a consumer gets rather than what the
analyzer wrote.

| Relationship type | Emitted? | Edges / files | Both ends resolve | How resolved |
| --- | --- | --- | --- | --- |
| contains | yes | 175,171 / 589 | 175,144 / 175,171 (99.98%) | custom-property declaration scope (`:root contains --primary`); at-rule scope (`@layer base contains body`); `@media`/`@supports`/`@container`/`@scope` scope; nested-selector scope; selector-chain edges, emitted only where both chain leaves are published symbols. Sub-shapes by flag on this corpus: `isCustomPropertyScope` 137,867, `isMediaScope` 30,864, `isSelectorChain` 5,005, `isLayerScope` 505, `isNestedSelector` 420, `isSupportsScope` 368, `isContainerScope` 142 |
| uses | yes | 2,620 / 331 | 2,620 / 2,620 (100.0%) | `animation`/`animation-name` naming a `@keyframes` this file declares (`isAnimationRef` 2,572); `font-family` naming an `@font-face` family this file declares (`isFontFamilyRef` 48) |
| references | yes | 161,768 / 389 | 159,678 / 161,768 (98.7%) | `var(--x)` reading a custom property (`isVariableRef` 161,767); a selector using a declared `@namespace` prefix (`isNamespaceRef` 1) |
| imports | yes | 243 / 68 | 0 / 243 (0.0%) | `@import url("x.css")` / `@import "x.css"`, unwrapped by the pure-String `unwrapUrl` (`isCssImport` 243); the `@use`/`@forward` module form (`isSassModuleImport` **0**) |
| overrides | yes | 48 / 7 | 48 / 48 (100.0%) | `isKeyframesRedefinition` 4; `isCustomPropertyRedefinition` 44. Both audited by a second walker since this round — see "DERIVATION findings" |
| extends | no — RULED | 0 | — | instrument A: 0 of 103 node types is a type declaration. instrument B: **0** `@extend` at-rules on the tree |
| implements | no — RULED | 0 | — | instrument A: 0 of 103 node types is a supertype/implementation clause |
| calls | no — RULED | 0 | — | instrument A: 0 function-definition node types. instrument B: **0** CSS-Functions-L1 `@function` declarations on the tree |
| exports | no — RULED | 0 | — | instrument A: 0 export node types. instrument B: **0** `composes: … from …` and **0** `:export` blocks on the tree |
| instantiates | no — RULED | 0 | — | instrument A: 0 object-creation node types. instrument B as well, and this is the part that matters: **162,470** `var(--x)` calls in 392 files, every one a READ already emitted as `references` |

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
| endpoints equal to `unknown` | 0 | **0** of 670,020 ends (335,010 edges x 2), src 0 / tgt 0; empty-string endpoints src 0 / tgt 0 | the instrument did not measure this until this pass — see below |
| edges below confidence 0.7 | 0 | **0** of 335,010 | — |
| edges missing `evidenceClass` | 0 | **0** | — |
| regex literals in the analyzer | 3 (then found to be 11) | **0** | this round; arbiter below |
| DERIVATION findings | 1 | **1 finding, 1 oracle written, 1 measurement** | paid |

#### The `unknown`-endpoint row was a claim with no instrument behind it, and now has one

The row above read `0` in pass 2 and read `0` in pass 3, and in neither pass anything
measured it. `css-parsefile-census.ts`'s own header listed "endpoints equal to the literal
`unknown`" among what it measures, but the relationship loop read `src`/`tgt` and tested
only `published()` — the string `"unknown"` appeared exactly once in the file, in the
SymbolKind test (`if (k.length === 0 || k === "unknown") unknownKind++`, line 222), which is
a different quantity. So the header asserted a check the code did not perform, and the
document inherited the assertion. That is the same defect class this lane's instruments
exist to catch, in the lane's own instrument.

Implemented and measured over the whole admitted corpus: the loop now tallies per END, so
`source`-only and `target`-only publication stay separable, and it tallies the empty string
beside the sentinel because `String(rel?.source ?? …)` yields `""` for a missing field and
that is a distinct failure from a placeholder.

```
relationship ENDPOINTS equal to the literal "unknown": src 0, tgt 0 (0 ends)
empty-string endpoints: src 0, tgt 0
```

**The number did not move — it was never measured before, and now it is.** Every other row
of the table is unchanged by the edit (222,786 symbols, 335,010 relationships, per-type
counts identical), which is the expected result of adding a counter and is why the fix could
not be confused with a behaviour change.

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
oracle rows derived                                 68   (was 110 before PASS 4 fixed the oracle — see below)
AGREE                                              48
MISSING (oracle derives, analyzer does not)        20   of which STORE-COLLISION 20, REAL-GAP 0
EXTRA   (analyzer publishes, oracle derives 0)      0   -> NO FABRICATION
agreement                                      70.59%   verdict: no analyzer defect, exit 0
```

**EXTRA = 0 is the number this lane could not previously produce, and it is the expensive
one.** `overrides`'s corpus population is 97.3% one shape — 142 of the 146 same-name
second `@keyframes` declarations are a vendor-prefixed pair — and emitting for those would
assert a replacement CSS does not perform between two REAL symbols, which no resolution
check can catch. A second walker that derives the vendor-prefix rule and the block
boundary independently finds **zero** rows the analyzer invented, and **zero** rows it got
wrong in the other direction once the oracle's own block boundary was corrected — the 20
that remain are a storage artefact, and 42 of the 62 this check previously reported were
the oracle's error rather than the analyzer's.

**The MISSING rows are limitation 3, and PASS 4 CORRECTED HOW MANY.** Pass 2 asserted
"62 of 106 same-block re-assignments are not emitted" from a shape count; the oracle
derived **110** rows (106 custom-property + 4 keyframes) against the analyzer's 48, so 62
read as unemitted — the same number, from a different instrument, and reached for the same
wrong reason twice. Pass 4 classified each surplus row by the parse fact `line` vs
`supersedesLine` and split it: **42 were the ORACLE flattening nested declaration scopes**
(chains across disjoint selectors in `phoenix/.../default.css`, each pair derived once per
ancestor level — see PASS 4 §3) and **20 are the store collision** described next. After
the oracle fix the oracle derives **68** rows and the surplus is 20.

The 20 sit in `bulma/css/versions/bulma-no-helpers{,-prefixed}.min.css`, whose second line
is 181,071 characters, and `emitOverride`'s dedup key is `(name, line)`: every declaration
in that line shares one line, so N supersessions of one property collapse to one edge. The
runner now **exits 0**, because its exit keys on the DEFECT count (`realGap + EXTRA`) and
not on the raw surplus — exiting 1 on an unrepresentable collision trains the reader to
ignore the script, which is how a real 42-edge gap sat behind a benign 20 for a round.
The previous version of this paragraph ended by saying a gate returning 0 here would be
reporting a number the two sides do not share; that is no longer true, and the reason it
is no longer true is the 42 rows of oracle over-derivation, not a change in the analyzer.

**The wiring changes this needs are the supervisor's** (`ONTOLOGY-WORKSTREAM.md`
§Ownership) and are written out in full in §8 item (c) below: one import beside the
other oracle imports, one loop in the `if (lang === "css")` branch, and a
**line-aware comparison** — and NO allowlist change, because `overrides` is already in the
css allowlist via the base disjunct at `differential.ts:23153`. `source === target` by
construction here, so `(label, from, target)` cannot tell one
redefinition from three and a set-based comparison degrades to "is the name right".

**Independence, and its limit.** The oracle and the analyzer are two walkers over the
SAME pinned `wasm/tree-sitter-css.wasm`, so a grammar bug shared by both is invisible to
this check. That is the harness's declared limitation and it is not upgraded by the
oracle agreeing on 48 of 48 emitted rows.

## PASS 4 — the ruling table is REGISTERED, and the oracle that was disagreeing with the analyzer was mine

Three things moved, and only the first was asked for.

### 1. `CSS_RULED` is in the arbiter, so all ten types are adjudicated

`script/m14/css-ruled.ts` had existed for a round and had **never been run**.
`RULED_BY_LANG` in `script/m14/ontology-coverage-gate.ts` is a literal with no extension
point and that file is §8-owned, so the five RULED verdicts had no arbiter checking them —
which is the blind spot the gate's own header says it exists to close, reproduced inside
the lane whose table it was. `ROUND-BRIEF.md` item 3 asked for the registration. It is
two additive lines and nothing else in the shared file was touched:

```
import { CSS_RULED } from "./css-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { …, fsharp: FSHARP_RULED, css: CSS_RULED }
```

Before: `npx tsx script/m14/ontology-coverage-gate.ts css` exited **2** with
`no RULING TABLE for css` and reported nothing. After, on **1,180 admitted files**:

| type | status | number |
| --- | --- | --- |
| `contains` | EMITTED | 170,432 edges |
| `references` | EMITTED | 161,738 edges |
| `uses` | EMITTED | 2,613 edges |
| `imports` | EMITTED | 179 edges |
| `overrides` | EMITTED | 48 edges |
| `calls` | RULED-SOUND | the grammar produced **103** distinct node types and none expresses it |
| `implements` | RULED-SOUND | 0 of the 8 supertype-clause node types appear in that vocabulary |
| `instantiates` | RULED-SOUND | 0 object-creation node types |
| `exports` | RULED-SOUND | **0** `composes … from …` declarations and **0** `:export` rule_sets on the tree |
| `extends` | RULED-SOUND | **0** `@extend` at-rules on the tree |

```
emitted 5/10   ruled-sound 5   FALSIFIED 0   ruled-without-justification 0   exit 0
```

**5 + 5 = 10 of 10 APPLICABLE**, where before it was 5 adjudicated and 5 unadjudicated.
The `appl` column of a 26-lane sweep is a lower bound for exactly this reason: a type the
analyzer does not emit is unadjudicated, not inapplicable, and only a ruling with a
corpus measurement moves it.

`validation/m14/fixtures/css/ruled-gate.ts` had to change with it, and the change is the
interesting part. It applied the two lines as patches to a copy of the gate, and exited 2
when a patch did not apply — correct while the gate did *not* register css, because the
absence was the thing under test, and wrong the moment it *did*, because then the patch
is legitimately gone and the runner fails on a success. Each patch now carries an
`alreadyApplied` string and is satisfied by either shape, and the run header states which
shape the shared gate was in. When both are already present the runner measures the shared
gate's own text, which is the stronger of the two runs. The `differential` import also
moved out of patch 1 into the mechanical rewrite list: patch 1 had been rewriting it in
the same breath as adding the table, so the `alreadyApplied` branch skipped it and the
copy died with `ERR_MODULE_NOT_FOUND` on `/differential` having applied nothing. That was
caught by running it, not by reading it.

### 2. My census and the arbiter were measuring different corpora — 9 files apart

`css-ruled.ts` cited 1,171 admitted files; the gate printed 1,180. Not corpus growth: the
probe called `detectLanguageFromPath(abs)` with **one** argument where the gate calls
`detectLanguageFromPath(abs, text)` with **two**, and the text argument is load-bearing, so
the probe admitted a different *set*, not a smaller copy of the same one. It also dropped
zero-byte files, which the gate keeps.

Every number in the ruling table is a function of that file set, so a set that is not the
arbiter's makes those numbers uncheckable by the one instrument meant to check them. The
admission rule is now transcribed argument-for-argument and the two agree at **1,180 /
76 repositories**. Re-measuring changed no count — 103 node types, 0 `@extend`, 0
`composes … from …`, 0 `:export`, 162,440 `var()` across 386 files — so the rulings were
never wrong, but their denominator was not the denominator the arbiter uses.

### 3. The oracle was over-deriving, and the analyzer was right

`validation/m14/census/css-overrides-differential.ts` reported agreement **43.64%** with
**62** MISSING rows, which reads as "the analyzer drops 62 `overrides` edges". It drops
none. The surplus is now **classified** by the parse fact `line` vs `supersedesLine`,
because the unclassified number conflates two things that call for opposite conclusions,
and the classification found the difference.

The oracle's custom-property rule walked a declaration block with a `collect` that
recursed through nested `rule_set`s, flattening separate declaration scopes into one
`seen` map. On `phoenix/installer/templates/phx_static/default.css`, Tailwind writes
`--tw-outline-style: none` into the utility at line 227 and into `&.menu-focus` at line
262 — nested under a **different** parent selector. Disjoint scopes: 262 does not supersede
227. Flattening built the chain 227→262→273→298 across four unrelated selectors.

Two parse facts gave it away, and both are recorded in the oracle rather than left as a
conclusion: the chain crossed declarations in **different blocks**, and every nested block
is also visited on its own, so each pair was derived once per **ancestor level** — which is
why `--btn-border` 401→408 appeared **twice** in the surplus. A genuine supersession
cannot be counted twice by two parents of the same pair. The analyzer already scoped to one
block, and `css/overrides-custom-property-block-boundary-widened-to-the-file` pins that,
so the two were disagreeing about the language and the oracle was the one wrong.

After the fix, on **all 1,180** admitted files, 1,180/1,180 parsed, 0 failures, 0 degraded:

| rule | agree | missing | extra |
| --- | --- | --- | --- |
| `custom-property-redefinition` | 44 | 20 | 0 |
| `keyframes-redefinition` | 4 | 0 | 0 |
| **TOTAL** | **48** | **20** | **0** |

Oracle rows derived **68** (was 110). Missing **20**, of which **20 are STORE-COLLISION
and 0 are REAL-GAP**. Extra **0** — no fabrications. Agreement **70.59%**.

The 20 collisions are all in the 2-line `bulma-no-helpers-prefixed.min.css`, where three
blocks sit on line 2 and three supersessions of one name want the same
`(source, type, target, line)` key. Unrepresentable in the store, not unpublished. The
exit code now keys on the **defect count** (`realGap + EXTRA`) rather than the raw surplus,
because exiting 1 on an unrepresentable collision trains the reader to ignore this script's
failures — which is how a real 42-edge gap sat behind a benign 20 for a round.

### The gate set, re-run this round

| gate | result |
| --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts css` | **exit 0**, `FALSIFIED 0`, `ruled-without-justification 0` — see the hang note below; it exits 1 on some runs while printing the same table |
| `npx tsx validation/m14/fixtures/css/ruled-gate.ts` | **exit 0**, same table, `already present 2 of 2` |
| `npx tsx script/m14/firing-check.ts --files 120 css` | **5/10 fired, 73,369 edges, 120/120 files, 0 degraded** |
| `npx tsx validation/m14/census/css-parsefile-census.ts --all` | 1,180/1,180 parsed, 0 failures, **0 degraded**, 335,010 relationships |
| `npx tsx validation/m14/census/css-overrides-differential.ts` | **exit 0**, 0 real gaps, 0 fabrications |
| `npx tsx validation/m14/census/css-ontology-probe.ts` | 103 node types, 1,180 files / 76 repos |
| `bun run script/m14/run-fixtures.ts --lang css` | **15 pass / 0 fail** |
| `npx tsx validation/m14/census/css-mutant-run.ts` | **27 mutants, 27 caught, 0 survived** |
| `npx tsx script/m12/verify-regex-census.ts` | 8 regex literals in HEAD; **none in `real-css-analyzer.ts`** (the two `css` matches are substrings of `real-scss-analyzer.ts`, another lane) |
| `npx tsc --noEmit` | **exit 0** |

**The gate's exit code is load-dependent and this is not the lane's to fix.** On one pass
4 run it printed the full table above — `emitted 5/10  ruled-sound 5  FALSIFIED 0
ruled-without-justification 0` — and *then* exited 1, because
`src/ast/engine.ts` arms a per-file 120 s self-destruct timer and calls `process.exit(1)`
when it fires, and one corpus file tripped it. The file is not a fixed one: that run was
`grails-core/grails-test-examples/namespaces/grails-app/assets/stylesheets/main.css`, an
earlier documented run was `hasura-engine/scripts/ekg/monitor.css`, and the run between
them exited 0 on the same corpus. So it is the shared timer meeting a loaded machine
(load average 15.7 on 8 cores while nine other lanes ran), not a property of any file.
`validation/m14/fixtures/css/ruled-gate.ts` captures stderr for exactly this and prints
`BUT NOT A VERDICT — the gate process was killed by parseFile's 120 s [BB-HANG] guard`, so
a truncated run is never read as a result. The verdict is reproducible on a re-run; the
exit code is not yet, and the fix is `engine.ts`'s, which is §8 item (f).

The firing-check's `degraded 0` matters more than the edge count: a degraded parse
substitutes a regex extractor whose symbols carry no `kind` and whose edges sit at
0.4/0.5, and several lanes in the supervisor's 26-lane table are marked provisional for
that reason. This lane's 73,369 is measured through production `parseFile` on files that
all parsed.

## PASS 5 — the corpus grew under the figures, so every number was re-measured

No verdict changed. What changed is that the corpus this lane measures over is no longer
the corpus its headline numbers were measured on: the shared corpus grew from **1,180
files / 76 repositories** to **1,255 files / 79 repositories**, and a document that
quotes an edge count without naming the corpus it came from is quoting a figure no
reader can reproduce. So pass 5 re-ran the census, the probe and every gate, and moved
the headline figures onto the current corpus. The per-pass history above is left as it
was written, because a measurement record that is edited to agree with the present is
not a record.

**What moved, and by how much.**

| | pass 4 (1,180 files) | pass 5 (1,255 files) | delta |
| --- | --- | --- | --- |
| `contains` | 170,432 / 582 files | **175,171 / 589** | +4,739 / +7 |
| `references` | 161,738 / 383 | **161,768 / 389** | +30 / +6 |
| `uses` | 2,613 / 325 | **2,620 / 331** | +7 / +6 |
| `imports` | 179 / 49 | **243 / 68** | **+64 / +19** |
| `overrides` | 48 / 7 | **48 / 7** | 0 / 0 |
| total relationships | 335,010 | **339,850** | +4,840 |
| symbols | 222,786 | **238,536** | +15,750 |
| files carrying a tree-sitter ERROR | 358 / 1,180 (30.3%) | **422 / 1,255 (33.6%)** | +64 |

`imports` is the one that moved by more than corpus noise: **+64 edges on +19 files, a
36% edge rise against a 6% corpus rise.** That is consistent with the new files being
Sass partials (`Documenter.jl/assets/html/scss/**`), which carry `@use`/`@import` chains
that a `.css`-only file set does not — the census sample at pass 5 lists
`Documenter.jl/assets/html/scss/bulma/{grid,elements,helpers}/*.sass` as the source of
most of them. It is still **0% resolved at both ends**, so the rise makes the lane's one
structural defect larger rather than fixing it; that is stated rather than smoothed.

**The resolution rates did not move**, which is the part worth having: `contains`
99.98%, `uses` 100%, `references` 98.7%, `imports` 0%, `overrides` 100% are identical at
both corpus sizes, so they are properties of the analyzer's emission sites and not
artefacts of which files happened to be present.

**All five RULED verdicts re-verified on the larger corpus, and all five still read 0.**
The corpus grew by 75 files, so a ruling whose only evidence was "0 on 1,180 files" had
to be re-run rather than inherited — a ruling measured on a subset is not a ruling on the
set. `validation/m14/census/css-ontology-probe.ts` over all 1,255 files / 79 repos:

| type | instrument | probe | count | files |
| --- | --- | --- | --- | --- |
| `calls` | A | grammar produces a function-definition node | **0** of 103 node types | — |
| `calls` | B | a `@function` declaration | **0** | 0 |
| `extends` | A | grammar produces a type-declaration node | **0** of 103 | — |
| `extends` | B | an `@extend` **directive** | **0** | 0 |
| `extends` | B | the `@extend` at-keyword alone (is it even lexable) | 46 | 26 |
| `implements` | A | grammar produces a supertype clause | **0** of 103 | — |
| `exports` | A | grammar produces an export node | **0** of 103 | — |
| `exports` | B | `composes: x from "./y.css"` | **0** | 0 |
| `exports` | B | a local `composes: y` | **0** | — |
| `exports` | B | a `:export` block | **0** | 0 |
| `instantiates` | A | grammar produces an object-creation node | **0** of 103 | — |
| `instantiates` | B | `var(--x)` — the one CSS construct that yields a value from a name | 162,470 | 392 |

The grammar vocabulary is still **103 distinct node types**, unchanged at the larger
corpus, so instrument A's positive evidence of absence did not weaken. The `@extend`
row is the one worth keeping visible: the at-keyword **is** lexable (46 times in 26
files, all inside `.sass` partials) and is **never** a directive, which is why the
ruling cites both instruments rather than resting on the keyword's absence.

### The gate set, re-run at the current corpus

| gate | pass 5 result |
| --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts css` | verdict **`emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0`** on `corpus: 1255 admitted files`; **exit 1**, see below |
| `npx tsx script/m14/firing-check.ts --files 120 css` | **5/10 fired, 47,667 edges, 120/120 files, 0 degraded** — run twice, byte-identical |
| `npx tsx validation/m14/census/css-parsefile-census.ts --all` | **1,255/1,255 parsed, 0 failures, 0 degraded**, 238,536 symbols, 339,850 relationships, **0** empty symbol names, **0** empty/unknown kind, **0** `unknown` endpoints, **0** empty endpoints |
| `npx tsx validation/m14/census/css-ontology-probe.ts` | 103 node types, 1,255 files / 79 repos, 422 with a parse ERROR |
| `npx tsx script/m14/differential.ts --lang css --sample 60` | **exit 0**. svelte: 60 files, 39/41 truth, 2 MISSING, 24 edges, **unexplained 0 (0%)**, heuristic 0. grails-core: 60 files, **477/477**, 0 MISSING, 367 edges, **unexplained 0**, heuristic 0. Both MISSING are the pinned `@namespace`-as-`imports` over-derivation, not gaps |
| `bun run script/m14/run-fixtures.ts --lang css` | **15 pass / 0 fail**, `fixture baseline gate: no regressions` |
| `bun run script/m14/mutate-analyzer.ts css` | **14 css mutants, 14 CAUGHT, 0 surviving** (the runner sweeps every lane; its 6 survivors are in OTHER lanes — pass 7 re-measured the membership and corrected this parenthetical, which had named zig/erlang/clojure) |
| `npx tsx script/m12/verify-regex-census.ts` | `real-css-analyzer.ts` appears in **neither** the MISSING nor the STALE list — lane count **0** |
| `npx tsc --noEmit` | **exit 0** |

**The gate's verdict reproduces and its exit code still does not, and pass 5 pinned the
cause more tightly than pass 4 could.** This run printed the full clean table and *then*
exited 1, on `spectre/dist/spectre.min.css`, with a `[BB-PARSE-ERR] … memory access out of
bounds` immediately before the `[BB-HANG]` line. Pass 4 could only say "the file is not a
fixed one"; pass 5 measured the file directly, in isolation, through production
`parseFile`:

```
spectre.min.css -> {"ms":1063,"symbols":640,"rels":100,"errors":0}
```

**1.06 seconds, 640 symbols, 100 relationships, 0 parse errors** for a 46,656-byte file.
So the file is not pathological and the 120 s trip is not a property of it: the shared
timer is meeting a loaded machine (load average 11.06 on 8 cores with eight lanes live).
The gate computes and prints its verdict and sets `process.exitCode = 0`
(`script/m14/ontology-coverage-gate.ts:394`) *before* the bomb fires, and
`src/ast/engine.ts:1441-1444` then hard-exits 1 — so the number a CI system reads is
decided by an event that happens after the result exists. That is §8 item (f) and it is
still the supervisor's to fix; this lane's contribution is that the offending file is now
demonstrably innocent, which is the part that was previously unmeasured.

**The firing-check edge count does not reproduce across corpus sizes, and the reason is
the sampling method rather than the analyzer.** Pass 4 recorded 73,369 edges at
`--files 120`; pass 5 recorded **47,667, twice, byte-identical**, at the same sample size
on a corpus 75 files larger. `--files N` takes a *stride* sample, so growing the corpus
from 1,180 to 1,255 changes which 120 files the stride lands on, and those files differ in
edge density. What reproduces exactly is everything that is a property of the analyzer
rather than of the draw: **5/10 fired, 120/120 files, 0 degraded, and the same five type
names.** The honest reading is that a 120-file edge total is a property of the sample and
should be quoted with `--files N` attached; the census figure (339,850 over all 1,255
files) is the one that is a property of the lane. The discrepancy with the supervisor's
26-lane table row for css (73,369) is this same effect and is not a disagreement about
behaviour.

## PASS 8 — a fourth unmoved corpus, every gate reproduced, and the hang population finally
## timed rather than argued

Pass 6 and pass 7 each found the corpus where the previous pass left it. This round checked
first and found it again: **`$HOME/fixtures/repositories` is the same 1,255 files
/ 79 repositories** those passes measured, so every headline figure below is a *fourth*
reproduction rather than a re-measurement. The corpus root now holds 183 repositories and the
disk is at **98% (9.4 G free)** — worth the supervisor's attention as a shared resource, and
recorded under §8 rather than acted on.

### Every gate reproduced

| gate | pass 8 | pass 7 | |
| --- | --- | --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts css` | **exit 0**, all ten rows, `emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0`; counts `contains` 175,171 / `uses` 2,620 / `references` 161,768 / `imports` 243 / `overrides` 48 | same verdict, exit 1 | reproduced, **and exit 0 for the first time in this lane's record** |
| `npx tsx validation/m14/census/css-parsefile-census.ts --all` | **1,255/1,255 parsed, 0 failures, 0 degraded**, 238,536 symbols, **339,850 relationships**, **0** empty names, **0** empty/unknown kind, **0** `unknown` endpoints, **0** empty-string endpoints | identical | reproduced, byte-for-byte |
| `npx tsx script/m14/firing-check.ts --files 120 css` | **5/10 fired, 47,667 edges, 120/120 files, 0 degraded** | identical | reproduced, byte-for-byte |
| `npx tsx validation/m14/census/css-ontology-probe.ts` | 103 node types, 1,255 files / 79 repos, 422 with an ERROR, `var()` **162,470** / 392 files, `@extend` directive **0** / 0, at-keyword **46** / 26 | identical | reproduced |
| `npx tsx validation/m14/census/css-extend-lexability.ts` | **46 / 46 `@extend` keywords inside ERROR nodes**, 0 directives, ancestor chains `ERROR` 32 / `ERROR > ERROR` 8 / `stylesheet > ERROR` 5 / `ERROR > import_statement > binary_expression > ERROR` 1 | identical | reproduced |
| `npx tsx validation/m14/census/css-overrides-differential.ts` | **exit 0**, 1,255/1,255, 48 emitted, **48 agree / 20 MISSING (20 store collisions, 0 real gaps) / 0 EXTRA**, `VERDICT: no analyzer defect` | identical | reproduced |
| `npx tsx script/m14/differential.ts --lang css --sample 60` | **exit 0**, `unexplained=0` and `heuristic=0` on both corpora, **MISSING=2** (the pinned `@namespace` rows); svelte 39/41, grails-core **507/507** (`rot 43`) | svelte 39/41, grails-core 487/487 (`rot 42`) | reproduced; the `rot` moved, and the row counts moved with it exactly as pass 7 predicted |
| `bun run script/m14/run-fixtures.ts --lang css` | **15 pass / 0 fail**, `fixture baseline gate: no regressions` | identical | reproduced |
| `BB_MUTANT_ONLY="css/" bun run script/m14/mutate-analyzer.ts` | **14 mutants, 14 CAUGHT, 0 surviving** (filtered 1,753 → 14) | identical | reproduced |
| `npx tsx script/m12/verify-regex-census.ts` | `real-css-analyzer.ts` in **neither** MISSING nor STALE; **lane count 0** | identical | reproduced |
| `npx tsc --noEmit` | **0 errors** | identical | reproduced |

### The gate exited 0 for the first time, and the run before it exited 1 with no table at all

The two runs are the spread pass 7 measured, observed again in a single round:

| run | real exit | table printed | what the machine said |
| --- | --- | --- | --- |
| 1 | **1** | **NO** — the guard fired before any row | `[BB-PARSE-ERR] … errors.css \| memory access out of bounds`, the same for `mobile.css`, then `[BB-HANG] parser stuck 120s on … errors.css` |
| 2 | **0** | yes, all ten rows | nothing at all — no parse-error line, no hang |

Same commit, same corpus, same command, 5 minutes apart. Run 2's counts match the census to
the edge, which is the part that matters: **a run that is not truncated is not a run that is
wrong**, and run 2 is the first in this lane's record to exit 0.

### The hang population is timed now, not argued

Pass 5 timed one file (`spectre.min.css`, 1.06 s). Pass 7 listed five files and argued from
co-occurrence that the population is not a property of the files. This round timed **all six**
through production `parseFile`, which converts the argument into a measurement:

| file | isolation time | symbols | relationships |
| --- | --- | --- | --- |
| `grails-core/…/stylesheets/errors.css` | **2,977 ms** | 17 | 0 |
| `spectre/dist/spectre.min.css` | **1,270 ms** | 640 | 100 |
| `grails-core/…/stylesheets/main.css` | **201 ms** | 91 | 5 |
| `grails-core/…/stylesheets/mobile.css` | **104 ms** | 16 | 14 |
| `hasura-engine/scripts/ekg/monitor.css` | **21 ms** | 8 | 0 |
| `svelte/…/preserve-specificity/expected.css` | **16 ms** | 2 | 0 |

The budget is 120,000 ms. The slowest of the six is **40× under it** and the fastest parses
in 16 ms. **So no file on the list is slow**, and the guard is measuring the machine.

**A second thing fell out of the same table.** Run 1 printed `[BB-PARSE-ERR] … memory access
out of bounds` for `mobile.css` as well as for `errors.css`, and `mobile.css` is the
**104 ms** row above — it parses to 16 symbols and 14 relationships without difficulty. So the
parse-error line is not a second, independent parser defect either; it is the same loaded
machine, and the census's own accounting agrees: it prints `parse failures 0` over the same
1,255 files. A reader who took run 1's two error lines as evidence about those two files would
be wrong on both counts, and this round has the numbers to say so.

## PASS 7 — every gate reproduced on a THIRD consecutive unmoved corpus, and the `extends`
## ruling's two numbers were reconciled instead of being consistent

Pass 6 found nothing to re-baseline. This round checked the same thing first and found the
same answer — the corpus is still **1,255 files / 79 repositories** — so every headline figure
below is a third reproduction, not a re-measurement. Then it did the one thing passes 5 and 6
left asserted rather than shown.

### The `extends` ruling's 0 and its 46 are not in tension, and now that is shown

`script/m14/css-ruled.ts`'s `extends` row carries two numbers that read as contradictory:

```
extends  B:parse-tree-count    0   0   an `@extend` DIRECTIVE (`@extend .base`)
extends  B:parse-tree-count   46  26   the `@extend` at-KEYWORD itself
```

The corpus writes `@extend` 46 times; the ruling reports 0 directives. Pass 6 established that
the at-keyword is lexable and the directive is not, and stopped there — so which of the two
readings of "0" was correct was **asserted, not measured**. There were three possible answers
and they have different consequences: (1) the keyword sits inside an `at_rule`, which would make
the 0 false, falsify the ruling and make `extends` a GAP this lane owes; (2) it sits in an
ordinary token position, so the directive is genuinely unreadable; (3) it sits inside an
ERROR node, which is a stronger form of (2).

`validation/m14/census/css-extend-lexability.ts` walks the ancestor chain of every `@extend`
`at_keyword` in the admitted corpus. The answer is **(3)**, all 46 of them:

```
@extend AT-KEYWORD occurrences: 46 in 26 files
@extend DIRECTIVES (keyword directly inside at_rule / postcss_statement): 0 in 0 files
occurrences inside an ERROR node: 46

BY DIRECT PARENT NODE TYPE
parent node type           occurrences   files
ERROR                               46      26   line 13: Documenter.jl/.../bulma/components/breadcrumb.sass

ANCESTOR CHAINS
    32  ERROR
     8  ERROR > ERROR
     5  stylesheet > ERROR
     1  ERROR > import_statement > binary_expression > ERROR
```

**Every single `@extend` token on this corpus is inside an ERROR node, and 5 of them sit
directly under `stylesheet`.** So the 46 are not directives written in a shape this grammar
cannot classify — they are the error-recovery artefact of `.sass` partials the pinned grammar
has no production for. There is no other position, which means no analyzer over this grammar
can read them: an ERROR node is a byte range with no production behind it, so recovering
`@extend .base` from one would mean deciding by hand what the bytes mean, which is precisely
the text-matching this lane's instrument discipline exists to prevent.

**The `extends` ruling is therefore stronger than pass 6 could state it, and its `overturn`
condition is now exact rather than merely stated:** any `@extend` at-rule on the tree, or any
type-declaration node type in the printed vocabulary. A corpus writing `@extend` in a file
this grammar can parse — a `.scss` file routed to the SCSS lane, or a grammar revision with an
at-rule production for it — produces one. This corpus does not, and its 46 are precisely why a
reader might have believed otherwise.

### The new probe drifted on its first run, and the printed file count is what said so

The probe printed **1,254 files / 78 repositories** where the arbiter prints **1,255 / 79**.
That is the **third** admission-rule transcription to drift in this lane and the third to be
caught by the same check. All three defects changed the SET rather than shrinking a copy of it:

| defect | why it changes the set |
| --- | --- |
| filtered `rel.endsWith(".css"/".sass"/".less")` before calling `detectLanguageFromPath` | the gate asks the detector and does not pre-filter; the detector admits a file whose extension is not one of those three |
| `git ls-files` newline-split where the probe uses `-z` NUL-split | a tracked path containing a newline becomes two bogus paths, neither of which stats |
| repository list from `readdirSync(withFileTypes)` + a literal `.git` skip | the probe asks git for `--git-dir`, which excludes a directory that is not a repository |

Fixed, and the probe now reads **1,255 / 79** — the arbiter's own number, the same check that
caught `css-boundary-probe.ts` in pass 6 and `css-ontology-probe.ts` in pass 4. **The argument
for transcribing the rule argument-for-argument in every probe rather than importing it is
now three measurements in a row**, and the argument for printing the count and comparing it
against the arbiter's before believing anything the probe says is the whole reason this round's
defect was five minutes' work instead of a wrong ruling.

### The arbiter's exit code varies; its VERDICT does not

Pass 6 measured two runs of `npx tsx script/m14/ontology-coverage-gate.ts css` and recorded
`FALSIFIED 0` on both. This round ran it **four** times on the same corpus at the same commit,
and the spread is wider than pass 6 saw — one run printed no table at all:

| run | real exit | table printed | `contains` | verdict line |
| --- | --- | --- | --- | --- |
| 1 | 1 | **NO** — the guard fired before any row | — | — |
| 2 | 1 | yes, all ten rows | **175,166** (5 short of 175,171) | `emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0` |
| 3 | 1 | yes, all ten rows | **175,157** (14 short) | identical |
| 4 (earlier this round) | 1 | yes, all ten rows | **175,171** — matches the census | identical |

So pass 6's "8 `uses` and 6 `contains` edges short" was one draw from a distribution that also
contains 5, 14, and "nothing printed at all". The **verdict line is identical in every run that
printed one**, so the arbiter's verdict for this lane is reproducible and its *counts* are not
quotable from the arbiter — which is why every count in this file comes from
`css-parsefile-census.ts --all` and the arbiter is quoted only for verdicts. §8 item (f) is
unchanged in substance and larger in scope than pass 6 stated it.

### Every gate reproduced, third consecutive round

| gate | this round | pass 6 | |
| --- | --- | --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts css` | `emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0`; **exit 1 on all four runs** — see above | verdict identical, exit varied | verdict reproduced; exit code confirmed not to be a result |
| `npx tsx validation/m14/census/css-parsefile-census.ts --all` | 1,255/1,255 parsed, 0 failures, 0 degraded, **238,536 symbols, 339,850 relationships**, 0 empty names, 0 empty/unknown kind, 0 `unknown` endpoints | identical | reproduced |
| `npx tsx script/m14/firing-check.ts --files 120 css` | 5/10 fired, **47,667 edges, 120/120 files, 0 degraded** | identical | reproduced |
| `npx tsx validation/m14/census/css-ontology-probe.ts` | 103 node types, 1,255 files / 79 repos, 422 with an ERROR, `var()` 162,470 / 392 files, `@extend` directive 0 / 0, at-keyword 46 / 26 | identical | reproduced |
| `npx tsx validation/m14/census/css-extend-lexability.ts` | **NEW**: 46 / 46 `@extend` keywords inside ERROR nodes, 0 directives, 1,255 / 79 | — | new instrument |
| `npx tsx validation/m14/census/css-overrides-differential.ts` | **exit 0**, 1,255/1,255 parsed, 48 emitted, **48 agree, 20 MISSING (20 store collisions, 0 real gaps), 0 EXTRA**, `VERDICT: no analyzer defect` | identical | reproduced |
| `npx tsx script/m60/rel-type-coverage-gate.ts --langs=css` | exit 0, **CHECK 1 DERIVATION clean, CHECK 2 REACHABILITY clean (10 of 10), CHECK 3 AGREEMENT clean, CHECK 4 ENUM clean**, `baseline: 104 recorded, 0 NEW, 104 repaid` — but it **overwrote the shared artifact**, see §8 (g) | not measured | first clean reading of all four checks for this lane; read CHECK 1 against §8 (c) |
| `npx tsx script/m14/differential.ts --lang css --sample 60` | **exit 0**, `unexplained=0` and `heuristic=0` on both corpora, 2 MISSING (the pinned `@namespace` rows); `BB_LABEL_DUMP=css` shows the compared set is exactly `contains`/`imports`/`references`/`uses` | reproduced | reproduced. **`--sample` is load-bearing**: without it `differential.ts:21470` sets `resume` and a resumed lane prints `RESUMED from journal (…)` carrying the PREVIOUS run's numbers. This row was measured with the flag on (`rot 42`), which is why svelte reads 41 rows and grails-core **487** where pass 6 read 41 and 497 |
| `bun run script/m14/run-fixtures.ts --lang css` | **15 pass / 0 fail**, `no regressions` | identical | reproduced |
| `BB_MUTANT_ONLY="css/" bun run script/m14/mutate-analyzer.ts` | **14 mutants, 14 CAUGHT, 0 surviving** (filtered 1,753 → 14) | identical | reproduced |
| `bun run script/m14/mutate-analyzer.ts` (whole sweep, for the survivors) | **1,745 CAUGHT / 6 SURVIVED**, real exit **2** — **run twice, byte-identical**. The survivors are `java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`, `groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`, `make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess` — **none in css**, and reported here rather than fixed (§8) | not measured | **corrects pass 5's parenthetical**, which named `zig/erlang/clojure`. That set does not reproduce at this commit, on either of two runs. The membership is a function of other lanes' suites, so it is quoted with the commit rather than as a fixed fact about the harness |
| `npx tsx script/m12/verify-regex-census.ts` | `real-css-analyzer.ts` in neither MISSING nor STALE; **lane count 0** | identical | reproduced |
| `npx tsc --noEmit` | exit 0 | identical | reproduced |

## PASS 6 — the corpus did NOT move, every gate reproduced, and the ruled table was carrying four pass-4 figures

Pass 5's finding was that the shared corpus grows under the figures, so this round first
checked whether it had moved again. **It had not**: `$HOME/fixtures/repositories`
was last written at 06:01 and pass 5 committed at 08:05, so the corpus is the same
**1,255 files / 79 repositories** pass 5 measured. Every headline figure therefore
reproduced rather than moved, which is the first time in this lane's history that a pass
found nothing to re-baseline — and it is also the first pass where the stale figures were
not in the census but in the ARBITER, which is worse, because the arbiter is what other
lanes read.

### Every gate reproduced, byte-for-byte where it should

| gate | this round | pass 5 | |
| --- | --- | --- | --- |
| `npx tsx script/m14/ontology-coverage-gate.ts css` | `emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0`, `corpus: 1255 admitted files`, **exit 1** | identical | verdict reproduced; see below — this run's EDGE COUNTS were short and the run was truncated |
| `npx tsx validation/m14/census/css-parsefile-census.ts --all` | 1,255/1,255 parsed, 0 failures, 0 degraded, 238,536 symbols, 339,850 relationships, 0 empty names, 0 empty/unknown kind, 0 `unknown` endpoints | identical | reproduced |
| `npx tsx script/m14/firing-check.ts --files 120 css` | 5/10 fired, 47,667 edges, 120/120 files, 0 degraded | identical | reproduced |
| `npx tsx validation/m14/census/css-ontology-probe.ts` | 103 node types, 1,255 files / 79 repos, 422 with an ERROR, `var()` 162,470 / 392 files, `@extend` directive 0 / 0, at-keyword 46 / 26 | identical | reproduced |
| `npx tsx script/m14/differential.ts --lang css --sample 60` | **exit 0**, `unexplained=0` and `heuristic=0` on both corpora, 2 MISSING (the pinned `@namespace` rows) | identical except the rotation | reproduced; sample rotated to `rot 40`, so svelte tree-truth read 41 rows and grails-core 482 where pass 5 read 41 and 477 |
| `bun run script/m14/run-fixtures.ts --lang css` | 15 pass / 0 fail, `no regressions` | identical | reproduced |
| `BB_MUTANT_ONLY="css/" bun run script/m14/mutate-analyzer.ts` | 14 mutants, 14 CAUGHT, 0 surviving | identical | reproduced |
| `npx tsx script/m12/verify-regex-census.ts` | `real-css-analyzer.ts` in neither MISSING nor STALE | identical | reproduced; **lane regex count 0** |
| `npx tsc --noEmit` | exit 0 | identical | reproduced |

**The arbiter's exit code is still not a result, and this round measured HOW MUCH a
truncated table differs from a whole one.** Four runs of the same command on the same
corpus at the same commit, and they do not agree:

| run | exit | `uses` | `contains` | `references` | `imports` | `overrides` | verdict line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| whole corpus (census) | — | **2,620** | **175,171** | 161,768 | 243 | 48 | — |
| gate, run 1 | 0 | 2,620 | 175,171 | 161,768 | 243 | 48 | identical to census |
| gate, run 2 | **1** | **2,612** | **175,165** | 161,768 | 243 | 48 | `FALSIFIED 0` — printed anyway |
| `ruled-gate.ts` | 1 | — | — | — | — | — | refused: `BUT NOT A VERDICT` |

**Run 2 is the finding, and it is the exact hazard §8 item (f) predicts.** It hung on
`spectre/docs/dist/spectre-exp.css`, after printing all ten rows of the table and the
summary `emitted 5/10  ruled-sound 5  FALSIFIED 0  ruled-without-justification 0` — and its
edge counts were **8 `uses` and 6 `contains` edges short of the whole corpus**, because
the walk was cut off before the last files. A reader checking the table against a summary
that says `FALSIFIED 0` sees a clean result; the numbers are 0.005% wrong and the exit code
is the only thing that says so. The truncation landed LATE here, which is luck: pass 4
recorded the same guard firing early enough that a partial table could read as a pass, and
nothing in the gate distinguishes the two cases.

The lane's own `ruled-gate.ts` is the mitigation and it works — it captured the same
condition and printed

```
gate exit code: 1  BUT NOT A VERDICT — the gate process was killed by parseFile's 120 s
[BB-HANG] guard (src/ast/engine.ts), so the run was truncated.
```

so this file quotes the gate's TABLE and not its exit code, and quotes the census for every
count. That mitigation is a lane-local wrapper around shared machinery; the gate itself
still needs to distinguish a finished walk from a killed one, which is §8 item (f).

### `script/m14/css-ruled.ts` was carrying four pass-4 figures, and one of them was wrong

The ruling table is what the arbiter prints for every `RULED-SOUND` row, so a stale number
in it is read by every lane that sweeps the gate. Four were stale and one was false:

| row | said | measured |
| --- | --- | --- |
| `calls` | "1,180 admitted files across 76 repositories"; `var` 162,440, `rgba` 18,752, `calc` 15,004, `rgb` 7,347, `url` 4,931 | **1,255 / 79**; `var` 162,470, `rgba` 20,370, `calc` 15,220, `rgb` 7,362, `url` 4,932 |
| `exports` | "0 … across 1,180 files / 76 repositories" | **1,255 / 79** |
| `instantiates` | "**162,440** `var()` calls across 386 files" | **162,470 across 392 files** |
| `extends` | "**0 `@extend` at-rules … and 0 occurrences of the at-keyword itself**, so the directive is not merely absent but unexercised by the corpus" | **0 directives, but the at-keyword occurs 46 times in 26 files** |
| header | "the corpus's 3 `.sass` + 54 `.less` files" | **67 `.sass`** + 54 `.less` |
| `CSS_OVERRIDES_EXAMINED` | `admittedFiles: 1180` | **1255** |

**The `extends` row was the one that mattered, and it was wrong in the direction that
makes a ruling look better than it is.** It claimed the corpus never writes `@extend` at
all. The corpus writes it 46 times, in 26 files, every one a `.sass` partial — the pinned
grammar simply routes the at-keyword through the catch-all `at_rule` instead of a
production of its own, so the text is lexable and the construct is not readable. The
ruling SURVIVES (0 directives, and instrument A agrees), but the sentence supporting it
described a corpus that does not exist. The row now carries the 46 and says plainly that
this ruling rests on instrument B alone: instrument A is silent here BY CONSTRUCTION, which
is the same structural reason bash's `overrides` needs instrument B. A ruling that quotes
a corpus number it has not re-measured is the failure this milestone exists to catch, and
this lane caught it in its own arbiter table rather than being told.

The block at the top of the file quoting the gate's original refusal is left as it was
written, including its `1196` — that was a real reading at the time, it is simply not the
current corpus — with a header now saying so, because a measurement record edited to agree
with the present is not a record.

### The per-branch firing table was counting its own dead branches wrong

`css-parsefile-census.ts --all` prints every declared flag whether it fired or not, and the
table under "Per-BRANCH firing" was quoting pass-2 counts. Two things were wrong with it.
The counts were stale, and it claimed **"Eight relationship branches and one symbol
branch"** have never executed, where the instrument reports **eight relationship branches
and FOUR symbol branches** — the census has grown symbol flags since pass 2 and the table
was not tracking them. A table of dead branches that undercounts its own dead branches is
worse than no table, because it reads as coverage.

Both are corrected and the table now lists every branch the instrument prints. One of the
four newly-visible dead symbol branches is `@property` registration, which is the shape
`overrides`' third rule reads — so the type's thinnest branch and the corpus's silence
about `@property` turn out to be the same fact seen twice.

### `css-boundary-probe.ts` was measuring 9 files fewer than the arbiter, for the second time in this lane

The probe printed `1246 admitted files` where the arbiter printed `1255`. Its admission
rule had both defects pass 4 found and fixed in `css-ontology-probe.ts`: it skipped
zero-byte files, and it called `detectLanguageFromPath` with **one** argument where the
gate passes the file text as a second. The second is load-bearing, so it admitted a
different SET rather than a smaller copy of the same one. Fixed, and the probe now reads
**1,255 / 79** — the arbiter's own number.

**The two probes agreed on every measurement afterwards**, which is the result that says
the fix was a denominator fix and not a behaviour change: dropped-key counts, the 2,917
scope symbols that arrive with no metadata, and the 106 same-block re-assignments are all
unchanged. The 9 extra files carried none of these constructs.

This is the second time one probe's transcription of the admission rule has drifted from
the arbiter's in this lane, and the first time the fix was applied to one probe and not
the other. That is the argument for transcribing the rule argument-for-argument in every
probe rather than importing or copying it, and for checking the printed file count against
the gate's before believing any number a probe reports.

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
| Admission rule | git-tracked, a real directory, ≤ 512 KB, `detectLanguageFromPath(abs, text) === "css"` — the rule `ontology-coverage-gate.ts` uses, **copied** rather than imported so the file set cannot drift with an edit to shared machinery. The **two-argument** call is load-bearing: pass 4 measured a 1,171-vs-1,180 gap caused by a one-argument transcription, and the probe no longer drops zero-byte files either |
| Sampling | **NONE — the census is the whole admitted set.** No stride, no sample. **1,255 files / 79 repositories**, re-measured in pass 5 (1,180 / 76 at pass 4; 1,131 / 65 at pass 2) |
| Growth, milestone 1 | 681 → 1,114 files. Cloned `twbs/bootstrap`, `jgthms/bulma`, `primer/css`, `picocss/pico`, `kognise/water.css`, `picturepan2/spectre`, `sass/sass-spec`. `open-prose` and `less-js-doc` failed to clone and `mdn/content` was cloned then deleted: it carries 0 `.css` files (its stylesheets are inlined into markdown), so it was 260 MB of walk cost for no admitted file |
| Growth, pass 2 | 1,114 → **1,131 files, 61 → 65 repositories**, by OTHER lanes cloning into the shared corpus. Nothing was cloned by this lane in pass 2. Every count in this file was re-measured rather than carried forward, and the before/after table is under "Every number in this file, re-measured" below |
| Growth, pass 5 | 1,180 → **1,255 files, 76 → 79 repositories**, again by other lanes cloning into the shared corpus. This lane cloned nothing in pass 5. The +64 `imports` edges are the visible consequence and are attributed under "PASS 5" above |
| Files the project states as its floor | 200+ per family; the census is 6.3× that |
| Files parsed | **1,255 of 1,255**; **0 failed**; **0 degraded** (`fallback: true`) |
| Parse-robustness findings | **422 of 1,255 (33.6%)** carry a tree-sitter ERROR somewhere (`css-ontology-probe.ts`, re-measured in pass 5 and again in pass 6; 358 of 1,180 / 30.3% at pass 4; 356 of 1,131 / 31.5% at pass 2; 354 of 1,114 / 31.8% at handover). **SIX** distinct files have now been observed tripping `parseFile`'s own 120 s `[BB-HANG]` guard, and **pass 8 timed every one of them in isolation through production `parseFile`, so the whole population is measured rather than inferred**: `errors.css` **2,977 ms**, `spectre.min.css` **1,270 ms**, `main.css` **201 ms**, `mobile.css` **104 ms**, `hasura-engine/scripts/ekg/monitor.css` **21 ms**, `svelte/.../preserve-specificity/expected.css` **16 ms**. Not one of the six is near 120 s, so the trip is a property of the machine and not of any file — see §8 item (f) and "PASS 8" below |

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
`imports`. The oracle derives two `imports` rows, one per `@namespace` URI.

**The reading is that the analyzer is right and the oracle over-derives,** and this round
turned that from an argument into a measurement. Production `parseFile` on that exact file
returns **5 symbols and 1 relationship**: two `module` symbols carrying the two
declarations verbatim, and the single `references` edge with `isNamespaceRef`. So the
construct is READ, and the disagreement is about the TYPE alone, not about coverage. An
`@namespace` URI is an XML namespace NAME, a vocabulary identifier the user agent resolves
against, while `@import url(…)` names a stylesheet the user agent FETCHES; the two are
different acts and one is not a file dependency. The analyzer's edge also carries strictly
more than the oracle's row — it says WHICH selector depends on WHICH declaration, where
`imports expected.css -> <uri>` says only that the file mentions the URI.

`validation/m14/fixtures/css/namespace-uri-is-not-an-import.{css,expectation.json}` pins
this decision so it cannot be closed the cheap way. Its `forbidRelationships` rows refuse
`imports` targeting either URI in both the bare and the prefixed spelling, and it carries a
real `@import url("theme.css")` so the refusal is about namespaces specifically rather than
about an `imports` branch that never fires. The mutant
`css/namespace-uri-published-as-an-import` performs exactly the change that would make
`MISSING=2` read zero — republish each `@namespace` URI as an `imports` edge — and the
fixture catches it. This lane therefore still declines the two rows, and the §8 item
against `deriveCssEdges` stands: the oracle is supervisor-owned, so the honest state of
this row is "two rows the oracle derives that the analyzer declines, with a measurement and
a fixture against the alternative, pending the owner's decision". Closing it by emitting
them would assert a fetch CSS does not perform.

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
| `contains` | EMITTED | **175,171 edges, 589 files** (pass 5, 1,255 files; 170,432 / 582 at pass 4; 168,327 / 561 at pass 2) | e.g. `Exposed/docs/api/styles/main.css`, `bootstrap/dist/css/bootstrap.css`, `svelte/packages/svelte/tests/css/samples/*/expected.css` |
| `uses` | EMITTED | **2,620 edges, 331 files** (pass 5; 2,613 / 325 at pass 4; 2,611 / 324 at pass 2) | `bootstrap/dist/css/bootstrap.css` (`.progress-bar-animated -> progress-bar-stripes`) |
| `references` | EMITTED | **161,768 edges, 389 files** (pass 5; 161,738 / 383 at pass 4; 161,217 / 371 at pass 2) | `Exposed/docs/api/styles/main.css` (`:root -> --color-b08`) |
| `imports` | EMITTED | **243 edges, 68 files** (pass 5; 179 / 49 at pass 4; 177 / 47 at pass 2) | `bulma/docs/assets/css/custom.css`, `bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/less/fontawesome.less` |
| `overrides` | EMITTED (was a GAP; implemented this milestone, and a second shape added in pass 2) | **48 edges, 7 files** | `hasura-engine/.../GraphiQL.css` (`rotation`, L1534 → L2214); `vue-element-admin/src/assets/custom-theme/index.css` (`v-modal-in`, `v-modal-out`, `progress`); `bulma/css/versions/bulma-no-helpers{,-prefixed}.min.css` and siblings (`--bulma-light-l` and 43 others — 106 same-block re-assignments on the tree, of which 44 are emittable; see limitation 10) |
| `extends` | RULED | instrument A: 0 of 103 node types is a type declaration or a supertype clause. instrument B: **0** `@extend` directives on the tree in 1,255 files, although the at-keyword itself is lexable and occurs 46 times in 26 files — and **pass 7 measured where all 46 live: 46 of 46 are inside an ERROR node** (`css-extend-lexability.ts`), so there is no other position for the directive to be in | Overturn: any `@extend` at-rule on the tree, or any `class_declaration`/`superclass`/`implements_clause`/`base_class_clause` node type in the printed vocabulary |
| `implements` | RULED | instrument A: 0 of 103 node types is `implements_clause`, `extends_clause`, `superclass`, `interface_implementation`, `base_class_clause`, `type_inheritance_clause`, `mixin_declaration_list` or `super_interfaces` | Overturn: any such node type in the printed vocabulary |
| `calls` | RULED | instrument A: 0 of 103 node types declares a function (`function_declaration`, `method_definition`, `function_definition`, `arrow_function`, `function_item`, `custom_function_statement`, …). instrument B: **0** `@function` at-rules — CSS Functions and Mixins L4's `@function --add(a,b) { … }` — on the tree | Overturn: any `@function` at-rule on the tree, or any function-declaration node type |
| `exports` | RULED | instrument A: 0 of 103 node types is `export_statement`, `export_declaration`, `export_list`, `exports_clause`, `export_specifier` or `export_block`. instrument B: **0** `composes: … from …` declarations and **0** `:export` rule_sets (0 `composes` declarations of any kind) | Overturn: any `:export` rule_set or `composes … from …` declaration on the tree |
| `instantiates` | RULED | instrument A: 0 of 103 node types is `new_expression`, `object_creation_expression`, `constructor_invocation`, `object_creation`, `instantiation_expression` or `new_declarator`. instrument B as well, and this is the part that matters: **162,470** `var(--x)` calls across 392 files, every one of them a READ of a declaration rather than a construction, and every one already emitted as `references` | Overturn: any object-creation node type in the printed vocabulary |

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
| 2 Fires | **589 of 1,255 files** | **331** | **389** | **68** | **7** |
| 3 Correct | differential, pass 7 (`--sample 60`, forced off the journal): svelte 60 files, **39 of 41** tree-truth rows covered, **2 MISSING**; grails-core 60 files, **487 of 487** covered, 0 missing. **unexplained 0 (0%) on both, heuristic 0** — the shared oracle finds no fabricated edge. Both MISSING rows are the pinned `@namespace` disagreement, not gaps: `imports expected.css -> http://www.w3.org/1999/xhtml` and `…/2000/svg`, derived by the shared oracle from `@namespace url(...)` lines in `packages/svelte/tests/css/samples/supports-namespace/expected.css`. The analyzer emits `references svg|a -> @namespace svg url(…)` instead, and the mutant that would zero this number by republishing the URI as an `imports` edge is CAUGHT by `css/namespace-uri-is-not-an-import`. **The row count is a function of the rotating 60-file sample**, which is why earlier passes read 67/67, 398/398, 502/502 and 477/477: `rot 42` on this run. Quote it with the run. **`--sample` is load-bearing**: without it `differential.ts:21470` sets `resume`, and a resumed lane prints `RESUMED from journal (…)` with the PREVIOUS run's numbers — so this row was re-measured with the flag on rather than quoted from a resumed line | same run | same run | same run | **the SHARED harness does not audit it — see DERIVATION.** `BB_LABEL_DUMP=css` on this run prints the compared set as exactly `contains` / `imports` / `references` / `uses`: `overrides` is absent, because `deriveCssEdges` pushes four labels. The harness's own `COMPARED WITH NO TRUTH: overrides (1 comparable, 0 truth)` line therefore fires only when the rotated sample happens to CONTAIN an `overrides` edge — pass 2 recorded it firing, and on this run's `rot 42` sample it did not, because the sample held 0. **A lane that emits `overrides` on every file would print the same clean rows either way.** A lane-owned second walker DOES audit it since pass 4 — `script/m14/oracles/css-overrides.ts`, re-measured over all 1,255 files: **48 agree, 20 MISSING of which 20 are store collisions and 0 real gaps, 0 EXTRA** |
| 4 Labelled | sub-shapes separable by metadata flag: `isMediaScope` 30,864, `isCustomPropertyScope` 137,867, `isSelectorChain` 5,005, `isNestedSelector` 420, `isLayerScope` 505, `isSupportsScope` 368, `isContainerScope` 142 | `isAnimationRef` 2,572 + `isFontFamilyRef` 48 — no edge carries a second flag, so a mislabelled `uses` would be visible as a third label | `isVariableRef` 161,767 + `isNamespaceRef` 1 | `isCssImport` 243; `isSassModuleImport` 0 | `isKeyframesRedefinition` 4 + `isCustomPropertyRedefinition` 44 |
| 5 Resolved, both ends | 175,144/175,171 (99.98%) | 2,620/2,620 (100%) | **159,678/161,768 (98.7%)** | 0/243 (0%) — and pass 2 showed this is a LANE property, not a language one (see the `imports` note above) | 48/48 (100%) |
| 6 Confident | `evidenceClass: structural`, `confidence` absent on 37,304 of 175,171 → treated as 1.0; **0** edges below 1.0 and **0** below 0.7 | `usage_contextual`, `confidence` absent on all 2,620, 0 below 0.7 | `import_based`, `confidence` absent on all 161,768, 0 below 0.7 | `import_based`, `confidence: 1.0` written explicitly on all 243, 0 below 0.7 | `structural`, `confidence: 1.0` written explicitly on all 48, 0 below 0.7 |

**Heuristic ratio for the whole lane: 0 of 339,850 relationships (0.0%) carry a
confidence below 0.7, and 0 carry a confidence below 1.0** (pass 5, 1,255 files; 335,010 at
pass 4; 332,380 at pass 2).
That is a real property and
also a limitation to read honestly: the lane writes `confidence` on only a few of its
emission sites, so the other edges are *absent* rather than measured at 1.0, and "0 below
1.0" partly reflects that absence. §4 of the honesty contract asks for a machine-readable
reason code on anything under 1.0; this lane emits nothing under 1.0, so there is
nothing to carry a reason code for.

The census counts that absence rather than describing it, because "absent" and
"1.0" are different claims about the same edges: `contains` writes `confidence` on
137,867 of 175,171 and leaves 37,304 absent; `uses` leaves all 2,620 absent;
`references` leaves all 161,768 absent; `imports` writes 1.0 on all 243 and `overrides`
writes 1.0 on all 48. So 201,692 of 339,850 edges (59.3%) carry no numeric confidence at
all, and the heuristic ratio above measures what is *written*, not what is known.

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

Question 2 asked per type is satisfied by `uses` at 2,620 edges. Asked per branch it is
not, and this is the table that says so. Re-measured at the current corpus (1,255 files /
79 repositories) by `validation/m14/census/css-parsefile-census.ts --all`, which prints
every declared flag whether it fired or not. This table previously carried pass-2 counts
and, worse, counted only ONE zero symbol branch where the instrument reports four — the
census has grown branches since, and a table of dead branches that undercounts its own
dead branches is worse than no table.

| branch | corpus occurrences |
| --- | --- |
| `uses` ← `isAnimationRef` | 2,572 |
| `uses` ← `isFontFamilyRef` | 48 |
| `uses` ← `isMixinRef` (`@include`) | **0** |
| `uses` ← `isComposition` (`composes:`) | **0** |
| `uses` ← `isCounterStyleRef` (`list-style: thumbs`) | **0** |
| `uses` ← `isFontFeatureValuesRef` | **0** |
| `references` ← `isVariableRef` | 161,767 |
| `references` ← `isNamespaceRef` | 1 |
| `references` ← `isCustomMediaRef` (`@media (--x)`) | **0** |
| `imports` ← `isCssImport` | 243 |
| `imports` ← `isSassModuleImport` (`@use`/`@forward`) | **0** |
| `overrides` ← `isKeyframesRedefinition` | 4 |
| `overrides` ← `isCustomPropertyRedefinition` | 44 |
| `overrides` ← `isPropertyReregistration` (`@property` twice) | **0** |
| `contains` ← `isCustomPropertyScope` | 137,867 |
| `contains` ← `isMediaScope` | 30,864 |
| `contains` ← `isSelectorChain` | 5,005 |
| `contains` ← `isLayerScope` | 505 |
| `contains` ← `isNestedSelector` | 420 |
| `contains` ← `isSupportsScope` | 368 |
| `contains` ← `isContainerScope` | 142 |
| `contains` ← `isScopeScope` (`@scope`) | **0** |
| symbols ← `isSelector` | 189,383 |
| symbols ← `isComplex` | 80,971 |
| symbols ← `isCustomProperty` | 44,731 |
| symbols ← `isUtility` | 34,402 |
| symbols ← `isKeyframes` | 1,133 |
| symbols ← `isSupports` | 243 |
| symbols ← `isAtRule` | 142 |
| symbols ← `isCssModule` | **1** |
| symbols ← `isCounterStyleDeclaration` | **0** |
| symbols ← `isCustomMediaDeclaration` | **0** |
| symbols ← `isFontFeatureValuesDeclaration` | **0** |
| symbols ← `isPropertyRegistration` | **0** |

**Eight relationship branches and FOUR symbol branches have never executed on this
corpus** — `isMixinRef`, `isComposition`, `isCounterStyleRef`, `isFontFeatureValuesRef`,
`isCustomMediaRef`, `isSassModuleImport`, `isPropertyReregistration`, `isScopeScope`, and
`isCounterStyleDeclaration`, `isCustomMediaDeclaration`,
`isFontFeatureValuesDeclaration`, `isPropertyRegistration`. Two of those four symbol
branches are `@property` registrations, which is the shape `overrides` third rule would
read, so the type's thinnest branch and the corpus's silence about `@property` are the
same fact seen twice.

That is not a claim that they are broken — it is the same situation the lane already
records for `@counter-style`/`@custom-media`/`@font-feature-values`, and the standing
answer is a fixture rather than a deletion. It IS a claim that **no corpus number in
this document is evidence about those twelve branches.** They are covered by
`validation/m14/fixtures/css/declarations-the-corpus-never-uses.css` and by the
`overrides` fixtures, and by nothing else.

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

The lane's own fixtures and mutants are on it, and — since pass 4 — so is a second
walker, `script/m14/oracles/css-overrides.ts`, importing nothing from the analyzer. Re-measured
in pass 7 over all 1,255 files: **48 agree, 20 MISSING of which 20 are store collisions and
**0** are real gaps, 0 EXTRA** (`css-overrides-differential.ts`). What remains is the honest
part of this finding: **the shared `script/m14/differential.ts` still does not audit the type**,
its allowlist comparison runs over four labels, and the wiring is §8 item (c). An oracle run by
the same agent that wrote the analyzer, outside the milestone's own harness, is weaker evidence
than being inside that harness, so this entry stays open at 1 rather than being closed on the
strength of a script this lane also owns.

The oracle this needs is written out under "Reported, not edited" below so it can be
implemented without re-deriving it.

### Declared limitations

CSS cannot express unrestricted computation, but a blank list would still be a false claim
for this lane. Every item below names the measurement that produced it.

1. **`overrides` is a thin census.** 48 edges in 7 files of 1,255 (0.56% of files), and
   44 of the 48 come from ONE construct in SIX files — Bulma's minified bundles. The
   construct is spec-defined and the implementation is exercised by two fixtures and eight
   mutants, but the corpus cannot say whether the rule is right about shapes it has never
   seen: a prefixed `@keyframes` pair nested inside a `@media` at-rule, or a
   same-block redefinition inside a `@supports` or `@layer` body, are cases no corpus file
   exercises. The count did not move at all between the 1,180-file and the 1,255-file
   corpus (48 / 7 on both), which is worth reading as a thin type rather than a stable
   one: 75 more files produced zero more edges.
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
   basename, which css publishes no symbol for. 0 of 243, measured. The fix is a scope
   decision (see "Reported, not edited") and not a claim that 0% is right.
5. **Nine branches have zero corpus occurrences** (table above) and are pinned only by
   fixtures.
6. **The grammar is the ceiling.** 422 of 1,255 files carry an ERROR, and one file
   (`preserve-specificity/expected.css`) reports `memory access out of bounds` from the
   wasm and trips `parseFile`'s 120 s guard. Anything inside a damaged region is not
   extracted, and no analyzer change can lift that.
7. **Resolution is measured per FILE.** A name that binds in one stylesheet does not bind
   across two, so every rate here is a within-file rate. A cross-file `references` claim
   (a `var(--x)` defined in another stylesheet) is deliberately not made.
8. **`.sass` and `.less` are routed here and the corpus for `.sass` is thin.** Pass 2
   measured 0 files of each and this document said so; the current corpus admits **1,134
   `.css`, 67 `.sass` and 54 `.less`** (`css-parsefile-census.ts --all`). Sixty-seven
   indented-syntax files cannot support a claim about `.sass` as a language, and the
   pinned `wasm/tree-sitter-css.wasm` is not the `.sass` grammar in any case. Every ruling
   in this file is measured over all 121 dialect files, so the `extends` and `calls` probes
   are not vacuous — they are simply unexercised. This matters most for `extends`, because
   the 46 `@extend` at-keywords the probe finds are all inside those `.sass` partials: the
   construct is written 46 times in NAME and produced as a DIRECTIVE 0 times, which is a
   statement about the pinned grammar, not about SCSS.
9. **`overrides` is audited by a LANE-owned oracle but not by the milestone's own
   instrument.** Pass 7 corrected this entry, which said "`overrides` has no differential
   oracle" — it has had one since pass 4 (`script/m14/oracles/css-overrides.ts`, a second
   walker importing nothing from the analyzer). Re-measured today over the whole admitted
   corpus: **48 agree, 20 MISSING of which 20 are store collisions and 0 are real gaps,
   0 EXTRA** (0 fabrications), `VERDICT: no analyzer defect`. So the type's correctness
   rests on a second walker rather than on fixtures alone. What is still true is the part
   that makes it the DERIVATION finding: the SHARED `script/m14/differential.ts` does not
   audit it, the wiring is owed and is §8 item (c), and a lane-owned oracle run by the same
   agent that wrote the analyzer is weaker evidence than the milestone's own harness. Pass 2
   raised the edge count 12× without raising the evidence CLASS, which is worth saying
   plainly: more occurrences of an unaudited type is not more confidence in it.
10. **62 of 106 same-block re-assignments are unemittable** — limitation 3, counted
    separately because it is a storage limit rather than an analyzer limit, and because
    "48 edges" would otherwise read as the size of the construct when the size is 106.
11. **A scope symbol's range is not contiguous.** `@media` / `@layer` / `@container` /
    `@scope` widen one symbol across all its blocks, so `startLine` is the first block
    and `endLine` the last, with everything between them not in the block. Only `endLine`
    moves, which keeps the byte span (`startIndex`/`endIndex`) describing the FIRST block.
    A consumer assuming contiguity will be wrong for exactly the multi-block scopes this
    describes; **2,924** scope symbols over **444** files are in that state.
12. **The `@media` / `@layer` scope extent and its block count are dropped at the
    production boundary.** `pool-worker.ts` forwards a narrow allowlist of CSS `metadata`
    keys; `isMediaScope`, `mediaCondition`, `scopeBlocks`, `hasLayerBlock`,
    `isLayerOrdering` and `layerIndex` are not on it, so **2,917 of 3,198 at-rule scope
    symbols arrive from `parseFile` with NO metadata at all**, across 444 files. The NAME
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

### For the supervisor: the `CSS_RULED` table entry — SUPERSEDED, kept as the record

**This section is the PRE-PASS-4 state and is left exactly as it was written, because it is
what the item looked like when it was filed.** It is applied: `CSS_RULED` is registered in
`script/m14/ontology-coverage-gate.ts` and the arbiter rules all ten types (`FALSIFIED 0`). Do
not apply what follows — see "Reported, not edited" item (a), which carries the measured result
of applying it, and `script/m14/css-ruled.ts` for the table as built. A reader who needs to know
what the supervisor's machine does today should read the gate, not this block.

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

**DIVERGENCE FROM WHAT WAS BUILT, so this block is not copied by mistake:** the table as
registered gives `exports` **and `extends`** instrument **B**, not A — instrument A is silent
on `@extend` BY CONSTRUCTION because the grammar routes every unrecognised at-rule through the
catch-all `at_rule`. Both rows carry their A probe as a secondary check and their B probe as
the decider. `script/m14/css-ruled.ts` is authoritative.

### Reported, not edited — seven open items, one applied in pass 4, one added in pass 7, one added in pass 8

Items (b) through (g) are open and §8-owned. Item (a) was open for a round, was the lane's
critical path, and is now APPLIED — it is kept in the list rather than deleted so the
measurement that justified it stays next to the record of what it produced. Item (g) was added
in pass 7: it was found by running the gate, and it silently destroys a shared artifact.
Item (h) was added in pass 8.

Each is written to be applied without re-deriving it: file, function, what it must do,
why, and the measurement that says it is needed. All are §8 items under
`docs/analyzers/ONTOLOGY-WORKSTREAM.md`.

**(h) ADDED IN PASS 8 — the shared corpus is at 98% of the disk, and the arbiter's hang guard
is the mechanism that will make that someone's problem first.** Measured at 11:55 on
2026-10-04 from this lane: `df -h /` reports **9.4 G free of 460 G (98% used)**, and
`$HOME/fixtures/repositories` holds **183 repositories** against the ~90 the lane
brief described. Nothing needs to change in the code for this to be fixed — it needs someone
to decide whether the corpus keeps growing, and if so what gets deleted. Two concrete notes
so the decision does not have to be re-derived: (1) this lane's own admitted set is
**1,255 files**, so the 183 repositories are mostly *not* css and a css-only lane cannot
audit the other 182; (2) the deletion rule the lane brief states is "delete build artifacts,
never source", and the temptation under pressure will be to delete whole repositories that
other lanes are mid-measurement on — `mdn/content` is the worked example, 260 MB of walk
cost for 0 admitted css files, deleted by this lane in an earlier pass. **No shared
corpus state is this lane's to change**, so this is reported and not acted on. It is filed
here rather than as prose because the failure it predicts is the one this lane has now
measured twice: a gate run that dies on a 120 s guard and prints no verdict, on a machine
that is out of memory and out of disk at the same time.

**(a) APPLIED IN PASS 4 — `script/m14/ontology-coverage-gate.ts`, `RULED_BY_LANG`.**
This item was open for a whole round and was the lane's critical path: the gate exited 2
and reported nothing for css, so the five RULED verdicts had no arbiter checking them.
`ROUND-BRIEF.md` item 3 authorised the change and it is now in the file — two additive
lines, nothing else in the shared file touched. What follows is the record of what was
applied and what it produced. `script/m14/css-ruled.ts` is the table, in the gate's own
`Ruled` shape, with five entries (one per un-emitted type) and each `describe` carrying
its measured number and its overturn condition. `validation/m14/fixtures/css/ruled-gate.ts`
copies the gate to `/tmp` and runs it, and now reports `already present 2 of 2` instead
of applying the patches:

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

Two things to note for anyone re-deriving this. First, the `RULED_BY_LANG` literal also
carries `lua`, `toml` and `fsharp`, so the second line must be the whole literal replaced,
not an append — and the runner's `alreadyApplied` string for it is the tail
`fsharp: FSHARP_RULED, css: CSS_RULED }` rather than the whole line, because the prefix
belongs to other lanes and will change under them. Second, the runner needs **no third
patch** — unlike
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
scope symbol carries, so 2,917 at-rule scope symbols reach the store indistinguishable.**
The allowlist is deliberate and its own comment says so ("Deliberately NARROW, and
deliberately CSS-only … the keys below are the ones the CSS lane's F6/F8/CC1 checks
read"), and `isAtRule` / `atKeyword` / `isSupports` / `supportsCondition` are on it. What
is missing, measured by `css-boundary-probe.ts` over the whole admitted corpus, is:

| key | occurrences dropped | what it carries |
| --- | --- | --- |
| `isMediaScope` | 2,917 | this symbol is a media scope |
| `mediaCondition` | 2,917 | the condition text, which the NAME also carries |
| `scopeBlocks` | 2,924 | how many blocks the scope spans (new in pass 2) |
| `isPropertyRegistration` | 26 | a `@property --x` is a registration, not a declaration |
| `isLayerOrdering`, `layerIndex` | 11 each | `@layer` order statements and their index |
| `hasLayerBlock` | 7 | the symbol is a layer BLOCK, not the ordering statement |
| `cssSpecific` | 189,383 | the payload is css-specific (every symbol) |
| `hasPseudoClass`, `hasPseudoElement` | 189,383 each | the selector's shape |
| `occurrences` | 38,169 | how many sites one name was written at |
| `firstLine` | 38,169 | the first site, when `startLine` is the merge's |
| `scopes` | 31,825 | every scope a merged name was written under |

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
3. **NO ALLOWLIST CHANGE IS NEEDED, and this is new.** An earlier version of this item
   said to add `"overrides"` to `...(lang === "css" ? ["uses", "contains", "references",
   "imports"] : [])` at line ~23373. That would be wrong: the css allowlist ALREADY
   contains `overrides`, via the base disjunct at line 23153 —
   `["extends", "implements", "instantiates", …(lang !== "csharp" && … && lang !== "go" ?
   ["overrides"] : []), …]` — and css appears in none of its exclusion lists. That is
   precisely why the shared differential reports `COMPARED WITH NO TRUTH: overrides
   (1 comparable, 0 truth)` rather than omitting the label: the label IS comparable and
   the truth is what is missing. So the defect is item 2 alone, and adding the label again
   would be a no-blind-widening no-op that reads as a fix.
4. The comparison must be **line-aware for this label**, and this is the substantive
   change rather than bookkeeping. `deriveCssEdges` (line 20559) returns
   `{label, from, target}` and dedupes on `label|from|target` — no line — and the harness
   compares label + target only. But `overrides` is the one ontology type where the same
   `(source, target)` pair legitimately recurs at DIFFERENT lines: a redefinition is
   identified by WHICH declaration it supersedes, so the line is the identity. Measured on
   all 1,180 admitted files:

   | | |
   | --- | --- |
   | oracle rows derived | 68 |
   | distinct under `(label\|from\|target)` | **21** |
   | analyzer edges published | **48** |
   | analyzer edges distinct under the store key `(source,type,target,line)` | 48 |

   21 against 48. A wiring that reuses `deriveCssEdges`'s name-level dedupe compares 21
   truth rows against 48 analyzer edges and reads the difference as unexplained — turning a
   DERIVATION finding into a phantom-fabrication report. The **20 store collisions are
   certain** to land that way, because two supersessions of one name in one minified file
   are one row under a name key and two rows in the store; the other 7 involve names
   repeating across files, which the per-file harness separates and the global dedupe does
   not, so their exact fate has to be read from the shared run rather than predicted here.

The measured result is in "PASS 4" above, after the oracle's own block-boundary defect was
fixed: **48 agree, 20 MISSING of which 20 are store collisions and 0 are real gaps, 0 EXTRA**
over 1,180 files. The 0 EXTRA is the number that matters — no fabricated edge.

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

**(g) NEW IN PASS 7 — `script/m60/rel-type-coverage-gate.ts --langs=<x>` OVERWRITES the
canonical aggregate artifact with the scoped subset, and has no guard against it.**
`validation/m60/results/rel-type-coverage.json` is supervisor-owned (§8), and running the gate
scoped to this lane replaces it:

```
$ npx tsx script/m60/rel-type-coverage-gate.ts --langs=css
lanes: 1
CHECK 1 — DERIVATION: clean    CHECK 2 — REACHABILITY: clean
CHECK 3 — AGREEMENT: clean     CHECK 4 — ENUM: clean
$ git diff --stat -- validation/m60/
 validation/m60/results/rel-type-coverage.json | 1424 +-------------
 1 file changed, 6 insertions(+), 1418 deletions(-)
```

**1,418 lines deleted: the artifact goes from every lane to `css` alone, and the console says
`lanes: 1` without ever saying the file on disk is now a one-lane claim.** `script/m14/run-fixtures.ts`
refuses exactly this, in its own words — *"SCOPED run (css of 46 lanes): results are printed here
and NO evidence is written … either would shrink the milestone's claim to the lanes this run
covered"* (`run-fixtures.ts:1553`) — and `script/m14/regex-census.ts` carries a `--head` mode for
the same class of problem. `rel-type-coverage-gate.ts:595` writes unconditionally:

```ts
fs.writeFileSync(path.join(RESULTS, "rel-type-coverage.json"), JSON.stringify({ … run … }))
```

What it must do: mirror the fixture runner — when `--langs=` narrows the run, print and do NOT
write, or write to a scoped path such as `rel-type-coverage.css.json`, exactly as
`differential.ts --lang css` already declines to overwrite the canonical sweep artifact
(*"M14.0.F5 NOT written. The artifact belongs to the canonical 60-file, 43-language sweep"*).
Why it matters beyond this lane: the four CHECKS are repository-wide claims and the artifact is
what the next lane reads, so one scoped invocation silently converts a 43-lane finding set into
a 1-lane one that reads `clean` on all four checks. This lane restored the file and did not
commit it.

**The scoped result itself is worth recording, because it is the first clean reading of all four
checks for this lane:** `lanes: 1`, CHECK 1 DERIVATION **clean**, CHECK 2 REACHABILITY **clean**
(traversal default 10 of 10, parsed from `graph-engine.ts`), CHECK 3 AGREEMENT **clean**, CHECK 4
ENUM **clean**, `baseline: 104 recorded, 0 NEW, 104 repaid`, exit 0.

**Read CHECK 1 against item (c) before believing it.** This gate derives a lane's audited set by
EVALUATING `differential.ts`'s own filter expression, and the css allowlist already contains
`overrides` via the base disjunct — while `deriveCssEdges` pushes only four labels. So CHECK 1
reports `overrides` as audited when the oracle behind it does not yet derive it. The check is
reading the filter, not the oracle, and for this lane the difference is item (c).

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

**(f) `src/ast/engine.ts:1439-1444` — a corpus file that hangs the parser makes the whole
gate process exit 1 AFTER printing its verdict, so a corpus-scale exit code is not a
result.** The per-file self-destruct timer calls `process.exit(1)` when it fires, because
`parser.parse()` is synchronous WASM and a timer cannot interrupt it. Observed on
`hasura-engine/scripts/ekg/monitor.css`, which intermittently reports `memory access out of
bounds` from the wasm and then runs past 120 s. The consequence is not that a count is
wrong — it is that the count may never be finished: on this lane's runs of
`validation/m14/fixtures/css/ruled-gate.ts` the same command returned an untruncated
`emitted 5/10 … FALSIFIED 0` table with exit 0 five times and was truncated by the guard
with exit 1 three times, and a truncation that lands EARLY would print a partial table that
reads as a pass. What it must do: either scope the exit to the indexer process so a census
can finish and report which file it skipped, or have the census treat `[BB-HANG]` on stderr
as an explicit non-result. Why this lane does not do it: `engine.ts` is shared machinery
(§8), and the fix is a change to how a corpus-scale instrument reports, not to css. What
this lane did instead: `ruled-gate.ts` now captures stderr and prints
`gate exit code: N  BUT NOT A VERDICT — … [BB-HANG] …` instead of letting a truncated run
read as a red, and distinguishes a signal death from an exit code for the same reason. Note
this is the SECOND corpus file recorded hanging in this lane — `preserve-specificity/
expected.css` is in the parse-robustness findings above — so the population is at least two,
and both are recorded as files rather than as a rate.

**PASS 5 ADDED THE MEASUREMENT THIS ITEM WAS MISSING, AND IT CHANGES WHAT THE ITEM IS.**
Pass 4 could only observe that the hanging file is not a fixed one, which left the item
ambiguous between "these files are pathological" and "the timer is misfiring under load".
Pass 5 named the file the guard fired on — `spectre/dist/spectre.min.css` — and parsed
that exact file in isolation through production `parseFile`:

```
spectre.min.css -> {"ms":1063,"symbols":640,"rels":100,"errors":0}
```

**1.06 s, 640 symbols, 100 relationships, 0 errors, on a 46,656-byte file.** So the file
the guard killed the gate on is not slow and not unparseable in isolation, and the
`[BB-PARSE-ERR] memory access out of bounds` that precedes the hang is a *consequence* of
the loaded machine rather than a property of the file — the same file parsed clean minutes
later under the same wasm. **SIX** files have now been observed tripping it across this lane
(`preserve-specificity/expected.css`, `hasura-engine/…/monitor.css`, `spectre.min.css`,
`grails-core/…/stylesheets/main.css`, `spectre/docs/dist/spectre-exp.css`,
`grails-core/…/stylesheets/errors.css`) and the population is **not a property of the files**
— every one of them was observed on a run where a sibling run over the SAME corpus
finished. **Pass 8 closed the remaining gap in that argument by timing all six in
isolation, and the timings are the load measurement**: 2,977 / 1,270 / 201 / 104 / 21 / 16 ms
against a 120,000 ms budget, the slowest being 40× under it. Pass 8 also caught the
`[BB-PARSE-ERR] memory access out of bounds` being emitted for a file that is not slow —
`mobile.css` drew that line in the same run and parses to 16 symbols and 14 relationships in
**104 ms** — so the error line is a symptom of the same loaded machine, not a second
independent parser defect. Pass 6 also measured the consequence, which is the reason this item is worth
the supervisor's time rather than a file list: a truncated run still prints the full
ten-row table and `FALSIFIED 0`, with its edge counts short by 8 `uses` and 6 `contains`.
See "PASS 6" above for the four-run comparison. That narrows the fix: this is not
"exclude the three pathological files", it is "a 120 s wall-clock budget applied to
synchronous WASM on a machine with 8 lanes resident measures machine load, and the
process it kills is the one holding the result". The measurement that would confirm the
narrowed reading is a re-run of the same gate on an idle machine — which is a §8 action,
not a lane action, and is why the item stays open rather than being closed as a
file-list.

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

**PASS 4: 27 mutants, 27 caught, 0 survived. 15 fixtures pass, 0 fail**, measured
by `npx tsx validation/m14/census/css-mutant-run.ts`, which refuses to score anything
against a red baseline. 13 mutants are the pre-existing `script/m60/css-mutants.ts` set
and 14 are `script/m14/css-mutants.ts`. Five are new this round:

| mutant | direction | caught by |
| --- | --- | --- |
| `css/namespace-uri-published-as-an-import` | FABRICATION — the change that would make the differential's `MISSING=2` read zero, by republishing each `@namespace` URI as `imports` | `css/namespace-uri-is-not-an-import` |
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
- The `extends` reconciliation (pass 7): where all 46 `@extend` at-keywords live on the parse
  tree — 46 of 46 inside an ERROR node, 0 inside an at-rule, which is what makes the ruling's
  0 a property of the grammar: `validation/m14/census/css-extend-lexability.ts`
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
  Measured after the pass-4 oracle fix: 48 agree, 20 MISSING (20 store collisions, 0
  real gaps), **0 EXTRA** over 1,180 files. The 62 this previously read is corrected in
  PASS 4: 42 of them were the ORACLE flattening nested declaration scopes, not analyzer
  gaps.
- Ruling table, and the PROOF that it runs (applies the two shared-file lines to a copy
  of the gate in /tmp and runs it): `script/m14/css-ruled.ts` and
  `validation/m14/fixtures/css/ruled-gate.ts`. Gate result: `emitted 5/10 ruled-sound 5
  FALSIFIED 0 ruled-without-justification 0`, exit 0.
- Fixtures: `validation/m14/fixtures/css/` — 15 fixtures, including
  `keyframes-redefinition-overrides` and `custom-property-redefinition-overrides` for the
  type `overrides` and its block boundary, `custom-media-in-every-query-shape` for the
  one branch with 0 corpus occurrences, and `namespace-uri-is-not-an-import` for the
  `@namespace` type dispute with the shared differential
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
