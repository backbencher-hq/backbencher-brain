# php — the lane verdict

Owner: **php-lane**. Analyzer: `src/ast/real-php-analyzer.ts`. Spec:
`script/m14/spec/php-completeness.json`. Corpus: **5,094 admitted `.php` files across 9
repositories** (the router maps `.php` alone — checked against
`src/ast/language-detection.ts`, so this lane is not one of the ten the population gate found
measuring a fraction of their language).

Two instruments decide everything below, and both are run over the WHOLE admitted population:

    npx tsx script/m14/residual-gate.ts --lane php          # the incoming verdict, per type
    BB_DATA_DIR=$PWD/.tmp-php/bb-data npx tsx validation/m14/fixtures/php/owner-resolution-gate.mts

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

### The include-path class — the fixable-looking one that is not worth fixing

`imports` also carries `include`/`require` paths (`metadata.relationshipType: "include_path"`): **208
edges** whole population. The file-claim route (json's) was measured before it was built
(`tools/include-claim-crosstab.mts`, production path, json's candidate arithmetic against the gate's
admitted-file facts plus the `statSync` guard):

| | edges |
|---|---|
| a claim would VERIFY | **2** |
| a claim would REFUTE | **185** |
| no computable candidate (URL / absolute / escapes) | 21 |

The cross-tab is exact in both directions (fs true but gate refutes: 0; fs false but gate verifies: 0),
so a claim gated on `statSync` would close 2 edges and refute none. **It is not built:** 2 edges do not
justify a claim key, a fixture migration, and a standing refutation risk if those two files ever leave
the population. The 185 name files the admitted population does not contain — `vendor/autoload.php`
untracked, `__DIR__` kept as literal text because the analyzer never resolves magic constants, one a
sibling checkout — and that is a property of the POPULATION, not a spellable defect.

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
