# php — the lane verdict

Owner: **php-lane**. Analyzer: `src/ast/real-php-analyzer.ts`. Spec:
`script/m14/spec/php-completeness.json`. Corpus: **5,094 admitted `.php` files across 9
repositories** (the router maps `.php` alone — checked against
`src/ast/language-detection.ts`, so this lane is not one of the ten the population gate found
measuring a fraction of their language).

Two instruments decide everything below, and both are run over the WHOLE admitted population:

    npx tsx script/m14/residual-gate.ts --lane php          # the incoming verdict, per type
    BB_DATA_DIR=$PWD/.tmp-php/bb-data npx tsx validation/m14/fixtures/php/owner-resolution-gate.mts

**Typecheck state.** `npx tsc --noEmit` (the repo's own command) is **GREEN as of `703d0272f`'s
follow-up**. It was RED on this file for part of 2026-10-10 — `TS18048: 'md' is possibly 'undefined'`
in `qualifyProvenMemberTargets`, where the owner was read through optional chaining and then written
back through the same object. The fix narrows `md` itself (`if (!md) continue`) rather than asserting
non-null: an edge with no metadata has no owner, so the branch was unreachable either way, but a `!`
would have hidden the question instead of answering it.

`BB_DATA_DIR` matters: the store gates open a real store, and a denied `mkdir` under `~/.bb`
reads exactly like a missing database. Point it inside the workspace.

## 0. RE-TAKEN 2026-10-11 — the baseline, the named causes, and two rulings that did NOT survive

Everything above this line was written before the shared-indexer landings and before the lane's own
residual was partitioned. **A lane's own doc is a claim, not a source.** This section re-takes the
measurement, names the causes with counts, and records two things this lane had wrong — one about the
programme record and one about its own instrument.

### 0.1 The baseline, and which run it is

| what | run |
|---|---|
| **BEFORE** | `incoming-gate.ts php php 0`, whole admitted population, **HEAD `1f5951a0a`**, 5,094 of 5,094 files parsed, unguarded `nice -n 10` (`.bb-heavy-v3.lock` was held), label in `.tmp-php/gate-baseline.log` |
| **AFTER** | same command, same population, analyzer modified (the fix below), **HEAD `8fdf5ba6e`**, `.tmp-php/gate-after.log` |
| partition | `validation/m14/fixtures/php/tools/residual-marker-partition.mts` (5,094 files, HEAD `d00541101`) |

Nothing in the analysis path for php changed between the two runs: `src/ast/real-php-analyzer.ts`,
`pool-worker.ts`, `incoming-rule.ts`, `member-owner-resolution.ts` and `file-claim.ts` were all
untouched by the intervening commits (`git diff --name-only 1f5951a0a..8fdf5ba6e` lists the bash,
dart, graphql, makefile, protobuf and zig analyzers plus `parallel-indexer.ts`'s `.proto` index entry,
none of which the php walk reads). The instrument's own `incoming-gate.ts` DID change, but only its
population/closure **disclosure** lines — `63063d378` is print-only (34 insertions, 0 deletions) and
changes no count.

**The baseline reproduces the doc's figures exactly**, which is what makes it a baseline rather than a
new number: 350,368 edges · 136,944 resolved · 120,520 `amb(decl)` · 79,934 unresolved · 12,970 `extOK`
· `extFAIL` 0 · **residual 200,454 = 57.2%**. `FALLBACK ROWS` printed **nothing in either run**, which
per §5ll is the measurement: 0 of these edges come from `extractFallback()`, so the residual is the
analyzer's and not a property of how many files aborted under load.

### 0.2 The 57.2% by NAMED CAUSE — the gate's own marker-set rule, uncapped

The gate's "EDGES A MARKER SET EXPLAINS" block prints **at most 5 marker sets per type**. `calls` closes
exactly with its five; `uses` does not — its five printed sets sum to 139,864 of 155,016 edges, so
**15,152 edges (9.8%) sat in sets the block never printed**, carrying `amb` 3,482 + `unres` 1,052. The
instruction "split the residual by the gate's marker table" therefore could not reach closure, and this
lane's largest cause was invisible in the instrument built to name it. That is now disclosed by the
instrument itself (`63063d378`, landed from this lane's arithmetic) as a per-type
`⋯ OMITTED N further marker set(s)` row — and it fires on php's own after-run.

The partition below is produced by a probe that **reproduces TABLE 1 exactly — all 14 columns, all 10
types** — before it prints anything; a probe that cannot do that is evidence about the probe (§5w).

| type | marker set (metadata keys on the edge) | edges | resolved | amb | unres | extClaim |
|---|---|---|---|---|---|---|
| uses | `isLocalRead+phpSpecific` | 102,396 | 9,861 | 47,038 | 45,497 | — |
| uses | `isMemberRead+owner+phpSpecific+resolvedBy` | 16,685 | 13,214 | 3,471 | — | — |
| uses | `isSubscriptBase+phpSpecific` | 10,161 | 907 | 3,521 | 5,733 | — |
| uses | `isMemberRead+phpSpecific` | 8,884 | 3,717 | 4,533 | 634 | — |
| uses | `isConstFetch+isMemberRead+owner+phpSpecific` | 4,159 | 3,326 | 601 | 232 | — |
| uses | `external+externalKind+isLocalRead+phpSpecific` | 2,683 | 623 | 1,181 | — | 879 |
| uses | `external+externalKind+isSubscriptBase+phpSpecific` | 2,412 | 10 | 19 | — | 2,383 |
| uses | `isMemberRead+isStaticRead+owner+phpSpecific` | 1,738 | 316 | 1,421 | 1 | — |
| uses | `isMemberRead+owner+phpSpecific` | 1,360 | 277 | 994 | 89 | — |
| uses | `isInterpolationRead+phpSpecific` | 656 | 88 | 103 | 465 | — |
| uses | `isClosureCapture+phpSpecific` | 350 | 31 | 161 | 158 | — |
| uses | 19 further sets (11 with amb+unres>0) | 15,152 → 2,178 + 12,974 | | | | |
| calls | `phpSpecific` / `owner+phpSpecific` / +`resolvedBy` | 47,902 / 43,641 / 10,916 | | 26,312 / 20,611 / 697 | 9,394 / 11,885 / — | — |
| imports | `fileLevel+isImport+phpSpecific+relationshipType` | 21,096 | 15,828 | 1,904 | 3,364 | — |
| imports | `external+externalKind+fileLevel+isImport+…` | 6,849 | 188 | 365 | — | 6,296 |
| imports | `fileLevel+importProjectFile+includeType+isImport+…` | 147 | — | — | — | 147 |
| references | `declaredOn+relationshipType` | 9,711 | 6,725 | 1,681 | 1,305 | — |
| instantiates | `isNew+phpSpecific` | 12,102 | 9,068 | 2,506 | 528 | — |
| extends / implements | `phpSpecific` | 2,941 / 934 | 1,173 / 617 | 1,589 / 135 | 179 / 182 | — |
| contains / exports / overrides | `isContained` / `calleeShape+…` / `isOverride+phpSpecific` | 35,112 / 58 / 2 | all resolved | | | |

**The largest single cause in the lane is `uses` on `isLocalRead`: 102,396 edges — 51% of the entire
200,454 residual — and the doc's stated cause for it is the WRONG MECHANISM.** §4 and Clause 1 say
"generic member reads off a receiver whose TYPE the tree does not state", giving `request` 1,819,
`expected` 1,259, `i` 958, `actual` 761, `node` 545 as examples. Those are **variable names**. An
`isLocalRead` edge is a BARE `$variable` read (`emitPhpVariableRead`, `real-php-analyzer.ts`), whose
target is the VARIABLE NAME — a member read is `isMemberRead`, a different and much smaller class. The
member-read wall is real and remains (11,033 `amb` + 956 `unres` across the `isMemberRead` sets); it was
simply never the plurality.

### 0.3 REFUTATION — `owner_provable 0` was an unreachable predicate, and the class it was supposed to guard SURVIVES on a reachable one

Clause 5 read: *"**Zero, and it is measured rather than characterised** (PROBE): `owner_provable` is 0
for every type … A non-zero count would have REFUTED the rule's completeness; the probe prints examples
when it finds any and found none."* The predicate cannot fire:

1. its `members` set is built **only** from symbols whose kind is class/interface/trait/enum — i.e.
   nested DECLARATIONS, never member symbols, so `members.has(owner + "." + target)` cannot be satisfied
   by a member;
2. its population filter (`keyCount.get(tgt) > 0 → skip`) removes every edge whose bare target the file
   publishes, so the by-construction argument covers the unresolved subset only;
3. on a file's TRUE member table it still fires 0, because every owner-carrying edge in the corpus is
   already owner-qualified (`Receiver.viaThis`) and the concatenation builds a double-qualified key.

Measured over the whole population: **the probe's exact predicate fires 0 times over ALL 80,128
owner-carrying edges** — not only the unresolved ones. **The reachable form of the same question is now
the control**: an owner-carrying edge with a BARE target whose `<owner>.<target>` the file publishes is a
MISS of the qualification rule, and the count is **0 of 51,227** bare owner-carrying edges; the other
28,901 are the ones the rule already re-spelled, which independently reproduces the owner-qualification
probe's headline figure exactly. **So the rule's completeness survives — on a predicate that could have
failed.** The Lead recorded the general rule as HANDOFF §6.11 ("a zero is evidence only if the predicate
could have returned non-zero"), fleet-wide.

The composition probe's OTHER zero, `builtin_unclaimed`, stands on its own definition (target names
nothing in the key space AND carries no claim), measured over 80,081 unresolved edges. It has a known,
counted edge: `phpInternalKind` is generated from php-src's 107 `.stub.php` files, so a predefined
constant declared in C is invisible to it — **11 of 36** hand-listed PHP predefined constants are absent
(`PHP_INT_MAX`, `PHP_INT_MIN`, `PHP_INT_SIZE`, `PHP_VERSION`, `PHP_OS`, `PHP_SAPI`, `PHP_FLOAT_EPSILON`,
`PHP_FLOAT_MAX`, `STDIN`, `STDOUT`, `STDERR`). Of the 780 all-caps unlabelled unresolved targets, the one
verified internal is `PHP_VERSION` at **42 edges**, which sits in the RULED boundary with the wrong reason
attached. The 366 `leaf_declared` edges keep their ruling (**0 same-namespace / 366 other**), and that
zero's predicate was separately shown REACHABLE — 3 constructed inputs fire it, the 366's shape does not.

### 0.4 THE FIX — a `$variable` value read is a BINDING, and the SPELLING is what says so

The family publishes no locals, parameters, superglobals or closure captures as symbols
(`src/ast/types.ts:148-190`), so an edge that reads one has no declaration to point at — but the string
it writes is what the store resolves, and `resolveRelationships` never reads the edge's metadata. A bare
local name is therefore indistinguishable from a declaration's name.

**Measured on the bare spelling, whole population:** every `metadata.isLocalRead` edge — 105,079 of them
— carried a VARIABLE name, and the declarations the key space "resolved" **10,484** of them to were
**property 7,714 · method 2,713 · class 34 · interface 3 · function 20**: never a local, because a local
is never published. Those 10,484 are **false links by construction** — a per-file census cannot produce a
correct one. And the columns that would have caught them read 0 for the same reason: nothing ever MARKED
a binding, so nothing could be wrong (`bindOK`/`bind?`/`bindFAIL` all 0).

The fix is the family's existing spelling, applied to **all seven emission sites of the five
`$variable`-read arms** (`isLocalRead`, `isGlobalRead`×2, `isSubscriptBase`, `isClosureCapture`,
`isInterpolationRead`×2), through ONE private helper so the rule has one spelling in one place.
Dart took this route for the identical defect (`validation/m14/fixtures/dart/local-read-phantom.ts`);
php was four arms behind it.

| run | edges | resolved | amb(decl) | unresolved | extOK | **bindOK** | extFAIL | residual |
|---|---|---|---|---|---|---|---|---|
| BEFORE | 350,368 | 136,944 | 120,520 | 79,934 | 12,970 | **0** | 0 | **200,454 (57.2%)** |
| AFTER | 349,236 | 125,423 | 68,491 | 28,079 | 9,629 | **117,614** | 0 | **96,570 (27.6%)** |
| `uses` only, BEFORE | 155,016 | 33,821 | 63,466 | 52,917 | 4,812 | 0 | | |
| `uses` only, AFTER | 153,884 | 22,300 | 11,437 | 1,062 | 1,471 | 117,614 | | |

**Pre-registered and then checked.** The prediction was written from the partition arithmetic BEFORE the
after-run returned (`.tmp-php/PREDICTION.md`): `uses` resolved 22,300 · amb 11,437 · unres 1,062 · extOK
1,471; TOTAL resolved 125,423 · amb 68,491 · unresolved 28,079 · extOK 9,629. **All eight landed
exactly.** `bindOK` (predicted 118,746) and the edge total (predicted 350,368) are short by the same
**1,132** — and that difference is now MEASURED, not inferred: **the SHARED noise filter drops them.**

`pool-worker.ts`'s `filterNoiseRelationships` rejects an edge whose `extractLeaf(target)` exceeds 80
characters, and `extractLeaf` splits on `:` and `.` — **not on the binding separator** — so in
`<source>\0<binding>` the SOURCE name counts toward the budget. A long callable name pushes the edge over
the line and it is deleted on the way to the index. Measured over the whole admitted population by
running the filter over both analyzers' output file by file (`tools/analyzer-count-invariance.mts`'s
companion run): **1,132 additional edges dropped, 0 fewer**, which is the entire gap. Named instance:
`gql-graphql-php/tests/Executor/NonNullTest.php`, a test method named
`testNullsASynchronouslyReturnedObjectThatContainsANonNullableFieldThatThrowsSynchronously` (89 chars) →
leaf 93-98 chars → dropped; the same reads emitted at 41 drops in that one file.

* The analyzer change itself is **edge-count neutral**: `tools/analyzer-count-invariance.mts` runs the
  base revision's analyzer and the working tree's analyzer over **all 5,094 corpus files** with one
  parser in one process and reports **0 files differing** in per-type edge count.
* The four disposition columns moving EXACTLY as predicted is consistent: every arm edge stops being
  `resolved`/`amb`/`unres`/`ext` whether it survives or is dropped, so only `bindOK` and the total can
  show the loss.
* **THIS IS A FLEET FINDING AND IT IS NOT THIS LANE'S FILE TO FIX.** Any lane adopting `BINDING_SEP`
  inherits it: the separator is invisible to `extractLeaf`, so the qualifier counts toward a limit whose
  stated intent is to reject code SNIPPETS, where the thing being measured should be the leaf of the
  NAME — here, the binding after the separator. The css lane already moved this same budget to the leaf
  "where the intent always was" when 46 of its edges per 60 files were deleted. The remedy is one line in
  `filterNoiseRelationships` (`extractLeaf` should take the segment after the last separator), and it is
  the Lead's, not this lane's: `src/ast/pool-worker.ts` is a shared file outside this lane's scope.
* Until then the lane's honest position is that **1,132 of its `uses` reads are absent from the graph
  rather than mis-bound** — which is the lesser evil the programme has already ruled on twice ("a WRONG
  edge is worse than no edge"), and it is a DISCLOSED, COUNTED loss rather than a silent one.

**The claims that make the fix safe, each with its check:**

* `separator tripwire: 0 published key(s) contain` the separator, **before AND after** (350,368 → 349,236
  edges measured) — HANDOFF §6.11 requires the N stated on both sides, because a published key carrying
  the separator would void every `extOK` claim in the population.
* `extFAIL` **0**, `bind?` **0**, `bindFAIL` **0** after. A binding claim is REFUTED outright when the
  target could name a declaration, so the spelling cannot be used to excuse a gap.
* the `extOK` fall (4,812 → 1,471 on `uses`) is CORRECT and is part of the same fix: those were `uses`
  edges on `$end`, `$count`, `$serialize`… — variable names that happened to match a PHP internal, so the
  labeller marked the read external. `phpInternalKind("run\0end")` is null, so the label is gone and the
  edge is what it always was: a binding. A variable named `$end` is not a reference to `end()`.
* the store side, against the GATE'S OWN rule rather than a copy of it:
  `validation/m14/fixtures/php/local-read-phantom.mts`. **RED before** — `uses run -> "counter"`
  classifies `resolved (decls=1, kinds=property)` and binds `run`'s own local to `Telemetry::$counter` in
  a file `reads.php` never names. **GREEN after** — `bindingVerified (decls=0, verifiedBy=binding)`, with
  the COUNTERFACTUAL proving the spelling is load-bearing: strip the separator and the same rule
  re-creates the false link, and the claim alone catches a lost spelling (`bindingRefuted`).

**Fixtures: 40 expectation rows re-spelled across 7 files**, each rewritten only where the fixed analyzer
really emits that binding edge for that fixture, with the mechanism and the count written INTO each file
as `variableReadSpelling`. No `forbidRelationships` row pinned a `$variable` target (measured: 0 of 39
`uses` forbids), so no forbid was left silently vacuous. `npx tsx script/m14/run-fixtures.ts --lang php`:
**`{"php":{"pass":32,"fail":0}}`**, no regressions (30 before, 32 after — the pair below is new),
`npx tsc --noEmit` exit 0.

### 0.5 What I got wrong, and how it was caught

* **My own partition probe counted 208 `builtin_unclaimed` — and it was wrong.** The counter admitted
  AMBIGUOUS edges (`pc.outcome !== "resolved"`), which is a different population with a different
  meaning. Every one of the 10 examples it printed was an in-file declaration the labeller had correctly
  skipped (`Location::$end`, `CustomScalarType::serialize`, `SyncPromiseQueue::count`). Caught by reading
  the printed examples back against the files — not by review. The counter now admits `unresolved` only,
  and the defect is recorded in the tool.
* **The first version of the phantom probe could not pass**: it demanded that EVERY edge of an arm end
  with the exemplar binding name, which no multi-binding arm can satisfy, and it selected the first bare
  edge rather than a phantom, so its RED run reported `unresolved` instead of naming the false link.
* **The first version of the fixture re-spelling script re-prefixed an already-spelled target**
  (`source + "\0" + target` → `run\0run\0xs`) and matched 0 rows.
* **My first analyzer edit was RED on the repo typecheck**: `nodeLine` is `number | undefined` and the
  helper typed `line: number`. Seven errors, all one shape. Fixed by accepting the same type the call
  sites already passed, rather than by a non-null assertion — and the key stays present with an
  `undefined` value exactly as before, since a conditional spread would have changed the output shape.

### 0.6 Unsettled

* **1,132 `uses` reads are DROPPED, not mis-bound** — measured above, caused by the shared noise filter's
  80-character LEAF budget counting the source name because `extractLeaf` does not split on the binding
  separator. The remedy is one line in `pool-worker.ts` and it is outside this lane's write scope; until
  it lands the loss is disclosed and counted rather than silent.
* **The 27 files that "returned nothing"** cannot be classified by the instrument: the after-run's own
  header says this counter cannot tell "content that cannot declare anything" from "a genuine parse
  failure or timeout" from "a file the analyzer declined" — so the population's completeness is bounded
  by an unread list rather than established.
* **`isMemberRead` remains a real boundary-class**: 11,033 `amb` + 956 `unres` after the fix. Those ARE
  member reads off receivers the tree does not type, and no name-keyed rule reaches them. The falsifier
  is unchanged (a type-aware instrument) and is still not reachable.
* The store-side effect of the fix — that a binding-spelled row is left NULL instead of mis-bound — is
  proved by the gate's rule and the counterfactual above, not by a live store run; the lane's store
  instrument (`owner-resolution-gate.mts`) covers the OWNER channel, not this one.

## 1. Coverage — declared, and it closes

`coverage.implemented` is all ten types, `excluded: []`, `corpusUnexercised: []`; the block derives
from PHPD40's whole-corpus numeration (`exports:3`, `overrides:1` — both implemented, both fire, and
the 120-file firing sample reads them SILENT only because their density is 0.06% of files).

## 2. Incoming residual, before and after the owner-qualification fix

Whole population, 350,368 edges, `residual-gate --lane php`:

| | resolved | amb(decl) | unresolved | ofWhich | residual |
|---|---|---|---|---|---|
| before `cd0c77546` | 124,095 (35.4%) | 133,369 | 80,081 | — | 60.9% |
| after | **136,944 (39.1%)** | **120,520** | **80,081** | **0** for uses/calls/references | **57.3%** |

`resolved` rose by **exactly** what `ambiguous` fell (+12,849 / −12,849), unresolved is FLAT, and
`extFAIL`/`bindFAIL`/`causeFAIL` are 0/0/0. `ofWhich` — resolved edges whose target had more than one
declaration, i.e. resolved by production's arbitrary id tie-break — is **0** for every type this
change touched. (`contains` shows 17,453; containment was not touched, and the #612 line-pin rule
makes those determinate in the store.)

### The cause and the rule

`calls`/`uses` named a member by its BARE name: `$this->persist()` emitted `target: persist`. In a
project where several classes declare `persist`, production answers that with
`ORDER BY is_declaration, file_id, language, s.id LIMIT 1` — and the indexer's own control arm
measures that tie-break as the WRONG symbol in **37,318 of 49,729** cases.

`qualifyProvenMemberTargets` re-spells the target `Owner.member` when, and only when,
(a) the edge already carries `metadata.owner` (the analyzer derived the receiver's class from the
tree) and (b) **the file's own symbol table publishes a class-like member named exactly
`<owner>.<target>`**. The qualified name's declarations are then a SUBSET of the bare name's, so
ambiguity can only fall and resolution can only rise.

Measured BEFORE emitting, whole population (`tools/owner-qualification-probe.mts`): **28,901 edges
provable** — 12,849 with a target that had more than one declaration and now has exactly one; 4,267
that stay ambiguous (two same-named classes in one project declare the member); 11,785 already
unique, which stop being an id-tie-break lookup. The probe asserts the subset property and reports
zero violations.

The lane's own census rejected the alternatives — same-file preference (20,368) and namespace
preference (10,188) — because each REPLACES a resolution rather than narrowing one. So does this
change: nothing here picks between rivals.

## 3. The store contract this fix had to satisfy — and the bug it exposed in MY OWN change

`cd0c77546` improved every column the incoming gate prints and would have bound NOTHING in
production. Two store facts the gate does not model:

1. `claimOwnerCarryingTargets` (`src/ast/member-owner-resolution.ts`) withdraws **every** `calls`/`uses`
   row carrying `metadata.owner` from the insert-time rank and sets `target_symbol_id = NULL`;
2. the pass it hands them to looked the member up **by name**:
   `membersByOwner.get(ownerId)?.get(String(row.target_external))`.

So `GammaStore.persist` was withdrawn from the rank and then looked up as a member literally named
`GammaStore.persist`, found nothing, and stayed NULL. Five pins in `owner-resolution-gate.mts` went
red — OWNED, DIRECT, COLLIDING OWNER NAME, the counter-agreement pin, CONTROL C — every one of them a
resolution withdrawn and not replaced.

**Fixed in `ac2873f4a`**, and the shape matters: the member NAME is the target's leaf after the last
dot (PHP member names cannot contain a dot — a fact about PHP, not about targets in general), and
**a qualified target binds only in the owner it names**: the ancestor rule is not consulted for it, so
a cross-owner leaf coincidence still DECLINES rather than trading a NULL for a WRONG edge.
`goAmbiguousParent -> Twin.solo` is exactly that case and the gate asserts it stays NULL.

Before/after, same store draw: **5 pins red → every pin green, no assertion re-pinned.** OWNED lands
on `GammaStore@alpha.php`; COLLIDING resolves BY IDENTITY to `Twin@gamma.php`; counters read
`ownerResolved=2 inheritedResolved=1 ambiguousOwner=1 notDeclared=2`; CONTROL C shows
`direct=GammaStore, inherited=NULL`.

**The rule this leaves the fleet:** qualifying a target is only safe if the store pass can still find
it. Any lane that owner-qualifies a target — or emits `metadata.owner` at all — is subject to the
same spelling-blind withdrawal, and the incoming gate will not show the difference.

## 4. The two declared boundaries — RULED with counts, not closed

The Lead's ruling, 2026-10-10: option (a). Recorded as `PHP-UNRESOLVED-USES` and
`PHP-UNRESOLVED-CALLS` in the spec's `gap.gaps`, each with its size, its mechanism, its instrument and
its **falsifier**.

**`uses` 52,917 unresolved (34.1%).** Generic member reads off a receiver whose TYPE the tree does not
state: `request` 1,819, `expected` 1,259, `i` 958, `actual` 761, `node` 545. A per-file analyzer knows
a receiver's class only for `$this->`, `self::`, `static::`, `parent::` and a NAMED receiver. The
owner-qualification pass closes exactly the half the file can prove and this is the half it cannot.
*Falsifier:* type resolution — an index-assisted or type-aware instrument. If one lands and this class
does not fall, the ruling is refuted.

**`calls` 21,279 unresolved (20.6%).** A vendor library's API called from a project that does not
contain it: `assertSame` 4,857, `__` 3,315, `assertStringContainsString` 1,078, `willReturn` 882. The
analyzer sees ONE FILE and cannot know whether the vendor is vendored IN THIS PROJECT — which is why
the boundary is real rather than a gap this lane failed to close. *Falsifier:* a per-project
instrument checked by something the store does not control.

### Why the external marker was refused for the `calls` boundary — the mechanism, not the taste

`tools/owner-claim-crosstab.mts`, per project, production path, every `calls`/`uses` edge carrying
`metadata.owner`:

| type | with owner | a claim would VERIFY | a claim would REFUTE |
|---|---|---|---|
| calls | 54,677 | 11,897 | 42,780 |
| uses | 25,451 | 338 | 25,113 |

A blanket claim verifies 12,235 and **refutes 67,893** — 5.5 refutations per verification, and a
refutation is an `extFAIL`, which must be zero. The same name splits by project (`assertSame`: 4,851
verify / 2,400 refute) and the refutations sit exactly where the library IS declared (phpunit 29,444,
phpmyadmin 26,869, gql 10,306).

**AND THE GATE CHECKS A CLAIM BEFORE THE COUNT.** A wrongly-attached claim does not merely fail to
help — it *breaks an edge that resolves today*. That is the mechanism that makes every blanket claim
dangerous here, and it is why the marker is not written.

**And the store-side alternative is refused by ruling, because it would be a tautology:** a store pass
that marks a row external on "its target names nothing in the project", verified by a gate that asks
the project's key space, is the same test asserting and checking itself. `extFAIL` would become
structurally 0 and the marker would stop carrying information — the laundering
`script/m14/incoming-rule.ts` warns about, arrived at honestly.

### The include-path class — a per-file defect, not a boundary (147 edges closed)

> **The figure this section replaces was misattributed to php.** A brief pursued "`imports` 80 unresolved
> of 178" as php's row; that is **css's** row. php's own row is **208 include/require edges**, and the
> first cross-tab read *verify 2, refute 185* — which is why the guard looked verified-and-not-worth-it,
> and why the number is recorded here beside its correction rather than deleted: the next reader should
> see the wrong figure, its lane, and what the right one turned out to be.

`imports` also carries `include`/`require` paths (`metadata.relationshipType: "include_path"`): **208
edges**. The first cross-tab (`tools/include-claim-crosstab.mts`) said a file claim would verify only
2 and refute 185, which looked like a boundary. It was not: **188 of the 208 carry a PHP magic
constant** — `require __DIR__ . '/../vendor/autoload.php'` is emitted as
`__DIR__/../vendor/autoload.php` — and `__DIR__` kept as literal text is a string that can never match
anything. **0 of the 188 verified.**

`__DIR__` is the directory of THE FILE BEING ANALYZED and `__FILE__` is that file: both are known to a
per-file analyzer, in pure String, with no filesystem. Resolving them
(`tools/magic-constant-include-probe.mts`, whole population) moves **145** of the 188 onto files the
project really carries. `claimResolvableIncludes` now does exactly that and attaches
`metadata.importProjectFile` when:

* the written path is a plain relative path (no URL, no absolute, no glob, no whitespace);
* after resolving `dirname(__FILE__)`, `__DIR__` and `__FILE__` it lands INSIDE the project;
* it ends in `.php` — **required, not convenient**: the arbiter's facts are the lane's admitted file
  list, which holds `.php` paths only, and this is what removes the single disagreement the
  unrestricted cross-tab found (a `.inc` file that exists on disk and is not admitted);
* and it exists on disk (`statSync`), which removes the 42 candidates that do not exist at all.

**Why the guard is not optional:** a claim that misses is REFUTED, and `extFAIL` must be 0. After both
guards the cross-tab is exact in both directions: **verify 145, refute 0.**

Whole-population verdict, `residual-gate --lane php`:

| | imports unresolved | extFAIL | resolved | ambiguous |
|---|---|---|---|---|
| before | 3,691 | 0 | 16,368 | 2,275 |
| after | **3,544** | **0** | 16,368 | 2,275 |

The TARGET stays the path as written — the claim is a statement ABOUT the target, and resolving
`__DIR__` into the target would invent a spelling no document contains.

**The 61 that remain are ruled**: 22 whose resolved path names a file the admitted population does not
carry (untracked `vendor/autoload.php`, a `.inc`, a `.phar`), 21 with no computable candidate, 18 that
never carried a constant and never resolved. *Falsifier:* if the admitted population ever carries
those files, the verify count moves and the ruling is refuted.

**This is a fleet finding, not a php one.** Every lane whose imports are path-shaped has magic-constant
spellings — python's `__file__`, ruby's `__dir__`, and the `${rootfsDir}` case that already cost a
lane 21 edges — and the same probe answers it: resolve the constant in pure String, restrict the
candidate to the extensions the lane's own admitted list holds, `statSync` the result, and cross-tab
verify against refute BEFORE emitting.

## 5. Refuted before it was built

**The FQN cause does not exist.** An earlier probe reported that publishing every namespaced
declaration's `metadata.fqn` as an additional key would move **16,202 `imports` edges
unresolved → resolved**. That probe called `analyzer.analyze()` directly; `src/ast/pool-worker.ts`
derives `qualifiedName: s.qualifiedName || s.metadata?.fqn || …` on the production path, so the key is
already there. Re-run through `parseFile` — the module `incoming-gate.ts` itself imports — the
proposal is a **no-op: 0 additional keys, 0 transitions, 0 regressions**, and the repaired probe
reproduces the gate's imports row exactly (16,368 resolved / 2,275 ambiguous).

The lesson is a layer rule, and this lane paid for it twice: **measure on the production path.** The
same mistake produced the earlier 57,729-vs-52,917 discrepancy in the unresolved counts, which is
explained entirely by `parseFile`'s normalization.

## 5b. THE COMPLETION PACKAGE — the four clauses

> **SUPERSEDED IN PART — read §0 first.** The clause tables below were measured on 2026-10-10.
> §0 re-takes them on the current revision, corrects the `uses` cause (§0.2) and the `owner_provable 0`
> control (§0.3), and lands the binding fix that moves the residual from 57.2% to 27.6% (§0.4).

Every figure below states its LAYER: **GATE** = the incoming gate's key-space model
(`script/m14/incoming-gate.ts`, whole admitted population, one run); **STORE** = a real store run
(`ONE RUN` — the store's binding is order- and run-dependent, §5p); **PROBE** = the production path
(`parseFile` from pool-worker) with the probe's own classifier.

### Clause 1 — per-type residual, named cause, count, and the before/after or the falsifier

| type | amb(decl) | unresolved | named cause | disposition |
|---|---|---|---|---|
| uses | 63,466 | 52,917 | bare member reads on receivers the tree does not type | **before/after**: owner-qualification moved **9,673** amb → resolved (`cd0c77546`); remainder RULED — `PHP-UNRESOLVED-USES`, falsifier: type resolution |
| calls | 48,015 | 21,279 | same, plus the vendor API (PHPUnit) | **before/after**: **3,176** amb → resolved; remainder RULED — `PHP-UNRESOLVED-CALLS`, falsifier: a per-project instrument |
| imports | 2,275 | 3,544 | include paths (`__DIR__`) + external FQNs | **before/after**: include class **3,691 → 3,544**, 147 claims, verify 145 / refute 0 (`703d0272f`); its 61 ruled — `PHP-INCLUDE-PATHS`; the other 3,483 are in the external-names ruling |
| instantiates | 3,084 | 528 | class names; external classes | RULED — `PHP-UNRESOLVED-EXTERNAL-NAMES` |
| references | 1,729 | 1,305 | interface/class names; external | RULED — same |
| extends | 1,708 | 179 | base-class names; external bases | RULED — same |
| implements | 228 | 182 | interface names; external | RULED — same |
| exports | 14 | 0 | 58 edges total, all `intended` | not a defect |
| overrides | 1 | 0 | 2 edges total | `PHP-CROSS-FILE-OVERRIDES` (PHPD39 boundary) |
| contains | 0 | 0 | — | CLEAN |

TOTAL residual 200,454 of 350,368 = **57.2%** (GATE).

### Clause 2 — the three refutation columns

`extFAIL` **0** · `bindFAIL` **0** · `causeFAIL` **0** (GATE, whole population). No edge in this lane
makes a false statement about another repository.

### Clause 3 — is the residual composed ENTIRELY of ruled classes?

**NO as of the four boundaries, and the remainder is 5,677 edges** — 79,934 − (52,917 + 21,279 + 61).
It is now partitioned and ruled (`PHP-UNRESOLVED-EXTERNAL-NAMES`, PROBE):

| remainder | edges | evidence |
|---|---|---|
| name nothing in the project (imports 3,121, references 1,305, instantiates 528, implements 182, extends 179) | 5,311 | same mechanism as the calls boundary; 1,514 targeted from ≥ 2 repos, 3,797 from one |
| FQN whose LEAF exists only in a DIFFERENT namespace | 366 | **0 same-namespace / 366 other** — a leaf coincidence, NOT a spelling defect |

**And the honest limit, as a number rather than a caveat:** of all 79,934 unresolved, **32,482 (40.6%)
are targeted from ≥ 2 independent repos that neither declares** — external evidence — and **47,452
(59.4%) are targeted from exactly ONE repo**, which cannot be told apart from a declaration this
analyzer failed to publish. That is the lane doc's own limit, carried forward rather than dropped.

**The two classes that would indicate a DEFECT are empty** (PROBE): `builtin_unclaimed` **0** — every
edge naming a PHP-internal symbol already carries its claim — and `owner_provable` **0**, below.

### Clause 4 — the tie-break

`ofWhich` (GATE, current revision): **`contains` 17,453**; every other type **0**. The gate's own
legend calls `ofWhich` an UPPER BOUND on arbitrary bindings, not a count of them.

For `contains` — the only type in `LINE_IS_TARGET_LINE` with a non-zero `ofWhich` — the **`intended`
column reads 35,112 of 35,112 resolved and `twin` reads 0**: every containment resolution is own file
AND own line, i.e. the #612 line pin decides it, and **none is an id tie-break pick**. `exports` reads
58 of 58 intended. For the other types `intended` is 0 by construction (their edges are written at the
call site, not at the target's declaration line) and `twin` counts a foreign declaration — which for
those types is what a cross-document reference IS: a RISK, not proven wrongness, per the legend.
Containment was not touched by this lane.

### Clause 5 — is any of `PHP-UNRESOLVED-USES` 52,917 reachable by the owner-qualification rule?

**Zero, and it is measured rather than characterised** (PROBE): `owner_provable` is **0** for every
type, `uses` included. It is also zero BY CONSTRUCTION — the rule fires only where the file's own
symbol table publishes `<owner>.<target>`, and that puts the bare name in the project key space, so an
edge the rule could re-spell can never be unresolved. A non-zero count would have REFUTED the rule's
completeness; the probe prints examples when it finds any and found none. The boundary therefore stands
with `owner_provable 0` behind it rather than with the phrase "type-inference wall".

### The store layer, and one correction to the fleet note

`BB_DATA_DIR=$PWD/.tmp-php/bb-data npx tsx validation/m14/fixtures/php/owner-resolution-gate.mts` —
**ALL GREEN on the current revision**, `ac2873f4a`'s five pins read against a store whose names carry
the scope. **STORE, ONE RUN.**

**php's member qualification is NOT `projectRoot`-dependent, and this gate is the measurement:**
`owner-resolution-gate.mts` hands the analyzer **no context at all** (`ASTEngine.parseFile(f, content)`
with no third argument), and the qualified spelling still lands — `goDirect -> GammaStore.persist`
resolves to `GammaStore@alpha.php`. `publishMemberIdentity` derives `Owner.member` from the symbol's own
`ownerName`. So `a82e4134d` did **not** make php's identity fix real for production — it already was.
What IS root-gated here is the include-path claim (`claimResolvableIncludes` returns null without a
root): before `a82e4134d` a worker would not have emitted those 147 claims; after it, it does.

**Is there a store-side probe for the identity question?** For the owner channel and for the store's
treatment of the qualified spelling, yes — the gate above. For the FULL-POPULATION identity claim,
**no**: the whole-population figures in this package are the GATE's model and the PROBE's, and neither
is a store run. Saying which layer a number came from is the point.

## 6. Instruments

| instrument | what it answers |
|---|---|
| `tools/owner-qualification-probe.mts` | the addressable half of the ambiguity: provable edges, amb→res, and the subset assertion |
| `tools/unresolved-shape-probe.mts` | what the unresolved edges NAME: owner-carrying vs receiver-less, builtin vs vendor |
| `tools/owner-claim-crosstab.mts` | per project, would an external claim verify or refute |
| `tools/fqn-keyspace-probe.mts` | the FQN proposal, measured on the production path (zero delta) |
| `owner-resolution-gate.mts` | the store-side owner channel, five defect/control pins (needs `BB_DATA_DIR`) |
| `tools/residual-marker-partition.mts` | the UNCAPPED marker-set partition, plus the three falsifier tests — **and it reproduces the gate's TABLE 1 exactly, all 14 columns of all 10 types, before it prints a bucket** |
| `local-read-phantom.mts` | the variable-read false link, against the gate's OWN rule, with the counterfactual that strips the separator and re-creates it |
| `tools/analyzer-count-invariance.mts` | does an analyzer change move the NUMBER of edges? base revision vs working tree, all 5,094 files, one process (`BB_AB_BASE`) |

## 7. What is NOT claimed

- The two boundaries above are RULED, not closed: residual is 57.3% and 80,081 edges are unresolved.
- `contains` `ofWhich` 17,453 was not touched, and `ofWhich` is an UPPER BOUND on arbitrary bindings
  rather than a count of them (both resolvers prefer the edge's own file second).
- The store-side ancestor stage (census 24,223 endpoints) lives in `member-owner-resolution.ts` and
  was touched only for the qualified-target lookup, not for its resolution policy.
