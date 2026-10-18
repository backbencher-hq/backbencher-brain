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

Twelve types now carry an emitted verdict: the original ten ontology types, plus the two canonical
labels landed 2026-10-18 (`renders` for JSX component usage, `decorates` for the decorator edge,
which replaced the per-decorator `references` row). **Every number below was measured through the
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
ontology claim. With the header as it now stands, nine of the ten types are parsed
and graded; the tenth is blocked on the gate's first-row skip (Open findings §10).

**2026-10-18 wave, measured:** canonical `renders`/`decorates` labels, three external-claim
classes, and the `metadata.owner` receiver channel — see
`validation/m14/verification/JAVASCRIPT-2026-10-18-EMISSIONS.md` for the cap-50 before/after with
commands, and `validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md` for the
per-edge cause census. The counts in the table below are the pre-wave whole-corpus/lane readings
where a row says so; the two new labels carry cap-50 triage counts because no whole-population arm
has been run since they landed.

| Relationship type | Emitted? | Count / files | How resolved | Confidence model |
| --- | --- | --- | --- | --- |
| calls | **EMITTED** | svelte 31,940 / 3,371 files; lodash 12,555 / 47; ts corpus 64,557 / 6,516 | `call_expression` → callee leaf (member expressions reduce to leaf: `obj.method()` → `method`); source = enclosing function/method leaf name; `console.*` leaf methods filtered; `super()` filtered (language keyword); `require()` handled as import; computed/dynamic calls (`o[key]()`) filtered. **A member call whose receiver type the file STATES carries `metadata.owner` = that type, plus `metadata.ownerEvidence` ∈ {new, assignment, this, jsdoc}** — the STORE channel (`src/ast/member-owner-resolution.ts`, `claimOwnerCarryingTargets` + `resolveMemberTargetsByOwner`, read by BOTH resolution paths in `parallel-indexer.ts`) that binds the member inside the owner. The four proofs: `new` (`const c = new Widget()`), `assignment` (`this.x = new Widget()`, `x = new W()`, class field `x = new Widget()`), `this` (`this.m()` inside a class DECLARATION — a class expression names no class-like symbol here, and a plain function's dynamic `this` gets nothing) and `jsdoc` (`/** @type {Widget} */` on a declarator, a scoped `@param {Widget} w`, or the constructor-parameter propagation `this.dep = dep`). A wrong owner is worse than none: the store WITHDRAWS the name binding for an owner-carrying row and then declines. **Coverage cap-50 triage (2026-10-18): 4 of 921 member-receiver calls (0.4%) — new 2, assignment 1, jsdoc 1**; the sample contains no class-declaration `this`-call (every `this.*` call there is a dynamic-`this` callback). Host-global claims: see "External claims" below. MEASURED END-TO-END through the production index (`indexProjectParallel`): with two classes Foo and Bar each declaring `run()`, `c.run()` bound to **Bar.run** (the alphabetically-first WRONG declaration) without the metadata and to **Foo.run** (the intended one) with it — the only place in this lane where a store channel has been shown to change a resolution. Controls pinned by `javascript/receiver-owner-from-new`: a non-`new` initialiser (`const d = make()`) states no type and carries no owner, and two different constructors for one name are refused, not guessed | 0.9 |
| extends | **EMITTED** | svelte 15 / 14; ts corpus 3,575 / 1,031; **lodash 0** (ES5 has no `class`) | `class_heritage` → base class leaf name | 1.0 |
| implements | **RULED** — the language has no `implements` clause. **Six instruments, two of them new this round and decisive** — see "What was RULED" | 0 emitted on every corpus | — | — |
| instantiates | **EMITTED** | svelte 140 / 72; lodash 586 / 21; ts corpus 6,415 / 1,264 | `new_expression` → constructor leaf name; 55 global runtime constructors filtered (`JS_GLOBAL_CONSTRUCTORS`) | 0.95 |
| imports | **EMITTED** | svelte 7,120 / 3,317; lodash 78 / 27; ts corpus 12,842 / 2,030 | ESM `import_statement` → per item. **A LOCAL relative/absolute module's NAMED specifier targets the DECLARED name** (`import { draw as render } from "./lib"` → `draw`), because the local binding is a name in THIS file and publishing it lets the store's name pass attach the row to an unrelated same-named declaration (measured: it bound `Widget.render`). The local binding is kept in `imports[]` and `metadata.declaredName`. **A LOCAL DEFAULT specifier keeps `<module>:<binding>`** (`import Def from "./lib"` → `./lib:Def`) so the module-aware resolver can reach the target module's default export; it resolves (`Def → Main`) through the wired `resolveImportTargets`. **A namespace specifier keeps `<module>:*`**. An EXTERNAL specifier keeps `<specifier>:<binding>`. **A named re-export now publishes ONE row per written member** (`export { readFile as read } from "fs"` → `fs:readFile` at 1.0 with `metadata {isReExport, declaredName, exportedAs}`), and `export *` / `export * as ns` / `export {}` keep `<module>:*` at 0.6, marked `unresolved`, discriminated by `metadata.starForm` (`all` vs `namespace`). Re-export and `exports` rows are sourced at the family sentinel `(file)` with `metadata.fileLevel`, not the module basename (a basename is a legal identifier; 155 of the first 250 admitted files declare a symbol equal to their module name — `visitors/Attribute.js` → `function Attribute`). **DEBT, stated: the differential's import oracle still spells the OLD contract and is master-owned — see Open finding §5** | 1.0 named/default, 0.6 for a `*` leaf (JD-J12: `*` names no symbol) |
| exports | **EMITTED** | svelte 4,856 / 3,404; lodash 60 / 12; ts corpus 26,043 / 3,148 | ESM `export` statements (declaration, export_clause, default); CJS `module.exports = { … }` (object keys), `exports.x = …` → exported name. **Source is `(file)` + `metadata.fileLevel`.** **The export record's own metadata is carried through** (`{isDefault, ...item.metadata}`), so a NAMED default declaration's row carries `metadata.localName` (`export default class Main` → `localName: "Main"`); `loadImportInputs` uses it to recover the declaration, which is what lets `import Def from "./lib"` resolve to `Main` (JSD53, m40 JD2.4) | 1.0 |
| overrides | **EMITTED** | svelte 52 / 7 files (all at 0.5); ts corpus **630 / 148** `[re-measured, was 644 / 158]`; **lodash 0** | derived member matching base-class member name, over METHODS, CONSTRUCTORS and ACCESSOR PAIRS; an accessor pair is a prototype member, so `get x()`/`set x(v)` shadow a base accessor too, and the pair collapses to ONE edge (J10). Symbol kinds are unchanged by that widening — accessors are still kinded `property`. A `#private` name can neither be declared by a base nor shadowed by a subclass, so it is always silent (J9). Base resolved via extends + cross-file harness companion (`User.format → BaseService.format`) | 0.95 in-file verified, 0.5 first-parent guess |
| contains | **EMITTED** | svelte 654 / 63; lodash 16 / 8; ts corpus **23,121 / 3,483** `[re-measured, was 23,209]` | computed from `ownerName` on symbols (single pass) — class members, object-literal members, prototype methods | 1.0 |
| uses | **EMITTED** | svelte 30,758 / 2,544; lodash 7,691 / 48; ts corpus 215,640 / 11,901 | **Four emission sites:** bare identifier reads at 0.9 (`return config`, `if (flag)`); member-chain segments at 0.85 (`title.length` → `title`); template-substitution reads at 0.85; and the chain ROOT of a call's callee at 0.6 with `metadata.callReceiver` (`title.toUpperCase()` → `title`). The 0.6 tier exists because `calls` names only the leaf, so the receiver is named by nothing else — see X1 in `script/m14/spec/svelte-completeness.json`. `this`/`super` are excluded as keywords. **The SOURCE expression is `method \|\| owner \|\| moduleName`** — `\|\|`, not `??`, so a zero-length recovered name cannot win (JSD35). **A member READ also carries `metadata.owner` + `metadata.ownerEvidence` when the chain root's type is stated** — a typed local (`const c = new Widget(); c.name`) or `this` inside a class declaration (`this.Path`); cap-50 triage: 16 of 1,008 (1.6%), this 15 / jsdoc 1. Host-global claims: see "External claims" below | 0.6 / 0.85 / 0.9 |
| references | **EMITTED** | svelte 26 / 15; lodash 46 / 11; ts corpus 1,533 / 574 | NOW `instanceof` ONLY (0.95): the decorator half became the canonical `decorates` label on 2026-10-18. **An `instanceof` with no enclosing declaration is sourced to the MODULE, not to a placeholder** (JSD35). The oracle derives `instanceof` in `deriveJavaScriptEdges` outside the decorator-skipping walk, so it audits those nodes rather than stepping around them | 0.95 |
| renders | **EMITTED** (canonical vocabulary, 2026-10-18) | cap-50 triage (incoming-gate, 50-file stride): **1 row**; whole-population count not yet measured | `jsx_element` / `jsx_self_closing_element` → the capitalized component tag identifier; **ONE row per element** (a paired `<Panel>…</Panel>` is one row, never one per tag); lowercase intrinsics (`div`), fragments (`<></>`) and member components (`<A.B/>`) emit NOTHING; source = the enclosing symbol the old `uses` row was already attributed to. This was a 1:1 relabel of the JSX `uses` row, so the name rule is unchanged | 0.9 |
| decorates | **EMITTED** (canonical vocabulary, 2026-10-18) | cap-50 triage: **21 rows**; whole-population count not yet measured | Per decorated symbol: source = the DECORATED declaration, target = the decorator name leaf (`jsDecoratorName` spelling), line = the decorator's own line. One row per decorator; **no row for a decorator's ARGUMENTS** (`@inject(make())` names `inject`, not `make`) and no second `references`/`calls` row at the same site — decorator position is suppressed whole by the call/read walks (`inDecoratorPosition`). Parameter decorators do not exist in this grammar/ECMAScript | 1.0 |

`depends` is not one of the ten ontology types and is not emitted; the lane doc's
earlier "covered by imports" row was about a name the ontology does not carry.

## External claims (2026-10-18) — published, never merged into `resolved`

A CLAIM IS NOT A RESOLUTION. Three claim classes are emitted, and the arbiter
(`incoming-gate.ts`) reads each through its own `metadata` keys and its own verification; an edge
that carries one is counted in the `extOK` column BESIDE `resolved`, never inside it.

| claim class | edges it marks | keys published | how the project checks it |
| --- | --- | --- | --- |
| host-global, bare | `setTimeout(...)`, `JSON` read, `extends Error`, `x instanceof Date` | `isExternalTarget: true`, `externalReason` ∈ {host-global-bare, host-global-base, host-global-type}, `externalClaimReason` (the citation) | dotless target looked up in the project's key space; a project that declares the name is a different answer and the claim is inert |
| host-global, member | `document.getElementById`, `window.addEventListener`, `location.hash.substring`, `document.body.dataset.theme` segments | same + `externalReceiver` = the receiver chain ROOT | the receiver root is on the closed cited list; a LOCAL receiver gets NO claim (`x.substring` may be a project object) |
| module-namespace, imports | a non-relative `imports` specifier (`qunit:test`, `@glimmer/component:Component`) | `isExternalTarget: true`, `externalReason: "module-namespace"`, `externalSpecifier` = the module | module ROOT against the project's own file/directory names, and only when `context.projectIndex.complete === true`; FAILS CLOSED (no claim) otherwise |
| runtime/test-runner, bare | `process`, `Buffer` (node-runtime-global); `describe`, `it`, `test`, `expect`, `beforeEach`, `jest`, `vi`, `QUnit`, … (test-runner-global) | `isExternalTarget: true`, `externalReason` ∈ {node-runtime-global, test-runner-global}, `externalClaimReason` (the official citation) | BARE names only, from the SECOND closed cited table `src/ast/js-runtime-globals.ts` (Node.js API + Jest/Vitest/Mocha/QUnit API pages, one entry per name); a FILE-bound or FILE-declared name is never claimed, and a MEMBER of these globals is never claimed from this table (its leaf may be a real project member). Measured cap-50: +122 verified claims (calls 109 test-runner, uses 4 test-runner + 9 node), ext? 0, extFAIL 0 |

The vocabulary behind the first two is `src/ast/js-builtin-prototypes.ts` — the 57 cited
`HOST_GLOBALS` (ECMA-262 §19–§26, WHATWG HTML §7.3) plus `memberChainClaim` — the same module the
differential's oracle imports, so the two sides cannot drift into two copies of one rule. **A name
not in that list gets NO claim.** The import claim's first version claimed every non-relative
specifier unconditionally and MEASURED `ext?` 0 → 19 at cap 50: the roots were project directory
names created by Jest mocks of real packages (`__mocks__/fs-extra.js`), so the claim read as one the
project could not reach. It is now index-gated (python twin's `applyProjectIndexFacts` precedent).

**PREPARED, NOT IMPLEMENTED — the local-binding claim class** (365,748 whole-population rows:
local/parameter/catch/destructured reads and calls, `new` of a local constructor, `instanceof`,
heritage, locally-bound JSX targets). The family mechanism is the `BINDING_SEP` target spelling +
`metadata.localBinding`, which lands in the arbiter's `bindOK` column and never in `resolved`; it
needs a positional lexical-scope model in this analyzer and the Lead-owned differential audit of the
class. The full contract (mechanism, scope rules, never-claimed list, per-site counts, oracle
requirement, fixture plan) is `validation/m14/verification/JAVASCRIPT-LOCAL-BINDING-CONTRACT.md`.

**Deliberately NOT claimed, with their cap-50 triage counts** (they are the open classes in
`validation/m14/verification/JAVASCRIPT-RESOLUTION-CLASSIFICATION.md`): MEMBERS of the runtime and
test-runner globals (`jest.fn`, `process.argv.slice`, `expect(x).toBe` — the leaf may be a genuine
project member, so only the bare ROOT is claimed), imported bindings (`steps()`, `extends
Component`, decorator names — the binding is a name in THIS file whose declaration is in another
module; that needs the import seam, not a claim), and `assert`/`should`/`sinon`, which are NOT
documented globals of the cited runners (assert is a QUnit callback parameter or an imported
binding) and therefore have no entry in the closed list.

---

## Part 1 — the six questions, per emitted type

The workstream's Part 1 asks six questions of every type a lane already emits.
Source derivation answers only the first. Each answer below carries the
measurement it rests on, and each says what the instrument cannot see.

**Instruments.** Four, all lane-owned, all reading the production entry:

| Instrument | What it answers | Artifact |
| --- | --- | --- |
| `script/m14/javascript-ontology-census.ts` | fires / resolved / confident / R7, over EVERY admitted file (no sampling — see its header for why a sample of the ts corpus lies) | `validation/m14/tmp/javascript-census-*.json` |
| `script/m14/javascript-label-oracle-agreement.ts` | correct / labelled, per label, by importing the SHARED oracle functions and applying `differential.ts`'s own comparison rule verbatim — **and, new this round, attributing every MISSING row to the production noise filter or to a real gap** | `validation/m14/tmp/javascript-label-agreement-*.json` |
| `script/m14/javascript-two-path-loss.ts` | **new this round** — what the production indexer drops that the differential measures, per label, by running BOTH entries on the same files and asking `filterNoiseRelationships` itself which rows it deletes | `validation/m14/tmp/javascript-two-path-*.json` |
| `script/m14/javascript-implements-ruling.ts` | **new this round** — the six instruments behind the `implements` ruling, including a counterfactual parse and a probe that is shown to fire on the sibling grammar | `validation/m14/tmp/javascript-implements-ruling.json` |

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
- **Resolved**: **0 of 52 on svelte.** Every target is `Base.member` where `Base` is imported from another file, and a single-file run cannot bind it. On the ts corpus 220 of 630 (34.9%) resolve at both ends.
- **Confident**: **every svelte row is at 0.5 — 52 of 52, i.e. every row of the type on that corpus is a declared guess** (`evidenceClass: inferred`, `reasonCode: first-parent-guess`). On the ts corpus 408 of 630 (64.8%) are at 0.5 and 222 at 0.95. The lane's J9 measured the guess's false rate (7 wrong rows of 44 on an earlier corpus, the rest confirmed members of the base they name) and kept the tier deliberately rather than deleting 37 correct rows to remove 7 wrong ones. That trade is recorded here so a consumer can filter on `confidence >= 0.7` and know it is discarding every cross-file override this analyzer emits.
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
- **Oracle agrees**: svelte-600 truth 10,602 / analyzer 10,388 / covered 10,388 / fabrication 0 / **MISSING 214 — all 214 attributed this round to `pool-worker`'s noise filter, 0 to a real gap**. lodash-51 truth 3,470 / analyzer 3,451 / MISSING 19, **19 of 19 filter deletions, 0 real gaps**. The named leaves are `type`, `parent`, `text`, `firstChild`, `lastChild`, `nextSibling` — real reads of real code that the product discards. See Open finding §1.
- **Labelled**: correct, and the four sites are disjoint by construction (bare read / chain segment / chain root / template substitution), each with its own `metadata` marker so a consumer can tell them apart.
- **Resolved**: svelte 12,708 of 30,758 (41.3%); lodash 3,299 of 7,691 (42.9%); ts corpus 140,986 of 215,640 (65.4%). This is the lane's weakest resolution and it is intrinsic: a `uses` target is a name the file READS, and most reads are of things the file does not declare (a local, a parameter, a DOM property, an imported binding).
- **Confident**: three tiers, and the split is the honest shape of the evidence — 0.6 (30,032 of 30,758 on svelte), 0.85 (223), 0.9 (the remainder). **97.6% of the type is below the 0.7 fabrication threshold**, i.e. declared heuristic. That is the correct reading: a bare read of a name is a real syntactic fact, but whether the name denotes anything in the graph is not, and 0.6 says so.
- **R7**: 0 empty endpoints, 0 empty sources — **fixed this round**, 2,037 rows on the ts corpus (JSD35). 0 on svelte and lodash both before and after, which is why no clean-corpus gate had seen it.

### 10. references — EMITTED
- **Fires**: svelte 26 / 15 files; lodash 46 / 11; ts corpus 1,533 / 574. The smallest type, and the only one carrying two distinct constructions under one label.
- **Oracle agrees**: svelte-600 truth 22 / analyzer 17 / covered 22 / MISSING 0 / fabrication 0. lodash-51 truth 46 / analyzer 39 / covered 46 / MISSING 0 / fabrication 0. (Analyzer rows are fewer than truth rows because the comparison collapses to one row per (label, target) and five truth targets are reached by fewer published rows.)
- **Labelled**: correct against `uses` (which carries reads) and `imports` (which carries module dependencies). The two constructions inside the label are separated by `metadata.relationshipType: "instanceof_check"` and `metadata.isDecorator`, so they are distinguishable downstream.
- **Resolved**: svelte 5 of 26 (19.2%), lodash 32 of 46 (69.6%), ts corpus 1,398 of 1,533 (91.2%). The low svelte figure is the `instanceof` half: `x instanceof SomeImportedThing` names a type this file does not declare.
- **Confident**: 1.0 for a decorator (the name is written in the file), 0.95 for `instanceof`. Nothing under 0.7. **The 0.95 does not distinguish an imported type from a local one**, which is the same overstatement `calls`' 0.9 carries and for the same reason.
- **R7**: 0 empty; **0 `global` sources — fixed this round** (116 rows on the ts corpus, 14 on lodash, 1 on svelte; JSD35). Every remaining "placeholder-looking" endpoint on this type is 0.

---

### 11. renders — EMITTED (2026-10-18)

- **Fires**: cap-50 triage 1 row (the stride's whole JSX surface); whole-population count not yet
  measured. The row replaced a `uses` row 1:1, so the emission site and its name rule are the ones
  the JSX fixtures already pinned — only the label is canonical.
- **Labelled**: a JSX element is a RENDER of a component, not a generic read. One row per ELEMENT:
  a paired `<Panel>…</Panel>` is one row (pinned by `expectRelationshipCount` equals 1), its nested
  elements are their own rows; lowercase intrinsics, fragments and member components emit nothing.
- **Oracle**: `script/m14/differential.ts` has NO JSX derivation for the plain javascript grammar
  (0 jsx references), so this label is currently outside the differential's reach — reported, not
  hidden. The fixtures pin it (`javascript/jsx-usage`).
- **Confident**: 0.9, the tier the `uses` row carried; nothing under the 0.7 fabrication threshold.

### 12. decorates — EMITTED (2026-10-18)

- **Fires**: cap-50 triage 21 rows; whole-population count not yet measured.
- **Labelled**: source = the DECORATED declaration, target = the decorator name leaf, line = the
  decorator's own line; one row per decorator, none for its arguments. This REPLACED the
  per-decorator `references` row, so the label the differential's oracle derives
  (`deriveJavaScriptEdges`'s decorator block still pushes `references`) is now the OLD contract —
  a known, reported mismatch in a Lead-owned file, not a silent one.
- **Confident**: 1.0 (the name is written in the file). The decorator's arguments remain
  measurements of the call/read walks' suppression (`inDecoratorPosition`), pinned by
  `javascript/decorator-arguments-not-decorates`.
- **Parameter decorators**: none exist in this grammar or in ECMAScript decorators, so that
  position has nothing to emit from.

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

The gate that arbitrates this is `script/m14/ontology-coverage-gate.ts`, which
refuses to report for a language with no ruling table. **It needs a
`JAVASCRIPT_RULED` entry for `implements` (instrument A: grammar inventory over
`implements_clause`, `superclass`, `interface_declaration`, `extends_clause`) to
print RULED-SOUND instead of RULED-UNJUSTIFIED.** The table is shared harness, so
the need is reported rather than made. The written ruling the gate reads is in
place (JSD33, verified to match the gate's own `rulingFor` predicate).

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

Each is outside this lane's files. Each carries the number, because a finding
without one is a complaint.

### 1. `pool-worker.filterNoiseRelationships` deletes this lane's relationships, and the differential cannot see it — NOW REPRODUCIBLE FROM A COMMITTED INSTRUMENT

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

**Two numbers, and the difference is not noise.** The COUNT delta is 470 and the
SET delta is 381 on svelte. The 89-row gap is duplicate rows: the engine emits
byte-identical `(source, target, type, line)` tuples more than once, so a count
subtraction charges the filter for rows that were never unique. Both figures are
quoted because the previous round reported only the count delta and this round's
set-based instrument is the stricter one. `gained = 0` on all three samples,
which is what makes "the filter only deletes" a measurement rather than an
assumption.

Per label on the svelte 600-file sample: `uses` 373 lost (`type` 258, `parent` 89,
`text` 14, `lastChild` 6, `firstChild` 4, `nextSibling` 2), `calls` 2, `contains`
3, `imports` 1, `exports` 2. On lodash: `uses` 23 (`type` 11, `text` 4,
`lastChild` 3, `firstChild` 2, `parent` 2, `startIndex` 1), `calls` 4 (`text` 2,
`parent` 2 — `$element.text(…)` and `.parent()` in
`vendor/underscore/test/*.js` are real jQuery calls). On the ts sample: `uses`
126 (of which `type` 120 — TypeScript type annotations read as identifiers),
`calls` 17, `contains` 5, `imports` 6, `references` 1.

**The instrument also names the mechanism, which the count alone did not.** Every
one of these rows has a target leaf the filter would keep IF THE FILE DECLARED
THE NAME (`would-survive-if-declared` is the whole column). So the loss is not
"the filter blocks these names" — the filter's declaration escape hatch is doing
its job — it is "the hatch is unreachable for a name the file only READS, CALLS
or BINDS".

**Why no gate saw it, and this is the part that generalises.** Every differential
figure for javascript describes the `ASTEngine.parseFile` path, while the product
indexes through the pool worker. So a lane can publish 0 unexplained, 100%
covered and 0 MISSING while the graph a user queries is missing rows. The
per-label instrument now sees it from the other side and attributes every row:
on svelte 218 of 225 MISSING rows are filter deletions, on lodash 21 of 21.
Written up as JSD36; instrument `javascript-two-path-loss.ts`.

### 2. 1,236 `calls` targets on the ts corpus are expressions, not names

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
and this lane already publishes `#events` as a symbol — so the fix must be a
name-shape rule that admits a `#` segment, not an alphanumeric filter. **I have
not shipped it, deliberately**: the differential's oracle
(`deriveJavaScriptEdges`, `differential.ts:4477`) mirrors the analyzer's guard
character for character, so tightening one side alone turns every one of these
into a MISSING row — about 29 on svelte and 165 on lodash against a recorded
baseline of 0. The change is four lines in each file and must land in the same
merge. The oracle derives the same garbage, which is why both sides of the
comparison currently agree on it (`calls MISSING 2` on the svelte draw is the
mirror of the two ternary callees the production filter deletes).

Reproduce by rerunning the probe named in the "Two paths" paragraph below.

### 3. Four of this lane's mutants are NEVER RUN — the fixes they protect have no teeth

This is the finding this round most wants the master to act on, because it is the
same class as a DERIVATION finding pointed the other way: a check that is stored
and never executed.

`script/m14/javascript-mutants.ts` declares four mutants.
`script/m14/mutate-analyzer.ts` builds its `MUTANTS` list **without importing
that file**. Measured at this commit: the registry holds **56** `javascript/*`
mutant ids; the lane file declares 4; and the strings `restore-empty-edge-endpoints`,
`restore-global-instanceof-source`, `restore-empty-pattern-binding-symbol` and
`class-scope-preempts-literal-owner` appear **zero times** in the registry. So

```
bun run script/m14/mutate-analyzer.ts --lang javascript
```

executes 56 javascript mutants, reports all 56 CAUGHT, and never touches these
four. The consequence is concrete: those four are the only regression protection
for the three rule-R7 fixes this lane shipped — the empty-endpoint guard, the
`global` instanceof source, the writable-name requirement in `collectPatternPairs`
— and for the containment owner fix. **The previous round's "javascript: 60 of 60
caught" therefore reported 56 that ran plus 4 that did not.**

`script/m14/javascript-mutant-runner.ts` (new, lane-owned) runs them through the
same `runLang` the registry uses, so the pass/fail rule is not restated:

```
clean suite: 74 pass / 0 fail over 74 fixtures
CAUGHT   javascript/restore-empty-edge-endpoints  (0 -> 2 failures; new failures: javascript/empty-endpoints-refused, javascript/recovery-empty-node-endpoints)
CAUGHT   javascript/restore-global-instanceof-source  (0 -> 2 failures; new failures: javascript/instanceof-module-scope-source, javascript/instanceof-source)
CAUGHT   javascript/restore-empty-pattern-binding-symbol  (0 -> 1 failures; new failures: javascript/recovery-empty-node-endpoints)
CAUGHT   javascript/class-scope-preempts-literal-owner  (0 -> 1 failures; new failures: javascript/literal-owner-inside-class)
4 lane mutants, 4 caught, 0 survived
```

All four die, so the fixtures can hold them; the gap is the wiring, and it needs
one import line and one spread in the shared registry. Reported, not taken.

### 4. Six M14.0.F4 mutation survivors, none of them this lane

A full registry run at this commit: **6 survived** —
`java/bare-read-type-attribution`, `groovy/modifier-return-type-loss`,
`groovy/ctor-name-revert`, `scala/drop-import-source-rewrite`,
`make/swallow-the-rule-after-a-comment`, `php/drop-external-override-guess`.
javascript: **56 of 56 caught in the shared registry, plus the 4 lane mutants
above when run through this lane's own runner** — 60 defined, 60 caught, but only
56 of them are reached by the canonical command. The workstream's "4 mutation
survivors in scala/csharp/elixir" no longer matches: scala has 1, csharp and
elixir have 0, and java/groovy/make/php have 5 between them.

### 5. `imports` re-export members — FIXED 2026-10-17; the ORACLE half is still owed

**Status: the analyzer half landed this iteration; the differential's oracle half did NOT and is
master-owned.** `export { a, b } from "./m"` now publishes one `imports` row per written member —
`m:a`, `m:b` at 1.0 with `metadata.declaredName` and `metadata.exportedAs` — and the star/namespace/empty
forms keep `m:*` at 0.6 with `metadata.starForm` (`all` vs `namespace`), `unresolved`. Fixtures
`javascript/reexport-forms` and `javascript/star-reexport` pin all of it and were RED before the change,
GREEN after. MEASURED pre-fix on the corpora: **svelte 106 named re-export statements carrying 271
specifiers, the ts corpus 607 statements carrying 519, lodash 0** — 713 statements and 790 written member
names published as a module-level dependency with no member.

**THE OWED HALF, named precisely so it can be applied in one merge:** `deriveJavaScriptImportEdges` in
`script/m14/differential.ts` (master-owned) still derives `path:*` for all three re-export forms, and it
still spells the OLD import contract for local modules (`<module>:<local binding>`) — the analyzer's local
named imports have been bare since `d0f2ea19b` and now target the DECLARED name. Until the oracle moves,
the differential reports the re-export member rows and the local-import rename as MISSING/analyzer-only.
`script/m14/differential.ts` is the master's; this lane's proposal
(`validation/m14/proposals/javascript-callee-guard-and-store-wiring.md`) carries the exact patch shape.

Also fixed in the same pass: `export *` and `export * as ns` used to emit BYTE-IDENTICAL records. The
grammar marks the namespace form with a named `namespace_export` child (`"* as ns"`), so the discriminator
is a tree fact, not a text guess, and it is also why `hasToken(node,'*')` is false for it. A resolver that
reads a star edge as a redistribution would otherwise invent, for a consumer of this file, every member of
`./m` the language does not export from it.

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

### 9. `rel-type-coverage-gate.ts --langs=` destroys the artifact it writes

Its own header says the flag "restrict[s] the report (never narrows the gate's
own claim)", but the run **writes** `validation/m60/results/rel-type-coverage.json`
containing only the selected lanes — `--langs=javascript` replaced 1,418 lines of
other lanes' evidence with 18 lines. Reverted here by hand; the flag needs to
suppress the write the way the differential's `--emit` scoping does. This round ran
the gate **without** `--langs` and restored the artifact afterwards for the same
reason.

### 10. `verify-doc-truth-emissions.ts` drops the FIRST body row of every claim table

`parseClaimTable` (`script/m14/verify-doc-truth-emissions.ts:439`) walks the rows
after the header, and on the first one does `if (!started) { started = true;
continue }` — which **discards it**. Every analyzer's claim table therefore loses
exactly its first data row, silently: there is no count check, so a table with
one row and a table with nine parse the same.

For this lane the lost row is `calls`, the largest type by volume (30,758 edges
on svelte), and it is now visible as `UNDOCUMENTED [javascript] calls
(relationship) — docs/analyzers/real-javascript-analyzer.md:36` on a line that
plainly reads `| calls | **EMITTED** | … |`. The fix is to `push` that row
instead of `continue`-ing it. The gate is the master's file; reported, not taken.

The lane's half of this is fixed: the claim table's second column now reads
`Emitted?` instead of `Verdict`, which is the only way `looksLikeClaimHeader`
accepts it, so this lane's claims are machine-checked for the first time. Nine of
the ten types are now parsed and graded; the tenth (`calls`) is blocked on the
row-skip above rather than on anything the doc says.

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

## The six definitions of done, checked

| Requirement | Result |
| --- | --- |
| every type has a verdict with a number | 10/10 — nine EMITTED with counts and file spreads on three corpora re-measured at this commit, one RULED with **six** instruments of which three are new and two of those decisive |
| emitted types answer all six questions | the ten subsections above; each answer cites its instrument and measurement, names what the instrument cannot see, and — new this round — **attributes every MISSING row** to the production noise filter or to a real gap. 218 of 225 MISSING rows on the svelte draw are filter deletions; the 7 that are not are all oracle over-derivation, listed by construct and file |
| no unknown symbols, no empty names, no placeholder-literal endpoints | 0 empty endpoints, 0 `global` sources, 0 empty symbol names, re-measured on all three corpora. Remaining "placeholder-looking" endpoints enumerated and classified, with one **classification corrected this round**: `module` as a `calls` TARGET is a written method name (`template.module(data)` in `lodash/lib/fp/build-modules.js:102`, `QUnit.module(…)` in `lodash/test/test-fp.js`), not the CommonJS free variable — 100 rows on lodash that the R7 heuristic mislabels, 0 on svelte |
| fixtures assert the new behaviour and a mutant must die | **[re-measured 2026-10-17]** 77 fixtures, **76 pass / 1 fail**, baseline `validation/m14/fixture-baseline.json` allowed 3 failing and now allows the run's 1. The pass count rose from 74 by recovering the lost lineage's two re-export fixture halves (`reexport-forms`, `star-reexport` were RED at HEAD) — see `validation/m14/verification/JAVASCRIPT-STATE.md`. The one remaining failure is `non-name-callee-refused`, whose analyzer half is four lines but whose ORACLE half lives in master-owned `script/m14/differential.ts`; it is proposed, not silently ignored (`validation/m14/proposals/javascript-callee-guard-and-store-wiring.md`). The old sentence here claimed "no analyzer behaviour changed this round" — that was true of the round it was written for and is FALSE of this one; the fixture count and the payload both moved. Mutation/differential rows below are from that earlier round and were NOT re-run this iteration. |
| mutation, differential and payload/latency re-run | mutation: javascript **56 caught / 0 survived** in the shared registry, plus **4 caught / 0 survived** through `javascript-mutant-runner.ts`; the 6 registry survivors are java 1, groovy 2, scala 1, make 1, php 1. differential: svelte 120 files 1,457 truth / 1,456 covered / MISSING=1 / unexplained=0 / heuristic=0, hash `fc839056ff888724`; lodash 55 files 12,819 / 12,819 / MISSING=0 / unexplained=0, hash `494e1b94766e8ade`; ts corpus 200 files 3,445 truth / 3,406 covered / MISSING=39 / unexplained=1 (an `exports` row), all 39 MISSING in `tsc/testdata/baselines` files the JS grammar cannot parse. payload: **399-file svelte sample 34,569 relationships at this commit** — see the caveat below |
| doc + spec updated | this file; JSD33 (`implements` RULED), JSD34 (class-expression heritage), JSD35 (R7 runtime), JSD36 (`pool-worker` loss), **JSD38–JSD40 added this round** (grammar-declared inventory, the probe that fires on the sibling grammar, the counterfactual parse, and the JSDoc resolvability measurement) |

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
| lodash (second) | 55 | 12,819 | 12,819 (100%) | 0 | 12,783 | 0 (0%) | 0 | `494e1b94766e8ade` |

The lodash hash reproduces the recorded baseline's drawn set exactly. The single
svelte MISSING is `extends -> Svelte4Component` from an unbound class expression
— JSD34's declared silence, quoted rather than hidden.

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

- Fixtures: `validation/m14/fixtures/javascript/` (74; **0 added this round, and
  the reason is in the definitions-of-done table: the analyzer emitted no new
  edge, so there is no new behaviour for a fixture to assert**)
- Spec: `script/m14/spec/javascript-completeness.json` (JSD33–JSD36 from the
  previous round; **JSD38–JSD40 added this round** — the grammar's declared
  vocabulary and the probe that fires on the sibling grammar, the JSDoc
  resolvability measurement, and the `imports` DERIVATION verdict with its
  independence caveat)
- Lane-owned instruments (committed):
  - `script/m14/javascript-ontology-census.ts` — fires / resolved / confident / R7, over every admitted file
  - `script/m14/javascript-label-oracle-agreement.ts` — per-label oracle agreement, importing the shared oracles; **extended this round to attribute every MISSING row to the production noise filter or to a real gap**
  - `script/m14/javascript-two-path-loss.ts` — **new** — the engine-vs-pool delta per label, asking `filterNoiseRelationships` itself which rows it deletes
  - `script/m14/javascript-implements-ruling.ts` — **new** — the six instruments behind the `implements` ruling, including the counterfactual parse, the probe-fires check, and the JSDoc resolvability count
  - `script/m14/javascript-mutants.ts` — this lane's four regression mutants
  - `script/m14/javascript-mutant-runner.ts` — **new** — runs those four through the shared `runLang`, because the shared registry does not import them (Open findings §3)
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
  run; this lane restored it after each run rather than carrying a whole-tree diff
  of a shared generated doc. The committed copy is the master's to regenerate.
- Harness artifacts (regenerated by their own verifiers, not hand-edited):
  `validation/m14/results/M14.0.F4.json`,
  `validation/m12/results/javascript-complexity.json`,
  `validation/m60/results/rel-type-coverage.json`
- Prior rounds: `validation/m12/{ground-truth,results}/javascript-*`,
  `validation/m12/corpus-manifest.json`

## Issue

Closes M12.10 (GitHub issue #149). Ontology round: `docs/analyzers/ONTOLOGY-WORKSTREAM.md`.
