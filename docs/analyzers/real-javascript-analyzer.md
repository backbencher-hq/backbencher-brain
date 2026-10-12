# real-javascript-analyzer.md

## Language

- Analyzer file: `src/ast/real-javascript-analyzer.ts`
- Parser: `tree-sitter-javascript` 0.23.1 (npm, latest release; WASM at
  `node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm`, loaded by
  `engine.ts` via `resolveWasm`)
- Language detection: extensions `.js` / `.mjs` / `.cjs` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealJavaScriptAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `class_declaration` → `name` identifier; `function_declaration`/`generator_function_declaration` → `name` identifier; `method_definition` → `name` property_identifier (constructor → `constructor`); `field_definition` → `property` (private `#x` → `x`); module-scope `variable_declarator` → `name` identifier (function-valued → Function, const → Constant, let/var → Variable); module-scope destructuring bindings → `collectPatternPairs`, **and only when the name is writable** (JSD35) |
| kind | ✅ | class → Class; function/generator/async → Function; method → Method; accessor (`get`/`set` token child) → Property; field → Property; `new`-only constructors → Constructor; prototype method (`X.prototype.m = fn`) → Method; module-scope const → Constant, let/var → Variable |
| qualified/container name | ✅ | `scope` = enclosing chain (module → class → function) joined; `ownerName`/`ownerKind` from the nearest class scope, **except for an object literal's member, whose owner is the literal's binding** (JSD37) |
| range (start/end line + column) | ✅ | `node.startPosition`/`endPosition` via `nodeToRange` |
| parameters | ✅ | `formal_parameters` → identifier / `assignment_pattern` left / destructured patterns (recorded but never symbols) / `rest_pattern` inner identifier |
| returnType / type | — | JavaScript has no type annotations; JSDoc `@returns` is not parsed (documented unsupported) |
| documentation/comments | ✅ | preceding `comment` nodes (JSDoc `/** ... */` and `//`), comment markers stripped via pure-String helpers; exported declarations (`export class X`) look past the `export` keyword wrapper to the preceding comment (fixed in post-close review, exercised by `Domain.js` file-header comments) |
| complexity metrics | ✅ | `complexity` on methods/functions (branching nodes counted iteratively) |
| syntax errors | ✅ | ERROR/missing nodes surfaced by the engine pipeline; reported as `parseErrors` in the differential |
| decorators/attributes | — | JavaScript has no decorators in the grammar (TC39 stage 3); not applicable |

## Relationship ontology

Ten types, ten verdicts. **Every number below was measured through the
production entry `src/ast/pool-worker.parseFile`** — not through `analyze()`
directly, because the two disagree (see "Two paths" at the foot of this file, and
JSD36). Every number was **re-measured at this commit**, and three rows the
previous round recorded differ from what the current tree produces; they are
marked `[re-measured]` and the reason is in "Open findings" §7.

The table's second column reads **`Emitted?`**, not `Verdict`, and that is load
bearing rather than cosmetic: `script/m14/verify-doc-truth-emissions.ts`'s
`looksLikeClaimHeader` accepts a header only when its second column contains
`emitted` or `supported`. With `Verdict` this lane's claim table was **invisible
to that gate**, which then reported `NO_CLAIM_TABLE` — "doc holds no
ontology-shaped claim table, so no emission claim is checkable". That is a check
which was off rather than passing, on the one doc whose table is the lane's whole
ontology claim. With the header as it now stands **all ten types are parsed
and graded, and the gate reports zero findings for this lane** — the last blocker
was the gate's own first-row skip, fixed this round (Open findings §10).

| Relationship type | Emitted? | Count / files | How resolved | Confidence model |
| --- | --- | --- | --- | --- |
| calls | **EMITTED** | svelte 31,940 / 3,371 files; lodash 12,555 / 47; ts corpus 64,557 / 6,516 | `call_expression` → callee leaf (member expressions reduce to leaf: `obj.method()` → `method`); source = enclosing function/method leaf name; `console.*` leaf methods filtered; `super()` filtered (language keyword); `require()` handled as import; computed/dynamic calls (`o[key]()`) filtered | 0.9 |
| extends | **EMITTED** | svelte 15 / 14; ts corpus 3,575 / 1,031; **lodash 0** (ES5 has no `class`) | `class_heritage` → base class leaf name | 1.0 |
| implements | **RULED** — the language has no `implements` clause. **Six instruments, two of them new this round and decisive** — see "What was RULED" | 0 emitted on every corpus | — | — |
| instantiates | **EMITTED** | svelte 140 / 72; lodash 586 / 21; ts corpus 6,415 / 1,264 | `new_expression` → constructor leaf name; 55 global runtime constructors filtered (`JS_GLOBAL_CONSTRUCTORS`) | 0.95 |
| imports | **EMITTED** | svelte 7,120 / 3,317; lodash 78 / 27; ts corpus 12,842 / 2,030 | ESM `import_statement` → module leaf → `${modulePath}:${item}` per item (named/default/namespace); CJS `require()` and dynamic `import()` → `${modulePath}:*`; re-export → **one row per written specifier at the name the SOURCE module declares, with `metadata.declaredName`/`declaredKind` and the specifier's own line** (shipped in the JSD40 round, analyzer and oracle in one change — the 713 statements / 790 member names this used to collapse to `${modulePath}:*` are §5); `export *` and `export * as ns` keep `${modulePath}:*` at 0.6 marked unresolved | 1.0 named/default, 0.6 for a `*` leaf (JD-J12: `*` names no symbol) |
| exports | **EMITTED** | svelte 4,856 / 3,404; lodash 60 / 12; ts corpus 26,043 / 3,148 | ESM `export` statements (declaration, export_clause, default); CJS `module.exports = { … }` (object keys), `exports.x = …` → module leaf → exported name | 1.0 |
| overrides | **EMITTED** | svelte 52 / 7 files (all at 0.5); ts corpus **630 / 148** `[re-measured, was 644 / 158]`; **lodash 0** | derived member matching base-class member name, over METHODS, CONSTRUCTORS and ACCESSOR PAIRS; an accessor pair is a prototype member, so `get x()`/`set x(v)` shadow a base accessor too, and the pair collapses to ONE edge (J10). Symbol kinds are unchanged by that widening — accessors are still kinded `property`. A `#private` name can neither be declared by a base nor shadowed by a subclass, so it is always silent (J9). Base resolved via extends + cross-file harness companion (`User.format → BaseService.format`) | 0.95 in-file verified, 0.5 first-parent guess |
| contains | **EMITTED** | svelte 654 / 63; lodash 16 / 8; ts corpus **23,121 / 3,483** `[re-measured, was 23,209]` | computed from `ownerName` on symbols (single pass) — class members, object-literal members, prototype methods | 1.0 |
| uses | **EMITTED** | svelte 30,758 / 2,544; lodash 7,691 / 48; ts corpus 215,640 / 11,901 | **Four emission sites:** bare identifier reads at 0.9 (`return config`, `if (flag)`); member-chain segments at 0.85 (`title.length` → `title`); template-substitution reads at 0.85; and the chain ROOT of a call's callee at 0.6 with `metadata.callReceiver` (`title.toUpperCase()` → `title`). The 0.6 tier exists because `calls` names only the leaf, so the receiver is named by nothing else — see X1 in `script/m14/spec/svelte-completeness.json`. `this`/`super` are excluded as keywords. **The SOURCE expression is `method \|\| owner \|\| moduleName`** — `\|\|`, not `??`, so a zero-length recovered name cannot win (JSD35) | 0.6 / 0.85 / 0.9 |
| references | **EMITTED** | svelte 26 / 15; lodash 46 / 11; ts corpus 1,533 / 574 | Carries both ways JavaScript names a type it does not own: decorator metadata (1.0) and `instanceof` (0.95). The oracle derives these in `deriveJavaScriptEdges` in a pre-pass OUTSIDE the decorator-skipping walk, so it audits those nodes rather than stepping around them. **An `instanceof` with no enclosing declaration is sourced to the MODULE, not to a placeholder** (JSD35). **The 1.0 decorator tier fires on 0 corpus rows on every JavaScript corpus measured** — 0 `decorator` nodes across svelte's 3,447 and lodash's 51 — so half this label is unexercised by real JavaScript | 1.0 decorator (unexercised), 0.95 instanceof |

`depends` is not one of the ten ontology types and is not emitted; the lane doc's
earlier "covered by imports" row was about a name the ontology does not carry.

---

## Part 1 — the six questions, per emitted type

The workstream's Part 1 asks six questions of every type a lane already emits.
Source derivation answers only the first. Each answer below carries the
measurement it rests on, and each says what the instrument cannot see.

**Instruments.** Five, all lane-owned, all reading the production entry:

| Instrument | What it answers | Artifact |
| --- | --- | --- |
| `script/m14/javascript-ontology-census.ts` | fires / resolved / confident / R7, over EVERY admitted file (no sampling — see its header for why a sample of the ts corpus lies) | `validation/m14/tmp/javascript-census-*.json` |
| `script/m14/javascript-label-oracle-agreement.ts` | correct / labelled, per label, by importing the SHARED oracle functions and applying `differential.ts`'s own comparison rule verbatim — **and, new this round, attributing every MISSING row to the production noise filter or to a real gap** | `validation/m14/tmp/javascript-label-agreement-*.json` |
| `script/m14/javascript-two-path-loss.ts` | **new this round** — what the production indexer drops that the differential measures, per label, by running BOTH entries on the same files and asking `filterNoiseRelationships` itself which rows it deletes | `validation/m14/tmp/javascript-two-path-*.json` |
| `script/m14/javascript-implements-ruling.ts` | **new this round** — the six instruments behind the `implements` ruling, including a counterfactual parse and a probe that is shown to fire on the sibling grammar | `validation/m14/tmp/javascript-implements-ruling.json` |
| `script/m14/js-ontology/js-callee-shape-census.ts` | **new this round** — how many published `calls` targets are NAMES: every row tested by the name-shape rule, each failure bucketed by the syntactic form that produced it, and the alphanumeric test §2's original table used reported beside it, so the two RECONCILE (the difference between the tests IS the `#` clause) instead of the new number replacing the old one | reads only — prints; no artifact |

**The firing check (shared harness; question 2).** `script/m14/firing-check.mjs`
is the check the workstream reports against, and this lane's row now samples
`svelte/packages/svelte/src` instead of lodash. lodash is ES5 — 51 files, zero
`class` declarations — so `extends` and `overrides` can never fire there, and the
7/10 it reported read as two SILENT types when the analyzer emits both. The svelte
ROOT starves them too: the harness caps the walk at 400 files and `benchmarking/`
reaches that cap before `packages/` does (measured 1 extends / 0 overrides at 400
files). The package source fires every emittable type at the default 120-file
sample, and `implements` alone stays silent — which is the ruling below holding on
a sample rather than a gap being hidden by one:

    JAVASCRIPT     9 types fired   120/120 parsed
       calls:3011  contains:243  exports:819  extends:3  imports:1320
       instantiates:26  overrides:2  references:19  uses:5577
       SILENT (constructible but produced nothing): implements

The block above is re-measured this round and two of its numbers moved for
attributable reasons: `imports` 1,175 → 1,320 (the JSD40 re-export round, which
publishes the members a named clause writes) and `calls` 3,022 → 3,011 (this
round's §2 fix, which stops publishing source text as a target). The type count and
the parsed count are unchanged, which is the point: the fix removed rows that named
nothing and cost the lane no emitted type.

### THE MISSING-ROW ATTRIBUTION, because it changes what every oracle number means

`svelte`, 600 files, production path:

| label | truth | analyzer | covered | MISSING | of which the production filter deletes | of which a REAL oracle/analyzer gap |
| --- | --- | --- | --- | --- | --- | --- |
| extends | 26 | 14 | 25 | 1 | 0 | **1** |
| instantiates | 63 | 63 | 63 | 0 | 0 | 0 |
| overrides | 52 | 52 | 52 | 0 | 0 | 0 |
| calls | 5,697 | 5,695 | 5,695 | 2 | **2** | 0 |
| uses | 10,602 | 10,388 | 10,388 | 214 | **214** | 0 |
| contains | 572 | 566 | 566 | 6 | 0 | **6** |
| exports | 1,966 | 1,965 | 1,965 | 1 | **1** | 0 |
| references | 22 | 17 | 22 | 0 | 0 | 0 |
| imports | 2,715 | 2,715 | 2,714 | 1 | **1** | 0 |
| implements | 0 | 0 | 0 | 0 | — | — |

**218 of the 225 MISSING rows on this draw are rows `pool-worker`'s noise filter
deletes, not disagreements between the analyzer and the oracle.** The previous
round's text read the same 225 as if they were one class; they are two, and the
split is what says whether a gap is the lane's or the harness's. `lodash`, 51
files: 21 MISSING, **21 filter deletions, 0 real gaps**.

### THE SEVEN REAL GAPS, and all seven are ORACLE over-derivation

| label | MISSING | the construct | whose defect |
| --- | --- | --- | --- |
| contains | 6 | `new (class StaleReactionError extends Error { name; message })()` — `packages/svelte/src/internal/client/constants.js:75` and `packages/svelte/src/reactivity/window/index.js:131`, 2 and 4 members | **oracle.** `jsContainerIsNameable` treats a named class expression as nameable; the lane's ruling 30 and decision X11 hold that a class expression publishes NO `Class` symbol and is owned by its BINDING, and `new (…)()` binds no name. Publishing `contains StaleReactionError -> message` would name a source no symbol carries — the dangling owner X11 removed. Measured population: 2 named class expressions in `new`-callee position on svelte, 4 on the ts corpus, 0 on lodash; **10 `contains` edges in total**, and every one is correctly absent. |
| contains | 6 | object literals with no nameable binding (`constants.js -> message`, `window/index.js -> current`, `-> constructor`) | **oracle**, same predicate. |
| extends | 1 | `return class extends Svelte4Component { … }` — `packages/svelte/src/legacy/legacy-client.js:52`, an ANONYMOUS class expression | **oracle.** The truth row carries `from: "(class)"`, a name that cannot exist, so it is unmatchable by construction: an `extends` edge needs a source and the language gives this one none. |

The fix for all three is one predicate in `script/m14/differential.ts`
(`jsContainerIsNameable`, and the `extends` truth's treatment of an anonymous
class expression) — the master's file. Reported, not taken.

### 1. calls — EMITTED
- **Fires**: 31,940 edges across 3,371 of svelte's 3,447 files; 12,555 across 47 of lodash's 51; 64,557 across 6,516 of the ts corpus's 13,202.
- **Oracle agrees**: yes, on target. 600-file svelte draw: truth 5,697 / analyzer 5,695 / covered 5,695 / **fabrication 0** / heuristic 0. lodash: truth 2,104 / analyzer 2,102 / covered 2,102 / fabrication 0. **Both corpora's 2 MISSING are `pool-worker` filter deletions, measured one by one this round** — on lodash the two targets are `text` and `parent` (`lib/main/build-site.js:115,153`, `$element.text(…)` and `.parent()`, jQuery calls), and on svelte they are the two conditional callees, dropped by the filter's `:`-split-then-`startsWith(" ")` rule rather than by `NOISE_TARGETS`. The previous round's claim that "the 2 MISSING on each corpus are the SAME defect on both sides (a conditional callee)" is **refuted for lodash**: its two are noise-leaf deletions, not ternary callees.
- **Labelled**: no neighbour. The only competitor for a call target is `uses` on the receiver, and the two are disjoint by construction (J4/X1: the callee chain's leaf is `calls`, its root is `uses` at 0.6).
- **Resolved**: **weakest type in the lane.** svelte 18,773 of 31,940 rows (58.8%) have both endpoints binding to a symbol; 12,988 targets name no symbol the run published (lodash 37.9%, ts corpus 66.1%). That is largely correct rather than broken — a call to a DOM/global/free function names no project symbol, and the lane's own contract filters `console.*` and `super()` only.
- **Confident**: uniformly 0.9. Nothing under 0.7, so nothing is a declared heuristic. **But 0.9 is a flat value, not a measurement**: the analyzer cannot distinguish a local call from a global one, so 0.9 overstates the latter. The tier is honest as "a name was written here"; it is not a probability that the name resolves.
- **R7**: 0 empty endpoints, on all three corpora.

### 2. extends — EMITTED
- **Fires**: svelte 15 / 14 files; ts corpus 3,575 / 1,031; lodash 0 (honest zero: ES5 has no `class`).
- **Oracle agrees**: svelte-600 truth 26 / analyzer 14 / covered 25 / **MISSING 1**, fabrication 0. The 1 MISSING is `extends -> Svelte4Component` from an unbound class expression — the declared silence of JSD34, not a disagreement about a name.
- **Labelled**: correct against `implements`, which this language cannot express (JSD33) and against `overrides`, which fires on the same heritage clause but from the member side.
- **Resolved**: 1 of 15 on svelte (6.7%) resolves at both ends; 12 targets name no symbol. Expected — a base class is usually imported from another file, and a single-file run cannot bind it. The corpus-wide figure is 3,155 of 3,575 (88.3%) on the ts corpus, where bases and subclasses share a file more often.
- **Confident**: uniformly 1.0, which is right for the shape (`extends B` is unambiguous) and does not claim the base resolves.
- **R7**: 0 empty endpoints; 0 placeholder endpoints.

### 3. implements — RULED (six instruments; JSD33 plus JSD38–JSD40)
Full table and reasoning in "What was RULED" below. The two decisive additions this round are **A1/A2** (the grammar package's own `node-types.json` says 118 named types and none is a supertype clause, while the same scan on the sibling `tree-sitter-typescript` returns `implements_clause` — so the scan is not blind) and **E**, the counterfactual: `class A implements B { }` parses to `(ERROR …)` with **no `class_heritage` node at all**, and `class A extends B implements C { }` puts only `B` under `class_heritage` and leaves `implements C` as an ERROR sibling. The falsifier is therefore a single predicate: **a real multi-supertype clause is a `class_heritage` with more than one named child and no ERROR anywhere in it.** Measured: 0 such clause on svelte (18 clauses, 0 multi), 0 on lodash (0 clauses), **97** on the ts corpus — and **all 97 sit inside an ERROR node** (`ERROR+identifier` 86, `ERROR+binary_expression` 11), produced by `extends (0, __extends)(A, B)` helper output and `extends A, B`, neither of which is JavaScript. The previous round reported "multi-supertype clauses 8" from a counter capped at 8 in the census instrument; the structural count is **97**. The first version of this round's own ruling instrument repeated the same cap and printed 40, and the census's shape table — which had accounted for all 97 independently — is what caught it.

### 4. instantiates — EMITTED
- **Fires**: svelte 140 / 72; lodash 586 / 21; ts corpus 6,415 / 1,264.
- **Oracle agrees**: svelte-600 63/63/63, fabrication 0. lodash-51 88/88/88, fabrication 0.
- **Labelled**: disjoint from `calls` on `new X()` by construction (the analyzer has a separate `new_expression` branch; the oracle a separate one too).
- **Resolved**: svelte 56 of 140 (40.0%), lodash 99 of 586 (16.9%), ts corpus 5,288 of 6,415 (82.4%). The lodash figure is the honest one to quote for ES5: lodash constructs `Object`, `Function` and primitives, which `JS_GLOBAL_CONSTRUCTORS` filters — so the surviving rows are `new lodash.X` style constructions whose leaf resolves to nothing.
- **Confident**: uniformly 0.95. Above the fabrication threshold, and no evidence that 0.95 distinguishes a local class from an imported one — it does not.
- **R7**: 0 empty; 19 `default` targets on the ts corpus, which is a written name (`exports.x = new b_1.default()`), not a placeholder.

### 5. imports — EMITTED
- **Fires**: svelte 7,120 / 3,317; lodash 78 / 27; ts corpus 12,842 / 2,030.
- **Oracle agrees**: svelte-600 truth 2,715 / analyzer 2,715 / covered 2,714 / fabrication 0 / heuristic 1. lodash-51 78/78/78, fabrication 0. **The doc's earlier claim that "the JS oracle derives no import truth" is HISTORICAL** — `deriveJavaScriptImportEdges` exists and the label is in the compared set; the claim was true on 2026-09-27 and is not now.
- **Labelled**: correct; disjoint from `references` (which carries `instanceof`/decorators) and from `uses`.
- **Resolved**: 7,065 of 7,120 on svelte (99.2%), 74 of 78 on lodash (94.9%), 12,794 of 12,842 on the ts corpus (99.6%) — the strongest type in the lane, because `<module>:<item>` binds through the item and the resolver has `declaredName`/`declaredKind` metadata to reach the right symbol. **The one unresolved row on the svelte draw is `imports -> ./text.js:text` from `packages/svelte/src/compiler/phases/1-parse/state/fragment.js`, and it is a noise-filter deletion: `text` is in `NOISE_TARGETS` and an import BINDING is not a declaration this lane publishes, so the filter's escape hatch cannot fire for it.**
- **Confident**: two tiers, and the split is the right one: 1.0 for a named/default import (2,345 of 2,715 on svelte-600), 0.6 for a `*` leaf (370), which names a module and no member. All 464 sub-0.7 rows on svelte are `*`-leaves and are declared `metadata.unresolved: true`.
- **R7**: 0 empty.

### 6. exports — EMITTED
- **Fires**: svelte 4,856 / 3,404; lodash 60 / 12; ts corpus 26,043 / 3,148.
- **Oracle agrees**: svelte-600 truth 1,966 / analyzer 1,965 / covered 1,965 / fabrication 0. lodash-51 59/59/59, fabrication 0.
- **Labelled**: correct. **Concentration warning**: on the ts corpus the largest single file contributes 15,000 of 26,043 rows (`tsc/testdata/baselines/reference/compiler/manyConstExports(target=es2015).js`, 5,000 distinct targets). A sample of that corpus reports a headline `exports` number decided entirely by whether that one synthetic baseline is in the draw — measured: a clean-file sample of 600 reported 15,701 `exports` rows (95.5% from that file) against 597 for the unfiltered 600. This is why the census admits every file and reports a per-file maximum.
- **Resolved**: svelte 1,716 of 4,856 (35.3%); the unresolved targets are `default` (2,958 of the 2,970 written-name rows) — `exports.default = RIL` and `export default function f` really do export the name `default`, and no symbol carries it. Honest, and the reason `exports` looks weak on resolution.
- **Confident**: uniformly 1.0. Correct: the exported name is written in the file.
- **R7**: 0 empty.

### 7. overrides — EMITTED
- **Fires**: svelte 52 / 7 files; ts corpus **630 / 148** `[re-measured at this commit; the previous round recorded 644 / 158]`; lodash 0 (ES5 has no classes to override).
- **Oracle agrees**: svelte-600 truth 52 / analyzer 52 / covered 52 / fabrication 0. lodash 0/0/0 — a **vacuous zero**, not a pass: lodash has no `extends` clause at all, so nothing is derivable and nothing is checked. Stated so the row is not read as agreement.
- **Labelled**: correct against `extends` (the clause) and `contains` (the member).
- **Resolved**: **0 of 52 on svelte.** Every target is `Base.member` where `Base` is imported from another file, and a single-file run cannot bind it. On the ts corpus 220 of 630 (34.9%) resolve at both ends. **After the JSD54 fix below, the STORE agrees with this number instead of contradicting it** — the 600-file draw reads `overrides 52 / detached 52 / correct 0 / attach 0.0%` — where before the fix the store bound rows of this type to the row's own method and a 250-file draw could be read as `2 of 2` resolved.
- **Confident**: **every svelte row is at 0.5 — 52 of 52, i.e. every row of the type on that corpus is a declared guess** (`evidenceClass: inferred`, `reasonCode: first-parent-guess`). On the ts corpus 408 of 630 (64.8%) are at 0.5 and 222 at 0.95. The lane's J9 measured the guess's false rate (7 wrong rows of 44 on an earlier corpus, the rest confirmed members of the base they name) and kept the tier deliberately rather than deleting 37 correct rows to remove 7 wrong ones. That trade is recorded here so a consumer can filter on `confidence >= 0.7` and know it is discarding every cross-file override this analyzer emits.
- **RESOLVED (2026-10-12, measured before AND after): a row of this type used to be bound to the row's OWN method — a self-edge.** Filed as spec gap **JSD54 OPEN** when both arms of `script/m14/tmp/ab-override-target-probe.ts` failed; landed now at both sites, label-scoped to this type. The defect was two sites and both are SHARED with every lane: `storeResults`' own-file leaf lookup resolved an `overrides` target inside the file that emits the row — which declares the OVERRIDING method by construction, so the leaf could only ever match the row's own source symbol — and Strategy 3 of `resolveRelationships` bound a base no project file declares to `MIN(sym.id)` among ALL same-named symbols (`Error.toString` → anything named `toString`). **AFTER**: the probe PASSES both arms (exit 0) — CONTROL `Derived -> Base.m` binds to `m (Base.m) @ c.js`, the PROJECT base's own member, and BUILTIN `Bar -> Error.toString` reads `NULL @ -`, detached because no project symbol declares it — and on the 250-file draw the census moves `overrides 2 edges / detached 0 -> 2 / correct 2 -> 0 / attach 100.0% -> 0.0%`, both rows from `(resolved to toString)` to `(resolved to -)`; the detached split reads `2 detached / 0 bindable / 2 nowhere`, i.e. `toString` is declared by no file in the sample, so detachment is the honest answer and not an unfinished one. The 600-file draw detaches all 52 the same way (the `SvelteSet -> Set.has/add/delete/clear/keys/values/entries/size` family, `SvelteURLSearchParams -> URLSearchParams.append/delete`), the census's overrides oracle splitting them 0 no-owner / 5 no-persisted-hierarchy / 0 VERIFIED / 47 NOT verified. A method overriding itself is a claim no consumer can be right about, and no row of either draw carries one now. The gates this shared-path change owes were run on the final bytes: store-path parity 8/8, resolution determinism 8/8 (250 files, 19855 rows and 1172 symbols both runs, 0 divergent), the fixture suite javascript 77/0 and svelte 53/0, src typecheck clean. Record: spec gap **JSD54, status RESOLVED**; artifacts `validation/m14/measurements/store-resolution-jsd54.before.log`, `.after.log`, `.after.json`. **One shape is absent from the corpus rather than unmeasured: an override whose base is an IN-PROJECT ancestor on real code.** A scan of every `.js/.mjs/.cjs` file of the six corpora this lane draws on finds a cross-file `class X extends Y` in ONLY svelte, and there exactly three sites — `InternalCompileWarning extends CompileDiagnostic` (twice) and `MediaQuery extends ReactiveValue` — of which neither can emit a row of this type: `InternalCompileWarning` declares a field and a constructor and no method, `MediaQuery` only a constructor, and this lane's J2 ruling never pairs a constructor (pinned by `override-qualification`'s `forbidRelationships`). lodash, vue-core, shadcn-svelte, element-plus and vue-element-admin contain no cross-file inheritance in JS at all. That is a CORPUS hole, not a resolution failure: the positive case is covered by the probe's CONTROL arm, and the honest reading of this type's `0.0%` attached is "no base inside the project", not "resolution attempted and failed".
- **R7**: 0 empty.

### 8. contains — EMITTED
- **Fires**: svelte 654 / 63 files; lodash 16 / 8; ts corpus **23,121 / 3,483** `[re-measured at this commit; the previous round recorded 23,209]`.
- **Oracle agrees**: svelte-600 truth 572 / analyzer 566 / covered 566 / **MISSING 6, and all 6 are attributed this round** — every one is a class expression the oracle finds "nameable" and the lane deliberately does not publish a symbol for. Fabrication **0**. See "THE SEVEN REAL GAPS".
- **Labelled**: correct, and it is the type most at risk from a neighbour: `contains` vs `extends` vs `overrides` all originate from the same `method_definition`. The oracle deliberately does NOT model the analyzer's owner logic — it asks whether the container is nameable — which is what caught the owner defect below.
- **Resolved**: 645 of 654 on svelte (98.6%), 12 of 16 on lodash, 22,624 of 23,121 on the ts corpus (97.9%). The strongest structural type.
- **Confident**: uniformly 1.0 — the only tier, and the right one: containment is derived from `ownerName` on a symbol this analyzer itself published, so both ends are symbols by construction. The 6 MISSING are the declared silence, and this round established WHERE the silence is: one shape, `new (class Name { … })()`, 6 members on svelte and 4 on the ts corpus.
- **R7**: 0 empty; 1 `global` target on svelte and 4 `self` on the ts corpus, all written tokens (`global x`, `self() {…}` in TypeScript recovery).

### 9. uses — EMITTED
- **Fires**: svelte 30,758 / 2,544; lodash 7,691 / 48; ts corpus 215,640 / 11,901. The largest type by volume in the lane.
- **Oracle agrees**: svelte-600 truth 10,602 / analyzer 10,602 / covered 10,602 / fabrication 0 / **MISSING 0**, and lodash-51 truth 3,470 / analyzer 3,470 / covered 3,470 / **MISSING 0**. These rows were 214 and 19 until this round: every one was attributed to `pool-worker`'s noise filter (0 to a real gap), the named leaves being `type`, `parent`, `text`, `firstChild`, `lastChild`, `nextSibling` — real reads of real code the product discarded. §1 closes it, and the re-measure is through the production entry with the filter's own attribution column reading `filter 0 / real 0` on both samples.
- **Labelled**: correct, and the four sites are disjoint by construction (bare read / chain segment / chain root / template substitution), each with its own `metadata` marker so a consumer can tell them apart.
- **Resolved**: svelte 12,708 of 30,758 (41.3%); lodash 3,299 of 7,691 (42.9%); ts corpus 140,986 of 215,640 (65.4%). This is the lane's weakest resolution and it is intrinsic: a `uses` target is a name the file READS, and most reads are of things the file does not declare (a local, a parameter, a DOM property, an imported binding).
- **Confident**: three tiers, and the split is the honest shape of the evidence — 0.6 (30,032 of 30,758 on svelte), 0.85 (223), 0.9 (the remainder). **97.6% of the type is below the 0.7 fabrication threshold**, i.e. declared heuristic. That is the correct reading: a bare read of a name is a real syntactic fact, but whether the name denotes anything in the graph is not, and 0.6 says so.
- **R7**: 0 empty endpoints, 0 empty sources — **fixed this round**, 2,037 rows on the ts corpus (JSD35). 0 on svelte and lodash both before and after, which is why no clean-corpus gate had seen it. **Re-read 2026-10-12 on the 250-file svelte and lodash draws** (`js-ontology/js-census.ts`): every one of the ten rows reads `empty 0`, and the two rows this draw used to CONVICT as placeholder-literal endpoints (`gather_possible_values -> UNKNOWN`, `get_possible_values -> UNKNOWN`) are now REPORTED as written-name collisions — `packages/svelte/src/compiler/phases/2-analyze/css/utils.js:3` declares `const UNKNOWN = {}` and reads it, so that spelling is a name the source WROTE, the same class this list already had to stop convicting for `Na` and `null`. The conviction is now a function of the spelling, the emitting file's own text and the names that file declares (`convictsPlaceholder`), and it is exercised on its own arms — including three that must still convict — by `js-ontology/js-r7-probe.ts`: **7 of 7 arms**. The A/B is on real data with the conviction rule as the only variable: the pre-fix census (materialized from the commit before the fix, and shown to BE pre-fix — `grep -c convictsPlaceholder` = 0) and the fixed one read **byte-identical output on lodash** and differ on svelte in **exactly two lines** (`uses` placeholder `2 -> 0`, and the header moving from `R7 PLACEHOLDER-LITERAL ENDPOINTS` to the written-name line), so the change removes a false positive WITHOUT removing the rule.

### 10. references — EMITTED
- **Fires**: svelte 26 / 15 files; lodash 46 / 11; ts corpus 1,533 / 574. The smallest type, and the only one carrying two distinct constructions under one label.
- **Oracle agrees**: svelte-600 truth 22 / analyzer 17 / covered 22 / MISSING 0 / fabrication 0. lodash-51 truth 46 / analyzer 39 / covered 46 / MISSING 0 / fabrication 0. (Analyzer rows are fewer than truth rows because the comparison collapses to one row per (label, target) and five truth targets are reached by fewer published rows.)
- **Labelled**: correct against `uses` (which carries reads) and `imports` (which carries module dependencies). The two constructions inside the label are separated by `metadata.relationshipType: "instanceof_check"` and `metadata.isDecorator`, so they are distinguishable downstream.
- **Resolved**: svelte 5 of 26 (19.2%), lodash 32 of 46 (69.6%), ts corpus 1,398 of 1,533 (91.2%). The low svelte figure is the `instanceof` half: `x instanceof SomeImportedThing` names a type this file does not declare.
- **Confident**: 1.0 for a decorator (the name is written in the file), 0.95 for `instanceof`. Nothing under 0.7. **The 0.95 does not distinguish an imported type from a local one**, which is the same overstatement `calls`' 0.9 carries and for the same reason.
- **R7**: 0 empty; **0 `global` sources — fixed this round** (116 rows on the ts corpus, 14 on lodash, 1 on svelte; JSD35). Every remaining "placeholder-looking" endpoint on this type is 0.

---

## What was RULED, and the measurement that rules it

| Type | Verdict | The measurement |
| --- | --- | --- |
| implements | **RULED** — JavaScript has no `implements` clause, and the pinned grammar cannot express one | **Six instruments, two of them new and decisive this round.** (A1) The grammar package's OWN `node-types.json`: `tree-sitter-javascript@0.23.1` declares **118** named types and the only supertype-shaped names are `class_heritage` and `super` — no `implements_clause`, no `interface_declaration`. (A2) **The probe is shown to fire:** the same scan over the sibling `tree-sitter-typescript` returns **183** named types including `implements_clause`, `interface_declaration` and `abstract_class_declaration`, so A1 is measuring the grammar and not failing to look. (B/C) Parse-tree count on the corpora: 18 / 0 / 4,428 `class_heritage` clauses on svelte / lodash / ts; the only anonymous token under one is `extends` at a 1:1 ratio (18/18, 0/0, 4,428/4,428); `implements` token **0** everywhere; multi-named-child clauses 0 / 0 / **97**, and **all 97 contain an ERROR node**. (D) JSDoc `@implements`: 1 / 0 / 45 occurrences. (E) **Counterfactual, new:** `class A implements B { }` parses to `(class_declaration name (ERROR …) body)` — **no `class_heritage` at all**; `class A extends B implements C { }` puts only `B` under `class_heritage` and leaves `implements C` an ERROR sibling; `class A extends B, C { }` yields `class_heritage (ERROR (identifier)) (identifier)`. (F) **Resolvability, new:** of the tags instrument D found, **0 name a type declared as a symbol anywhere in the corpus** — svelte's single tag names `ICompileDiagnostic`, which is declared in `packages/svelte/src/compiler/types/index.d.ts`, a TypeScript declaration file; the ts corpus's 45 name types no JavaScript file declares. Falsifier: **a `class_heritage` with more than one named child and no ERROR in it**, or a supertype-shaped node type in A1. Full text and reasoning: `script/m14/spec/javascript-completeness.json` JSD33, JSD38, JSD39, JSD40 |

**Why (D) does not overturn the ruling, argued rather than asserted.** A JSDoc
tag is the one place the JavaScript ecosystem spells the word, so it deserves an
answer and not a dismissal. Three things decide it. First, it is a **comment**:
the JS grammar has no node for it, so it cannot be derived from the tree the way
every other edge in this lane is, and deriving it means writing a JSDoc parser
that this lane has deliberately declined for every other tag (`@param`,
`@returns`, `@type` are all documented unsupported, because JavaScript has no
runtime types). Second, (E) shows the language has nowhere to PUT the edge: there
is no interface declaration for the target to bind to. Third, and decisively,
**(F) measures it**: not one `@implements` tag on any of the three corpora names a
type any JavaScript file declares. An `implements` edge built from those tags
would be a graph of targets nothing binds — 46 edges whose every endpoint is
unresolvable — which is a decoration, not a relationship. The ruling stands, and
(F) is what makes it falsifiable rather than a matter of taste.

**The arbiter's own verdict, over the WHOLE admitted corpus (re-run 2026-10-12 at
the tree that ships).** `ontology-coverage-gate.ts javascript --fresh` parsed
**12,805/12,805 files (100.0%, newly walked 12,805)** — a fresh walk, not a
resumed checkpoint, because the gate refuses by design to adjudicate one it did
not parse — and read the table type by type: `calls` 643,407 edges, `uses`
511,573, `contains` 31,832, `exports` 28,366, `imports` 18,813, `instantiates`
9,275, `extends` 2,443, `overrides` 1,475, `references` 1,397, every one of them
`EMITTED` in 4+ files; and `implements` **`RULED-SOUND` — "NOT EMITTED; the
grammar produced 215 distinct node types across the corpus and NONE expresses
it"**. The verdict line is `emitted 9/10   ruled-sound 1   FALSIFIED 0
ruled-without-justification 0`, i.e. nothing is claimed inapplicable that is
derivable, and nothing is left silent without a ruling. (`--coverage` is a
different mode and is NOT this: it lists the lanes the arbiter can rule for and
exits before any verdict — which is why the earlier attempt at this reading
produced a preamble and no table.)

The gate that arbitrates this is `script/m14/ontology-coverage-gate.ts`. Its
`JAVASCRIPT_RULED` entry now exists — `script/m14/javascript-ruled.ts`, registered
as `RULED_BY_LANG.javascript` — so the lane is adjudicated on a corpus probe
(instrument A over `implements_clause`, `superclass`, `interface_declaration` and
`extends_clause`) rather than on spec prose, and a node type that would mean the
construct fails the gate instead of decorating it.
`script/m14/verify-ruling-tables-registered.ts` confirms the file and the registry
agree. The instrument is `script/m14/javascript-implements-ruling.ts`; re-run at
this commit over the typescript corpus (6,124 admitted files) it measures the
grammar at 118 named types with none a supertype clause, the same scan finding
`implements_clause` in the sibling typescript grammar, 1,502 corpus `class_heritage`
clauses carrying 0 `implements` tokens, and all 23 multi-named-child clauses inside
an ERROR node. The written ruling is JSD33/JSD38–JSD40.

RUN at this commit (`ontology-coverage-gate.ts javascript --fresh`, 11,422 admitted
js-family files across the whole corpus root): the verdict table reads `implements
RULED-SOUND` off `script/m14/javascript-ruled.ts` — instrument A, "the grammar
produced 215 distinct node types across the corpus and NONE expresses it" — with
`emitted 9/10`, `FALSIFIED 0`, `ruled-without-justification 0`, exit 0. The nine
emitted types include `extends` 2,328 edges and `overrides` 1,402, so both
class-based types fire at corpus scale as well as in the 120-file firing sample
above. Run log: `validation/m14/tmp/javascript-gate-run.log`.

---

## Standing rule R7 — measured, not asserted

R7 has a static half (a placeholder literal at a source site) and a runtime half
(no emitted row may carry a placeholder or an empty string as a name). This lane
has **zero registered R7 sites statically** — `script/m60/sentinel-census.ts`
reports javascript absent from its 48-violation table — and the runtime half did
**not** hold. Three defects, all measured through `pool-worker.parseFile`, all
fixed 2026-10-03 (JSD35):

| # | Defect | ts corpus (13,202 files) | svelte | lodash | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | an edge with an EMPTY endpoint, from a zero-length node in error recovery | 2,037 of 356,490 edges (1,934 `uses` bare reads, 87 chain segments, 5 template substitutions, 7 empty SOURCES, 3 `calls`, 1 `exports`) | **0 before, 0 after** | **0 before, 0 after** | a terminal guard dropping any row with an empty endpoint — mirroring the guard `differential.ts` already applies to its truth side (M60/SDJ-17) |
| 2 | `references` sourced from the literal `"global"` | 116 rows / 51 files | 1 | **14** | source it to the module, the convention `extractExportRelationships` and the `uses` walk already apply |
| 3 | a symbol named the empty string, from a zero-length pattern identifier | 32 of 115,356 symbols | 0 | 0 | `collectPatternPairs` requires a writable name |

After: 0 / 0 / 0 empty endpoints, 0 `global` sources, 0 empty names
(115,356 → 115,324 symbols).

**Two things this census deliberately does NOT count as R7, and the reason.**
`default` as an exported name (`exports.default = RIL`, `export default function
f`) is a written name — 2,970 rows on svelte — and `module` / `this` / `super` /
`self` as a read or call target are language-supplied tokens the file writes
(21 `module` reads on svelte). Counting them as placeholders convicts the lane for
being right; the combined figure would read ~3,100 sites where the register that
matters holds 2,037 + 116 + 32.

**A static-census blind spot, reported.** `script/m60/sentinel-census.ts`'s
MARKER is the single literal `unknown` (regex `^(?:<|\()?unknown(?:\)|>)?$`), so
a lane that invents `global`, `?`, `<anon>` or `n/a` passes the static gate
outright. Defect 2 above is exactly that lane, and only the runtime half caught
it — which `validation/m60/symbol-sentinel-register.json` records as measured for
csharp only.

---

## Open findings, measured, not fixed here

Each carries the number, because a finding without one is a complaint. **Two of
them are no longer open** — §2 (a `calls` target must be a name) and §5 (the named
re-export clause's members) are fixed, each with the analyzer and the oracle moved
in one change, and their headings say so. The §2 heading's "1,236" stays as the
finding's original measurement; §2 carries the post-fix numbers, the falsification
arm and the mutant beside it, because a fixed finding whose number is quietly
replaced by the new one leaves no way to check the claim.

### 1. `pool-worker.filterNoiseRelationships` deletes this lane's relationships, and the differential cannot see it — INSTRUMENT COMMITTED, BOTH HALVES FIXED THIS ROUND (binding hatch + collision rule), loss now MEASURED AT ZERO

`text`, `type`, `parent`, `firstChild`, `lastChild`, `nextSibling`, `startIndex`
are web-tree-sitter Node accessor names, and they are in `NOISE_TARGETS`. The set
has an escape hatch — a name the file DECLARES survives — which cannot fire for
an **import binding**, because a binding is not a declaration this lane
publishes. So `import text from './text.js'` loses both its `imports` edge and its
`uses` edge, and nothing else in the tree notices.

**The instrument is new this round.** The finding previously rested on a probe in
the git-excluded `script/m14/tmp/`, which is not reproducible from the commit —
a reader could re-run the census and the per-label differential and neither would
reproduce it. `script/m14/javascript-two-path-loss.ts` runs BOTH entries on the
same files and asks `filterNoiseRelationships` itself which rows it deletes
(rather than copying `NOISE_TARGETS`, which is how an instrument ends up
re-stating a rule that has since moved):

| sample | engine rows | pool rows | lost by COUNT | lost by SET | % of engine | gained |
| --- | --- | --- | --- | --- | --- | --- |
| svelte, 600 files | 36,726 | 36,256 | 470 | **381** | 1.037% | 0 |
| lodash, all 51 files | 21,063 | 21,032 | 31 | **27** | 0.128% | 0 |
| ts corpus, 1,500 files | 31,010 | 30,840 | 170 | **155** | 0.500% | 0 |

**THIS TABLE IS SUPERSEDED AND IS KEPT AS THE OPENING MEASUREMENT, NOT AS THE CURRENT ONE.**
It was taken while the instrument asked the filter with the language argument only, so it
counted rows production keeps (see the correction in §1). Re-measured the way production
asks the filter, on the same two corpora and the same sample sizes:

| sample | engine rows | pool rows | lost | gained |
| --- | --- | --- | --- | --- |
| svelte, 600 files | 36,881 | 36,881 | **0** | 0 |
| lodash, all 51 files | 20,898 | 20,898 | **0** | 0 |

(Engine totals differ from the table above by +155 / −165 rows because the analyzer itself
moved between the two runs — §2's name-shape rule, §5's re-export clause and the `exports`
forwarding fix all land on the same corpora. The comparison that matters is engine vs pool
WITHIN a run, and that is now row-for-row.)

**Two numbers, and the difference is not noise.** The COUNT delta is 470 and the
SET delta is 381 on svelte. The 89-row gap is duplicate rows: the engine emits
byte-identical `(source, target, type, line)` tuples more than once, so a count
subtraction charges the filter for rows that were never unique. Both figures are
quoted because the previous round reported only the count delta and this round's
set-based instrument is the stricter one. `gained = 0` on all three samples,
which is what makes "the filter only deletes" a measurement rather than an
assumption — and it holds at `0` on both re-measured corpora above, before and
after every fix in this section.

Per label on the svelte 600-file sample: `uses` 373 lost (`type` 258, `parent` 89,
`text` 14, `lastChild` 6, `firstChild` 4, `nextSibling` 2), `calls` 2, `contains`
3, `imports` 1, `exports` 2. On lodash: `uses` 23 (`type` 11, `text` 4,
`lastChild` 3, `firstChild` 2, `parent` 2, `startIndex` 1), `calls` 4 (`text` 2,
`parent` 2 — `$element.text(…)` and `.parent()` in
`vendor/underscore/test/*.js` are real jQuery calls). On the ts sample: `uses`
126 (of which `type` 120 — TypeScript type annotations read as identifiers),
`calls` 17, `contains` 5, `imports` 6, `references` 1.

**The instrument also names the mechanism, which the count alone did not.** Every
one of these rows had a target leaf the filter would keep IF THE FILE DECLARED
THE NAME (the `would-survive-if-declared` column). So the loss was never "the filter
blocks these names" — the filter's declaration escape hatch is doing its job — it was
"the hatch is unreachable for a name the file only READS, CALLS or BINDS". That
classification is what set the terms of the fix: reach the hatch for the names the source
wrote, and leave it shut for everything else.

**THE IMPORT-BINDING HALF IS FIXED (this round, `src/ast/pool-worker.ts`).** The
hatch admitted only names the file DECLARES, and tested the WHOLE target against a
set of symbol names. Both had to change for the case this finding names, and neither
change is a widening of the noise list:

- `importBindingNames()` builds the set of names the file BINDS — the escape hatch's
  own reasoning is "an analyzer that leaks `node.type` emits a name the file never
  mentions", and `import text from "./text.js"` is a name the file DOES mention;
- the hatch is now tested on the **leaf**, because the target of an `imports` row is
  path-spelled (`./text.js:text`) and a symbol-name set can never match that string.

Measured on the production entry, not inferred: for a probe file importing three
noise-listed names, the pool path went from dropping `uses f -> text`, `uses f -> type`,
`imports (file) -> ./text.js:text` and `imports (file) -> ./x.js:type` to keeping all
four — while `uses f -> parent`, a property read on a name the file neither declares nor
binds, was still deleted at that point. That half is the collision rule below, and it is
fixed in this same round; the sentence that used to close here ("the half that is not
mine to decide") was written before the discriminator had been measured and does not
survive it.
On the svelte 600-file sample this change alone recovers 3 rows (`uses` 17,815 → 17,816,
`imports` 2,880 → 2,882, `gained` still 0), and the SET-based total does not move at that
step because the recovered rows share `(source, target, type, line)` keys with rows the
filter already kept — the duplicate-key effect the two-number rule above records, now
visible from the other side.

**THE REST IS FIXED TOO — the "policy decision" paragraph that used to close this
section is SUPERSEDED, and not by a decision to widen the list.** What remained after the
binding hatch was 354 lost rows on svelte and 21 on lodash, all of them noise-named
targets the file neither declares nor binds. The question was whether admitting them
would let back in the bug the list was written for. It would not, and the discriminator is
recorded by the ANALYZER rather than guessed from the name: **a noise-named target the
analyzer recorded as a read it derived from source structure is a real read; a leak — an
analyzer passing `node.type` where a symbol name belongs — carries no such marker at all.**
Three markers, each added against a measurement, and the ladder is the two-path
instrument's `lost` column (per file, with production's own declared/bound arguments):

| step (each row = that rule step ADDED) | svelte, first 600 `.js` | lodash, all 51 `.js` |
| --- | --- | --- |
| binding hatch only (no collision rule) | 354 of 36,881 (0.960%) | 21 of 20,898 (0.100%) |
| + member reads (`metadata.isFieldAccess`) | 10 | 4 |
| + member calls (`metadata.calleeExpression` dotted) | 10 | 0 |
| + template interpolations (`metadata.isTemplateInterpolation`) | **0** | **0** |

`gained 0` at every step, before and after: the filter only ever deletes, and the two
paths now agree EXACTLY on both samples — 36,881 = 36,881 and 20,898 = 20,898 rows, so
nothing this analyzer emits for these files is dropped on the way to the graph.

**A third corpus, and the row that is NOT this finding.** The `typescript` repo's `.js`
files (1,500 admitted) re-measure at engine 25,664 / pool 25,656 / **4 lost / gained 0**,
and those 4 are a different defect class, named rather than folded in: three are
`contains C123 -> [s: string]` index-signature members and one is a multiline
`instanceof` recovery target (`references (file) -> fs.File; var hex = 0xBADC0DE`). None of
the four targets a `NOISE_TARGETS` name — they are deleted by the universal identifier
sanitizer (bracket, whitespace and newline shapes), which is unchanged by this section and
is not measured by the finding's leaf classification. Stated because a `lost` column that
reads 0 twice and 4 once invites the reader to assume the 4 are noise-name rows; they are
not, and the instrument's `lost` is "the filter deleted it", a superset of the noise list.

**The ladder is derived, not asserted**, and that is the check on it: each row of the
collision-rule-less baseline was classified by the marker it carries, the residual after
all three
steps is 0, and the endpoints are real runs of the rule. A residual of 0 is also the
statement that **the rule never had to admit an unmarked row** — the leak shape is still
refused, which is a negative case in the gate rather than a hope.

**A correction to the first recording of these numbers, kept visible.** The ladder was
first written as `378 → 16 → 0` (svelte) and `4 → 0` (lodash), and the sections above
still carry those figures as what they were. They were measured while the instrument asked
the filter with **only the language argument**, whereas production
(`pool-worker.ts:1432`) passes the per-file declared and bound names too — so that
configuration counted rows production KEEPS as lost, and the artifact said so itself:
`imports 2 lost` on a sample where production had lost none, one of the two being
`phases/1-parse/state/fragment.js` / `import text from './text.js'`, the exact
import-binding case the hatch was added for. The instrument is now per-file and
production-configured; every figure in this section's ladder is from it, and the earlier
ones are superseded rather than adjusted. (The same defect the whole finding is about —
an instrument describing a path the product does not run — committed by this lane's own
instrument, caught by comparing its column against production's own counts.)

**WHAT STILL GETS DELETED, and why that is the right shape:** a collision target with NO
recorded marker — the leak — and the universal test-lifecycle group (`setUp`,
`tearDown`, `beforeEach`, `afterEach`), which the rule deliberately does not cover even
in a member position (`this.setUp()` is framework noise in every language). A language
outside the JS family skips the accessor list entirely rather than having it applied by
a rule that reads metadata (the M60 LUA-16 exemption, which recovered 345 real Lua
`type()` stdlib calls).

**Pinned by a gate, because no fixture can reach this file.** `filterNoiseRelationships`
is called by no fixture in the tree: svelte/vue fixtures go through
`ASTEngine.parseFile` and the rest run their analyzers directly. So the pin is
`script/m14/js-ontology/js-filter-hatch-probe.ts`, now **15 cases through the filter
itself**, in two groups:

- the binding hatch — declared name survives; an import binding survives bare, as a
  path-spelled target, as a local alias (`import { other as type }`) and under the
  imported spelling (`parent as par`);
- the collision rule — a marked member read, member call and template interpolation are
  all admitted; a BARE target with no marker and a bare undotted call are still refused;
  the same marked row is exempt in a language outside the family; and the universal
  group keeps its full force in a member position;
- plus the negatives that keep the positives honest: a name the file neither declares nor
  binds is refused, including when nothing is passed at all.

Wired: **15 of 15 pass, exit 0**. Falsified in BOTH halves, independently, with the file
restored byte-identically afterwards (`sha256` checked): disable the collision rule and it
reads **3 fail** — exactly the three marker cases — and disable the bound-names hatch and
it reads **4 fail** — exactly the four binding cases — with every negative still passing
in both runs. The first versions of this gate each contained a case that could not fail
(a target not in `NOISE_TARGETS`; a `python` expectation of `false` that asserted the
opposite of the M60 exemption's actual behaviour) and both were replaced, because a green
assertion that cannot fail is the defect this whole section is about.

**NOTHING IS LEFT OPEN IN THIS FINDING.** It was carried for two rounds as "instrument
committed, one half fixed, the rest a policy decision with its number", and the policy
paragraph's two premises do not survive measurement. It said the bulk of the loss is
property reads on names nothing in the file introduces; the measurement is that 344 of
the 354 remaining rows on svelte (97.2%) are **reads the analyzer recorded as reads it
derived from source structure**, and the last 10 are template interpolations of function
parameters. It said admitting them "changes the production graph for every language"; the
rule is scoped to the JS family by the same `NOISE_TARGET_FAMILIES` lookup the M60
LUA-16 fix established, and a non-family language skips the list altogether, so the
graphs it can change are the ones this lane owns. Both are now asserted in the gate rather
than argued in prose.

The residual after the rule is **0 lost, 0 gained on both samples** — the number the
finding was opened for, reached, and pinned.

**Why no gate saw it, and this is the part that generalises.** Every differential
figure for javascript describes the `ASTEngine.parseFile` path, while the product
indexes through the pool worker. So a lane can publish 0 unexplained, 100%
covered and 0 MISSING while the graph a user queries is missing rows. The
per-label instrument now sees it from the other side and attributes every row — at the
height of the finding that read `on svelte 218 of 225 MISSING rows are filter deletions,
on lodash 21 of 21`, and after the fixes in this section both corpora read `MISSING 0 /
filter 0 / real 0` on every label except the two named real gaps above.
Written up as JSD36; instruments `javascript-two-path-loss.ts` and
`javascript-label-oracle-agreement.ts`.

### 2. 1,236 `calls` targets on the ts corpus are expressions, not names — FIXED THIS ROUND, analyzer and oracle in one change

`extractCallRelationships`' malformed-callee guard refuses a callee over 100
chars, containing a newline, a backtick, `${`, or one of `{ } ; =`. A conditional
or parenthesised callee contains none of those, so the leaf published is source
text: `(0, ral_1.default)`, `(await $.save(1))`, `_.runInContext.convert(options)`,
`add('2')`, `(h?xs:Ws)`. Measured **through the analyzer's own output**
(`ASTEngine.parseFile`, the path the differential measures), which is the
population this defect is about:

| corpus | `calls` rows | non-name targets | of which `#private` (CORRECT, must be preserved) |
| --- | --- | --- | --- |
| ts (13,202 files) | 64,557 | 1,236 (1.915%) | 124 |
| svelte (3,447) | 31,940 | 152 (0.476%) | 123 |
| lodash (51) | 12,555 | 165 (1.314%) | 0 |

**The ts column's population is no longer reproducible from this checkout, and that
is stated rather than papered over.** The `typescript` corpus is now SPARSE
(`/tsc/src/`): 6,124 of its 13,203 tracked `.js` files are on disk, and the
instrument reads **22,210 `calls` rows / 550 non-name / 2 `#private`** on that
materialized set. The `svelte` row is the instrument's
validation, and it reproduces on the two figures that fix the POPULATION — **3,447
files and 123 `#private` rows, identical** — while its totals are 33 rows higher
(31,973 `calls` rows now, 154 failing the alphanumeric test against the 31,940 /
152 recorded above). The 33 rows are this lane's other rounds landing on the same
analyzer, and the 2-row gap in the alphanumeric column is NOT attributed: the
instrument is the same, so either the recorded figure or the current one is a row
count taken over a slightly different admitted set, and I would rather say so than
pick the explanation that makes the new numbers line up.

**A correction to the previous round's conclusion about these rows.** It stated
that these rows "reach the product — `pool-worker`'s noise filter does not catch
parentheses". Measured through the new two-path instrument, that is **false for
most of them**, and the reason is the filter's leaf extraction, not a parenthesis
rule: `extractLeaf` splits the target on `:` and takes the last segment, so a
ternary callee `(BROWSER ? requestAnimationFrame : noop)` yields the leaf
`" noop)"`, which trips `leaf.startsWith(" ")` and is dropped. On the ts sample,
**17 of the malformed `calls` rows are dropped from the product** and on the
svelte 600-file sample **2 are** — including both ternary callees the per-label
instrument reports as MISSING. So the garbage is real analyzer output that the
oracle mirrors, and most of it is deleted before it can be queried; what remains
untouched is the subset whose last `:`-segment happens to look like an
identifier. That is a reason to fix the analyzer's guard on its own merits, not a
reason to leave it.

`#x` is a **legitimate** call target — `this.#x()` names the private method `#x`,
and this lane already publishes `#events` as a symbol — so the fix had to be a
name-shape rule that admits a `#` segment, not an alphanumeric filter.

**SHIPPED THIS ROUND, analyzer and oracle in one change.** `extractCallRelationships`
now publishes a `calls` row only when the callee leaf passes
`isNameShapedCallTarget` — `ID_Start`/`ID_Continue` as char codes, plus a leading
`#` — and the token test (`length > 100`, newline, backtick, `${`,
`hasBraceEquals`) is **gone**, because a proxy for a name test is not a name test.
The oracle moved with it: `deriveJavaScriptEdges` (`differential.ts`) applies the
same rule test for test, and the two functions' comments say so, since tightening
one side alone turns every affected row into a MISSING row.

**What it costs and what it buys, measured.** On the svelte corpus the `calls` rows
fall 31,973 → 31,942 and the non-name count falls 31 → 0, with the 123 `#private`
rows intact — which is the measurement that says the rule is a shape test and not
a filter. On the same-files differential draws after the co-move:

| corpus | files | tree-truth before → after | covered | MISSING | unexplained | sample hash |
| --- | --- | --- | --- | --- | --- | --- |
| lodash (recorded baseline's drawn set) | 55 | 12,819 → **12,597** | 12,597 (**100%**) | **0** | 0 (0%) | `494e1b94766e8ade` |
| svelte (fresh rotation) | 120 | — → **1,412** | 1,412 (**100%**) | **0** | 0 (0%) | `cf3b53aff7e7b43d` |

The lodash draw is the honest arm: it reproduces the recorded baseline's hash, so
it is the SAME file set, and the 222 rows leave BOTH sides — truth 12,819 → 12,597
and analyzer 12,783 → 12,561 — with coverage still 100% and 0 unexplained. A
co-move that dropped rows on one side only would have surfaced here as 222 MISSING
rows; it surfaces as 0.

**Pinned, falsified, and given a mutant.** `javascript/non-name-callee-refused`
(new) writes six of the pre-fix shapes and forbids each spelling, with four expect
rows as the positive controls (`fn()`, the member leaf `save`, the INNER call of
`define()()`, and `this.#tick()` for the `#` clause). Suite: **76 pass / 0 fail**.
**Falsification arm:** reverting ONLY this guard in a copy of the analyzer reads
**75 pass / 1 fail**, the single failure is this fixture, and six of its seven
forbid rows fire. The seventh — the IIFE `(function () {})` — does NOT, and the
fixture says so at the row: the replaced guard's `hasBraceEquals` clause already
caught that shape, so it is a contract pin, not a pre-fix arm. That distinction is
recorded because a fixture claiming an arm it does not have is the defect this lane
keeps finding in other people's notes. Lane mutant
`javascript/restore-source-text-call-target` (sixth) reverts the guard by
re-publishing the parenthesised callee spans it finds in the source text — with the
old token test applied to each span first, so the revert is exactly as wide as the
guard — and dies on this fixture alone (`0 -> 1`); the lane runner reads **6 lane
mutants, 6 caught, 0 survived**.

**What the fix does NOT do, with the number attached.** It drops rows whose callee
has no name; it does not RECOVER the name a transparent wrapper hides. The census
buckets those rows, and they are not small: svelte **26 paren + 5 call-expression**
rows, the materialized ts tree **174 paren + 161 call-expression**. `(fn)` names
`fn` and `(0, ral_1.default)` names the interop's `default`, so an unwrap rule
would turn a dropped row into a real call — a second change, with its own oracle
co-move and its own A/B, and it needs a decision about whether a recovered interop
call should resolve to the property leaf the member path already publishes.

**The `typescript` lane's twin is NOT touched by this change.** `extractCallRelationships`
has a TS counterpart with its own oracle (`deriveTypeScriptEdges`), which still
carries the token guard; this round measured the javascript analyzer only, so any
TS-side occurrence is unmeasured here rather than assumed absent.

**Two-path re-measure, because this section used to quote a filtered-row count.**
The claim that "17 of the malformed `calls` rows are dropped from the product" (and
2 on the svelte 600-file sample) is SUPERSEDED: those rows no longer exist to be
dropped. Re-running `javascript-two-path-loss.ts` on the same 600-file sample reads
`calls` engine = pool = 12,951 with **0 lost**, and a total that read **378 lost of
36,881 (1.025%), gained 0** at that point — all of it outside the `calls` label, which
left the JSD36 finding (§1) intact and removed the `calls` half of it. **That total is now
`0 lost of 36,881`** (the current re-measure, §1's ladder): the 378 did not move because
of anything in this section, they were §1's, and §1 is closed.

Reproduce with `script/m14/js-ontology/js-callee-shape-census.ts --corpus svelte`
(read-only), and the differential draws with
`bun run script/m14/differential.ts --repo lodash --lang javascript --sample 120`.

### 3. Six of this lane's mutants were NEVER RUN — WIRED THIS ROUND, and the wiring is checked

This is the finding this round most wants the master to act on, because it is the
same class as a DERIVATION finding pointed the other way: a check that is stored
and never executed.

`script/m14/javascript-mutants.ts` declares six mutants.
`script/m14/mutate-analyzer.ts` **built** its `MUTANTS` list without importing
that file. Measured at the commit that found it: the registry held **56**
`javascript/*` mutant ids; the lane file declared its own; and the lane ids
(`restore-empty-edge-endpoints`, `restore-global-instanceof-source`,
`restore-empty-pattern-binding-symbol`, `class-scope-preempts-literal-owner`,
`restore-reexport-module-star`, `restore-source-text-call-target`) appeared **zero
times** in the registry, so a canonical run reported every javascript mutant CAUGHT
while never executing the lane's own. The consequence was concrete: those six are
the only regression protection for the three rule-R7 fixes this lane shipped — the
empty-endpoint guard, the `global` instanceof source, the writable-name requirement
in `collectPatternPairs` — and for the containment owner fix, the JSD40 re-export
fix and §2's name-shape guard.

**FIXED THIS ROUND: the import line and the spread are IN `mutate-analyzer.ts`**
(the file also carries a note that the six are lane-owned definitions and that this
registry holds the two lines, so a merge that removes them costs two lines).
Verified by running the canonical harness with its own dev selector:

```
BB_MUTANT_ONLY="javascript/" bun run script/m14/mutate-analyzer.ts
  -> 63 mutants selected of 1,856, all 63 CAUGHT, exit 0   (re-measured 2026-10-12)
  -> 62 mutants selected of 1,845, all 62 CAUGHT, exit 0   (when this sentence was written)
```

63 is the registry's own 56 plus these 7, and 0 survived. Both lines are kept
because the count is a property of the REGISTRY and moves when another lane adds a
mutant: only the second number is a reading of this lane's own file, and it is the
one the lane's runner can verify by reading the spread line (`javascript-mutant-runner.ts`,
7 lane mutants, 7 caught, 0 survived, re-measured 2026-10-12). **Two corrections to the
prose that reported this finding**, both measured: the canonical command is the
`BB_MUTANT_ONLY` prefix filter — the harness has **no `--lang` flag**, so the
`--lang javascript` spelling the earlier report quoted selects nothing by language;
and a filtered registry run deliberately writes **no** canonical
`validation/m14/results/M14.0.F4.json`, which is why this is verified by a filtered
run rather than by a full sweep that would take the whole 1,845-mutant battery.

`script/m14/javascript-mutant-runner.ts` (new, lane-owned) runs them through the
same `runLang` the registry uses, so the pass/fail rule is not restated:

```
clean suite: 76 pass / 0 fail over 76 fixtures
CAUGHT   javascript/restore-empty-edge-endpoints  (0 -> 2 failures; new failures: javascript/empty-endpoints-refused, javascript/recovery-empty-node-endpoints)
CAUGHT   javascript/restore-global-instanceof-source  (0 -> 2 failures; new failures: javascript/instanceof-module-scope-source, javascript/instanceof-source)
CAUGHT   javascript/restore-empty-pattern-binding-symbol  (0 -> 1 failures; new failures: javascript/recovery-empty-node-endpoints)
CAUGHT   javascript/restore-source-text-call-target  (0 -> 1 failures; new failures: javascript/non-name-callee-refused)
CAUGHT   javascript/class-scope-preempts-literal-owner  (0 -> 1 failures; new failures: javascript/literal-owner-inside-class)
CAUGHT   javascript/restore-reexport-module-star  (0 -> 3 failures; new failures: javascript/barrel-named-clause, javascript/barrel-reexport, javascript/reexport-forms)
6 lane mutants, 6 caught, 0 survived
```

All six die, so the fixtures can hold them — and now the registry runs them, so
the teeth are in the command a milestone quotes. The lane's own runner also
**checks the wiring rather than assuming it**: it reads `mutate-analyzer.ts` and
prints `WIRING OK` or a `NOTE` naming the two missing lines, and that check was
falsified (disabling the spread flips it to the NOTE, renaming the import does not
escape it — the first version of the check matched the identifier as a SUBSTRING
and reported OK on a disconnected tree, which is why the test is now the trimmed
spread line itself). The
fifth is the JSD40 revert (the named re-export clause's members collapsed back to
`path:*`), and it fails exactly the three re-export fixtures — which is also the
check that the new pins are scoped to this behaviour rather than to the lane. The
sixth is this round's §2 revert, and it fails exactly `non-name-callee-refused`;
unlike the other five it re-derives nothing from a tree the transform layer does
not have — it locates the pre-fix spans in the SOURCE TEXT and applies the replaced
guard's own token test to each, which is what keeps it a revert of the guard rather
than a widening of it.

### 4. Six M14.0.F4 mutation survivors, none of them this lane

A full registry run at this commit: **6 survived** —
`java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`,
`groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`,
`make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess`.
javascript: **63 of 63 caught in the shared registry** — 63 defined, 63 caught, and
now all 63 are reached by the canonical command (§3 was wired this round; filtered
run: 63 selected of 1,856, all CAUGHT, exit 0, re-measured 2026-10-12 — the registry
held 1,845 ids and the selector read 62 when this sentence was first written). Before the wiring the same sentence
had to read "56 of 56 in the registry plus 6 in the lane's own runner", which is the
shape §3 exists to report. The workstream's "4 mutation
survivors in scala/csharp/elixir" no longer matches: scala has 1, csharp and
elixir have 0, and java/groovy/make/php have 5 between them.

### 5. `imports` threw away the members a named re-export clause writes — FIXED THIS ROUND, analyzer and oracle in one change

`export { a, b } from "./m"` names two members. The lane spells **every**
re-export target `${modulePath}:*` at confidence 0.6 with
`metadata.unresolved: true` — including the form that wrote the names. Measured
across the three corpora: **svelte 106 named re-export statements carrying 271
specifiers, the ts corpus 607 statements carrying 519, lodash 0.** So 713
statements and 790 written member names are published as a module-level
dependency with no member, and demoted below the 0.7 threshold for it.

It was not defensible as a design choice: `import { a } from "./m"` already
yields `m:a` at 1.0 with `metadata.declaredName`, measured and
oracle-confirmed, so the same member name from the same module path was a
first-class edge in one direction and discarded in the other.

**Fixed this round, and the reason it became fixable is the reason it was
reported as unfixable.** The blocker was never a rule — it was the co-move: the
import oracle's contract in `deriveJavaScriptImportEdges` stated `export … from`
→ `path:*` for all three re-export forms verbatim, so an analyzer-only change
turned all 790 rows into MISSING. Both files move in one change:

- the ANALYZER publishes one `imports` row per written specifier at 1.0 — the
  `name` field's spelling, which is the member in the SOURCE module, not the
  alias this module re-exports it under — with `declaredName`/`declaredKind` and
  the specifier's own line. `export *` and `export * as ns` keep `path:*` at 0.6
  marked unresolved; an EMPTY clause (`export {} from "m"`) falls back to it,
  because the dependency is real and no member is named;
- the ORACLE derives the same member rows, so no row became MISSING.

**The A/B, because the differential cannot attribute this change.** The
cold-pool draw rotates on every run, so a before/after of two differential runs
compares two different file sets. A throwaway probe
(`script/m14/tmp/js-jsd40-reexport-ab.ts`, git-excluded, imports both the
PRE-CHANGE analyzer and the PRE-CHANGE oracle from copies — never re-stating
either rule) parses one tree per file instead, which is exact:

| same 13 files | old | new | rows in | rows out |
| --- | --- | --- | --- | --- |
| analyzer `imports` rows | 199 | **364** | 271 member rows | 106 `path:*` rows |
| oracle `imports` rows | 198 | **355** | 262 member rows | 105 `path:*` rows |
| per-file TARGET-SET delta disagreeing | — | **0 of 13** | | |

Those 13 files are 13 of the corpus's 3,446 tracked js files and they carry 106
named re-export statements — the whole-corpus figure this finding measured last
round, so a fixture-sized A/B *is* the population here. The oracle's totals are
lower because it dedups per target while the analyzer emits a row per statement.
Row-shape invariants held: every analyzer row only in NEW is member-spelled (no
`:*`), and every row only in OLD is a module star.

Store side, same 250-file draw: `imports` detached 676 → 674 and attached
526 → 528. **That comparison is inside this instrument's own ±9-row band and is
not the evidence** — it is reported so the next reader does not mistake it for
some. Exactly 1 of the 13 files is inside the 250-file cut
(`packages/svelte/src/compiler/index.js`, 4 named re-exports), which bounds what
a 250-file sample can show.

Pinned so it cannot regress: `barrel-named-clause` and `barrel-reexport` assert
the member rows and FORBID `./m:*` / `./mod:*`, and `reexport-forms` (new) pins
the four forms that must NOT move — `export * as ns`, `export { default as D }`
→ `path:default` (not `path:D`), `export { readFile as read } from "fs"` →
`fs:readFile` (not `fs:read`), an empty clause, and an ES2022 string-literal
member name. Suite: **76 pass / 0 fail**; lane mutants 6 caught / 0 survived (the
JSD40 round recorded 4 and the §2 round added the sixth).
**Falsification arm** (the fixtures must bite on the behaviour they were written
for): with the PRE-change analyzer swapped back in the suite reads **72 pass / 3
fail**, and the three failures are exactly `barrel-named-clause`,
`barrel-reexport` and `reexport-forms` — no other fixture in the suite moved, so
the pins are scoped to this change rather than to the lane.
`firing-check.mjs JAVASCRIPT` 9 types fired, 120/120 parsed, `implements` still
the only silent type; `verify-override-retarget.ts` all properties hold;
`typecheck` and `typecheck:scripts` exit 0. JSD40's resolution now records both
halves as shipped.

### 6. A latent owner shape with ZERO corpus occurrences — measured, and not shipped

`bindingNameAbove` lists the wrappers that can sit between a value and its
binding (`pair`, `object`, `return_statement`, `expression_statement`,
`export_statement`) and `parenthesized_expression` is **not** among them, so
`const C = (class Q { n() {} })` publishes `method:n` with no owner and no
`contains` edge, where the unparenthesised form publishes `contains C -> n`.
Measured before deciding: **svelte 1 object literal (40 members) and 2 class
expressions behind a parenthesis; ts corpus 83 object literals and 26 class
expressions (21 named)** — and in every reachable case the chain above the
parenthesis is an `arrow_function`, a `new_expression` or an
`expression_statement`, none of which is a binding, so adding the wrapper
recovers **0** edges on all three corpora. Shipped: nothing. A change with a
fixture and no measurement behind it is the mirror image of the defect this
workstream exists to catch, so the shape is recorded here for whoever finds a
corpus that exercises it.

### 7. Three rows in this file were stale at handover, corrected above

`contains` 23,209 → **23,121**, `overrides` 644 / 158 → **630 / 148**, and the
corpus table's edge total 354,458 → **354,356**. The three are one change: the
containment owner fix (JSD37) in the same commit removed 102 rows from the ts
corpus — 88 `contains` and 14 `overrides` — and the per-type figures were recorded
before it while the corpus total was recorded after. Every number in this file is
now from one run of one instrument at one commit; the ones that moved are marked
`[re-measured]` in the ontology table. Recorded rather than quietly fixed,
because a doc whose own rows disagree with each other is the reason a reader
cannot tell which figure to quote.

### 8. `validation/m12/results/javascript-complexity.json` is sealed at 2026-09-14 and the lane's budget row cannot be scored

`script/m60/analyzer-complexity-gate.ts` reports javascript as `unscorable`,
severity 5, `status: open`, for four **frame** reasons: the artifact carries no
`loadRule`, no `corpusManifest`, no `loadAvg1` and no `userCpuMsPerFile`. It
predates #871 and #909, and it is `bbSeal`ed (`sealedAt: 2026-09-14`), so a lane
cannot regenerate it in place — `measure-analyzer.ts` writes
`OUT_FILE` unconditionally and would break the seal.

What the lane CAN fix, and did: the budget declaration itself. It lived in a
markdown table row, and the gate's `parseBudget` reads the first line matching
`/declared budget/i` as a paragraph — which yielded no `fixtures` bound, no
`corpus` bound and no file count, so the row also carried a budget-parse debt. It
is now declared in the form the gate parses, and `parseBudget` returns
`fixturesMs: 2000, corpusMs: 60000, corpusFiles: 400, unparsed: []`.

What it cannot: re-emit the artifact. Master action needed — unseal
`validation/m12/results/javascript-complexity.json` and re-measure with the
current harness so the row carries load context and a set digest. Until then
javascript's complexity budget is **unscored rather than within budget**, and this
lane's re-measurement below was run against a scratch root precisely so the
sealed file was not touched.

### 9. `rel-type-coverage-gate.ts --langs=` destroyed the artifact it writes — ALREADY FIXED 2026-10-09, and this row was STALE

When this finding was written, `--langs=javascript` **wrote**
`validation/m60/results/rel-type-coverage.json` containing only the selected lanes
— replacing 1,418 lines of other lanes' evidence with 18. That was repaired in the
gate on 2026-10-09 with a scoped-run guard (`const scoped = !!lanesIn`, then no
canonical write, no baseline write, and a `evidence NOT written: …` line naming the
lane count), and this row was not updated to say so. **Re-verified 2026-10-10 by
checksum rather than by reading the guard**: `sha256` of the artifact before
`--langs=javascript` was `2482049b…`, the run printed the refusal and exited 0, and
the hash afterwards is identical, at 1,820 lines both times. The same run reports
`baseline: 4 recorded, 0 NEW, 4 repaid` — §11's subject.

The lesson is the one this doc keeps re-learning from the other direction: a lane
that reports "the gate is master-owned, not taken" must re-check before the next
handover, because a fixed finding reads exactly like an unfixed one until someone
measures it.

### 10. `verify-doc-truth-emissions.ts` dropped the FIRST body row of every claim table — FIXED THIS ROUND

`parseClaimTable` (`script/m14/verify-doc-truth-emissions.ts`) walked the rows after
the header and, on the first one, did `if (!started) { started = true; continue }` —
which **discarded it**. Every analyzer's claim table lost exactly its first data
row, silently: there was no count check, so a table with one row and a table with
nine parsed the same. A gate that under-reports is worse than a missing gate,
because its green is trusted.

For this lane the lost row is `calls`, the largest type by volume (30,758 edges on
svelte), and it surfaced as `UNDOCUMENTED [javascript] calls (relationship)` on a
doc line that plainly reads `| calls | **EMITTED** | … |`.

**Fixed, and the fix is three lines: the flag is gone.** The loop starts AT the
header, so the question `started` was asking — "has the table begun?" — cannot
arise; the table's own rule is now the loop's rule (the first non-`|` line after the
header ends it). What that changed, measured on the same tree:

| | before the fix | after |
| --- | --- | --- |
| UNDOCUMENTED (fleet) | 34 | **10** |
| javascript findings | 1 (`calls`) | **0** |
| FALSE_NEGATIVE (fleet) | 7 | 7 — **the identical seven**, byte-diffed |
| new classes revealed | — | `MIXED_ROW [nim]` (its first row mixes engine and non-kind names) |

So 24 first rows across the fleet went from invisible to parsed and clean, one
previously hidden defect appeared, and the javascript lane's doc now passes the gate
with all ten types graded.

The parser contract is pinned by a direct probe (`bun -e` over the exported
`parseClaimTable`, same two-row table both ways): **pre-fix it returns 1 row and that
row is `uses`** — `calls`, the first body row, is gone — and post-fix it returns 2,
with `names[0] = ["calls"]` and `claim: YES`. The pre-fix half was measured by
restoring the three lines in a checksummed copy, not inferred from reading them.

The lane's half of this was already fixed and is what made the row visible: the
claim table's second column reads `Emitted?` rather than `Verdict`, which is the
only way `looksLikeClaimHeader` accepts it.

**The gate is a shared harness file and the fleet verdict is still FAIL** — 7
FALSE_NEGATIVE rows and 1 MISSING_DOC, none of them this lane's. Those seven are
other lanes' docs saying "not emitted" about a channel that emits, and the fix is
what makes them checkable rather than what creates them.

### 11. This lane's DERIVATION debt is repaid, and the recorded debt is stale

`validation/m60/rel-type-coverage-baseline.json` (recorded 2026-10-01) lists **4**
DERIVATION findings for javascript: `contains`, `exports`, `imports` and
`references` each "stored and compared against nothing". At this commit
`script/m60/rel-type-coverage-gate.ts` reports **0** for javascript, over four
consecutive runs — the compared-label allowlist in `script/m14/differential.ts`
now admits all ten for this lane and four oracles are wired behind them
(`deriveJavaScriptEdges`, `deriveJavaScriptImportEdges`, `deriveJavaScriptExtends`,
`deriveJavaScriptOverrides`; `script/m14/verify-oracle-coverage.ts` counts 4). The
`imports` half is the handover note, and it is repaid on evidence rather than on
the note: the svelte 600-file per-label draw derives **2,715** `imports` truth
rows from `deriveJavaScriptImportEdges` and covers 2,714 of them with 0
fabrications.

So the same gate run reports `45 NEW / 56 repaid` against a baseline whose
javascript rows are two revisions out of date. That baseline is
shrink-only and master-owned: **it needs a `--update-baseline` run**, or the next
reader sees javascript carrying four debts that were paid. Reported, not taken.

One more thing the gate cannot see, and it is the same shape as finding §3 — a
check that is stored and never executed. A DERIVATION row says a label is
compared, not that the oracle behind it is independent. For `imports` the oracle's own header records that its **target
format** ("the target is the LOCAL BINDING, not the original name", "every
whole-module form is `path:*` at 0.6") was measured from the analyzer's output
rather than re-derived from the language, while the **module path** is a genuine
tree descent through the grammar's `string_fragment` child. So the import oracle
is independent about where the path came from and mirrored about how the target
is spelled — a shared naming bug in both would be invisible to both, exactly as
the workstream's Part 1 question 3 warns. Stated here rather than counted as
agreement.

---

## Resolution, incoming and outgoing: what actually binds, and what cannot

Every other section of this file measures what the ANALYZER emits. None of them
measures the graph a consumer queries, because the store resolves names, applies
its own filters, and runs two post-index passes that the analyzer never sees. The
two instruments below close that gap, and the answer they give is not the one the
lane's firing and differential numbers imply.

**`script/m14/javascript-store-resolution.mts`** indexes a javascript-only project
through `indexProjectParallel` into a temp data dir and reads
`brain_relationship.target_symbol_id` / `source_symbol_id` back. It reports, per
label: attached, detached (`target_external` set, no symbol), landed-in-the-source-
file, landed-elsewhere, and source-dangling. The sample is the deterministic FIRST
N of the sorted admitted list, so two runs are comparable. Its one scored claim is
deliberately narrow: an attached target is CORRECT when the edge's own file declares
that name (decidable from one file), and rows whose target is declared elsewhere are
reported as UNVERIFIABLE beside the scored ones rather than added to them.

**`script/m14/js-ontology/js-detached-triage.mts`** answers the question the store
instrument cannot: whether the name a detached row carries is declared ANYWHERE in
the corpus. It scans every admitted corpus file through the same `parseFile` the
indexer uses, caches the result with a file-list digest (a stale cache is refused,
not reused), and splits the detached population into corpus-declared / ECMAScript
standard-library / neither. The standard-library set is enumerated from the running
engine's own prototypes and globals, so it is executed rather than typed.

### The arms

Both arms are the same 1,200-file draw of the pinned svelte corpus, the same
instrument, and the same machine; the before arm is a clean `git worktree` of
`8a7c6ec96` (HEAD) so the only difference is this round's three changes.

| 1,200-file svelte draw | before (HEAD) | after |
| --- | --- | --- |
| stored relationships | 42,066 | 42,066 |
| attached targets | 27,328 (65.0%) | 27,335 (65.0%) |
| detached targets | 14,738 | 14,731 |
| `imports` detached | 765 | 758 |
| `imports` landed in the source file | 1,191 | 1,201 |
| symbols carrying `super_types` | **0** | **10** |
| containers with a method index (qualified `Owner.method`) | 84 | 93 |
| `overrides` rows the pass can interpret | **0 of 52** | **52 of 52** |
| source-dangling rows | 5,067 | 5,067 |

**The row deltas are inside the noise and must be read as such.** Two HEAD arms of
the same population differed by 22 rows on `imports` alone (765 here, 787 on an
earlier HEAD run), because insert-time resolution runs against a partially stored
symbol table and scheduling decides some ties — the same effect the `_i13` pass
documents. `+10 imports landed in the source file` is not a claim this file makes.
The load-bearing evidence is structural: `super_types` 0 → 10 (the column was NULL
for EVERY language on the worker path, not just this lane), the method index 84 →
93, and `overrides` 0-of-52-interpretable → 52-of-52.

**This table is the HIERARCHY round's record and its 1,200-file figures were not
re-measured afterwards.** The file-level wave that followed (below) changed the
source spelling of every module-scope row, added the store id fix, and then the
import resolver; those rounds are measured at the **250-file draw**, in §"Outgoing"
and §"Incoming". Nothing in this table is a current number, and the 5,067
source-dangling row is the specific figure the file-level wave moved.

### What the detached population actually is

At 1,200 files, 14,731 detached rows split by what the WHOLE corpus says about the
name (triage instrument above, corpus scan 3,447/3,447 parsed, 0 failures):

| class | rows | share | what it means |
| --- | --- | --- | --- |
| declared in the SAMPLE, still unbound | 48 | 0.3% | the resolver had a candidate and did not take it |
| declared elsewhere in the CORPUS | 1,016 | 6.9% | a cross-file target, left to a name pass that could see it |
| ECMAScript standard-library member name | 3,010 | 20.5% | no file anywhere declares `push`, `slice`, `resolve` |
| neither | 10,657 | 72.6% | DOM/browser APIs, library bindings, JSDoc-typed properties |

**The 1,016-row class is name-level, not binding-level, and its top entries say
so.** The most frequent members are `b` (241 rows, a name declared in 3 of 3,447
files), `fn` (191, one file), `DEV` (145, one file), `input` (68, three files),
`click` (65, one file). A one- or two-letter name declared somewhere is not
evidence that the edge meant it; on a minified file it is evidence of the opposite.
Reading this class as "1,016 bindings the graph missed" would be the same
shape of error as reading a MISSING row as a language gap (§Open findings 1).

**The 10,657-row "neither" class is the honest ceiling.** Its members are
`assert`, `querySelector`, `innerHTML`, `window`, `document`, `getComputedStyle`
(browser and node surfaces, declared in no project file by construction) and
`expression`, `start`, `end`, `binding`, `attribute`, `options`, `path` — property
names of values whose types live in JSDoc (`@param {AST.RenderTag} node`), which
this analyzer does not read and could not publish as declarations if it did.

So the truthful statement about incoming resolution on this lane is: **65% of
emitted edges attach to a stored symbol, 100% of the decidable ones land in the
source file (8,497 of 8,497), and of the remainder 20.5% names the language's own
standard library while 72.6% names a DOM/browser or JSDoc-typed property that no
declaration exists for.** "Almost 100% resolution" is not reachable by name
resolution here, and a report that claimed it would have to have marked these rows
external — a claim that is false for `this.state` and for `import { x } from` …
`'#compiler'` bindings alike.

#### The BINDING-level route, which is a different class and is not the ceiling

Re-measured at the full corpus (3,447 files, real `indexProjectParallel`) and on a
closed population (`packages/svelte/src`, 368 files, all real source), the numbers
above hold: **76,306 edges, 65.1% attached, own-file decidable 100% (17,396 of
17,396), 74 detached rows whose raw target equals a stored symbol name.** Those 74
are the name-level residue the table above explains.

But the name-level test is not the only decidable one, and the store's strategies
implement ONLY it: `_res_name_unique` needs the name to be unique project-wide, and
`_res_qname` needs the target spelled `Owner.member`. Neither can read the row's own
**import graph**, which is the one piece of evidence that turns a bare leaf into an
exact answer: the import statement names the module, and the module names the symbol.
Measured by `script/m14/javascript-import-decidability.ts` on the closed population:

| route (all require the module to be IN the project and to declare the item) | rows |
| --- | --- |
| OWN_FILE — the row's file declares the leaf (the store already lands these) | 3,414 |
| NAMED — `import { x } from './m'` | 2,666 |
| ALIAS — `import { x as y }` | 4 |
| DEFAULT — `import y from './m'` | 38 |
| NAMESPACE — `import * as ns from './m'` then `ns.leaf` | 479 |
| SHADOWED — the leaf is a parameter of the row's own source symbol | 3,263 (not decidable, and not the import) |
| **IMPORT-DECIDABLE, not own-file** | **3,187 (11.1% of these labels' rows)** |

The first reading of this table was **2,581 (9.0%) with NAMESPACE 0 and ALIAS 0**, and the
difference is the four blind spots listed above plus one store-side defect (JSD42) — not a
change of rule. Each was a route reported as ABSENT because the instrument could not SEE
it: a namespace binding keyed by the string `"*"` instead of the local name, the receiver
of `ns.member(...)` read from the target while it lives on `metadata.calleeExpression`, an
alias's declared name looked for under a `localName` key the `imports` record does not
carry (the edge target spells the local, `metadata.declaredName` the declared), and the
store dropping every clause member but the last.

Examples, from the instrument's own output: `uses flip -> cubicOut` where the file
imports `cubicOut`; `calls migrate -> parse` where `parse` comes from
`../phases/1-parse/index.js`; `instantiates constructor -> CompileDiagnostic` from
`./utils/compile_diagnostic.js`. Each is a binding a resolver could take without
guessing, on evidence already in the store.

**THE SEAM THAT BLOCKED IT WAS THE LANE'S OWN, AND IT IS FIXED THIS ROUND (JSD41).**

*Before*, read back out of a real index (`packages/svelte/src`, 368 files, through
`indexProjectParallel`): every JavaScript import row was
`('./wrapper/wrapper_bench.js', NULL, './wrapper/wrapper_bench.js', 'named')` — the
MODULE PATH in `imported_name`, `imported_as` NULL for every row, and `import_type`
`'named'` even for `import x from './m'` and `import * as ns from './m'`.

Two independent causes, both measured. (1) The worker's import mapping emitted neither
`localName` nor the key the store reads for the type: `parallel-indexer`'s insert reads
`imp.alias ?? imp.localName` for `imported_as` and
`imp.importType ?? (isDefault ? "default" : isNamespace ? "namespace" : "named")` for
`import_type`, and this lane spells the type in `type`. (2) `import * as w from
'./warnings.js'` published **no binding anywhere**: the record carried `items: ["*"]` and
the alias `w` was in the tree but in no field, so no resolver could attribute
`w.get_prototype_of(...)`.

The consumer consequence is why this is not cosmetic: `src/ast/patterns.ts` computes
unused imports as `usedName = imported_as || imported_name` and then looks that name up
IN THE FILE, so for this lane it searched for a module specifier the source never writes.

*Fixed in this lane's own two files*, with no shared column semantics changed:
`real-javascript-analyzer.ts` publishes three parallel arrays per import statement —
`bindings` (the LOCAL name for every form, including the namespace alias),
`declaredNames` and `kinds` — plus `namespaceName`, so the filter's escape hatch also
counts a namespace binding as a name the file BINDS; `pool-worker.ts` emits `localName`
and `importType` **per item**, which is what the store already reads. Per item, not per
statement: `import a, { b } from './m'` used to label both items with the statement's
single `isDefault` flag.

*After*, on the same two-file index (all four forms plus a side-effect import):
`thing`/`default`, `alpha`/`named`, `bee`/`named` for `beta as bee`, `ns`/**namespace**,
and the side-effect import still binds nothing. Pinned by
`script/m14/verify-js-import-seam.ts` — **8 checks, exit 0**, run through the real indexer
rather than by reading the mapping — and falsified: with both halves removed it reads
**5 of 8 failing**, the two files restored byte-identically (`sha256`) afterwards.
**Not changed, and pinned as such by the same gate:** `imported_name` still carries the
MODULE SPECIFIER for this record shape. The column means different things in different
lanes (a module-shaped record puts its module there), so changing it is a fleet-wide call
and not this lane's; the gate pins the current value so a future change is visible rather
than silent.

**THE RESOLVER IS BUILT, AND IT LANDS 100% OF THAT POPULATION.**
`src/ast/binding-resolution.ts` runs inside `resolveRelationships` AFTER every name
strategy and before the cross-language normalization, and it does the one thing none of
them can: it reads the row's OWN import statement. Two actions, and the second is the one
that matters — **attach** a bare target the name passes left NULL, and **correct** one they
attached to a DIFFERENT file's same-named symbol. It refuses, by construction, every case
where the evidence is not exact (no import binding for the leaf; two modules binding the
same local; a module that does not resolve to exactly one project file; more than one
declaration of the name in the target file; an export surface that does not contain it), and
it DETACHES a row whose name is a parameter of its own source symbol (JSD43).

Measured by `script/m14/javascript-import-landing.ts` — which RECOMPUTES each expectation
from the source rather than reading the resolver's return value, so a pass that reports
corrections and stores nothing cannot pass it — on the same closed 368-file population,
indexed through `indexProjectParallel`:

| route | decidable | landed | wrong-file | detached | % landed |
| --- | --- | --- | --- | --- | --- |
| named | 2,567 | 2,567 | 0 | 0 | **100.0%** |
| alias | 14 | 14 | 0 | 0 | **100.0%** |
| default | 38 | 38 | 0 | 0 | **100.0%** |
| namespace | 474 | 474 | 0 | 0 | **100.0%** |
| **ALL** | **3,093** | **3,093** | **0** | **0** | **100.0%** |

**Falsified, not asserted.** With the pass unwired the same instrument reads **2,796 of
3,093 (90.4%)**: **283** rows on a wrong file, **14** alias rows failing (4 detached, 10 on a
namesake), **3** namespace rows on a namesake. The 100% is therefore attributable to the
pass rather than to a corpus that happens to be easy. The store-side denominator is 3,093
against the parse-side 3,187 because the store holds only rows that survived indexing (noise
filtering, files whose parse failed); the difference is recorded rather than smoothed.

Two defects found by running the resolver against real source rather than a fixture, both
fixed and both gated:

* **JSD42 — the store kept one binding per clause.** The import row's id was
  `fileId:import:module:line`, so every member of a clause collided and `INSERT OR REPLACE`
  kept the LAST: `create-subscriber.js` writes `{ get, tick, untrack }`, `{ effect_tracking,
  render_effect }`, `{ source, increment }` and the store held `untrack`, `render_effect`,
  `increment`. A binding the store never recorded is one no resolver can read, so those rows
  kept the name pass's answer with no evidence left to correct them against. Fixed in
  `parallel-indexer.ts` (the row id carries the imported name); gate
  `verify-js-binding-resolution.ts` B7/B8; falsified by restoring the old id, which reads the
  five-binding file as `['ns','p2']`. **Fleet benefit, measured:** the groovy lane goes from
  **20 fixture failures to 2** on this change alone.
* **JSD43 — a shadowed name was left on its namesake.** `store/index-server.js` declares
  `export function toStore(get, set)` while importing `get`, and its two `get` rows were
  attached to `compiler/phases/scope.js:get`; `batch.js` declares
  `capture(source, value, is_derived)` and its `source` row landed on
  `compiler/preprocess/index.js:source`. A parameter of the row's own source symbol is in
  scope by construction, so the attachment is provably wrong — and the name is not the import
  either. The pass now DETACHES those rows (`shadowed-local-binding`), counted separately in
  its outcome; gate A6 pins the planner decision and B9 the stored state.

**A name that reaches a file ONLY through a re-export chain (both halves SHIPPED this
round, and the second half was a store-path defect the chain found).** The resolver above
reads the row's OWN import statement, so it could say nothing about a name the row's file
never imports — `import { tick } from './index-client.js'` is a binding to a barrel, and
nothing in the store said which module declares `tick`. The analyzer had already published
the evidence and nothing read it: `export { tick } from './runtime.js'` writes an `imports`
edge with `metadata.isReExport: true`, `metadata.declaredName: tick` and, when the clause
renames, `metadata.exportedAs`. The clause is the evidence; the `exports` edge beside it was
often pointed at the WRONG module, because an `exports` edge is about the name THIS module
publishes and nothing in it says where the declaration lives. Two actions, gated at B12/B13
and falsified (**9 of 46 gate checks fail with the chain disabled** — A14, A15, A17, A25b,
A26, B10, B11, B12, B13 — files restored by sha256; the arm was re-measured when the gate
grew from 33 checks to 46, which is why it reads `9 of 46` and not the `7 of 33` this
paragraph first cited: A25b and A26 are the two additions that also route through the
clause walk, and an arm that is not re-run when its instrument grows is a stale number): an `exports` row that declares nothing locally now follows the file's own clause to
the module the clause names, and a consumer row whose target file is a barrel follows the
same chain — including a TWO-HOP chain — to the declarer.

MEASURED on the closed 368-file population, same instrument, both arms in one session on
the same draw (the unwired arm is a one-line early return in `resolveThroughReexports`,
restored byte-identically at sha256 `12adfbf6dfbe447f970b0a437b130fe95dc9c531d7952855e84fa6014be01a7a`):

| 368-file svelte `src`, import-decidable rows | chain unwired | chain wired |
| --- | --- | --- |
| all routes | 3,097 of 3,099 (**99.9%**) — 1 wrong-file, 1 no-symbol | **3,099 of 3,099 (100.0%)** |
| of those, the `reexport` route | 4 landed, 1 wrong-file, 1 no-symbol of 6 | **6 of 6** |
| clause-decidable re-export EDGES | 209 of 270 on the declarer; **56 wrong-file, 5 detached** | **270 of 270, 0 wrong, 0 detached** |

**So the chain closes 63 stored facts: 61 edge targets and 2 consumer rows.** The edges are
the larger half and the reason the route is worth more than its six consumer rows: 61
export-edge facts (56 wrong + 5 detached) were settled by a same-named symbol in the WRONG
module before the chain could read the clause. Both halves are named rather than counted.
The consumer rows, from the unwired arm's own report: `reactivity/window/index.js -> get`
held `compiler/phases/scope.js:get` instead of `internal/client/runtime.js:get` (a
confident wrong-file attachment), and `reactivity/date.js -> derived` held
`deriveds.js:derived` instead of `deriveds.js:user_derived` — the ALIASED re-export
(`export { user_derived as derived }`), where the store had the right file and a name that
module does not declare. The edges: `index-client.js -> tick : clause says
internal/client/runtime.js:tick, edge holds index-server.js:tick`, and
`index-server.js -> beforeUpdate : clause says internal/shared/utils.js:noop, edge holds
index-client.js:beforeUpdate` — an aliased re-export (`noop as beforeUpdate`) whose
client-side namesake is a DIFFERENT function.

One number moved that is not attributable to the chain, and it is recorded rather than
smoothed: the instrument's decidable total is 3,099 this round against the **3,093** recorded
in the previous round, and 3,099 − 6 equals 3,093 exactly — consistent with the six re-export
rows having been classified as undecidable because the instrument did not know the route
yet. The previous round's "with the pass unwired" arm (2,796 of 3,093, 90.4%) is a
different arm and was not re-run; the number here is the CHAIN unwired with every other
resolver action live.

Still not decidable through the chain, and refused by construction: `export * as ns` (it
binds a name in THIS module and redistributes nothing, so there is no member of the source
module to point at — the bare `export *` that sat in this same list is SHIPPED, §JSD46), a
member the source module does not declare, two declarations of the name in the source module,
a specifier that does not resolve to exactly one project file, and a chain longer than the
hop budget.

**JSD44 — the store-path name register: `self` was published, admitted, and dropped by a
fourth copy of one list.** The chain above is what walked into this. `export function
self(fn)` at `packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:27` is
published by the analyzer, passes `keepSymbol`, and appeared in NO symbol row
project-wide — and it is the ONLY declaration of that name in the population, so nothing
else could stand in for it. Reproduced on a single-file index: **parse 8 symbols, store 7**;
after the fix, **8 and 8**. On the 368-file draw read back from the store, the three barrels
that publish `self` (`internal/client/index.js:83`, `legacy/legacy-client.js`,
`legacy/legacy-server.js`) all name `internal/client/dom/legacy/event-modifiers.js:self:27`
today; while the declaration had no row, an `exports` row for `self` had no candidate to
name anywhere in the project. That is the register's cost measured at the store, and it is a
STORE-level effect: it is not attributed to the chain, which reaches a declarer the
name-across-the-project strategy can also reach when the name is unique.

The cause is a register problem, not a copy problem. One list of refused symbol names
existed in FOUR places: `keepSymbol`'s universal set (pool-worker.ts), the indexer's
`SYMBOL_NAME_DENYLIST` (parallel-indexer.ts), the keyword regex + read-side SQL condition in
analysis-exclusions.ts, and the per-language RESERVED table beside `keepSymbol`. The FIRST
was measured and corrected — R 12 symbols deleted across 9 files, graphql 1 of 8,796
(`Query.me`), sql 3 of 18,325, lua 236 declarations (leaving 677 edges naming nothing), hcl
H10, solidity's store-vs-analyzer divergence — and the other three kept refusing `self`,
`Self`, `me`, `My`, `root`, `program`, `source_file` anyway, on the production path, where
nothing reported the loss. (`this`/`super` and the synthetic analyzer artifacts are the
genuine residue of that list and stay refused; per-language reservations stay per-language,
which is why this cannot be fixed by deleting the names everywhere.)

FIXED STRUCTURALLY, which is the only version of this fix that lasts: the universal set and
the per-language table now live in `src/ast/symbol-name-rules.ts`, `keepSymbol` and the
indexer's `storeableName`/insert path both call one `isDenylistedSymbolName(name, lang)`, and
the names that LEFT the list are kept as a register (`SYMBOL_NAME_DENYLIST_REMOVED`) that
carries the measurement for each, so a future edit that "restores a missing entry" has to
argue with evidence. New gate `script/m14/verify-symbol-name-register.ts` — **8 checks,
8 pass**, run through `indexProjectParallel` and read back from `brain_symbol`,
`brain_import`, `brain_relationship` and the read-side SQL condition, with a two-file
declaration/consumer project and a PHP control: R1 the declared `self` IS a row; R2a/R2b the
import records the binding AND a call through it lands on that row's id; R3 the read-side SQL
mirror does not hide it either; R4 `super` and the synthetic artifacts are STILL refused; R5
a PHP `self` is STILL refused, with R5b showing the same name stored for javascript — the
scoping claim, not a blanket deletion. FALSIFIED in two independent arms, each reading
**6 of 8 with R1 failing** and each restored byte-identically by sha256: `self` back in the
shared register, and `self` back in the analysis-exclusions replica alone — which is the
proof that the extra copies were load-bearing rather than vestigial.

MEASURED effect on this lane's population: on the 368-file draw the store now holds **4 rows
whose names the old list refused** (3 `root`, 1 `self`) out of **2,799** symbol rows —
re-counted from the store on this tree, not carried over. Note what that number does NOT
claim: four rows is the register's effect, and the re-export chain's own effect is measured
separately above (the `reexport` route's 6 rows and the 61 edges), because the two were
fixed in the same round and a number cannot be attributed to both. The fleet-wide effect
is quoted, NOT re-measured by this lane: the per-lane counts above are the removal register's
own, and the lanes they belong to (R, lua, sql, graphql, hcl, python, zig) now store those
names — their store-side numbers are theirs to re-take.

The pass's refusals are reported by reason (`no-import-evidence`, `specifier-not-internal`,
`ambiguous-multiple-files`, `item-not-exported-by-target`, `exports-not-locally-declared`,
…), so a reader can tell "undecidable" from "decided wrongly" — which is the distinction the
whole lane is built on.

**JSD46 — the two CLAUSE-LESS re-export forms: byte-identical records, and one of them
redistributes.** `export * from './m'` publishes every member of `./m` without writing a
single name; `export * as ns from './m'` binds ONE name in this module and redistributes
nothing. Measured through `parseFile`, one file per form: both emitted the `imports` edge
`./m:*` at 0.6 with `{isReExport: true, unresolved: true}` and nothing else — and read back
out of a real index, both emitted the SAME `brain_import` row (`imported_name` = the module
path, `imported_as` = NULL, `import_type` = 'named'). So the namespace alias existed in no
field anywhere, and a resolver that read a star edge as a redistribution would have invented
an edge for every member of `./m` the file does not export.

The discriminator is a TREE fact rather than a text guess: the grammar marks the namespace
form with a NAMED `namespace_export` child (`"* as ns"`), which is also why
`hasToken(node, '*')` is FALSE for it — the `*` sits inside that named node. The analyzer now
publishes `metadata.starForm` = `all` | `namespace` (plus `namespaceName` for the second) on
the edge, and the resolver files a redistribution ONLY where that field says `all` — a
required marker rather than a default, because a record that does not state the form is the
record a guess would be wrong about. That strictness also keeps the route unreachable from
outside this lane: the resolver indexes `imports` edges, and no other analyzer publishes
`isReExport` on one (haskell's `isReExport` rides an `exports` edge, nim's key is
`nimReExport`, the ts lane spells it `reExport`), read out of those three lanes rather than
assumed. The namespace form publishes the same per-item binding arrays a namespace
IMPORT publishes, so the store records `imported_as = 'ns'` and `import_type = 'namespace'`
where it previously recorded NULL and 'named'. The edge spelling, confidence and `unresolved`
flag are unchanged on both forms, because the module dependency is the same fact in each —
which is why the existing `reexport-forms` fixture did not move, and why the new
`star-reexport` fixture pins the discriminator instead of re-pinning the spelling.

The resolver follows a bare star as a STATEMENT (there is no name to file it by), carrying
the same name to the next hop, and refuses what the language refuses: `default` (never
redistributed), two sources that both declare the name (ambiguous — the union is keyed by
symbol, so two sources naming the SAME declaration still agree), a named clause on the same
file (it shadows a star for that name), a name declared twice in one source module, a star
source outside the project, and any hop that does not resolve to exactly one project file.
The barrel's recorded export surface deliberately does NOT gate this route: the analyzer
cannot enumerate the members of a module it has not resolved, so a surface lacking the name
is not evidence that the name is unpublished — the `export *` statement is.

MEASURED on the closed 368-file population with the instrument taught the route, both arms on
the same deterministic draw (the unwired arm is a one-line early return in
`resolveThroughStarSources`, restored byte-identically):

| 368-file svelte `src`, import-decidable | star route disabled | star route enabled |
| --- | --- | --- |
| all routes | 3,113 decidable | 3,113 decidable, **3,113 landed (100.0%)** |
| the new `star` route | 14 decidable, **14 landed, 0 wrong-file, 0 detached** | 14 decidable, **14 landed, 0 wrong-file, 0 detached** |
| `not decidable by the import statement` | 18,943 | 18,943 |

**Read those rows twice, because the honest conclusion is in the thing they do not show:**
enabling the route moves those 14 rows OUT of "undecidable" (3,099 → 3,113 decided, 18,957 →
18,943 not decidable, exactly −14) but changes ZERO landing verdicts on this draw — the
name-across-the-project strategy had already answered all 14, because their names are unique.
That is not a reason to skip the route, and it is the reason the route is not sold on the
draw: **263 of this draw's 2,189 distinct names ARE declared in more than one file**, so the
name pass has a real competitor for 12% of names and answers anyway (that is how it produced
the wrong-file rows the earlier rounds had to detach). The collision case is where this route
is load-bearing, and it is pinned where a draw cannot hide it — the gate's decoy project,
where the name pass picks the decoy: **B14/B15 fail without the route (40 of 46), and A21–A28
and B14/B15 fail with it disabled**.

MEASURED AND NOT BUILT, and the measurement is what justifies parking it. The namespace
form's own member route (a consumer's `import { ns } from barrel` then `ns.member`, where the
barrel publishes the namespace) needs the consumer's alias, and a conservative rule would have
to refuse whenever the barrel publishes more than one namespace. **The population: the form
appears in exactly ONE corpus — typescript, 24 statements across 9 files, and all 9 live
inside `tsc/testdata/baselines`** (the concatenated baseline dumps this lane already records
as unparseable by design), with **0** in svelte, rxjs, element-plus, vuejs, shadcn-svelte,
vue-element-admin and lodash. Its CONSUMER population is measured too: no file in any of those
corpora imports one of the names those barrels publish, so the route would ship with nothing
that can exercise it. That is a census of the trees in `fixtures`, not an analyzer run, and it
is recorded as such — the point of the number is that it can be re-taken rather than
re-argued.

TWO DEFECTS FOUND BY THE NEW CHECKS THEMSELVES, which is what the checks are for: the first
end-to-end run of the star cases read `attached 0` and left both rows detached, because the
clause-index loop skipped every `*` target BEFORE the branch that files bare stars (an
ordering defect, found by running the gate once and reading its outcome); and A28 failed
because the clause walk and the star walk shared one `(file, name)` cycle key, so the clause
hop blocked the star hop that follows it for the same pair — the keys are now
mechanism-tagged and `depth` still bounds every ping-pong between the two.

**How the resolver moved the NAME-level store numbers, measured on the same 250-file draw
the sections below use** (`javascript-store-resolution.mts --files=250`, re-run this round):

| 250-file svelte draw | before this round | after |
| --- | --- | --- |
| attached edges, all labels | 5,613 (28.7%) | 5,496 (**27.7%**) |
| `imports` attached | 527 / 1,202 (43.9%) | 528 / 1,203 (43.9%) |
| own-file decidable, landed in the source file | 100.0% | **2,569 of 2,569 (100.0%)** |
| detached rows whose target IS A PARAMETER of the row's own source symbol | — | **1,527** |

The attachment RATE falls by a point and that is the point: the pass removes
1,527 provably-wrong attachments (the parameter-shadowed class of JSD43) and adds
import-bound ones, and the two movements partly offset. A reader who saw only "attached%
28.7 → 27.7" would call this a regression; the row that matters is that the edges cleared
were **provably not the name they claimed** and the edges added are **exactly the symbol the
row's own import statement names**. The `imports` figure is unchanged inside the noise band
this file already documents for that label. The full-corpus figures quoted above —
76,306 edges, 65.1% attached, 17,396 of 17,396 own-file, 74 detached — are the **pre-resolver**
reading and were NOT re-measured this round; they are left in place, labelled, rather than
restated from a smaller draw.

**A measurement artifact, recorded because it produced a wrong number first and the
wrong number was large.** The first version of this instrument ran on the lodash
project and reported **1,602** detached rows whose target names a stored symbol.
That project is not closed for this measurement: 4 of its 55 tracked `.js` files
exceed the 512KB cap — including `lodash.js` itself at 546KB — so the run indexed
`lib/`, `fp/` and the smaller `dist/` bundles while the names it called "bindable"
(`isEqual`, `map`, `filter`) are declared in the file it skipped. 1,602 was an
artifact of the sample, and it is the same defect this lane keeps finding in its own
instruments: a population described as closed that is not. The committed instrument
defaults to `packages/svelte/src` (368 files, every one under the cap) and prints its
admitted count so the next reader can check closure before quoting a number.

### Outgoing: 12.0% of edges have no source symbol, and the obvious fix is not one

5,067 of 42,066 rows carry `source_symbol_id IS NULL` (12.0%; 10.3% on the 250-file
draw). Grouped by the analyzer's own spelling, the top entries are module
basenames — `index` (222), `errors` (181), `utils` (54+48), `transform-client`,
`transform-server`, `constants`, `browser-support.detector` — which is exactly
`moduleName`, the actor this analyzer uses for module-scope `imports`/`exports`/
`uses`/`calls` rows and never publishes as a symbol.

**The naive fix — publish a `Module` symbol named `moduleName` — was measured and
rejected.** On the same representation, 155 of 250 sampled files declare a symbol
whose name EQUALS the module basename (svelte's own convention:
`visitors/Attribute.js` exports `function Attribute`). `nameToSymbol` is first-wins
and the store sorts `module` kind first, so the symbol would flip which actor wins
for every module-scope edge in those files while leaving the ambiguity itself
intact — a different guess, not a resolution. Landing it needs an unambiguous file
identity in the edge spelling, and that is what this round landed.

#### The fix: the actor is the FILE, spelled the family's way

The analyzer now spells a file-level source `"(file)"` — the sentinel rust
(`RUST_FILE_SOURCE`), scala (`FILE_MODULE`), kotlin, zig, graphql and nim already
publish — and stamps `metadata.fileLevel: true` on every row that carries it
(seven emission sites, applied terminally so an eighth cannot forget). The store's
existing M60/#910 branch (`!sourceSymbol && metadata.fileLevel` →
`source_external = relativePath`) then records the project-relative path, which is
a node a reader can follow, instead of a basename that may or may not be a
declaration in this file. No store logic was added for it.

`(` and `)` cannot appear in a JavaScript identifier, so no declaration can be
named `(file)` and the store's name lookup can never bind these rows to the wrong
symbol — which is exactly what the basename spelling did.

**Eight expectations changed, deliberately.** `import-edges`, `dynamic-import`,
`dynamic-import-qualified`, `cjs-export-methods`, `empty-endpoints-refused`,
`instantiations`, `recovery-empty-node-endpoints` and
`instanceof-module-scope-source` pinned `"from": "<module basename>"`, which was
the defect restated as a contract. They now pin `"from": "(file)"`, and the
rationale in each says why (the store binds a source BY NAME; a basename is a
legal identifier; `fileLevel` is the channel the store already reads). The
assertion is not weakened — it is strictly narrower: the old spelling could not
distinguish a module-scope edge from an edge inside a function that happens to
carry the module's name, and the new spelling cannot be confused with either. The
lane's own mutant `restore-global-instanceof-source` still dies against the new
spelling (`instanceof-module-scope-source`, `instanceof-source`), so the contract
is pinned by mutation and not only by text.

#### The measurement (250-file draw, all three states, same instrument)

| | baseline | file-level actor | + the id fix below |
| --- | --- | --- | --- |
| stored edges | 19,371 | 19,122 | **19,529** |
| `imports` analyzer vs stored | 1,202 / 1,128 | 1,202 / **905** | 1,202 / **1,202 match** |
| `exports` analyzer vs stored | 547 / 535 | 547 / 509 | 547 / **547 match** |
| outgoing `source_symbol_id IS NULL` | 1,989 | 2,487 | 2,894 |
| … of which FILE-LEVEL (path in `source_external`) | **0** | 2,300 | **2,707** |
| … of which NAME-SPELLED (names nothing bindable) | 1,989 | 187 | **187** |
| outgoing rows with a usable actor | 89.7% | 98.6% | **99.0%** |
| attached target edges | 5,398 (27.9%) | 5,306 (27.7%) | 5,368 (27.5%) |

The draw is 250 files because that is the draw this lane's own instrument defaults
to and the one every figure in this section can be re-run at; the 1,200-file
figures elsewhere in this document predate the file-level wave and were NOT
re-measured, so they must be read as the record of the round that produced them.

The `NULL` count RISES and that is the correct direction: the rows it gains are
the 718 edges that used to be attributed to whichever declaration shared the
module's basename, and which are now attributed to the file that actually made
them. The number that moves the right way is the NAME-SPELLED half — 1,989 → 187,
a 90.6% reduction — because that is the population that names nothing a consumer
can follow. The instrument now reports the split instead of one `NULL` count, and
its header says why: the two populations mean opposite things.

Two costs, both measured and both stated:

- Attached target edges dip 5,398 → 5,368 (0.15%): the enrichment pass skips rows
  whose source is dangling (`dangling source edges cannot be enriched`), so a
  file-level row does not get the symbol-to-symbol target resolution a
  symbol-sourced row gets. 132 target symbols therefore lose their only inbound
  edge (1,125 → 993, 96.3% → 85.0% of published symbols). Paying 30 target links
  for 2,707 correctly attributed sources is the trade this round chose; the
  alternative it replaces mis-attributed 718 rows to the wrong declaration.
- The instrument itself had a measurement bug, found here and fixed: it keyed its
  per-file oracle by `path.relative(projDir, corpusFile)` — a `../../…` string that
  matches nothing in the database — so every `declAtLine.get(sourceFile)` lookup
  silently missed and the file-level membership test was unsatisfiable. The
  corrected key is the project-relative path, which is the string the store
  stores.

#### The store id had no file in it

The first file-level measurement showed `imports` 1,202 analyzer / 905 stored —
297 rows gone. They were not filtered: `brain_relationship.id` is
`projectId:rel:<sourceId>:<target>:<type>:<line>`, and `sourceId` is NULL for
every row whose source did not resolve, so **two DIFFERENT files emitting the same
`(target, type, line)` built the same id and `INSERT OR IGNORE` kept one**. Twelve
`*.bench.js` files importing `node:assert:assert` at line 1 collapsed to one stored
row; the same collapse cost 37 `#compiler/builders:*` @4 rows, 18 @3, 16
`../../../errors.js:*` @3. The baseline already lost rows this way — its duplicate
groups (`c>1`) are that loss in the act — and moving 2,300 more rows into the
unresolved bucket turned the rest of the duplicates into losses.

The fix is one component: `sourceId ?? \`file:${relativePath}\``. Rows whose source
resolved keep their id byte for byte, so no resolvable edge is re-keyed and
within-file multiplicity semantics (#822) are untouched; rows that name a real,
distinct file stop being discarded. Effect on this lane: `imports` and `exports`
now match the analyzer exactly (1,202/1,202 and 547/547), stored edges 19,122 →
19,529, file-level rows 2,300 → 2,707. **Cross-language blast radius, stated:**
this id is shared by all 43 lanes, so any lane with same-line unresolved-source
edges in two files will now store rows it was silently dropping. The change can
only ADD rows of that shape; it cannot re-key or delete one. Verified for this
lane only — the 43-language differential sweep was not run this round.

**This defect was already known and reported by another lane, and two of that
lane's artifacts are now stale.** `script/m14/lanes/java-store-roundtrip.ts:249`
names it exactly ("project:rel:null:<module>:imports:<line> and it carries NO FILE
COMPONENT … Two different files that import the same module with that module
written on the same line produce the SAME id and the second is silently
dropped"), measures it (AnEnum.java and AbstractCollectionTester.java both
importing `GwtCompatible` at line 19 → one row), and closes with "This is a
SHARED-HARNESS defect (parallel-indexer.ts is MASTER-owned) … Reported, not
fixed." That note is now history: this round fixed it, because the JS lane could
not land its file-level work without it. `script/perf/probe-rel-id-collisions.mjs`
describes the same id shape and then infers "a tuple that appears for N distinct
source_external values therefore stands in for N emissions" — that inference
describes the pre-fix state and is now FALSE (each source_external gets its own
row); to keep measuring remaining loss it has to count STORED ROWS per
(target,type,line) group rather than distinct contributors. Neither file was
edited here: they belong to other lanes, and changing their recorded verdicts is
those lanes' call, not this one's.

Nothing above touched the analyzer's LABELS or TARGETS, so the differential is
invariant by construction: on a fresh rotated 120-file draw it reads
`1621/1621 covered (100%) MISSING=0 unexplained=0 heuristic=0`
(`hash=e4b4539bd3e02b48`), and the draw that produced the committed
`fc839056ff888724` figure read `1,457/1,456 MISSING=1` with the single MISSING row
being an `extends` to the DOM global `MutationObserver` — unchanged, because the
source field is not compared. Two draws, both clean.

### Incoming: the `<module>:<item>` resolver, and the two gates a path spelling fixed

Once the source side said "the FILE", the worst-attached label in the lane was
`imports`: 1,202 rows, **926 detached (23.0%)**. The population is small and
mechanical — a target is `./util.js:helper`, so the question "which symbol" has
one honest answer — so it was measured rather than guessed. Splitting the 926 by
the MODULE the specifier names, and resolving relative ones against the importing
file's own directory:

| specifier | rows | bound | detached | … of detached: BINDABLE | module not in sample | star |
| --- | --- | --- | --- | --- | --- | --- |
| relative (`./`, `../`) | 974 | 281 | 693 | **234** | 363 | 94 |
| hash alias (`#compiler/…`) | 91 | 0 | 91 | 0 | 0 | 91 |
| node builtin | 54 | 0 | 54 | 0 | 52 | 2 |
| bare package | 83 | 8 | 75 | 0 | 57 | 18 |

234 rows named a module that IS in the sample and DECLARES the item. They were
declined by two gates, and both declined them for a reason that had stopped being
true — in `src/ast/import-resolution.ts`, not in this analyzer.

**Gate 1 — the export surface was recovered from a module basename, so a
path-spelling lane had an EMPTY one.** An `exports` edge's source symbol is the
module, which is not a symbol, so the file is recovered from `source_external`;
the recovery accepted it only when it equalled a file's basename STEM, uniquely.
A path cannot equal a stem, so every file in every file-level lane had no export
surface — and the gate that keeps resolution honest ("a target must be in the
importing module's export surface before it may be joined", added after a
name-only match produced a confidently WRONG edge) then declined every import
into the lane. **This one is a regression the file-level wave itself introduced:**
the gate's rule was right, its file-recovery was written when `source_external`
was a basename for every lane, and the wave changed that for eleven of them. The
recovery now tries the exact PATH spelling first (nothing else can match it) and
keeps the basename-uniqueness rule as the fallback for lanes that still write one.

**Gate 2 — the ambiguity refusal rested on a premise the wave invalidated.**
`planImportResolutions` refuses a specifier that resolves to several files, and
its comment said why the tie cannot be broken: *"The relationship carries no
importing file — `relId` is `${projectId}:rel:${sourceId}:…` and an import edge's
source symbol does not exist, so the file is simply not in the row.
`source_external` is the importing file's module BASENAME."* Both halves of that
are now stale: the id carries the file (this round) and `source_external` IS the
importing file's path for every `fileLevel` lane. So the planner resolves the
specifier from the importer's own directory first, which is not a tie-break but an
EXACT answer, and is strictly stronger than the map it precedes: `pathTargets` is
keyed by the specifier STRING, so one `./util.js` written by three importers is a
3-element set and gets refused even though each importer's meaning is unambiguous.
The empty-set and non-path cases fall through to the old strategies unchanged.

A third, smaller correction: the refusal CLASSIFIER re-derived its reason from
`pathTargets` alone, so a row declined by the export gate was reported as
"ambiguous-multiple-files". It now mirrors the branch, because a diagnostic that
names the wrong gate sends the next reader to the wrong code.

**Result** (250-file draw, same instrument):

| | before | after |
| --- | --- | --- |
| `imports` attached | 276 / 1,202 (**23.0%**) | 527 / 1,202 (**43.9%**) |
| `imports` detached | 926 | **~675** |
| attached edges (all labels) | 5,381 (27.6%) | 5,613 (**28.7%**) |
| target symbols with ≥1 inbound edge | 993 (85.0%) | **1,035 (88.6%)** |
| source-side numbers (file-level / name-spelled) | 2,707 / 187 | 2,707 / 187 (untouched, as expected) |

The target side wobbles ±9 rows between identical runs (the same noise class this
document already records for `imports`), so the two decisive numbers are the
`imports` label's own move and this: among the ~675 rows still detached, **only 5
now name a module that is in the sample and declares the item** — down from 234.

**Two counts in that table are corrected here** (the attached pair was written as
530 and ~880 while the percentages were computed from the true pair, 276 and 527).
A row whose count and its own percentage disagree is §7's defect class, not a typo
to leave standing; the percentages were right and the counts now are too.
Re-measured on the same draw after this round's re-export change: detached 676 →
674 and attached 526 → 528, which is inside the ±9-row band and therefore §5's A/B
rather than that pair carries the re-export claim.
The remainder is 363 rows whose module is outside the 250-file sample (they bind
on a full project, and cannot on a subset), 185 namespace/star imports (`:*` names
no single symbol — resolving it would invent a node), and ~180 node builtins and
bare packages, which are external by construction.

**Pinned by mutation, through the real entry point.**
`script/m14/verify-import-resolution-path-spelling.ts` builds a temp sqlite
fixture of two files with the SAME basename (`src/a/util.js` and `src/b/util.js`,
both declaring `helper`, both imported as `./util.js:helper`) and calls
`resolveImportTargets` — four properties, exit 0. Two mutations were run against
it and both were caught: neutering the importer-relative branch → 2 of 4 fail
(`ambiguous-multiple-files` for the path row), and restoring the basename-only
export recovery → 2 of 4 fail (the same row, declined by the export gate). The
fourth property is the falsification case built in: with basename-spelled export
rows the SAME row must NOT resolve, so a suite that only asserted the success
would pass on a resolver that resolved everything.
`script/audit-index-modules/verify-import-fingerprint-index.ts` (the committed
audit for this module's other half) stays **50/50 green**, and
`verify-override-retarget.ts` still holds.

#### What the DETACHED targets are, and which of them any name-keyed resolver could ever take

A resolver change can only move rows that have a CANDIDATE. So the store
instrument now censuses the incoming side the same way it censuses the outgoing
side — by the analyzer's own shape flags, with two candidate tests per row. Same
250-file draw, two runs:

| shape (`uses` unless stated) | rows | the route it has |
| --- | --- | --- |
| `calls` row | **5,311** | the leaf of a call — a prototype or a library member |
| chain SEGMENT (property name) | **3,241** | the RECEIVER'S TYPE, i.e. JSDoc `@param {T}` + a declared member |
| BARE read | 2,612 | a global (external) or a local binding (not a symbol) |
| call RECEIVER root | 947 | same two cases as a bare read |
| chain ROOT | 899 | same |
| `imports` row | 674 | modules outside the sample, namespace imports, builtins |
| template read | 162 | a local in scope |
| `instantiates` 29 · `exports` 28 · `extends` 4 · `references` 1 · `contains` 1 | 63 | mechanical residue |
| **total** | **13,909** | |

*This table is the shape census from an earlier round, kept because its per-shape
columns are what the later reason codes are argued against. Its total is SUPERSEDED
— §"Every detached row now carries a REASON CODE" below reads 14,336 on the same
nominal 250-file draw, and the two are not comparable row-for-row because the
analyzer, the store's file-level branch and the symbol-name register all changed
between the rounds. Read the reason-coded section for current numbers and this one
for why each shape has the route it has.*

**The candidate tests, and both come back empty.** The store resolves by NAME, so
for each detached row the question is whether a name-keyed candidate exists at
all:

| test | run 1 | run 2 |
| --- | --- | --- |
| leaf names a STORED symbol anywhere in the sample | 11 | 15 |
| …and that symbol is declared in the row's OWN file (a real miss) | **0** | **0** |
| target IS a PARAMETER of the row's own source symbol | **1,383** | — |

So there is no store miss left in this population: not one of 13,909 detached
rows has a candidate in its own file. The two largest shapes — 8,552 rows, 61.5%
of the population — were checked directly against the written index and return
**0 of 5,311** `calls` and **0 of 3,241** segments whose leaf is a stored symbol
anywhere: their targets are `push`/`map`/`includes`/`slice`/`filter` (Array,
String, Set prototypes — declared by no corpus file, external by construction)
and `node`/`state`/`length`/`expression`/`metadata`/`scope` (property reads whose
declarations the analyzer does not publish — 27 `property` symbols in the whole
sample). A resolver cannot bind a name that names nothing.

**The 1,383-row parameter column closes a design question rather than opening
one.** That is the population a "publish parameters as symbols" design would have
bound, and publishing them is FORBIDDEN repo-wide: `SymbolKind` has no `Parameter`
member at all, and csharp removed its own under `ParamsAreNotSymbols` /
`LocalsAreNotSymbols` with swift/kotlin/julia recording the same removal (see
`real-julia-analyzer.ts`, where the first version published them, produced two
`undefined`-kind symbols and the compiler rejected the vocabulary). A parameter is
a BINDING, not a declaration. The instrument prints the number as a closed route
so no later round has to re-derive that it was considered.

**A bug in the first version of this census, recorded because the doc's own rule
is that a measurement states how it was checked.** It reused the OUTGOING loop's
skip condition (`source_symbol_id != null → skip`) and so censused only the 2,894
rows whose SOURCE is also unattributed — a population in which, by construction,
almost no row has an enclosing function with parameters. It printed "target is a
parameter: 0" beside a direct SQL query on the same database that returned 1,358
`uses` rows. The skip is now on the TARGET (`target_symbol_id != null → skip`) and
the two methods agree (1,383 all-labels vs 1,358 `uses`-only — the 25-row gap is
exactly the `calls` label). The instrument's other invariants hold on both runs:
`source_external` sentinel left un-rewritten = 0, decidable rows landed in the
source file = 2,565 of 2,565 (100.0%).

**What this leaves as the next lever, stated as a decision rather than a task.**
The remaining detached population is not resolver-tunable: it is either external
(prototype/global/DOM/library surface, unnameable in-corpus) or contract-closed
(parameters/locals). The segment class could only ever bind if the analyzer
PUBLISHED the members its property reads name — an ontology change (new symbol
rows, `metadata.declaresProperties`-style payload on the JS lane, an oracle
co-move in `deriveJavaScriptEdges`), which is a new wave with its own gates, not
more of this one.

#### Every detached row now carries a REASON CODE, and the codes are exhaustive

A count of `DETACHED: 14,336` is a population that has not been asked why, and a
shape census is only half an answer: "`calls` row" does not say whether the call
was the resolver's to take. The instrument now assigns every detached row exactly
one reason, decidable from this draw alone — the row's own file, the bindings
`brain_import` records for that file, the engine-enumerated standard-library set,
and the spelling itself. The classes are mutually exclusive by construction and
exhaustive by construction, so a class that silently stops matching prints as a
non-zero `unclassified` remainder instead of a quieter total:

| class | rows | what it means |
| --- | --- | --- |
| 1. the SOURCE is unattributed | **1,557** | belongs to the OUTGOING table, not to the resolver |
| 2. label outside the resolver's scope | **0** | `contains`/`overrides` — a different pass owns them |
| 3. target IS a parameter of the row's own source symbol | **1,527** | a binding, contract-closed (above) |
| 4. the row's file records NO binding for the leaf | **10,464** | the import statement cannot decide it — sub-classified below |
| 5. the binding's module is EXTERNAL | **255** | a package or a node builtin: no project file to name |
| 6. the module is RELATIVE but resolves OUTSIDE this draw | **530** | the sample boundary, not a resolver gap |
| 7. the module is INSIDE the draw **and declares the leaf** | **0** | the only class that IS the lane's open work |
| 8. the module is INSIDE the draw but declares no such name | **3** | the edge names an import BINDING, not a declaration |
| **total** | **14,336** | `unclassified: 0` |

**Class 7 reads 0, and getting there was two corrections to this instrument's own
first answer.** The first version filed 788 rows as resolver-eligible. It was
asking only whether the binding's module was relative, never whether the draw
CONTAINED the module it named: the sampled examples all turned out to be modules
outside the 250-file draw (`utils.js`, `compiler/state.js`), which is what class 6
exists to separate — that check alone moved the class to 533. The last three rows
were `import * as acorn from '../acorn.js'` (read as `acorn`) and
`import entities from './entities.js'` (read as `entities`); both modules are in
the draw (ranks 50 and 63 of the admitted list) and NEITHER declares a symbol of
that name — `acorn.js` declares `parse`, `remove_parens`, …, `entities.js` has
exactly `export default {...}` — so the edge's target is the local BINDING. A
binding is not a declaration: its route is the `imports` edge that the store
already carries (`acorn:*`), and attaching the `uses` row to a namesake would
invent a target. Measured on the same draw, the member READ of such a namespace
does resolve where a member exists: `acorn.parse(...)` in
`1-parse/read/script.js` lands on
`…/1-parse/acorn.js:parse:26`, attached. Class 8 is that population, and class 7 —
the rows this lane's resolver was eligible to decide and did not — is empty.

**Class 4's 10,464 rows are what is left, and they split four ways.** "No binding
for the leaf" lumps a prototype method, a property read off a local object and a
name the draw declares into one number; the sub-classes tell them apart, and the
sub-class sum is printed so the split cannot drift from its class:

| sub-class | rows | route |
| --- | --- | --- |
| a) ECMAScript standard-library name (engine-enumerated) | **3,101** | none — no project file declares it |
| b) the draw DOES declare that name | **0** | receiver typing only |
| c) chain SEGMENT of a name the draw declares nowhere | **3,014** | a member of a local object or an external surface |
| d) BARE read of a name no file in the draw declares | **4,349** | a local binding (may not become a symbol) or an external surface |
| **total** | **10,464** | `unclassified: 0` |

Sub-class (b) at 0 is the strongest single statement here: not one detached row in
class 4 names a symbol this draw declares, so no name-keyed lookup could have
taken any of them. The shapes inside class 4 are `calls` 4,453 · chain SEGMENT
3,288 · BARE read 1,746 · chain ROOT 446 · call RECEIVER 427 · template read 100 ·
`extends` 3 · `instantiates` 1.

**The two tables close on each other, and the closure is printed rather than
claimed.** Class 1 defers its rows to the OUTGOING table instead of judging them,
so the classification is only complete if those rows are classified there too. The
instrument counts rows with BOTH ends unattributed independently of the reason
loop and prints the two numbers side by side; on this draw `1,557` and `1,557`,
with the agreement spelled out (`nothing escapes both`). The outgoing table
classifies all 2,900 NULL-source rows — 2,711 file-level (attributed: the store's
M60/#910 branch rewrote the sentinel, and the un-rewritten count is 0) and 189
name-spelled, of which **178 are neither** (an external surface or an unpublishable
local binding) and **11 name a name the sample declares — SOMEWHERE ELSE**.

**That second half was reported last round as "a source-side attachment the name pass
did not make", and it is a reading error of this instrument's own** — corrected here,
because it is the same error as the 788/533 one and it has the same cause: the class
asked whether the SAMPLE declares the name and never asked which FILE does. The row id
carries the row's file (`file:<relativePath>` — the file-level wave's anchor for
exactly the rows whose source did not resolve), so the file of a NULL-source row is
recoverable from the id alone, and the class now splits three ways by it:

| the name is declared… | rows | verdict |
|---|---|---|
| in the row's OWN file, **in the STORE** | **0** | the miss: same-file evidence the resolver had and did not use |
| in the row's OWN file, in the **ANALYZER's output only** | **0** | a store-path drop, not a resolver miss |
| only in OTHER files of the sample | **11** | a name COLLISION: attaching would be a wrong-file lie |

Both same-file classes read 0, so the outgoing side has no resolver work. The 11 are
six rows in `benchmarking/compare/generate-report.js` (lines 38-39, whose actor is the
local `const write = (str) => {…}` at line 37 — a nested arrow function this language
does not publish and this analyzer does not publish either, measured: the file's
analyzer output holds no symbol of that name) and five in
`packages/svelte/src/compiler/phases/3-transform/utils.js` (lines 375-378, whose actor
is the local `const RegularElement = (node, { stop }) => {…}` at line 374 inside
`check_nodes_for_namespace`). `write` is declared once in this draw — in
`benchmarking/benchmarks/ssr/wrapper/wrapper_bench.js`, an unrelated top-level function
— and `RegularElement` in six other files, so in both cases the only candidate the name
pass could reach sits in a file with nothing to do with the row. **They are the same
population as the 178 "neither" rows** (an actor that is a local binding the language
does not publish); what makes them look different is only that a stranger's name
matches. The itemized rows travel in `--json` as `nameSpelledDeclaredRows` (class, own
file, and whether that file declares the name in the store and in the analyzer's
output), so the two zeros can be re-taken rather than re-argued.

**The two zeros are ASSERTED, not only reported.** A draw can measure a class; it cannot
assert one, and on a draw a `0` and a rule that stopped being evaluated are the same number —
which is why `script/m14/verify-js-source-attribution.ts` builds a project whose answer is
known BEFORE the run and reads the classification back through the real indexer: a file that
declares `caller` and calls `helper` from it (the positive control — the store's insert-time
same-file lookup must resolve a row inside that file), a local `const write = (text) => {…}` in
a file that declares no `write`, and `lib/stranger.js`, which does. **12 checks, 12 pass, exit
0**: A1–A3 the premises (the collision rows exist, a candidate exists, the row's own file
publishes nothing of that name in either view), B1–B3 the refusal (NULL source, classified
`other-files`, own file recovered from the id), B4/B5 the two zeros, B6 the closure over the
fixture's NULL-source rows, B7/B8 the file-level half (the source IS the row's own path, and
no raw `(file)` sentinel survived), B9 the control.

**The rule lives in ONE module** — `script/m14/js-ontology/js-source-classification.ts` —
because the instrument and the gate ask the same question of two different evidence bases
(a 250-file draw's stored names, a fixture's known answer), and this lane has already paid
for two copies of one rule: JSD44 measured a name register written out in four places, where
correcting one left the other three refusing the names it had just admitted. The module also
carries the engine-enumerated standard-library surface, which was pasted into two instruments
before this round; `js-detached-triage.mts` and the store instrument now import it.

**AND THE CLASS'S OWN LABEL WAS TOO STRONG, corrected in the same edit.** It printed `the
resolver had same-file evidence and did not use it`, which explains a non-zero reading as an
act of omission. The store DOES look — `nameToSymbol.get(sourceName) ??
nameToSymbol.get(sourceLeaf)` at insert time — while the class is computed from `brain_symbol`
READ BACK after the run. So a non-zero reading does not mean the lookup was skipped: it means
the insert-time symbol set and the read-back symbol set DISAGREE about the row's own file,
which is the shape a dropped or late-admitted symbol produces. That is what the printed label
now says, and it is what the gate's B4 asserts.

**FALSIFIED IN TWO INDEPENDENT ARMS, each restored byte-identically by sha256.** With the
store's insert-time same-file source lookup neutralised (`parallel-indexer.ts`, the
`sourceName` guard short-circuited; sha256
`d60d633f1f14305afa38bd5925246297c4fc009cf96a29d448de718e52b1ab84` before and after) the gate
reads **10 of 12**, failing exactly **B4** (`own-store`) and **B9** (the control) — the two
checks that exist for that behaviour — with the collision checks A1/B1–B3 correctly
unaffected, which is what makes the arms distinguishable rather than one blanket failure.
With the row-id anchor recovery broken (`":rel:file:"` renamed inside the module; sha256
`52fdd17007094d83b096a5c1e3540397bb129c0f58a21a026d6a7939b9911d2d`) it reads **8 of 12**,
failing A1, B2, B3 and B7 — the anchor rule the entire classification rests on.

**One defect found by writing the gate, recorded because it is this lane's second time**: the
gate's summary line was TYPED (`10 of 10 checks`) while twelve checks executed — the same
shape the binding gate shipped earlier in this milestone (a hardcoded `32 of 32` against 33
running). The count is now taken from the checks that run, which is the only part of a gate
nothing else can verify. A second defect was in the module: the file-level verdict did not
carry the row's own file (the instrument never needed it; the gate's B7 does), found by B7
failing on the gate's first run.

**A gap this round's own verification found, recorded because a check has to be
stated for what it covers.** `typecheck:scripts` compiles
`script/m14/**/*.ts` — a glob that does **not** match `.mts`, so every `.mts`
instrument in that directory sits outside it; measured by listing the config's own
program, which contains the `.ts` scripts and none of the 75 `.mts` ones. Both of
this lane's `.mts` instruments (`javascript-store-resolution.mts`,
`js-ontology/js-detached-triage.mts`) were therefore type-checked here under an
explicit include, and `tsc` reads **0 errors** for them. Widening the shared
include is NOT done in this lane: under the same explicit include the directory
reads **97 errors across 24 other lanes' `.mts` scripts** (protobuf 19 + 3 + 2 + 1 +
1 + 1, python 17 + 7 + 7, java-fold 6, vb 5 + 1, py10 5 + 4, svelte 3 + 2 + 2 + 1,
vue 3 + 2, groovy 2, perl 1 + 1, clean-ambiguity-split 1), plus 3 `Bun`-global
errors that only the ad-hoc program surfaces in `.ts` files which compile cleanly
in the config they belong to. Flipping the glob would therefore turn a passing
check red for work that is not this lane's — the gap is reported, with its size,
rather than silently inherited.

**Reproducibility, stated as a bound — and the variance is LOCALIZED, which is the
stronger statement.** The instrument indexes through `indexProjectParallel`, and
four runs of the same command on the same tree read 14,343 / 14,335 / 14,336 /
14,339 detached rows with 1,564 / 1,556 / 1,557 / 1,560 in class 1. Every OTHER
class is byte-identical across all four runs — 1,527 / 0 / 10,464
(3,101 · 0 · 3,014 · 4,349) / 255 / 530 / **0** / 3 — as is the outgoing split
(2,711 + 189) and the class-1 cross-check against the outgoing table, which agreed
in every run. So the spread sits exactly where the mechanism predicts it: class 1
is the population whose SOURCE resolution is a race between workers, and the
classes that judge the INCOMING side do not move at all. The decidable numerator
moves with the same bound — 2,570 · 2,578 · 2,577 · 2,574 across the four runs, and
2,565 in the earlier round this doc reports — with **100.0% landed in the source
file and 0 wrong-file in every one of them**, and the file's own JSON now writes
every class including the zero ones, so a consumer cannot read an absent key as an
empty class.

**The variance was then localized, and it is NOT the source side — this doc's earlier
guess ("class 1, the source-side race") was wrong.**
`script/m14/verify-resolution-determinism.ts` indexes the same deterministic 250-file
draw into TWO separate projects and compares every `brain_relationship` row by its
endpoints. Measured: the two runs' row identity sets, symbol identity sets and the
module-aware planner's decisions are **identical** (19,855 rows, 1,172 symbols, 0
differences), while **8 / 9 / 10 / 4 / 28 / 42 rows** of the six pairs run so far resolve
to a DIFFERENT target — a spread that grows with scheduling pressure, which is the shape
the mechanism predicts. Every one of those rows is an `imports` edge in the
`module:item` form, and each side is classified against the mechanisms that can write
such a target, recomputed from that run's own tables:

  - the **insert-time leaf ranking** — `resolveTargetStmt`, keyed on the target's LEAF
    (`zimmerframe:walk` is asked for as `walk`), ranked
    `COALESCE(is_declaration,0), same-file, same-language, id` with `LIMIT 1`. For a
    parallel index the batches are stored as workers finish, so the table it ranks is
    the PREFIX written by then: the gate replays that prefix (candidate files written no
    later than the row's own importing file, read from `brain_symbol.rowid` order) and
    reports the two answers it produces — measured on real rows, `0/1 candidate files
    written by then` vs `1/1`;
  - the **module-aware planner** (`resolveImportTargets`), which resolves the specifier
    from the importing file's directory and is guarded on `target_symbol_id IS NULL` —
    so it can attach a row the prefix ranking left alone, and can never correct one the
    prefix ranking attached FIRST.

That second half is the defect: for `./utils.js:is_global` one run stores the planner's
answer (`css/utils.js`) and the other the prefix ranking's (`css-prune.js`), because the
leaves of both mechanisms produce a symbol whose NAME is the row's item. Rows the
planner does not prove are left with whatever the prefix saw — of the draw's
`zimmerframe:walk` rows some are attached in one run and NULL in the other. The
per-side labels are the measurement, and they are lopsided in the direction that names
the defect: in the 42-row draw, **34 are A: module-aware planner / B: insert-time leaf
ranking**, 5 are NULL-vs-ranking and 3 are the mirror of the first. The gate is 4 checks,
**3 pass / 1 fail** (row identity equal, symbol identity equal, every divergence
attributed with 0 unexplained; the property itself red): record
`validation/m14/measurements/resolution-determinism.before.json`.

**The fix is LANDED (JSD50), and the same gate now reads 8 of 8 with 0 divergent rows.**
(It read 6 of 6 when this paragraph was written; the two checks added since are the payload
comparison — which found JSD51 — and the pass's own cross-run gauges.)
`settleImportTargets` (`src/ast/import-resolution.ts`) is called from the resolution phase
at the one point where both tables are complete and the import/export evidence exists —
immediately after the binding pass and BEFORE the cross-language normalization that fills
its bridge — and it re-decides every `module:item` row rather than only the NULL ones:
the module-aware planner's answer wins wherever it is proven, and where it is not, the
insert path's OWN ranking runs over the complete symbol table (same four keys:
definition before declaration, then the row's file, then its language, then the id). A
row whose settled answer is NULL and which carries a target is DETACHED, which is the one
branch that removes an edge. Both halves are fixed points, and the gate asserts that
rather than arguing it: asking the pass AGAIN over the store the index run just settled
reads **0 corrected / 0 settled / 541 unchanged of the 1,203 `module:item` rows**, 503 of
which the planner proves; on the same draw **0 of 19,855 rows diverge** (record
`validation/m14/measurements/resolution-determinism.after.json`).

**The gate is proved able to fail, on the same draw, by the one line the fix adds.**
With the `settleImportTargets` call replaced by a no-op and nothing else changed, the gate
reads **2 of the 7 checks red in both arm runs**, and the divergence it sees is itself
scheduling-dependent — **57 rows on one arm run and 8 on another**, with 0 unexplained in
both (33 and then 3 labelled `A: module-aware planner; B: insert-time leaf ranking`, the
rest with the insert-time ranking on a side the planner or the complete-table ranking
explains). That spread is the defect stated in its own units: with the fix in place the
same gate reads 0 divergent rows on every run, and without it the answer is a function of
which worker finished first. Off-arm the pass also reports the work it owes — **113 / 140
corrections and 17 settlements on one pair, 139 / 141 and 16 / 11 on another**, and
**disagreeing gauges between the two runs of the SAME arm pair** (`attached 525 vs 530`),
which is the seventh check and the reason it exists: the finished store shows none of this
because the finished store is the fixed point (records
`validation/m14/measurements/resolution-determinism.arm.json` and
`resolution-determinism.after.json`; the arm was restored byte-identically after every run,
verified by sha256).

**What the settlement costs, and the same instrument is what makes the cost legible**
(`script/m14/javascript-store-resolution.mts --files=250`, records
`store-resolution-jsd50.before.json` / `.after.json`). Same instrument, same draw, one
variable — the settlement call — and **the aggregate total that this lane carried as a
reproducibility BOUND is now exact under the fix and only wobbly without it**: three runs
with the pass live read 14,324 detached rows every time (attached 5,531 every time), while
two runs with it neutralised read 14,338 and 14,342. The same split shows in every number
that moves with it — `imports` rows detached 676 / 680 (arm) vs **662** (live, three runs),
attached edges 5,513 / 5,517 vs **5,531**, and **import-decidable rows 2,571 / 2,575 vs
2,589 with 100.0% of them landed in the source's own file and 0 wrong-file in EVERY one of
the five runs**. The reason classes stay exhaustive in both arms (`unclassified: 0`, the
two tables agreeing 1,545 live), and `detached rows whose leaf names a STORED symbol` reads
135 in all three live runs. The attachments the pass adds are therefore of the strongest
shape this lane has — the row's own file declaring the name — not name matches across
files, and the honesty invariant holds while its denominator GROWS.

**The other side is stated as the price rather than left out.** On the arm, of the draw's
1,203 `module:item` rows **503 are planner-proven and 139 of the stored targets differ
from the planner's answer** (115 on an earlier arm dump — the arm is the racy state, which
is why its counts move), **16 detached rows gain a target** because the leaf name exists
somewhere in the project (22 on the earlier dump; the insert path already attached exactly
those rows whenever the name happened to be stored early enough), and the remaining **662**
name no symbol anywhere and stay detached in every run. A second, independent draw
(`--corpus=lodash`, 250 files, 12,222 rows) reads **0 divergent rows, 8 of 8 checks, and
identical pass gauges** (`validation/m14/measurements/resolution-determinism-lodash.json`,
re-measured 2026-10-12: gauges `scanned=77 planned=0 attached=0 unchanged=0 unresolved=77
corrected=0 settled=0`, so the eighth check — the source-side endpoint, the outgoing half —
is green on this draw too; the same run read 7 of 7 before the gate gained that check) — and
it is recorded with its own weakness spelled out: that draw has 77 `module:item` rows,
0 attached and 0 planner-proven, so it verifies the PROPERTY
without exercising the correction, which is exactly the "green means nothing" shape this
lane keeps catching in its own instruments. One further independent instrument, the closed
368-file population, still reads **3,113 of 3,113 decidable rows landed with 0 wrong-file**
with the pass live.

**The classification was then re-run on an independent draw** (`--files=120`, a
different population of 7,121 detached rows rather than the same 250 files): the
classes stay exhaustive (`unclassified: 0` in all three tables), the cross-table
closure agrees again (1,110 = 1,110), class 7 is **0** again, and the 3 rows in
class 8 are the same two bindings — so the empty resolver-eligible class is a
property of the lane's resolver, not of one draw's arithmetic. Decidable rows on
that draw: 1,602 of 1,602 landed, 0 wrong-file.

### What was landed

Eight items, each measured at both ends:

1. **`real-javascript-analyzer.ts`** — a class symbol now carries
   `metadata.superTypes` from its heritage clause, and members carry
   `qualifiedName = Owner.member`. Neither existed, so the store's `super_types`
   column had no writer for this lane and `override-retarget`'s method index had no
   qualified names to build from.
2. **`pool-worker.ts`** — the metadata allowlist now carries `superTypes`. This was
   the actual blocker: the store binds `symbol.metadata.superTypes` →
   `brain_symbol.super_types`, and the worker dropped the key, so the hierarchy was
   NULL for every language on the production path (0 of 3,757 symbols at 1,200
   files). The CSS `declaresProperties` and markdown `headingLevel` seams are the
   same defect class, met from the same side.
3. **`override-retarget.ts`** — the pass read the overriding owner from
   `source_external` only, the column that is populated exactly when the source did
   NOT resolve. Every row whose source resolved was skipped at its first line; on
   this corpus that is 52 of 52 rows. It now falls back to the resolved source
   symbol's `qualified_name`.
4. **`real-javascript-analyzer.ts` + `parallel-indexer.ts`, this round** — the
   file-level actor (`"(file)"` + `metadata.fileLevel`, replacing the module
   basename) and the store id that had no file in it when the source was
   unresolved. Both are documented with their before/after measurements in
   §"Outgoing" below — that section is the record, and it is where the eight
   expectation updates are justified.
5. **`import-resolution.ts`, this round** — the two gates that a path spelling
   fixed: the export surface is recovered from the PATH first (a path-spelling
   lane had an EMPTY one, which declined every import into the lane), and the
   planner resolves a specifier from the importing file's own directory now that
   the file is in the row. §"Incoming" above has the population, the
   falsification and the result.
6. **`script/m14/javascript-store-resolution.mts`, this round** — the outgoing
   split gained its incoming counterpart: the detached-target census by shape flag
   (with the parameter column and the two name-candidate tests), printed and
   written into the `--json` artifact as `detachedByShape`, `detachedByLabel` and
   `targetIsParameterOfSource`. It is what makes "the target side has nothing left
   to take" a measurement instead of a hunch — see §"Incoming" above, including
   the off-by-loop bug it caught in its own first version. **Extended this round
   from a census into a classification**: every detached row carries exactly one
   reason code (eight classes, exhaustive, sum printed against the total), class 4
   is sub-classified four ways, the outgoing defect half carries its own reason
   codes, the two tables are cross-checked for closure, and the results go into
   `--json` as `detachedByReason`, `nameSpelledByReason`, `noBindingSubClasses`
   and `noBindingByShape`. That extension is what turned "there are 14k detached
   rows" into "none of them is the resolver's to take", and it also retracted a
   number this doc previously reported — see JSD47 and the reason-code subsection
   of §"Incoming".
7. **`real-javascript-analyzer.ts` + `differential.ts` (the oracle), this round** —
   the named re-export clause's members, in ONE change: the analyzer publishes
   `path:<member>` per written specifier at 1.0 with `declaredName`, the oracle
   derives the same rows, and two updated fixtures plus one new one pin the
   boundary. Open findings §5 has the A/B (271 member rows in, 106 `path:*` rows
   out, per-file deltas agreeing on all 13 files) and the reason it had to be both
   files at once.
8. **`real-javascript-analyzer.ts` + `differential.ts` (the oracle), this round** —
   §2: a published `calls` target must be a NAME, so the token-membership guard is
   now `isNameShapedCallTarget` (ID_Start/ID_Continue plus a leading `#`) in the
   analyzer, mirrored test-for-test in `deriveJavaScriptEdges`. Measured on the
   corpora before the change: 31 of 31,973 svelte `calls` rows (0.097%) and 550 of
   22,210 ts rows (2.476%) held source text; after it, 0 and 0, with the 123 svelte
   `#private` call targets intact. The lodash differential draw reproduces the
   recorded baseline hash and reads **100% covered / 0 MISSING / 0 unexplained**,
   with the same 222 rows leaving BOTH sides. Open findings §2 has the fixture, the
   guard-revert arm (**75 pass / 1 fail**, that fixture the only failure), the sixth
   lane mutant, and the follow-on this fix deliberately does NOT do (recovering the
   name a transparent wrapper hides: 26 + 174 paren rows). Its three arms are the
   point: the finding appeared in at least two earlier rounds and was reported each
   time, and neither report could state a fixture that covered it (the suite's 75
   fixtures passed with the defect live) or a mutant that reverted it (the five
   older lane ids name other defect classes) — so the class survived a lane that had
   already closed the neighbouring one.

9. **`js-ontology/js-source-classification.ts` + `verify-js-source-attribution.ts`, the
   JSD48 round** — the outgoing classification moved into ONE module (the rule, the row-id
   anchor recovery, and the engine-enumerated standard-library surface the two other
   instruments had each pasted), and the two classes that must be empty are now ASSERTED on
   a fixture whose answer is known before the run instead of only counted on a draw. The
   gate is 12 checks, exit 0; both zeros fail when the behaviour behind them is removed
   (10 of 12 with the insert-time lookup neutralised, 8 of 12 with the anchor recovery
   broken — the failing checks are named in the reason-code subsection), and each arm was
   restored byte-identically by sha256. Writing it found two defects of its own: a typed
   summary count (twelve checks under a `10 of 10` line) and a module verdict that dropped
   the row's own file on the file-level class. The same round retracted a claim from JSD47 —
   the 11 rows it carried as "a source-side attachment the name pass did not make" are name
   COLLISIONS with local bindings — see §"Incoming"'s reason-code subsection.

10. **`verify-resolution-determinism.ts`, the JSD49 round** — the reproducibility bound
   this doc carried in prose became a checked property, and checking it corrected the
   mechanism the prose named. The gate indexes the same draw into two projects and compares
   every relationship by its endpoints: row identity, symbol identity and the module-aware
   planner's decisions are IDENTICAL, while 8 / 9 / 10 / 4 / 28 / 42 rows resolve to a
   different target across the six pairs measured, and every one of them is attributed,
   from that run's own tables, to the insert-time leaf ranking racing the module-aware
   planner (34 of the 42 read `A: module-aware planner; B: insert-time leaf ranking`).
   GATE **3 of 4, the property red on purpose**; record
   `validation/m14/measurements/resolution-determinism.before.json`. JSD49 has the
   mechanism, the evidence and the designed fix; landing it was JSD50 (item 11).

11a. **The check that found the NEXT defect, in the same round's gate** — the determinism gate
   gained a payload check (a row's stored target AND its three derived fields). It went red on
   the first run: 66 of 19,855 rows stored a different `is_cross_file` across two indexings
   with **every target identical**. That is JSD51 below.

11. **`settleImportTargets` (`src/ast/import-resolution.ts`) + the call in
   `parallel-indexer.ts`, the JSD50 round** — the fix JSD49 designed and deliberately did
   not claim: every `module:item` target is re-decided over the COMPLETE tables at the one
   point where they are complete, the planner's answer winning where it is proven and the
   insert path's own ranking being re-evaluated over the whole symbol table everywhere else.
   The measured result is that   the property goes from red to green — **0 of 19,855 rows
diverge, in every run** (was 4 to 42 across pairs) — while the pass itself is a fixed point
(0 corrected / 0 settled on a second run, with the pass's own gauges equal to the row across
the pair), and the arm that removes its one line reads **8 and 57 divergent rows on two runs
of the same draw with 3 checks red and gauges that DISAGREE across the pair**. (The gate was
7 checks then and is 8 now; item 12 below is what the eighth one found.) Records:
`resolution-determinism.after.json`, `resolution-determinism.arm.json`, and the
same-instrument cost measurement `store-resolution-jsd50.before.json` / `.after.json`.
**The lane's own bound is retracted with it**: the census used to report a ~10-row (0.07%)
run-to-run spread (14,343 / 14,335 / 14,336 / 14,339) and call it reproducibility-at-a-bound;
the spread WAS this defect — with the pass live the same instrument reads 14,324 detached
rows on three consecutive runs, and with it neutralised, 14,338 and 14,342. Fifteen-ish more
`imports` rows attach (676 / 680 on the arm against 662 live), every one of them decidable
and landing in the row's OWN file, 0 wrong-file in all five runs.

12. **The `is_cross_file` closure (`parallel-indexer.ts`, the JSD51 round)** — the derived half
   of the same defect class, found by the gate extension above rather than by looking for it.
   The column had FIVE writers, they disagreed, and which one touched a row first depended on
   batch order, so `is_cross_file` was both under-claimed and run-dependent: **66 rows flipped
   between two runs of the same source with every target identical**, and **533 of the 5,531
   resolved rows (9.6%) stored 0 on a target in another file** — 427 of them `imports`.
   The cause is structural: a cross was claimed only when the row's SOURCE SYMBOL resolved
   (`sourceId !== null`), while the planner's UPDATE compared the target's file against the
   target's own — a constant 0 — so a row whose source is unattributed but whose
   `source_external` is a project PATH (the file-level spelling) was never claimed by anyone.
   There is now ONE writer, a set-based closure that runs after every pass which can move a
   target and before the cross-language pass, and it decides from the row itself in three
   routes — the source symbol's file, the `file:<relativePath>` **anchor in the row's own id**
   (the store builds ids as `${projectId}:rel:${sourceId ?? `file:${relativePath}`}:…`, so the
   anchor IS the emitting file and is present exactly when the source did not resolve), then
   `source_external` as a path. Measured: the gate reads **8 of 8 with 0 of 19,855 rows
   differing on (target, is_cross_file, is_cross_language, bridge_mechanism)**, the derived
   value matches the stored one on **every** row (0 residual), and the anchor answers **all 22**
   of the draw's unknown-source rows — without it the closure would store 0 on edges whose
   target IS in another file. The arm that makes the closure's write a no-op puts the payload
   check red again (11 rows) and leaves **650 / 647 rows** wrong against the derived value
   (11.7%: 541 `imports` 0→1, ~54 `calls`, ~51 `uses`, 1 `exports`, and a handful of 1→0 rows
   whose source file is genuinely unknown), so the repair is measured rather than asserted.
   Nothing else moved: the store's attachment census reads the same numbers as JSD50
   (5,531 attached / 14,324 detached / 2,589 decidable landing 100.0%), the 368-file landing
   instrument still reads 3,113 of 3,113 with 0 wrong-file, and the relationship phase reads
   3,091 / 3,471 / 3,555 ms with the pass against 2,963–3,632 ms without it — its cost is not
   separable from that phase's own spread at 250 files. Six of the flag's consumers fail in
   this tree for reasons that predate the change and fail IDENTICALLY with the closure
   neutralised (`m64` patterns-evidence, `m13/patterns-orphans`, `m59/call-site-dedupe`, the
   markdown store round-trip, the java store round-trip, and `m29/r5-tier-fixture`, which cannot
   run under bun at all because it requires `better-sqlite3`); they are listed in the record
   because a reader of this column needs to know which of its consumers are currently red.

13. **The INBOUND half of the store (`parallel-indexer.ts`, this round)** — the same defect class
   read in the other direction, and the one the earlier rounds had been measuring against without
   naming. The store DELETED every relationship row from ANOTHER file that pointed into the file
   it was re-storing. Such a row cannot be re-emitted by the re-parsed file — it belongs to its own
   source — so the store destroyed rows it had no way to rebuild, and the repair pass was the only
   thing that ever put them back: as a re-spelled `` `${source}:${type}:${target}:${line}:m40` ``
   COPY re-bound by name, which is why a re-index and a full index disagreed about the same edge
   and why the copy carried none of the original's id, metadata or flags.
   The schema settles the question the delete was answering: `brain_relationship.source_symbol_id`
   → `brain_symbol(id)` is `ON DELETE CASCADE` (a re-store removes its own rows), while
   `target_symbol_id` → `brain_symbol(id)` is `ON DELETE SET NULL` — deleting a symbol KEEPS the
   rows that merely point at it and clears the pointer. So the delete was pure loss, and the repair
   is now an UPDATE of surviving rows: **exact** by the captured target id (a re-stored file whose
   symbols did not move re-points to the same symbol — no name matching, which is what picked a
   different same-named symbol before), **by name** only where that symbol is genuinely gone and
   only inside the re-stored files, then the shared `<module>:<item>` resolver
   (`resolveImportTargets`, M60/JD2) for the spellings no bare-name rule can match, called with the
   captured row ids so a `--changed` run cannot resolve rows in files it never touched. A legacy
   `line_number = 0` (M59/#821) is healed to NULL, bounded to the same captured population — the
   old heal rode on the re-insert, so it had to be earned back by a statement of its own.
   Two further defects sat in the CAPTURE predicate, both silent: `source_symbol_id NOT IN (…)` is
   NULL — not TRUE — when the source is NULL, so every **file-level** row (an `imports` row whose
   source is the importing file, `source_external` set and `source_symbol_id` NULL) escaped the
   capture entirely; and the predicate excluded rows whose source file was re-stored in the same
   run, on the theory that such a file re-emits them — true only when it is stored AFTER the file
   it points into.
   Measured, with the arm that makes each claim falsifiable:
   - **the file-level loss, at two scales.** `script/m14/js-ontology/js-lifecycle-drift-probe.ts`
     indexes N modules that each `import` one function from a single hub and re-stores the HUB
     alone. At N=200: **HEAD keeps 201 edges into the hub and loses all 200 file-level `imports`
     rows** (`exports` 201, `calls` 200, `imports` 0); the fixed store keeps **401** edges
     (`imports` 200, 0 unresolved). The same shape at the M40 lifecycle corpus's 1,500-module scale
     is the S4 drift: relationships **3003 → 4502** (+1499, ≈1 per module file), all of it the
     restored rows, which is why the baseline was re-recorded in this round rather than treated as
     a regression. S1 reads 8 → **9** in-edges and S5 2 → **4** resolved edges across this round's
     two changes (3 with the inbound repair alone, 4 once the bounded pass also decides the rows it
     re-stored — the fourth is exactly the deferred cross-file call edge the J12 paragraph names).
   - **A2, the write path.** `A2: caller edges into edited file RESTORED` read **E1=11999 vs
     E0=15994** with the old repair (3995 rows lost, every one of them the `<module>:<item>` form)
     and reads **15997 vs 15994** now, with the run's own telemetry in the record:
     `bounded.repairedInEdges=15994` — every in-edge into the edited hub re-pointed rather than
     copied — of which `bounded.importResolvedInEdges=3998` are the file-level `<module>:<item>`
     rows no bare-name rule can answer (the check beside it counts the same population:
     `fileLevelEnriched=3998 of 3998`), and `bounded.stillUnresolvedInEdges=0`. 26 checks, 0 failed.
     The gate's enrichment check also had to be stated on purpose: `source_symbol_id NOT IN (…)`
     dropped the file-level rows from its numerator while the in-edge count kept counting them, so
     it now names both populations (symbol-sourced, and file-level) and measures each.
   - **identity, not just counts.** `script/m14/verify-store-path-parity.ts` on the 120-file svelte
     draw, re-indexing every file through the production incremental entry point: **10,171 rows
     before and after, 0 only-before, 0 only-after; 832 symbols, symmetric difference 0**; **no row
     LOSES its resolved target** (0 of 10,171) and every derived-flag difference belongs to a row
     whose target also differs (no second rule writes the flag). **8 of 8 checks green** on the
     250-file draw (the residue this paragraph closes was the seventh, at 120 files; the eighth
     is the SOURCE-side endpoint check, added when this lane asked its incoming/outgoing question
     on both ends, and it reads **0 of 19,855 rows differing on `source_symbol_id`**).
   - **the residue, named — and then closed.** 66 of 10,171 rows (0.65%) STORED a different
     `target` after a re-index: 64 where the full pass left NULL and the re-index bound a symbol, 2
     where both bound and picked different ones (`calls parse` twice, in two files) — 45 of the 66
     carrying a name that is ambiguous in the project. All of it was ONE mechanism: the insert
     path's `resolveTargetStmt` ranked a bare name by proximity (same file, then same language, then
     any, id tie-break) over the symbol table AS IT STOOD AT THAT MOMENT, while the resolution pass
     refuses a name that is not unique — so which writer reached a row first, i.e. batch order,
     decided the stored edge, and the count moved between runs of the same draw (65, 66, 69, 70;
     the 66 recorded in the first version of `validation/m14/results/JS-STORE-PATH-PARITY.json`,
     which is the run that version of this paragraph cited). Recorded as **gap J12**, then closed by
     ORDERING the two writers instead of racing them: the insert path now decides only what the ROW
     ITSELF can prove — a candidate in the row's OWN FILE (`AND s.file_id = ?`), a row-local fact no
     batch order can change — and defers everything else to the passes that read the COMPLETE
     tables, `_res_qname` for a qualified name and `_res_name` strategy 2 for a name that is UNIQUE
     project-wide (the same single candidate the ranking would have picked, which is why deferring
     loses no resolution). A name that is neither unique nor in the row's own file is left
     UNRESOLVED instead of guessed: refusing to guess is the honest answer, and two independent
     proximity guesses that agree only by luck are what this replaced. Measured on the 250-file draw
     the determinism gate uses: the parity instrument reads **19,855 rows and 1,172 symbols
     identical before and after a re-index, 0 divergent targets, 0 residue, 8 of 8 checks**;
     `verify-resolution-determinism` reads **8 of 8 with 0 of 19,855 rows differing on target or
     derived flags**; and the store instrument's attachment census is UNCHANGED by the fix —
     `attachedTotal` 5,531 of 19,855, 14,324 detached, 2,589 decidable landing 100.0% in the
     source's own file, `wrongFile` 0 — because the guess only ever fired when the table prefix
     happened to hold a candidate at insert time, which is exactly why it was order-dependent. The
     refusal therefore costs no attachment the graph had: the full-pass census was already the
     honest baseline, and the incremental path now agrees with it. NOT taken, with its population
     measured rather than left vague: the original ruling's FIRST route — binding an ambiguous name
     through the row's own file's import statement — is ADDITIONAL COVERAGE, not a determinism
     requirement, and the census's own reason table says so — class **7** ("the binding's module is
     relative, INSIDE the draw, and that module DECLARES the leaf — RESOLVER-ELIGIBLE rows still
     detached", the lane's real open item) reads **0** beside class 8's 3 rows (a module inside the
     draw that declares no symbol of that name — the edge names an import BINDING, not a
     declaration) — so no row is currently decidable that way and left unresolved; it lands as a
     coverage change with its own measurement. The change is in the SHARED store path, so every
     lane's stored targets move by the same rule and the store-level records were re-earned in this
     round, not assumed: the three that ship are
     `validation/m14/results/JS-STORE-PATH-PARITY.json` (8 of 8, 0 of 19,855 rows differing on any
     stored payload, on the 250-file draw),
     `validation/m14/measurements/resolution-determinism-j12.json` (8 of 8, content byte-identical
     to the pre-fix `resolution-determinism.after.json`) and
     `validation/m14/measurements/store-resolution-j12.json` (the census above, re-run against the
     fixed source: every COUNT identical to the pre-fix `store-resolution-jsd50.after.json` —
     attached 5,531 of 19,855, detached 14,324, decidable 2,589 at 100.0%, `wrongFile` 0 — with the
     two `diagnosis` name lists this instrument caps at 200 rows differing by one tie at the cap
     edge (`('spread', 8)` vs `('snip', 8)`, both count 8, and the row ids carry a different
     project prefix), so the claim is that the counts did not move, not that the file is
     byte-identical).
   - **the J12 rule had to be backed in BOTH paths, and the corpus is what said so.** The insert
     path's own-file rule is half a fix on its own: the FULL index hands the deferred rows to
     `resolveRelationships` after the store, but the bounded incremental pass runs neither that pass
     nor the store's own resolution (its batches are stored with `skipResolution: true`), so a
     re-stored file's own cross-file edge had no decider at all. MEASURED by
     `script/m40/lifecycle-corpus.ts` against the committed baseline: S2 (`bb_edit` inserting a call
     to a function declared in another file) read **0 resolved outgoing edges and FAILED**, and S3
     then counted the leftover row as an orphan (**3 against a 0 baseline**) — the corpus was 35/37
     until both were fixed and is **37/37** now. The fix is the shared rule, not a third copy of it:
     `resolveNameTargets` (`src/ast/import-resolution.ts`) is the two name strategies the full pass
     runs — qualified name, then a name that is UNIQUE project-wide — factored into one callable
     function with an optional `sourceFileIds` scope, and `resolveImportTargets` gained the same
     scope as `onlySourceFileIds` for the `<module>:<item>` half (a file-level row's own file is
     recovered from its source symbol, the `:rel:file:<path>:` anchor in its id, or
     `source_external` as a path). The bounded pass calls BOTH halves for the files it re-stored, and
     the full pass's inline copies were replaced by a call to the same function — a rule with two
     spellings drifts (JSD44). The scope is what keeps the bounded contract: only the UPDATEs are
     restricted, and only to rows whose source file this run re-stored.
   - **the third half, and the parity gate is what named it.** Two deciders are not the full pass:
     the name strategies bind by a name that is UNIQUE project-wide, and a name the row's OWN file
     binds locally is not that symbol — which is why the full pass runs the binding pass LAST
     (`resolveImportBoundTargets`, the pass that owns the shadow guard and the import-clause route)
     and CLEARS those bindings. The bounded run ran neither, so the name half bound rows the full
     pass stores NULL. MEASURED by `script/m14/verify-store-path-parity.ts` on the 250-file draw,
     with the name and `<module>:<item>` halves but without this call: **118 of 19,855 rows the full
     pass stores NULL and the re-index stores BOUND** — and the gate's own attribution says every
     one of them is a `uses` row whose requested name is a parameter of its OWN source symbol
     (`count` in `create_sbench_test(label, count, num_sources, fn)`, bound to the one project-wide
     `count` in `.../reactivity/tests/kairo_triangle.bench.js`), i.e. exactly the class
     `shadowed-local-binding` exists for. The fix is the same call, not a third copy of the shadow
     rule: `resolveImportBoundTargets` gained the `onlySourceFileIds` scope (the rows it ACTS on;
     every table it reads is complete either way, so a scoped call decides exactly what the full
     pass decides), the bounded pass calls it after the other two, and the gate reads **8 of 8 with
     0 of 19,855 rows differing on any stored payload**. This is also why the ORDER is the full
     pass's order (name → `<module>:<item>` → binding): the third pass is what corrects the first
     two, so a set of the same rules in a different order is a different answer.
   - **named by an instrument, not by a count.** `script/m14/js-ontology/js-bounded-resolution-probe.ts`
     reproduces the corpus's S5 adoption scenario and prints every row before and after: the
     adoption run re-stores 2 files, the repair re-points 3 rows, the new step resolves **1** — the
     deferred cross-file `calls` edge — and the world reads **4 rows, 4 resolved, 0 unresolved**,
     with the CLI line `2 symbols touched | 3 cross-file edges restored | 1 re-stored rows resolved`.
     S5's recorded `resolvedEdges` therefore moved **3 → 4** for exactly that row; the baseline was
     re-recorded through the corpus's own sealed writer, and `--gate` reads PASS against it. Read as
     a sequence rather than a single number: 3 was the world where the deferred row had no decider
     in the adoption run, and 4 is the world where the row is resolved and no other row moved.
   - **M59.** `script/m59/verify-legacy-zero-heal.ts` was rewritten onto the new contract and reads
     **16 checks, 0 failed**, including two negative controls: the out-of-scope legacy zero must
     SURVIVE (the heal is scoped, not a global sweep) and the detector must fire on it (the checks
     above are not vacuous). It also pins the ordering the production path has and a repair-only
     caller does not: the snapshot must be taken while the pointer is live, because the capture
     joins the target SYMBOL.
   - **unchanged by this round:** `verify-a3-write-parity` 21/0/3, `verify-a5-flag-semantics`
     266/0/3, `verify-a7-cli-parity` 24/0/5, `verify-resolution-determinism` 8/8 (0 of 19,855 rows
     differing on target+flags), the JS fixtures **77/0**, the vue store round-trip PASS, and
     `typecheck` exit 0. The M40 lifecycle corpus reads 37/37 with its baseline re-recorded (and
     its writer now seals the record through `writeSealed`, because the raw write dropped the
     `bbSeal` envelope the committed baseline carried — the producer shape `refresh-stale-seals.ts`
     exists for).

**The same round found a pre-existing resolution hole and closed it (JD2.4, the default import).**
`script/m40/verify-import-resolution.ts` reads **6/7 at HEAD in a clean worktree** and 7/7 now. The
commit that pinned the naming rule (JD-J14: a NAMED default declaration is exported under the name
`default`, `fragment` is not reachable by name) recorded the declaration's own name in
`metadata.localName` "so nothing is lost" — and `extractExportRelationships` in BOTH the JS and TS
analyzers then dropped it, storing the row with `{isDefault}` alone. A row whose target is the
literal `default` matches no symbol (the name is in the symbol denylist) and had no name to be
recovered by, so `defaultExportByFile` was empty and **`import Def from "./m"` could not resolve for
any module with a named default export**. The analyzer now carries the record's metadata through,
the resolver recovers the symbol by the declaration's name in the row's own file (only when it
identifies exactly one symbol), and the gate's surface check counts the default declaration under
both names it is reachable by — without that, JD2.6 and JD2.4 contradict each other.
`script/m14/js-ontology/js-default-export-probe.ts` is the instrument: it shows the row, the
metadata it carries and whether the import attached, before and after.

`script/m14/verify-override-retarget.ts` gains the arm that pins the third seam: a
row with `source_external` NULL and `source_symbol_id` pointing at
`JsLeaf.render`, whose first-parent guess is not the declaring ancestor. 17 checks,
exit 0. Before the seam the pass derived an owner for none of the lane's rows
whatever their hierarchy said; after it, 47 of the 52 svelte rows resolve their
ancestry and are correctly classified UNVERIFIABLE because their base is the
GLOBAL `URLSearchParams` — the one answer no in-corpus declaration can give, and
now the answer the pass actually reports. The remaining 5 have no persisted
hierarchy at all.

The hierarchy round changed no fixture: the lane's own runner read `74 pass / 0
fail over 74 fixtures` and `4 lane mutants, 4 caught, 0 survived` before and after
it, and `firing-check.mjs JAVASCRIPT` read `9 types fired, 120/120 parsed` with
`implements` the only silent type (the RULED verdict). It added symbol payload
(hierarchy and qualified names), not edges — which is why the fixture suite was
unchanged and why the dispatch-path count was the check that could see the
difference.

The file-level round that followed DID change behaviour, and both gates were
re-run against it: `74 pass / 0 fail over 74 fixtures` (with the eight
expectations listed under "Outgoing" updated to the new contract), `4 lane
mutants, 4 caught, 0 survived`, `firing-check.mjs JAVASCRIPT` `9 types fired,
120/120 parsed`, `verify-override-retarget.ts` 17/17 exit 0, `typecheck` and
`typecheck:scripts` exit 0.

---

## The six definitions of done, checked

| Requirement | Result |
| --- | --- |
| every type has a verdict with a number | 10/10 — nine EMITTED with counts and file spreads on three corpora re-measured at this commit, one RULED with **six** instruments of which three are new and two of those decisive |
| emitted types answer all six questions | the ten subsections above; each answer cites its instrument and measurement, names what the instrument cannot see, and — new this round — **attributes every MISSING row** to the production noise filter or to a real gap. 218 of 225 MISSING rows on the svelte draw are filter deletions; the 7 that are not are all oracle over-derivation, listed by construct and file |
| no unknown symbols, no empty names, no placeholder-literal endpoints | 0 empty endpoints, 0 `global` sources, 0 empty symbol names, re-measured on all three corpora. Remaining "placeholder-looking" endpoints enumerated and classified, with one **classification corrected this round**: `module` as a `calls` TARGET is a written method name (`template.module(data)` in `lodash/lib/fp/build-modules.js:102`, `QUnit.module(…)` in `lodash/test/test-fp.js`), not the CommonJS free variable — 100 rows on lodash that the R7 heuristic mislabels, 0 on svelte |
| fixtures assert the new behaviour and a mutant must die | **77 fixtures, 77 pass / 0 fail** (the two new pins are `reexport-forms` and `star-reexport`). **No analyzer behaviour changed in the hierarchy round**; the file-level round that followed DID change behaviour — eight expectations were updated to the new contract and the mutant arms were re-run against it (§Outgoing has the list and the reason) — so this row's claim is per-round and now reads: every behaviour change this lane has landed is pinned by a fixture AND by a mutant that dies without it. In the hierarchy round, no new fixture was claimed: the full-corpus relationship count is byte-identical (svelte 75,561 before and after), which is the measurement that says the payload did not move. **The JSD40 re-export round is the current case and it meets both halves**: 3 fixtures (2 updated, 1 new, with `forbidRelationships` rows naming the pre-fix spelling), and a fifth lane mutant `restore-reexport-module-star` that dies on exactly those three — plus the pre-change-analyzer arm, where the suite reads **72 pass / 3 fail** and the three are again exactly them. The lane mutants were re-run through the runner and **7 of 7 die** (the seventh, `restore-star-form-indistinct`, is the JSD46 arm and dies on exactly the new `star-reexport` fixture), and §3's wiring is in, so the canonical registry runs them too (**63 selected of 1,856, all 63 CAUGHT**, filtered run, exit 0, re-measured 2026-10-12; 62 of 1,845 when this row was written). **The §2 round is the second case and it also meets both halves**: 1 new fixture (7 forbid rows, six of them pre-fix arms and the seventh labelled as a contract pin, with 4 expect rows as the positive controls) and a sixth lane mutant that dies on exactly it, with the guard-revert arm reading **75 pass / 1 fail** and that failure being the new fixture. Its corpus measurement is the name-shape census (31 of 31,973 svelte rows → 0) plus two differential draws at 100% covered / 0 MISSING / 0 unexplained |
| mutation, differential and payload/latency re-run | mutation: javascript **56 caught / 0 survived** in the shared registry, plus **5 caught / 0 survived** through `javascript-mutant-runner.ts`; the 6 registry survivors are java 1, groovy 2, scala 1, make 1, php 1. differential: svelte 120 files 1,457 truth / 1,456 covered / MISSING=1 / unexplained=0 / heuristic=0, hash `fc839056ff888724` on that draw, and on a **fresh rotated 120-file draw** `1621 / 1621 (100%) MISSING=0 / unexplained=0 / heuristic=0`, hash `e4b4539bd3e02b48`, and again after the JSD40 re-export change `1756 / 1756 (100%) MISSING=0 / unexplained=0 / heuristic=0`, hash `1d25ea4fb04ffcce` — the draw rotates per invocation (`coldPoolPick`), so a hash is only comparable within one draw and three clean draws is the stronger statement; lodash 55 files 12,819 / 12,819 / MISSING=0 / unexplained=0, hash `494e1b94766e8ade`; ts corpus 200 files 3,445 truth / 3,406 covered / MISSING=39 / unexplained=1 (an `exports` row), all 39 MISSING in `tsc/testdata/baselines` files the JS grammar cannot parse. payload: **399-file svelte sample 34,569 relationships at this commit** — see the caveat below |
| doc + spec updated | this file; JSD33 (`implements` RULED), JSD34 (class-expression heritage), JSD35 (R7 runtime), JSD36 (`pool-worker` loss), JSD38 (`implements` grammar inventory + the probe that fires on the sibling grammar + the counterfactual parse), JSD39 (the JSDoc resolvability measurement), JSD40 both halves SHIPPED, **JSD41 (the store's view of an import: binding + type)**, **JSD42 (the import row kept one binding per clause — the shared-insert seam)**, **JSD43 (a shadowed name is detached, not left on a namesake)**, **JSD44 (the store-path symbol-name register: `self` and six others dropped by a fourth copy of one list)**, **JSD45 (the re-export chain: a name a file publishes without declaring)**, **JSD46 (the two clause-less star forms: the redistribution followed by statement, and the namespace binding told apart from it)**, **JSD47 (the residue: every detached row carries one reason code, the classes are exhaustive, and the resolver-eligible class is EMPTY by measurement — with the earlier 788/533 reading corrected as this instrument's own artifact)**, **JSD48 (the outgoing half of the same question: the "declared" class split by WHOSE file declares the name, both same-file classes at 0 — so the 11 rows that were reported as an attachment the name pass did not make are name COLLISIONS with local bindings, not a resolver gap)**, **JSD49 (the reproducibility bound, measured as a property: row identity, symbol identity and the planner's decisions identical across two indexings of the same draw while 4–42 rows per pair resolve to a different TARGET — every one of them the `module:item` form, each side classified against the mechanisms that can write it, 0 unexplained)**, **JSD50 (the fix, landed: `settleImportTargets` re-decides every `module:item` row over the COMPLETE tables — planner-where-proven, else the insert path's own ranking — the gate goes 0 of 19,855 divergent and 7 of 7, the pass is a fixed point, and the arm that removes its one line reads 8–57 divergent rows on the same draw with 3 of 7 checks red)**, **JSD51 (the derived half, found by the payload check JSD50's gate gained: `is_cross_file` had five disagreeing writers, stored 0 on 9.6% of cross-file edges and flipped 66 rows between runs with every target identical — now one set-based closure that decides from the row itself, three routes deep, with the id's own `file:` anchor covering the whole unknown-source bucket)** — and the resolver these unblocked, measured on the closed 368-file population at **3,113 of 3,113 (100.0%)** import-decidable rows landed with the pass, the chain and the star route wired, **3,097 of 3,099 (99.9%)** with the chain unwired, and **2,796 of 3,093 (90.4%)** with the whole pass unwired — that arm was measured in the JSD43 round, when the instrument's denominator read 3,093; this round's denominator reads 3,099, and the six-row difference is exactly the re-export route, which the instrument now classifies instead of counting as undecidable; **JSD52 (the inbound half of the store: a re-store DELETED rows it could not re-emit and rebuilt them as name-bound copies — the delete is gone, the repair is an exact-id UPDATE plus the shared resolver over the captured ids, and the file-level capture bug is measured at 201 → 401 edges on a 200-module probe, with its own M59 gate at 16 checks / 0 failed)**, **JSD53 (a NAMED default declaration is exported as `default` while its own name is kept — the metadata was dropped before the resolvers could use it, which is why `import Def from "./m"` could not resolve for any such module; the gate reads 6/7 at HEAD in a clean worktree and 7/7 here)**, and **J12 CLOSED (the ambiguous-name race: the insert path now decides only what the row's own file proves and defers the rest to the complete tables, and the bounded run backs the deferral with the full pass's three deciders in the full pass's order, scoped to the files it re-stored — the parity instrument goes 0 of 19,855 divergent on the 250-file draw with 8 of 8 checks, determinism reads 8 of 8, and the attachment census is unchanged at 5,531 attached / 14,324 detached, so the refusal costs no attachment; the third decider was added because the gate measured 118 rows the two-decider version bound that the full pass stores NULL)**, with the store-level records re-earned in this round (parity, determinism, store census) because the rule lives in the shared store path |

### Payload and latency

`bun run script/m12/measure-analyzer.ts javascript <399-file svelte sample>`, the
lane's own envelope check, on a deterministic sample drawn from svelte. The
budget is declared here in the form `script/m60/analyzer-complexity-gate.ts`
parses, so the row is machine-readable rather than a table cell a regex cannot
reach: **declared budget: fixtures < 2000 ms; 400-file corpus < 60000 ms.**

| | fixtures | corpus (399 files) |
| --- | --- | --- |
| declared budget | < 2000 ms | < 60000 ms |
| wall, previous round | 472–851 ms ✓ | 11,853–26,818 ms ✓ |
| wall, **this round** | **6,602 ms** (load1 = 28.9) | **40,420 ms** (load1 = 29.5) |
| user CPU, this round | **700 ms** | **29.8 s = 74.8 ms/file** |
| symbols / relationships, this round | 46 / 139 | 2,853 / **34,569** |

**The wall figures are not comparable to the budget and are not offered as if they
were.** The box ran at load1 ≈ 29 (six other agents), and `measure-analyzer`'s own
guidance is to compare `userCpuMsPerFile` rather than wall time on a shared box.
On that number the fixture run is **700 ms against a declared 2000 ms** and the
corpus run is **74.8 ms/file against a declared 60000 ms for 399 files** (which
is 29.8 s of CPU, half the declared bound). Both are inside the declared budget on
the load-stable measure. The 6.6 s wall on five files is scheduler delay, not work.

**The relationship count moved by 5 and the reason is sample membership, not the
analyzer.** 34,569 at this commit against the 34,574 recorded above. The
stronger measurement is the full-corpus census, which is identical either way:
**75,561 relationships over svelte's 3,447 files** before and after. The
recorded 34,574 came from a sample directory (`/tmp/bb-js-sample-dir`) that no
longer exists, so the two file sets cannot be compared file-for-file; a 5-row
difference on a 399-file selection is one small file, and the full-corpus number
is the one that decides. Reported as a difference rather than smoothed over,
because a payload figure that cannot be re-derived is the thing this harness
exists to stop.

**Why this round adds no payload at all: the analyzer emitted no new edge type.**
No `RelationshipType.X` was added, no emission site changed, and the census
reproduces every per-type count in the ontology table. The three instruments this
round added are measurement code — they read the analyzer, they do not feed it.

The previous round's A/B figures are left where they were: the FIRST non-interleaved
read +25% CPU after its change (min-of-3: 59.4 → 74.2 ms/file), which the
INTERLEAVED A/B reversed in sign (after 59.7 / 61.8, before 68.9 / 69.9 ms/file).
Its guard is one linear pass over `relationships`, so the non-interleaved reading
is load drift on a box running six other agents.

### Two paths, and why every number above names which one it used

`script/m14/differential.ts` measures through `ASTEngine.parseFile`
(`differential.ts:22090`). The product indexes through
`pool-worker.parseFile`, which additionally runs `filterNoiseRelationships`. The
two disagree — 470 edges by count and 381 distinct rows on 600 svelte files
(finding 1), and `javascript-two-path-loss.ts` measures the delta rather than
asserting it. The census and the per-label instrument use the **production** path,
so their counts are what reaches a graph; the differential's counts are what the
harness compares. Where the two are reported together above, both are labelled.
The previous round's version of this paragraph pointed a reader at a probe in the
git-excluded `script/m14/tmp/`, which is not reproducible from the commit; the
instrument is committed now.

---

## Symbol kinds

The analyzer emits 7: `Class`, `Function`, `Method`, `Constructor`, `Property`,
`Constant`, `Variable`. It emits **no `Module` symbol for the file itself** and
**no `Object` symbol for object literals** — an object literal is owned by the
binding it initialises, and one that has no binding (a call argument, a return
value, an array element) produces ownerless members by design, which the oracle's
nameability rule agrees with.

## Supported constructs

- ESM modules: `import`/`export` (named, default, namespace, re-export)
- CommonJS: `require()`, `module.exports = { ... }`, `exports.x = fn`, deep chains
- Classes: fields (public + private `#x`), accessors (`get`/`set` → property), static, async methods, generator methods, constructor, static blocks
- Functions: declarations, generators, async, arrows — none of them locals
- Module-scope constants/variables, module-scope destructuring bindings
- Inheritance: `extends` + cross-file override resolution; class EXPRESSIONS bound by declarator, by assignment, or by their own name (JSD34 covers the two shapes that stay silent)
- Prototype inheritance: `X.prototype.method = function () {}` → Method with owner + contains
- Calls: leaf targets, member expressions, optional chaining, `super.format()`
- Instantiation: `new User(name)`
- Negative fixtures: locals, params, lambda params, destructured params never become symbols; template-string call targets filtered; console/Object builtins filtered; `require` bindings are imports not symbols

## Unsupported / explicit-unknown constructs

- JSDoc type annotations (`@param`, `@returns`, `@type`) are not parsed into
  returnType/type fields — JavaScript has no runtime types, and the family
  contract keeps type info absent rather than synthetic. JSDoc *comments* are
  still extracted as documentation. This is also why JSDoc `@implements` does not
  produce an `implements` edge (JSD33).
- Decorators (TC39 stage 3) — present in the pinned grammar's vocabulary as a
  node type, so `@dec class X` parses; TC39 has not shipped the syntax to
  JavaScript, so the construct does not occur in a JavaScript corpus (measured: 0
  `decorator` nodes across svelte's 3,447 files and lodash's 51 — the analyzer's
  decorator handling is exercised only by fixtures and by `.ts` neighbours).
- Computed/dynamic member calls (`o[key]()`) are deliberately filtered — the
  target is not a statically resolvable name (family contract, mirrors TS).
- `this.x` property access produces no `uses` relationship on the receiver — the
  chain ROOT is published, and `this` is a keyword, not a symbol (family contract).

## Regex inventory

0 regex usages, re-measured 2026-10-03 by stripping comments and string literals
from `real-javascript-analyzer.ts` and scanning: 0 regex literals, 0 `RegExp`
constructs. All text normalization uses `startsWith`/`endsWith` + `slice`, plus
`split`/`replace` on literal separators. The absence of this lane from
`validation/m49/regex-debt-register.json` is consistent with that rather than the
evidence for it.

## Complexity envelope

| Run | files | symbols | relationships | wall | declared budget |
| --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 46 | 139 | 0.47–0.85 s | < 2 s ✓ |
| corpus sample (svelte, deterministic first-399) | 399 | 2,853 | 34,574 | 11.9–26.8 s | < 60 s ✓ |

Hot-path audit: single iterative AST traversal (explicit stack, no recursion
depth risk); scope carried per-frame as immutable snapshots; per-name/owner dedup
via `Set` keys; containment from `ownerName` in one pass; call source resolution
O(1) leaf extraction; override resolution via name-keyed `Map` + companion set.
Two known hot-path guards are documented at their sites (`isNodeInDeadSpans`'s
empty-list short-circuit, 44.6% of samples on a 1.9 MB minified file before the
fix; the decorator pre-pass, 15.0%). **Added this round:** one linear pass over
`relationships` for the R7 endpoint guard — O(n), no splice on a clean corpus.

## Differential ground truth

- Truth side: `script/m14/differential.ts` — `deriveTreeEdges(root, "javascript")`
  plus the four dedicated oracles `deriveJavaScriptEdges` (calls, decorators,
  `instanceof`, `contains`, `exports`), `deriveJavaScriptImportEdges`,
  `deriveJavaScriptExtends`, `deriveJavaScriptOverrides`. All four were
  previously unaudited labels; the doc's older claim that "the JS oracle derives
  no import truth" is historical.
- Measured this round, production path on the analyzer side
  (`bun run script/m14/differential.ts --repo <corpus> --lang javascript --sample 120`):

| corpus | files | tree-truth | covered | MISSING | analyzer-edges | unexplained | heuristic | sample hash |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| svelte (primary) | 120 | 1,457 | 1,456 (99.9%) | 1 | 1,456 | 0 (0%) | 0 | `fc839056ff888724` |
| svelte, re-run after the re-export change | 120 | 1,756 | 1,756 (**100%**) | **0** | 1,756 | 0 (0%) | 0 | `1d25ea4fb04ffcce` |
| lodash (second) | 55 | 12,819 | 12,819 (100%) | 0 | 12,783 | 0 (0%) | 0 | `494e1b94766e8ade` |

The lodash hash reproduces the recorded baseline's drawn set exactly. The single
svelte MISSING is `extends -> Svelte4Component` from an unbound class expression
— JSD34's declared silence, quoted rather than hidden.

**The two svelte rows are two different file sets and must not be subtracted.**
The cold-pool rotation draws never-sampled files each wave, which is the point of
it, so the 1,457 → 1,756 move combines the rotation with this round's change and
attributes neither. What the second row does say is that on a fresh 120-file draw
the analyzer and the co-moved oracle agree on every row — 0 MISSING, 0
unexplained, 100% covered — and the attribution is §5's same-files A/B instead.

**Two limits of this comparison, stated because the numbers are worth less
without them.** `differential.ts` matches on **label and target only, never
source**, so a mis-attributed source is invisible here; and the analyzer and the
oracle are **two walkers over the same pinned grammar**, so a grammar bug shared
by both is invisible to both. The lane's per-label instrument
(`script/m14/javascript-label-oracle-agreement.ts`) applies the same published
rule and inherits both limits — it does not escape them, it only attributes the
result per label. Per-label truth/analyzer/covered/fabrication figures are in the
"Part 1" table above.

## Corpus validation

Corpora, all through the production entry, all tracked files only:

| corpus | role | files | symbols | relationships | parse errors |
| --- | --- | --- | --- | --- | --- |
| `svelte` @ `020242d6` | the lane's declared primary corpus and its M12 pinned target | 3,447 | 6,228 | 75,561 | **0 files** |
| `lodash` @ `2b5e6f73` | second corpus, ES5 UMD — a different dialect | 51 | 899 | 21,032 | **0 files** |
| `typescript` @ `ed480721` | the widest js-family population available, 13,202 admitted | 13,202 | 115,324 | **354,356** `[re-measured]` | 10,855 files / 446,952 errors |

Corpus commits are the ones `javascript-ontology-census.ts` recorded at run time
and each census artifact carries its own, so the row is re-derivable rather than
remembered. The svelte commit recorded this round is `020242d6`, not the
`ed480721` the previous round wrote — the corpus moved under the lane and nothing
in the doc noticed, which is the same class of error as the three stale counts in
Open findings §7.

The ts corpus is **not** a JavaScript codebase: 10,855 of its 13,202 admitted
files are TypeScript compiler EMIT baselines written to a `.js` path, and only
2,347 parse without a single ERROR or MISSING node. It is reported because it is
the widest population and because it is where the R7 class was found, with the
clean/whole split stated per type in the census artifact. **0 crashes, 0
timeouts** on all three.

Two corpus facts that decide how these numbers may be read:

- A **sample** of the ts corpus is not a measurement of it. A first-600 draw is
  574 files of `tsc/testdata`; filtering to files the JS grammar parses cleanly
  does not repair it either, because
  `manyConstExports(target=es2015).js` parses cleanly and holds 15,000 of 26,043
  `exports` edges. A clean-file sample of 600 reported 15,701 `exports` rows
  (95.5% from that one file) against 597 for the unfiltered 600 — a 26× swing in
  a headline number decided by sample membership. Every census here therefore
  admits every admitted file and reports a per-file maximum.
- **The production indexer and the differential measure different things.** See
  "Open findings" 1: on a 600-file svelte draw the product delivers 36,256 of the
  engine's 36,726 relationships — 470 by count, 381 as distinct rows — and no
  differential figure can see either number.
- **A MISSING row is not automatically a gap.** The per-label instrument now
  attributes each one to `pool-worker`'s noise filter or to a real disagreement,
  and on the svelte draw 218 of 225 are the former. Reading a MISSING count as a
  language gap overstates the gap by two orders of magnitude on this lane.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/javascript/` (**77** on disk; **+2 this round** —
  `reexport-forms` and `star-reexport` — plus member-row assertions and `forbidRelationships` rows
  added to `barrel-named-clause` and `barrel-reexport`. The older "0 added" note
  belongs to the hierarchy round, which emitted no new edge and therefore had no
  new behaviour for a fixture to assert)
- Spec: `script/m14/spec/javascript-completeness.json` (JSD33–JSD36 from an
  earlier round; JSD38–JSD40 — the grammar's declared vocabulary and the probe
  that fires on the sibling grammar, the JSDoc resolvability measurement, and the
  `imports` DERIVATION verdict with its independence caveat; **JSD41–JSD43 added
  this round** — the store's view of an import, the import row's identity, and the
  shadowed-name detach — **and JSD44/JSD45/JSD46 in the same round**: the
  store-path symbol-name register (the four replicas of one list, with the names
  it was dropping), the re-export chain, and the two clause-less star forms (the
  redistribution followed by statement, and the namespace binding told apart from
  it), each with the fix, the gate and the falsification arm)
- Lane-owned instruments (committed):
  - `script/m14/javascript-store-resolution.mts` — **new** — the STORE graph: indexes a javascript-only project through `indexProjectParallel` into a temp store and reads `target_symbol_id` / `source_symbol_id` back, per label, with the `overrides`-verified-ancestry section
  - `script/m14/js-ontology/js-detached-triage.mts` — **new** — splits every detached target by whether the WHOLE corpus declares the name, whether it is an engine-enumerated standard-library member, or neither. Refuses a stale corpus index rather than reusing it
  - `validation/m14/measurements/js-corpus-declarations.json` — the cached corpus declaration index (3,447 files, file-list digest `59a19c867ad9ed6a`); the triage refuses it if the population moved
  - `script/m14/javascript-ontology-census.ts` — fires / resolved / confident / R7, over every admitted file
  - `script/m14/javascript-label-oracle-agreement.ts` — per-label oracle agreement, importing the shared oracles; **extended this round to attribute every MISSING row to the production noise filter or to a real gap**
  - `script/m14/javascript-two-path-loss.ts` — **new** — the engine-vs-pool delta per label, asking `filterNoiseRelationships` itself which rows it deletes
  - `script/m14/javascript-implements-ruling.ts` — **new** — the six instruments behind the `implements` ruling, including the counterfactual parse, the probe-fires check, and the JSDoc resolvability count
  - `script/m14/verify-js-import-seam.ts` — **new** — the store's view of an import (binding + type) through the real indexer, 8 checks, falsified against the pre-fix behaviour
  - `script/m14/verify-js-binding-resolution.ts` — **new**, **46 checks** — the import-graph resolver: 29 planner cases (every gate and every refusal, including the re-export chain's A14–A20 and the star route's A21–A28) plus 17 end-to-end store assertions over a decoy-bearing project (B10–B13 the chain's, B14–B17 the star route's), falsified at **37 of 46 with the chain disabled** (A14, A15, A17, A25b, A26, B10–B13 — re-measured on the 46-check gate, not carried over from the 33-check one) and at **40 of 46 with the star route disabled** (A21, A22, A24, A28, B14, B15). Its summary line read a hardcoded `32` while 33 checks ran, which is now counted from the checks that execute — the same defect class this gate exists to catch one layer down
  - `script/m14/verify-symbol-name-register.ts` — **new**, **8 checks** — the store-path name register through the real indexer: the declared `self` IS a row, the binding lands on it, the read-side SQL mirror does not hide it, `super`/synthetic artifacts are still refused, PHP's `self` is still refused while javascript's is stored, and the removed-name register carries a measurement per entry; falsified in two independent arms (register, and the analysis-exclusions replica alone), each 6 of 8
  - `script/m14/javascript-import-landing.ts` — **new** — the OUTCOME on the closed population: every import-decidable row classified against an expectation recomputed from the SOURCE, per route, with the wrong-file rows printed
  - `script/m14/javascript-mutants.ts` — this lane's four regression mutants
  - `script/m14/javascript-mutant-runner.ts` — runs the lane's seven through the shared `runLang` and **checks that the registry still imports them** (Open findings §3 — wired 2026-10-10, so this file's own NOTE branch is now the regression arm for the wiring, not a statement of the current state)
- Their artifacts are written to `validation/m14/tmp/`, which this checkout
  excludes via `.git/info/exclude` — the repository's convention for lane output,
  so a reader re-runs the committed instrument rather than reading a stored blob.
  Every finding in this file now has a committed instrument behind it; the one that
  did not (the two-path loss) was the reason the last round's largest finding was
  not reproducible.
- `docs/DOC-TRUTH-EMISSIONS.md` is generated by
  `script/m14/verify-doc-truth-emissions.ts` and is **stale in this checkout**: at
  HEAD the committed copy records a javascript claim at "line 29, 9 rows", while
  re-running the generator against the committed doc yields `absent` — because
  that doc's table header said `Verdict`. The generator rewrites the file on every
  run; this lane restores it after each run rather than carrying a whole-tree diff
  of a shared generated doc, and did so again this round. The committed copy is the
  master's to regenerate — and it is now **wrong in a second way**, because it was
  produced by the gate BEFORE §10's first-row fix: a fresh run reports
  `UNDOCUMENTED=10` where the committed copy records 34. §10 carries both numbers,
  the javascript row's disappearance from the findings list, and the one new class
  the fix revealed (`MIXED_ROW [nim]`).
- Harness artifacts (regenerated by their own verifiers, not hand-edited):
  `validation/m14/results/M14.0.F4.json`,
  `validation/m12/results/javascript-complexity.json`,
  `validation/m60/results/rel-type-coverage.json`
- Prior rounds: `validation/m12/{ground-truth,results}/javascript-*`,
  `validation/m12/corpus-manifest.json`

## Issue

Closes M12.10 (GitHub issue #149). Ontology round: `docs/analyzers/ONTOLOGY-WORKSTREAM.md`.
