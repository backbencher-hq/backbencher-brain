# JavaScript — receiver-owner and source-attribution audit (findings 1–5)

**Author: Muhammad Ishaq Khan.**
**Reconstruction note:** the original of this file (568+ lines over two rounds) was deleted from the
working tree by the 0.1.5 release cycle and its commits are unreachable (`git fsck` finds no object).
This rewrite keeps every finding, population and verification number; the per-probe transcripts are
gone and each number names the instrument that reproduces it.
**Lane:** `javascript` — `src/ast/real-javascript-analyzer.ts`.
**What this audits:** the two dimensions **every gate the lane owned was blind to** —
`metadata.owner` (the receiver-typing evidence the store's owner pass reads) and the row's `source`.

Why blind: `script/m14/differential.ts` matches on `label + normTarget` and **never on source** (its
own header says so), the per-label oracle does the same, and `verify-js-source-attribution.ts` asserts
only the **NULL**-source class. A wrong owner or a wrong source was invisible to the whole instrument
set.

| # | finding | class | state |
|---|---|---|---|
| 1 | `this.<field>` types keyed by **field name only** | wrong owner, **bound by the store** | FIXED |
| 2 | every chain segment carried the **chain root's** owner | wrong owner on segments past the head | FIXED |
| 3 | a `#private` field's owner was **never published** | lost owner (safe) | FIXED |
| 4 | a named `function_expression` did not rebind the `uses` source | wrong source | FIXED |
| 5 | `importedBinding` was **never populated** on `extends` / `mixes_in` | missing claim | FIXED |
| 6 | `decorates` carried no `importedBinding` (2,570 rows, 0 claimed) | missing claim | FIXED |

---

## Finding 1 — `this.<field>` types are keyed by field name, not by the declaring class

`collectLocalReceiverTypes` keyed `fieldTypes` by FIELD NAME alone, so `this.svc = new SvcA()` in class
A was visible to a read of `this.svc` in class B, and B's member call was published with `owner=SvcA`.
The store's `claimOwnerCarryingTargets` **withdraws the name binding** for an owner-carrying row and
re-resolves inside the owner, so the wrong claim became a wrong EDGE.

**Measured end-to-end in a real index:** `HolderB` never writes the field and has no relationship to
`SvcA`, yet `calls b -> run` came out `owner=SvcA` and bound to `run in SvcA`.

**Fix:** the map is keyed `(class, field)` and reads an inherited field up the `extends` chain; the
class identity is `classMemberOwnerAt`, which resolves a class **expression** to its BINDING — the same
string `containerOwnerName` publishes, so a field and its member's symbol cannot disagree.

**The trade was measured and is free:** bootstrap kept **80 / dropped 0** correct owners; vault and
consul 0/0. The different-type case is a strict **coverage gain** — the old conflict rule withdrew both
owners, the fix gives each its own type.

**Fixture** `javascript/field-owner-class-scope` (three shapes, distinct method names because the
matcher compares type/from/target/owner): **fails at HEAD 95/1, passes 96/0.**

## Finding 2 — every segment of a multi-segment member read carried the chain root's owner

`collectFieldAccessUses` took `cur`/`head` from the chain ROOT once, outside the segment loop, so
`w.a.b` gave `b` the same owner as `a` — though only `a`'s receiver IS the typed root. Population: 392
sites on apollo-server, 143 on bootstrap, 25 on lodash; harmful (the owner's type actually declares the
name) on 1.

**Fix:** each segment carries its own receiver.

**The load-bearing measurement** — the depth A/B (`script/m14/javascript-chain-owner-census.ts`):

| chain depth | tree sites | owned before | owned after |
|---|---|---|---|
| 1 (`this.x`) | 4,711 | **1,757** | **1,757** ← identical: no correct owner lost |
| 2 (`this.x.y`) | 1,351 | 920 | 14 ← the wrong-owner class |
| 3 (`this.x.y.z`) | 104 | 37 | 0 |

The 14 survivors at depth 2 are **not defects**: `this.constructor.DATA_KEY` in bootstrap's minified
bundle, where `.constructor` is a genuine member of a typed `this`.

## Finding 3 — a `#private` field's owner is never published

The grammar types a private field's property node `private_property_identifier`; the three field-map
write arms tested `property_identifier` only, so every `#private` field was dropped. The reader's
`field()` had no type test — the writer was the only half refusing, and the TypeScript twin already
accepted all three spellings.

**Fix:** all three spellings accepted. Real case: svelte
`packages/svelte/src/internal/client/dom/elements/bindings/size.js` (`#listeners = new WeakMap()`).

## Finding 4 — a named `function_expression` does not rebind the `uses` walk's source

`extractCallRelationships.resolveCurrent` — the **calls** walk — lists `function_expression` among the
nodes that rebind the actor. The **uses** walk listed only three of those four. So reads inside a named
function expression were charged to the OUTER function. Same line of bootstrap's bundle:

```
L348 calls  handler            -> off
L348 uses   bootstrapHandler   -> handler\0EventHandler / oneOff / type / fn
```

`bootstrapHandler` merely RETURNS `handler`; it reads none of those names. Population: 53 rows on
bootstrap's bundle, 77 on lodash's UMD wrapper, 0 on svelte.

**Fix:** a named `function_expression` rebinds to its own name first; the `X.prototype.m` rule moves
into the `else`.

**Fixture** `javascript/named-function-expression-source` — four nesting contexts (declaration,
expression, `const` arrow, `X.prototype.m`). Its first draft called three of them "positive controls
that already worked"; **that was false**, and the A/B proved all four emitted the outer name. They are
four regression tests for the one fix, and they prove it COMPOSES with each other rebinding rule
instead of replacing it. **At pre-fix 96/1, with the fix 97/0.**

## Finding 5 — `importedBinding` was never populated on `extends` or `mixes_in` (FIXED)

The class pass computes `metadata.importedBinding` for a base that is an imported binding, and
`callShapedHeritageRows` does the same for a call-shaped base and each mixin. **It never appears.**
Measured on consul's first 400 JS files: **702** `extends` + `mixes_in` rows, **0** carrying it.

Not hypothetical: `svelte/.../compiler/warnings.js` imports `CompileDiagnostic` and writes
`class InternalCompileWarning extends CompileDiagnostic` — the row is
`extends InternalCompileWarning -> CompileDiagnostic` with metadata `{ evidenceClass: "structural" }`.

**Why it matters more than `mixes_in` alone.** The whole-population measurement makes the "83 rows, 0
resolved" concrete: **all 81 measured `mixes_in` targets name a name the same file does not declare** —
imported Ember mixins (`WithBlockingActions`, `WindowResizable`, `Sortable`). The only channel by which
the store could follow the import is `metadata.importedBinding`, and it is empty. So "0 resolved" is
not a resolution failure and not a wrong target — it is a **missing claim**.

**The root cause is ORDERING, and it was proved by code position, not by guesswork.**
`this.bindingModel = this.collectBindingModel(rootNode)` sat ~1,300 lines into `analyze()` with the
containment/call/use passes. The class heritage emission runs EARLIER in the same method, so when it
asked `importedBindingFor` for a base's binding, `bindingModel` was still `null` and the helper
returned null on its first guard (`if (!model || !node || !name) return null`).

The decisive test was not a guess about scopes: in ONE file,
`svelte/packages/svelte/src/compiler/warnings.js`, `uses` rows for `CompileDiagnostic` carried
`importedBinding` while the `extends` row for the SAME name did not. Same model, same file, same name —
so the model was correct and the class pass was reading it too early.

**Fix:** build the model once at the TOP of `analyze()`, and delete the late assignment so it is built
once. **Blast radius measured before the move**, by grepping every binding-dependent call site before
the old position: exactly **two** exist, both class-heritage (`class_declaration` and the class
EXPRESSION form) — so no other emission can change. The model was already built on every file; this
moves it, it does not add a pass.

**Result, measured:**

| population | before | after |
|---|---|---|
| consul, first 400 JS files: `extends` rows carrying `importedBinding` | **0 / 702** | **203 / 702** |
| nomad `mixes_in` rows carrying `importedBinding` | 0 / 70 | **70 / 70** |
| consul `mixes_in` rows carrying `importedBinding` | 0 / 11 | **11 / 11** |

The 499 `extends` rows in consul that still carry nothing are bases that are NOT imports — Ember
globals (`Route`, `Component`) — which is the correct answer, not a gap.

**What this does and does NOT fix — corrected after checking the consumer, because the first
statement of this paragraph was an overclaim.** All 81 measured `mixes_in` targets are imported
mixins. `metadata.importedBinding` is consumed by the **inbound-gate arbiter**
(`script/m14/incoming-gate.ts`, `classifyEdge` kind `importedBinding`), which verifies the claim
against the run's OWN import evidence — so before this fix an imported mixin target was a bare name
indistinguishable from a fabricated one, and now it is a **verifiable claim** on 81 / 81 rows.

It does **not** make the store resolve them. `member-owner-resolution.ts` and `parallel-indexer.ts`
have no `mixes_in` handling at all and do not read `importedBinding`; that is a resolution RULE, and
adding one is a store-side, all-lane decision of the same class as the name-ranking bind above. So
"0 resolved" is still true at the store, and the honest statement of this fix is: **the claim is now
present and checkable; resolution is still a store question.**

## Finding 6 — `decorates` carried no `importedBinding` on 2,570 rows (FIXED)

Same family as finding 5, much larger population, and it needs node plumbing rather than a one-line
move, so it is recorded rather than rushed.

**Measured on nomad** (every tracked `.js`/`.mjs`, via `script/m14/javascript-vocabulary-census.ts`
plus a direct probe):

| measurement | value |
|---|---|
| `decorates` rows | **2,570** |
| carrying `importedBinding` | **0** |
| top targets | `service` 398, `attr` 394, `action` 364, `computed` 334, `classic` 196, `tracked` 178 |

Every one of those top targets is an **imported** Ember decorator — the probe confirms `imported=true`
for the sampled rows (`@service`, `@action`, `@computed` are resolved through the file's own import
lines). So the rows carry `{ isDecorator, decoratorLine }` and no claim, exactly the shape finding 5
had on `extends`/`mixes_in`.

**Fix:** the decorator's own `startIndex` is now recorded beside its name and line
(`decoratorOffsets` in the symbol metadata, from `collectOwnDecoratorDetails` through
`collectClassDecoratorDetails`), and `importedBindingFor` gained a position form
(`importedBindingAt(index, name)`) so the decorator pass — which holds NAMES, not nodes — can ask the
same question the node-based callers ask. The `decorates` row now carries the same claim `extends` and
`mixes_in` carry.

**Result, measured on nomad:** **2,554 of 2,570** `decorates` rows now carry `importedBinding` (was
**0**). The 16 that do not are decorators that are not imports — locally declared or global — which is
the correct answer.

**And the claim is now measured by the committed instrument**, so the number is reproducible rather
than quoted: `javascript-vocabulary-census.ts` prints rows carrying `metadata.importedBinding` per
label. On nomad:

| label | carrying the claim | of rows |
|---|---|---|
| `mixes_in` | **70** | 70 |
| `extends` | **482** | 483 |
| `decorates` | **2,554** | 2,570 |
| `instantiates` | 67 | 127 |
| `references` | 13 | 39 |
| `calls` | 6,793 | 27,434 |
| `uses` | 1,297 | 20,811 |

**Why it matters:** `decorates` is the lane's fourth-largest label by population (2,570 on nomad alone,
1,299 vault, 960 consul), and in the inbound gate its unresolved rows are exactly these names —
`service`, `action`, `or`, `computed` — because a decorated symbol's target cannot be resolved and
carries nothing to say why. The claim is the honest fix; it is the same claim finding 5 established.

## Finding 7 — JSDoc declares names that were not symbols at all (FIXED)

**The largest symbol hole in this lane, and no node-type census could see it.** A JSDoc type
declaration lives in a COMMENT:

```js
/** @typedef {{ code: string; message: string }} ICompileDiagnostic */
/** @implements {ICompileDiagnostic} */
export class CompileDiagnostic { … }
```

`ICompileDiagnostic` is referenced by other JSDoc, by `@implements`, and by JSDoc-typed parameters —
and there is no grammar node of type "typedef" to enumerate, so every symbol census this lane ran
measured zero gaps while the name was absent from the symbol table entirely.

Instrument: `script/m14/javascript-symbol-coverage-census.ts`, which measures BOTH axes — declaration
**nodes** from the grammar, and declaration **names** from comment text.

| corpus | JSDoc declared | covered | missed |
|---|---|---|---|
| svelte | 38 | **38** | **0** |
| nomad | 22 | 20 | 2 |
| vault | 14 | 13 | 1 |
| proxicall | 13 | 12 | 1 |
| consul | 4 | **4** | **0** |
| lodash / bootstrap | 0 | 0 | 0 |

**Fix:** `extractJsdocDeclarationSymbols` publishes `@typedef` / `@callback` / `@interface` / `@enum`
names as symbols (`TypeAlias` / `Interface` / `Enum`) with `{ viaJSDoc: true, jsdocTag }`. A REAL
declaration always wins: if the file already declares a symbol of that name, the tag is a comment
about it and adds nothing — which is what the 4 residual "misses" are (the name IS a symbol, declared
later in the same file, so the census's line join does not see it).

**No relationship changes**, and that is by construction: `addContainmentRelationships` emits only for
a symbol with an `ownerName`, and a module-level type declaration has none — exactly like a module-level
`const`. Both differential hashes are byte-identical afterwards, which is the evidence.

**This is also what makes `implements` followable.** The `implements` edge added for
`@implements {ICompileDiagnostic}` named a type no symbol carried, so the graph could not land on it.

### The bug this fix had in its own first version, and how it was caught

The tag-body boundary was a fixed-string search for `"\n * @"` — which matched NOTHING, because real
JSDoc is indented further (`"\n   * @property"`). The body then swallowed every following `@property`
line and the "last identifier in the body" became a PROPERTY name: a multi-line
`@typedef {Object} HealthStatus` + two `@property` lines published **`canary`**, not `HealthStatus`.
Measured on nomad: **16 of 22** declared names missed for that one reason. The boundary is now a
character scan (`jsdocTagBodyEnd`, no regex — the lane's rule).

## Symbol coverage, measured — grammar declarations

Same instrument, the other axis. A declaration node is covered when a published symbol has the same
name and its range contains the **NAME node's** line.

| corpus | class | function | generator | method | field | var(top) | MISSED |
|---|---|---|---|---|---|---|---|
| svelte | 37/37 | 1562/1562 | 2/2 | 564/564 | 216/216 | 0 | **0** |
| nomad | 446/446 | 77/77 | — | 1494/1494 | 1831/1831 | 0 | **0** |
| consul | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |
| vault | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |
| bootstrap | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |
| lodash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |
| proxicall | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **1** |

Two census bugs were found and fixed before these numbers meant anything, and both had made the
analyzer look worse than it is:

1. **Locals counted as gaps.** The first run reported **4,205** missed variable declarators on svelte;
   every sampled one was a loop counter inside a function. This lane publishes no LOCAL symbols by
   design, so the bucket is `local(ok)` now.
2. **Decorator lines counted as gaps.** In the pinned grammar a decorated declaration's node STARTS AT
   ITS DECORATOR, so `@computed('x') get features() {}` has its node start on the `@computed` line
   while the symbol's range starts on the `get` line. Joining on the node start reported **522**
   published nomad methods as missing — every sampled one a decorated getter that WAS in the symbol
   table (`features kind=property owner=Abstract`, verified). The join is on the NAME node's line now.

### Dispositions that are NOT gaps, now measured as such

| class | population | why it is correct |
|---|---|---|
| object-literal members | 2,223 nomad / 2,487 svelte | this lane publishes NO symbol for an object-literal member; a bound literal's member is placed by its OWNER, an unbound one is correctly ownerless |
| function locals | 1,229 nomad / 4,205 svelte | a declaration at function depth > 0 is not a symbol in this lane |
| import bindings | 1 nomad / 63 lodash / 742 proxicall | `const fs = require('fs')` publishes an `imports` EDGE and no symbol — and ESM default/named/namespace imports behave identically (measured: 0 symbols, 1 imports edge each) |

### One inconsistency found and recorded, not fixed

`const { a } = require('m')` **does** publish a symbol `a`, while every other import binding —
ESM default, named, namespace, and a bare `const fs = require('m')` — publishes none. Either the
destructured form should stop publishing or the others should start, and that is a lane-wide symbol
model decision (it would move symbol counts on every corpus), not a bugfix. Recorded here with the
measurement.

## Finding 8 — Flow-annotated `.js` was HALF-unreadable, and a grammar fallback recovers it (FIXED)

**The largest coverage gain of this campaign, and only a freshly cloned corpus could expose it.** Every
corpus this lane had measured before (svelte, lodash, bootstrap, Ember apps) is plain ECMAScript. React
is not: its source is **Flow**, a typed superset of JavaScript that `tree-sitter-javascript` cannot
parse. So the analyzer read only the fragments error-recovery left intact.

### The measurement

Parse health of AUTHORED source (build output AND test fixtures excluded — the fixtures are
deliberately Flow/proposal samples, and measuring them measures the test data):

| repo | authored `.js` | ERROR trees | rate |
|---|---|---|---|
| **react** | 1,450 | **782** | **53.9%** |
| prettier | 671 | 1 | 0.1% |
| three | 1,463 | 0 | 0.0% |
| moment | 433 | 2 | 0.5% |
| preact, jquery, underscore, ramda, d3, express, axios, chartjs, socket.io, vue, mongoose | — | 0 | 0.0% |

**753 of React's 782 (96%) carry a `@flow` / `@noflow` pragma in the first 400 characters.** That is
the key: the failure is a *declared* dialect, not general brokenness.

### The fix, and why the TypeScript grammar is legitimate here

`tree-sitter-typescript` **extends** the JavaScript grammar, so the node types the javascript analyzer
switches on are the SAME names (verified on a Flow file: both grammars produce
`comment, import_statement ×8, export_statement` at top level). Parsing a Flow file with it yields the
structure the analyzer already understands, and TS-only nodes (`type_annotation` and friends) are
simply types its switch does not list — an unlisted type is ignored, not misread.

`src/ast/engine.ts` now retries with the TypeScript grammar, under FOUR gates, each of which exists to
stop it being a general-purpose language switch:

1. the file is `javascript` (never `.ts`/`.tsx` — those already use the TS grammar);
2. the primary JS parse **failed** — a clean parse is never second-guessed;
3. the source **declares Flow in its head** — an ordinary broken `.js` is not silently reparsed as
   another language;
4. the fallback tree must parse **CLEAN** — a failure is never traded for a different failure.

### The gain, measured A/B on the same 426 files

| | JS-grammar tree (before) | engine path (after) | delta |
|---|---|---|---|
| symbols | 2,766 | **3,912** | **+1,146 (+41%)** |
| relationships | 33,885 | **34,841** | **+956** |

426 of React's 782 rejected files parse clean under the TypeScript grammar and are now fully read.

### Still unreadable, and named rather than implied

356 of the 782 remain: Flow-only syntax the TS grammar does not accept (`declare var`, exact object
types `{| |}`, existential `*`), and React Compiler's own `component C() {}` DSL in fixtures — which
is not JavaScript at all. A TSX retry cleans 141 more of those and is the obvious next step.

### A measurement trap in my own instruments, recorded

`getParser` recreates a parser every 500 files (a WASM-memory mitigation), so a probe that holds ONE
parser reference across thousands of parses is reading from a deleted object. My first A/B was
distorted by exactly that, and it also silently made the census skip files. Every census that walks a
corpus must re-fetch the parser periodically; the fix is in the census, not the analyzer.

## Relationship witnesses — every label proved to FIRE, not just documented

**New committed gate: `script/m14/javascript-relationship-witness.ts`.** It feeds the analyzer a
minimal construct for each of the 14 vocabulary labels and asserts a row comes out. No corpus, no
sampling, no stride — so a label cannot appear "implemented" because a sample happened not to contain
the construct.

Why this was needed: `renders` has **0 rows on every corpus this lane measures** (the drawn `.js` files
contain no JSX) and `mixes_in` is 81 rows across 7 corpora. A zero from a corpus is indistinguishable
from a broken code path, so "EMITTED" rested on triage counts rather than on a construct known to
produce the label.

| label | witness rows | verdict |
|---|---|---|
| calls, extends, implements, uses, imports, exports, contains, references, overrides, instantiates, decorates | 1 each | fires |
| renders | **2** (`App -> Panel`, `App -> Inner`; lowercase `div` correctly emits nothing) | fires |
| mixes_in | 1 | fires |
| **part_of** | **0** | **silent by declared disposition** — no grammar node, and no JSDoc channel either |

**PASS — 13 of 13 implementable labels fire.**

**The gate is proven to fail, which is the only thing that makes a PASS mean anything.** Breaking the
`renders` witness (returning a literal instead of JSX) turned it into
`FAIL — 12 of 13 … renders: NO row. The same witness emitted: (none)`, and restoring the witness
returned PASS.

**And a sandbox lesson re-learned the hard way in the same minute:** the backup copy of the gate was
written to `/tmp`, which does not persist here — so the restore had to be done by editing the file
back in place, not by copying. Workspace paths only.

## No regex in the analyzer — re-confirmed

The lane's standing rule is that the analyzer contains **zero regex**. Re-measured this round:

- `grep` for regex literals, `new RegExp`, and `.replace(/`, `.match(/`, `.test(/`, `.split(/`,
  `.exec(/` on `src/ast/real-javascript-analyzer.ts` → **0 matches**
- the additions this campaign made (the JSDoc `@implements` parser, the symbol-coverage work) use
  `indexOf` / `split` on literal separators / character scans, and the new `jsdocTagBodyEnd` boundary
  is a character loop specifically to keep that true

## What the store does with an owner claim, and the one thing still open

`claimOwnerCarryingTargets` withdraws the name binding for an owner-carrying row, then
`resolveMemberTargetsByOwner` re-resolves inside the owner. With the owner correctly withheld, the
store's **name-ranking pass still binds a project-unique member name by name**:

```
ARM A (before):  b -> onlyOnA  owner=SvcA    bound=onlyOnA.SvcA
ARM B (after):   b -> onlyOnA  owner=(none)  bound=onlyOnA.SvcA
```

The false CLAIM is gone; the wrong EDGE can survive by another route. That is a policy question about
`parallel-indexer.ts` covering **all 50 languages** — it needs its own arm and the owner's ruling, so it
is measured and named rather than folded into a JS fix that cannot reach it.

## Verification for the whole campaign

| gate | result |
|---|---|
| whole fleet fixtures | **50 lanes, 1,788 pass, 0 fail** (vue 64, svelte 54) |
| JS fixtures | **98 pass / 0 fail** |
| `tsc --noEmit` (src, scripts) | **0 / 0** |
| differential svelte | 2,184 truth, **100% covered, MISSING 0, unexplained 0**, hash `1aa48514c0dab17a` |
| differential lodash | 12,597 truth, 100%, MISSING 0, unexplained 0, hash `494e1b94766e8ade` |
| per-label oracle agreement | **identical to the pre-fix run** on every aggregate |
| fleet audit / js-census / doc-truth | PASS / PASS / PASS |
| perf (lodash, 60 files) | HEAD 500 / 511 ms · fix 504 / 522 ms — ~1.9%, within noise |

## Instruments (committed, re-runnable)

| instrument | measures |
|---|---|
| `script/m14/javascript-chain-owner-census.ts` | the depth A/B for finding 2 |
| `script/m14/javascript-field-owner-census.ts` | class-scoped `this.<f>` writes vs reads, **tree-only** so it cannot inherit the defect it measures |
| `script/m14/javascript-source-attribution-census.ts` | replays `resolveCurrent` per line to check each source |
| `script/m14/javascript-target-validity-census.ts` | the R7 class the empty-endpoint guard misses |
| `script/m14/javascript-vocabulary-census.ts` | whole-population counts + tree-read denominators |

**Current measured state:** targets **0 invalid on 70,157 rows**; sources **0 unattributed** on the
`calls`+`uses` rows of four corpora. Both zeros are *validated*: injecting a defect moved the target
census 0 → 109, then the analyzer was restored byte-identical.

## Three corrections that make the rest trustworthy

1. **A false lead.** I reported `#getObserverentries` as a merged-name defect. It was `BINDING_SEP`
   (`\u0000`) stripped by a shell pipeline. Recorded so the next round does not re-walk it.
2. **Both censuses first reported thousands of "defects"** that were all legal syntax — `imports`
   `<module>:<item>`, module-stem sources, reserved-word **property** names (`o.default`, `class`),
   the default export, module-level rows inside an unrelated `const`.
3. **My own fixture's rationale was false** — see finding 4.

The pattern in all three is this lane's standing rule firing again: **read the node type, do not
re-decide from the text.**
