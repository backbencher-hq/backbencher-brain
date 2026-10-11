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

## 7. What is NOT claimed

- The two boundaries above are RULED, not closed: residual is 57.3% and 80,081 edges are unresolved.
- `contains` `ofWhich` 17,453 was not touched, and `ofWhich` is an UPPER BOUND on arbitrary bindings
  rather than a count of them (both resolvers prefer the edge's own file second).
- The store-side ancestor stage (census 24,223 endpoints) lives in `member-owner-resolution.ts` and
  was touched only for the qualified-target lookup, not for its resolution policy.
