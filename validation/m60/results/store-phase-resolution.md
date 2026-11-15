# The per-edge resolve: what it costs, and why removing it is not a SQL exercise

Corpus: `.perf-fixtures/bb-scale/n200` — 196 files, 10,082 symbols, **62,085 relationships**.
Machine: 8-core i7-8650U (15 W), shared with other work; load is visible in `parseMs`.
Tool: `npx tsx script/perf/probe-store-phases.ts .perf-fixtures/bb-scale/n200 <repeats>`

## 1. What the store phase spends on the eager resolve

Every relationship is resolved at INSERT time by a SELECT with an `ORDER BY` over expression
keys (definition before declaration, same file, same language), so SQLite materialises and
sorts every same-named candidate. The switch `BB_TEST_SKIP_EDGE_RESOLVE=1` turns that resolve
off entirely so the phase can be measured both ways.

| arm | dbFlushMs across runs | parseMs across runs |
|---|---|---|
| with the resolve | 28,724 · 28,291 · 30,421 · 33,990 · 35,528 · 44,401 | 51,683 · 52,358 · 58,962 · 60,015 · 63,637 · 72,542 |
| without it | **24,210 · 24,308 · 25,404** · 27,709 · 27,869 · 33,284 | 47,711 · 48,555 · 50,108 · 55,419 · 60,108 · 68,918 |

The skip arm is tight (24.2–25.4 s when the machine is quiet); the resolve arm is not. The
honest reading is the tightest pair — **≈ 3–4 s of a ~28 s store phase, about 12%** — and NOT
the mean-of-all-runs difference (25.7–43.1% across runs), which measures machine load as much
as SQL. `parseMs` moves in step with `dbFlushMs`, which is the tell.

So: **the eager resolve is real but not dominant.** The store phase is mostly the row INSERTs
and the 17 index objects they maintain.

## 2. Why the removal was attempted and reverted — twice

`skipResolution` reads as "a resolution pass will follow" (the worker pool stores every chunk
with it). It only ever skipped the block AFTER the loop, so the eager resolve ran anyway. Two
attempts to make it mean what it says, both measured by a fingerprint over
`(relationship id -> resolved target id)`:

| variant | nullTargets | resolution fingerprint | verdict |
|---|---|---|---|
| baseline (eager resolve) | 18,402 | `14a1de15014ce948` | — |
| skip every non-`contains` edge | 19,573 | `dc8a67dedf12cda3` | **1,171 edges lost their target** |
| skip only the rows `_i13_pick` covers | 18,153 | `8e4108653d5cf82d` | 249 bindings differ |

The first variant is wrong for a concrete reason: dotted and qualified target names
(`a.b`, `mod:item`) have **no other resolver in the pool path** — `_i13_pick`'s WHERE clause
excludes them (`instr(target_external,'.') = 0 AND instr(target_external,':') = 0`) and the
post block has no `contains` resolver either.

The second variant is *not certifiable*, and that is the finding below.

## 3. The finding that blocks a certified removal: resolution is not deterministic

Three runs of **identical code** on the same corpus:

| run | dbFlushMs | nullTargets | resolution fingerprint |
|---|---|---|---|
| 1 | 28,724 | 18,402 | `14a1de15014ce948` |
| 2 | 35,528 | 18,015 | `be0eff06594480c1` |
| 3 | 44,676 | 18,204 | `e46df138e62235dd` |

Every run binds a different set of edges: the spread is ~390 of 62,085 rows (0.6%). This is the
row-level form of the drift the audit described as "6–12% of edges bind differently between two
identical indexes", and it is why the 249-row difference of variant 2 cannot be called an
improvement or a regression: **it is smaller than the noise the product already has.**

`relHash` cannot see any of this — it hashes `(id, source, target, kind)` over NAMES, so every
fingerprint above would have passed a `relHash` equivalence check. The resolution fingerprint
was added to `probe-store-phases.ts` for exactly that reason, and it is what stopped both
attempts from landing.

## 4. What the next attempt needs

1. A **deterministic resolution contract** — same input, same bindings, every run. Without it no
   graph change can be certified, which is a defect in its own right and a bigger one than the
   12% this item was chasing.
2. A resolver for dotted/qualified targets in the pass (or keep the eager resolve for them, as
   the second variant does).
3. Then: fingerprint equality against a *stable* baseline, plus the store-phase timing measured
   on a quiet machine, interleaved arm-to-arm rather than run-to-run.

Until (1) exists, the eager resolve stays and this file is the reason.

## 5. The drift has a name and an address

`script/perf/verify-resolution-determinism.ts` indexes the same corpus twice and compares the
fingerprints. On n200:

    322 of 62,085 bindings differ (0.52%)
    relHash identical in both runs — as always, it cannot see this

Every differing binding in the sample has the SAME shape:

    ...t0099_real-dart-analyzer.ts:RealDartAnalyzer:557:ASTEngine.LanguageAnalyzer:implements:557
        run A: (no target attached)
        run B: ...t0128_engine.ts:LanguageAnalyzer:2412

The edge belongs to `real-dart-analyzer.ts` and its target (`ASTEngine.LanguageAnalyzer`) is
declared in `engine.ts`. The two files are stored at positions t0099 and t0128, and WORKERS
FINISH IN A DIFFERENT ORDER every run. The eager resolve runs at INSERT time against a
partially-populated database, so when the referencing file happens to be stored first the
target does not exist yet and the edge is left NULL — and nothing repairs it afterwards,
because `_i13_pick` excludes dotted and qualified names by construction.

So the non-determinism is not mysterious: it is the eager resolve doing exactly what it was
written to do (resolve against "what is stored so far") in a pool whose completion order is
not fixed. It also says what the fix is: **the pass needs a resolver for dotted/qualified
targets**, which is the same missing piece that cost variant 1 its 1,171 edges. Give the pass
that resolver, drop the eager path for those rows, and the order dependence goes with it —
verifiable by this gate going from 322 to 0 rather than by an argument.

## 6. RESOLVED — the eager resolve is gone from the store path, and the graph is reproducible

The fix, in the order it had to happen:

1. **Strategy 3 — a dotted target by SUFFIX on `qualified_name`.** An edge says
   `ASTEngine.LanguageAnalyzer`; the symbol stores `t0128_engine.ASTEngine.LanguageAnalyzer`
   (the file stem is a prefix), so strategy 1's exact comparison could never match it, and the
   `_i13_*` plan excludes dots and colons by construction. Built as a temp table of every
   dot-suffix, indexed once — the same pattern strategies 1 and 2 use. The first version used a
   correlated `substr()` per row: it worked (dotted unattached 1,200 → 424) and cost 68 s of
   post-processing (13 s → 82 s), because a function on the column cannot use an index.
2. **Strategy 3b — the LEAF of a dotted/qualified target when it is unambiguous** (`cnt = 1`).
   Strategy 3 is precise but fails when the referring analyzer writes a module the symbol's
   `qualified_name` does not carry (`ASTEngine.SymbolKind` vs `t0172_types.SymbolKind`). This
   restores what the eager resolve caught by leaf name, under strategy 2's existing contract so
   a qualified reference never lands on one of several same-named symbols.
3. **Then, and only then, the eager resolve is skipped** for non-`contains` edges when the
   caller has promised a pass (`skipResolution`), which is what that flag always meant to its
   callers. `contains` keeps its eager resolve: the pass excludes it and it has no other
   resolver. `BB_TEST_FORCE_EDGE_RESOLVE=1` restores the old behaviour as the A/B arm.

### Verified

Resolution determinism, `script/perf/verify-resolution-determinism.ts`, two fresh indexes:

    before   322 of 62,085 bindings differ (0.52%)   relHash identical in both runs
    after      0 of 62,085 bindings differ           fingerprint 0da4110f01d5a349 in both

Full repository (5,396 files, 200,490 symbols, 516,502 relationships), pre-change index kept
for a direct comparison rather than a remembered number:

    metric                  BEFORE        AFTER        delta
    attached                480,277      482,371       +2,094
    dotted-unattached         1,418          602         -816
    colon-unattached          1,041          547         -494
    bare-unattached          32,882       32,982         +100
    attached share            93.15%       93.39%      +0.24pp

Store phase, `script/perf/probe-store-phases.ts`, arms INTERLEAVED in one session:

    eager (old)   dbFlushMs 39,006 · 34,431   fingerprints 9eb5cc3de425b930 · f79317d20b3df714
    pass  (new)   dbFlushMs 26,840 · 19,132   fingerprints 9e0abbabdd67750b · 9e0abbabdd67750b
    mean: 36,719 -> 22,986 ms, -13,733 ms (37.4% of the store phase)

The old arm's two runs disagree with each other — the drift reproduces inside the experiment
that was supposed to measure only time. Post-processing does not pay for this: 13,087 ms before
and 15,152 ms after on n200, and the resolve phase itself got *cheaper* per relationship
(0.0306 -> 0.0372 ms/rel against a 2x bound, minimum over interleaved repeats).

### Two wrong turns, both caught by measurement rather than review

1. **`cnt = 1` was far too strict for a dotted leaf.** Strategy 3b bound a leaf only when it was
   unambiguous — correct for a bare name, useless in a 200,490-symbol repository where almost
   no leaf is unique. On n200 it looked fine (+955 edges over baseline); on the full index it
   LOST 3,257 attachments (+2,049 dotted, +2,244 colon), because the eager resolve had been
   ranking candidates and taking the best. The lesson is in the comparison itself: a 196-file
   corpus agreed with a change that a 5,396-file corpus refuted.
2. **A correlated `ORDER BY … LIMIT 1` inside `SET` does not work in SQLite here.** It answers
   `no such column: brain_relationship.source_symbol_id` three levels deep, the phase's
   try/catch swallowed it, and the result was a DETERMINISTIC but wrong graph — 33,464
   attachments instead of 45,117, identical in both runs, so the determinism gate passed while
   coverage quietly collapsed. Determinism alone is not correctness; the coverage count is what
   caught it. The working form computes the ranking once into a temp table with `ROW_NUMBER()`
   and joins on it.
