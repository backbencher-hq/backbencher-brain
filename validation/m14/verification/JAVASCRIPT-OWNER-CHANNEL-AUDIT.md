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
| 5 | `importedBinding` is **never populated** on `extends` / `mixes_in` | missing claim | **OPEN** |

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

## Finding 5 (OPEN) — `importedBinding` is never populated on `extends` or `mixes_in`

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

**Candidates, named not guessed:** (1) `importedBindingFor` requires
`resolveBindingKind(...) === "published"`; if the heritage base's offset resolves to a scope whose
`published` flag is false it returns null for every base — which is what 702/702 looks like. (2)
`model.moduleBindingSpecs` may not hold the name for the import form used. `bindingModel` is **not** the
cause: it is assigned once before any relationship pass (`:2100`), ahead of the class/call/use passes,
so pass ordering is ruled out.

**Not fixed here:** whatever the cause, the repair changes metadata on `extends` for every JavaScript
file — a binding-model question, not a one-line omission, and it deserves its own arm and fixture.

---

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
