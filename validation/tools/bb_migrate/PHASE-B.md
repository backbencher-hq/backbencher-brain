<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase B record for bb_migrate: every audit defect, the fix,
the command that proved the defect red and the same command proving it green, the
planted mutants that re-verified the repaired gates, the final gate battery, the
before/after latency, and the exact file hashes of the fixed tree.
WHO IT IS FOR — the Lead's release integration and the permanent owner of bb_migrate.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_migrate/{PHASE-B.json,LATENCY.json,
BATTERY.json,REAL-CORPUS.json}, mutants/RED-GREEN.json and mutants/fixed-tree-hashes.txt.
-->

# bb_migrate — Phase B record (red → green)

Phase A evidence: `validation/tools/bb_migrate/AUDIT.md` (commit `f401a5275`).
Phase B code, gates and docs: commit `56a80c5e5`. Battery ran at `df0b9b88d`.
Fixed-tree hashes: `mutants/fixed-tree-hashes.txt` (sha256 per changed file).
`npx tsc --noEmit` exit 0 at the audited tree.

## 1 · Red → green, defect by defect

| ID | Defect (Phase A, red) | Fix | Green evidence |
|---|---|---|---|
| **C1** critical | A read wrote the index: one handler call created a 98,912-byte WAL and changed db bytes; the public MCP door changed the db sha256; an unindexed project had a database **created** by a read | `getRawInstance(projectId, { readonly: true })` in the handler and the bounded loader; unindexed is the loud `no index found` error; freshness footer uses the manual-only wording | `raw/door-write-probe.json` (red: sha `e5a360e7…`→`60ff3fc7…`) vs `raw/door-write-probe-after.json` (green: sha `e6580252…`→`e6580252…`, `dbBytesChanged:false`); `raw/readonly-probe-before.json` (red: WAL created, DB created) vs `raw/readonly-probe-after.json` (green: db sha `sha256sum -c` OK, unindexed throws and creates nothing). Mutant `readonly` kills the accuracy gate. |
| **H1** high | 12-name batch loaded 844 symbols / 46,753 relationships for one plan; T2 p95 **29,041 ms** | Every entry resolves to at most one component through the planner's own name rule **before** any relationship is read; loaded symbols are the selected components only | `LATENCY.json`: 12-name p95 **29,041 → 833.0 ms**; first call **9,793.7 → 2,025.7 ms**. Mutant `bounded-load` kills `m65/verify-migrate-latency`. |
| **H2** high | A component could be planned twice (name + its own id/duplicate names) while `truncation.deduplicated` claimed a merge that did not happen; `m65/verify-migrate-selectors` was red | Identity de-duplication by resolved symbol id; `truncation` separates `deduplicated` (already planned) from `capped` (dropped), and `returned = plans + refusals + deduplicated` | `m65/verify-migrate-selectors` exit **1 → 0**; door duplicate-names: one plan, `requested 2 / returned 2 / deduplicated 1`; name+id: one plan. Mutant `dedupe` kills the selectors gate. |
| **H3** high | `symbolName` silently dropped when `symbolNames` was present | Legacy spelling unions with `symbolNames`; exact duplicate spellings merged by the engine | `door-extra-t0.json`: both-name-forms now plans both components. |
| **H4** high docs | Guide claimed a no-route target is refused (`go → haskell`); the code plans it with the gap declared | `docs/BB_MIGRATE.md` rewritten: only an **unknown** target is refused; a known target with no rows is planned with `MISSING DATA` and no invented mapping | Guide text; `REAL-CORPUS.json` unrouted-pair checks on all four repositories. |
| **M1** medium | First call paid the read-write migrations | same as C1 | first-call T2 **9,793.7 → 2,025.7 ms**; T1 **207.6 → 52 ms**. |
| **M2** medium | Blank name/id/path entries silently narrowed the request (clean empty success) | `nonBlankEntries` refuses by name with positions | `door-extra-t0.json`: blank-path, blank-path-plus-valid, blank-entries-mixed all `isError` with the count and positions. |
| **M3** medium | Blank `targetLanguage` accepted in text mode | trimmed and refused by name | `door-edges-t0.json`: json and text blank-target both `isError`. |
| **M4** medium | Freshness remediation promised auto-refresh and a `refresh=false` option this tool does not have | Runtime uses `buildStalenessEnvelope(..., {autoRefresh:false})` + `FRESHNESS_REMEDIATION_MANUAL_ONLY`; the generator owner landed the custom page branch and the page was regenerated with `--only --write` | `m13/verify-migrate-docs` staleness checks green; page Staleness section says "does NOT auto-refresh and has no `refresh` option". |
| **M5** medium | `m20/verify-migration-dictionary` red on three stale declarations; docs quoted 56 rows / 11.5% and a deleted mis-keyed block | Declared class is exactly the measured canonicalization-unreachable keys (`flutter/material`, `shadcn/ui` = 4/486 = 0.8%) with a completeness predicate and negative control; stale rule (which could never fire) fixed; curation/guide carry measured counts (486 rows, 30 sources, 21 targets, 126/630 pairs, 31 knowledge rows) | `m20/verify-migration-dictionary` exit **1 → 0** (`M4: VERIFIED 31/31, 3 negatives`). Mutant `dictionary-stale` kills it. |
| **M6** medium | 30+ dead imports and §9 milestone comments in the handler; no §8 headers in `src/intelligence/migration/**` | Imports reduced to the used set; §8 headers on handler/descriptor/engine/source/curation; process narration removed (§9 grep clean in scope) | `npx tsc --noEmit` 0; grep inventory clean. |
| **M7** medium | Malformed cohort statement ("language mix is ;") and scoping advice on target-language refusals | Statement names the measured mix and identified components; advice only when scoping could help | `door-edges-t0.json` statements. |
| **M8** medium | `m13/verify-migrate-docs` red: description anchor was a fixed line number inside the author header; it spawned the full-tree generator | Heading-anchored description; `--only bb_migrate`; added staleness-truth checks | exit **1 → 0** (`M3: VERIFIED 12/12`). |
| **M9** medium | `m13/verify-migrate-e2e-corpus` red: the MCP SDK child environment dropped `BB_DATA_DIR`; the CLI leg ran the stale `dist` build | Transport forwards `BB_DATA_DIR`/`BB_NO_AUTO_REFRESH`; CLI leg uses the source entry | exit **1 → 0** (`M2: VERIFIED 7/7`). Mutant `e2e-env` kills it. |
| **M10** medium | `symbolIds` example was `sym_01H…`, not a real id shape | Descriptor/curation use `<projectId>:<file>:<name>:<line>` and say where ids come from | descriptor + regenerated page. |
| **M11** medium | `BB_MIGRATE.md` was process narrative (no §8 header, "round N", "the lane") with stale claims | Rewritten as a reference with the §8 header, measured behaviour and the corrected no-route/dictionary/truncation/bounds/ staleness claims | `docs/BB_MIGRATE.md`; `m13/verify-migrate-docs`. |
| **L1** low | `m13/verify-migrate-accuracy` was a 9-check text scan | Behavioural gate: read-only invariant (with plant), resolution rule, methodology identities, order/waves/cycle/partial, legacy-alias union, text-operation boundaries (quotes, separators, Unicode, astral, 50k input, Go hosts/major versions, node_modules, test paths, data-shaped names), AST regex scan over all four sources, 9 negatives | exit 0 `M1: VERIFIED 49/49, 9 negatives` (was 9/9, 2). Mutants `readonly` and `order` kill it. |
| **L2** low | `m15/verify-visualize-migrate-deep` crashed on the pre-split registry | Resolved by the shared-gate owner; no action in this lane | battery `m15-deep exit 0` (`M4: VERIFIED`). |
| **L5** low | 22 source-text regexes (16 in the assistant, invisible to the policy gate's scan roots) | Explicit string/token helpers; boundary tests in the accuracy gate; AST regex check over the four sources | regex policy **PASS**, 0 new, 12 baseline rows now paid; accuracy `regex:` checks green. |

## 2 · Planted mutants (the repaired gates can fail)

`mutants/run-mutants.sh` changes one rule, runs the gate (must fail), restores the file
byte-for-byte (sha256 compared), and re-runs the gate (must pass). All six were killed;
`mutants/RED-GREEN.json` records the hashes and exit codes.

| Mutant | Changed rule | Gate | Red → green | Restored |
|---|---|---|---|---|
| `readonly` | handler opens read-write again | m13 accuracy | 1 → 0 | sha256 identical |
| `order` | `order.push(current)` → `unshift` (order no longer dependency-first) | m13 accuracy | 1 → 0 | sha256 identical |
| `dictionary-stale` | a reachable key declared unreachable | m20 dictionary | 1 → 0 | sha256 identical |
| `e2e-env` | MCP child env stops forwarding `BB_DATA_DIR` | m13 e2e | 1 → 0 | sha256 identical |
| `dedupe` | duplicate-component dedupe removed | m65 selectors | 1 → 0 | sha256 identical |
| `bounded-load` | relationship pass loads every name match again | m65 latency | 1 → 0 | sha256 identical |

## 3 · Final gate battery (`BATTERY.json`, command → exit)

| Gate | Command | Exit | Verdict |
|---|---|---|---|
| m13 accuracy | `npx tsx script/m13/verify-migrate-accuracy.ts` | 0 | VERIFIED 49/49, 9 negatives |
| m13 docs | `bun run script/m13/verify-migrate-docs.ts` | 0 | VERIFIED 12/12, 1 negative |
| m13 e2e corpus | `bun run script/m13/verify-migrate-e2e-corpus.ts` | 0 | VERIFIED 7/7, 1 negative |
| m20 order | `bun run script/m20/verify-migration-order.ts` | 0 | VERIFIED 13/13, 3 negatives |
| m20 methodology | `bun run script/m20/verify-migration-methodology.ts` | 0 | VERIFIED 17/17, 3 negatives |
| m20 mappings | `bun run script/m20/verify-migration-mappings.ts` | 0 | VERIFIED 15/15, 5 negatives |
| m20 dictionary | `bun run script/m20/verify-migration-dictionary.ts` | 0 | VERIFIED 31/31, 3 negatives |
| m35 S3 | `bun run script/m35/verify-s3-graph-migrate.ts` | 0 | PASS 23/23, 4 negatives |
| m48 C2 | `bun run script/m48/verify-c2-edge-mutations.ts` | 0 | PASS 73/0/3 |
| m48 P4 | `bun run script/m48/verify-p4-param-matrix.ts` | 0 | PASS 10/0/2 |
| m65 latency | `bun run script/m65/verify-migrate-latency.ts` | 0 | all checks pass |
| m65 selectors | `bun run script/m65/verify-migrate-selectors.ts` | 0 | all checks pass (was 1 failure) |
| m15 deep | `bun run script/m15/verify-visualize-migrate-deep.ts` | 0 | VERIFIED |
| docs page | `npx tsx script/verify-tool-docs.ts --only bb_migrate` | 0 | PASS (16 public tools) |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | 0 | PASS — 0 new, 12 baseline rows paid |
| typecheck | `npx tsc --noEmit` | 0 | clean |
| visualize/migrate | `bun run script/verify-visualize-migrate.ts` | 1 | **foreign red**: every `migration …` check in the gate passes; the failing assertion is `visualization provenance uses canonical engine` (the visualization side, another lane) — reported, not edited |
| fleet mode corpus | `bun run script/m31/tool-mode-corpus.ts --check` | 1 | **fleet red**: sole drifting invocation is `bb_ask.answer`; `bb_migrate.plan` is not drifting |

Battery: **16 pass / 2 fail of 18**; both failures are outside this tool's scope and are
recorded as declared blocked legs, never as green.

## 4 · Latency, before → after (`LATENCY.json`)

| Tier | Population | Shape | Phase A p50/p95 ms | Phase B p50/p95 ms |
|---|---|---|---|---|
| T0 | 5 files / 13 sym / 26 rels | single text | 6.4 / 7.3 | **1.7 / 2.4** |
| T0 | | single JSON | 4.4 / 6.7 | **0.8 / 1.4** |
| T0 | | 12 names | 5.9 / 12.5 | **5.8 / 6.4** |
| T0 | | first call (cold) | 33.4 | **27.7** |
| T1 | 97 / 3,512 / 17,068 | single text | 19.7 / 24.0 | **6.6 / 7.3** |
| T1 | | 12 names | 95.3 / 102.2 | **65.1 / 252.5** |
| T1 | | first call | 207.6 | **52.0** |
| T2 | 6,452 / 310,423 / 820,040; db 3,639,963,648 B; reference mtime 2026-11-02T04:29:55Z | single text | 805.2 / 909.3 | **442.6 / 477.1** |
| T2 | | single JSON | 1,054.9 / 2,310.5 | **470.9 / 618.2** |
| T2 | | 12 names | **9,532 / 29,041** | **431.7 / 833.0** |
| T2 | | first call | **9,793.7** | **2,025.7** |
| T2 | | directory cohort | refused (index predates split) | refused by name — declared blocked leg; timing is the refusal path (311/669 ms) |

All shapes are inside the campaign budgets (T0 250 ms, T1 1,000 ms, T2 5,000 ms p95) and
under the 30 s client timeout. Load average at Phase B measurement: T0 19.45/12.58/5.71,
T1 19.17/12.64/5.76, T2 19.47/13.12/6.07 — a contended shared checkout; p50 is the
honest figure and the p95 includes contention.

## 5 · Real-corpus evidence through the real MCP stdio door (`REAL-CORPUS.json`)

Four real repositories, isolated `BB_DATA_DIR=validation/tools/bb_migrate/realdata`, real
stdio MCP session: **82/82 checks, 6 planted negative controls, exit 0** (re-run after
the fixes, `phaseB-real-corpus.log`):

| Repository | Files / symbols / relationships | Cross-language edges | Warm single-plan p50/p95 |
|---|---|---|---|
| `elixir` (Elixir 10,722 + Erlang 1,215 symbols) | 692 / 14,725 / 77,697 | 714 | 84 / 93 ms |
| `rebar3` (Erlang 6,247) | 303 / 7,012 / 38,143 | 36 | 59 / 66 ms |
| `clojure` (Clojure 3,998 + Java 7,621) | 347 / 12,764 / 65,458 | 2,759 | 121 / 638 ms |
| `graphql-js` (TypeScript 8,407 + JavaScript 544) | 564 / 13,620 / 61,917 | 980 | 891 / 1,517 ms |

Checked per repository: single plan by symbol id with real cross-language relationship
evidence; 5-name batch accounting; dependency order respects every in-scope edge; the
wave plan accounts for every plan exactly once; effort arithmetic and by-kind sums;
directory-cohort cap names what it dropped; unknown target, same-language, missing
symbol, bogus id, ambiguous name with resolvable candidate ids; unrouted pair with
`MISSING DATA` and no invented mapping; freshness envelope. Negative controls prove each
predicate can fail (reversed order, unnamed cap, broken total, missing freshness,
cleared cross-language flags, empty wave plan).

## 6 · Blocked legs (final)

1. **`visualize-migrate` red on a visualization assertion** (`visualization provenance
   uses canonical engine`) while all `migration …` checks in the same gate pass. The
   visualization engine is another lane's scope; reported to the Lead. Not green.
2. **`m31 tool-mode-corpus` fleet drift** — sole drifting invocation `bb_ask.answer`;
   `bb_migrate.plan` matches its committed baseline. Fleet-owned.
3. **T2 directory-cohort shape** — the shared reference index predates the module split
   (4 files under `src/mcp`, no `handler.ts`), so a `src/mcp` path matches no indexed
   file; the tool refuses by name. Honest refusal, not a latency leg.
4. **`m48/verify-c1-corpus`** not run (corpus-scale central gate; bb_migrate covered by
   M48 C2 and REAL-CORPUS).
5. **Compiled `dist` door** deferred by ruling; all door evidence uses the source entry.

## 7 · Reproduce

```bash
# phase B measurements and evidence (isolated data dirs; the shared index is never written)
BB_DATA_DIR=$PWD/validation/tools/bb_migrate/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t0
BB_DATA_DIR=$PWD/validation/tools/bb_migrate/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t1
BB_DATA_DIR=$PWD/validation/tools/bb_migrate/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t2
BB_DATA_DIR=$PWD/validation/tools/bb_migrate/realdata npx tsx validation/tools/bb_migrate/real-corpus.ts
bash validation/tools/bb_migrate/run-battery.sh
bash validation/tools/bb_migrate/mutants/run-mutants.sh
npx tsx validation/tools/bb_migrate/assemble-phaseB.ts
```
