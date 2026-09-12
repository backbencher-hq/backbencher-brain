# M57: Test Truth — the indexer must know what a test is

> GitHub milestone #57. Issues: #789 (T1), #790 (T2), #791 (T3), #792 (T4),
> #793 (T5), #794 (X1).

## The milestone invariant (verbatim, to be enforced by X1)

> **A file that is not code is never a test file, and a corpus-defining flag
> never changes meaning without re-measuring every consumer — visibly.**

## Why this milestone exists (measured during M50 — not guessed)

The indexer's `is_test_file` classifier matches path substrings with **no file-type
check**. On the real index all 30 flagged files are JSON data fixtures
(`script/m14/spec/*-completeness.json`, `validation/m14/results/M14.0.SPEC.json`),
every relationship from them is `contains`, and test-intel classified **0** evidence
edges — so `test_gaps` reported all 30,557 production symbols as untested and
`test_quality` listed 30 JSON files as test files. M50 made the read tools honest
(exclusions + `provenance.unknowns`); the source defect is still there, and the
read tools therefore report **"0 test files"** on this repo — true, but useless.

Root-cause receipt: `validation/m50/results/A2-test-sources.json` (M50 commit
`71821d2c`).

## Issues

- **T1 (#789) — Test classifier truth.** File type gates the flag (shared
  `NON_CODE_TEST_LANGUAGES` vocabulary with M50's test-intel fix — ONE
  definition); path-shape rules stay and align with `AnalysisExclusions.isTestPath()`;
  hermetic mutation-proven gate (JSON-in-/spec/ never flagged, `x.test.ts` and
  `tests/helper.py` always flagged); **re-index proof** (sandbox first, then the
  real DB) with before/after flagged-file census.
- **T2 (#790) — Re-measure every consumer.** Full census: test-intel trio,
  suggestions, doc-engine, patterns, analysis-exclusions, cross-language
  persister. Per-consumer before/after on the SAME re-indexed DB; pattern
  corpora gates re-run against the re-index or their delta is convicted.
- **T3 (#791) — `bb_patterns scope=all` under the line, truthfully.** M50 took
  it from >90 s to 1,345 ms; the remaining cost is per-call rule evaluation.
  Generation-keyed cache with declared freshness, or a measured floor — a
  number either way. Parity: findings digest identical on a fixed DB.
- **T4 (#792) — Corpus identity.** The process defect behind the milestone:
  corpus-defining flags changed meaning and nothing forced a re-measure; stale
  green gates asserted stale truths. Evidence files that depend on the indexed
  corpus record the corpus identity (counts + census digest) and a gate goes
  RED when the live census no longer matches; a classifier change must list the
  evidence it invalidates in the same commit.
- **T5 (#793) — One canonical test predicate.** The indexer flag and
  `AnalysisExclusions.isTestPath()` disagree today. ONE module, consumed by
  both; a divergence census over the re-indexed DB is a permanent gate
  assertion; search demotion and orphan `includeTests` switch to it.
- **X1 (#794) — Closure gate.** Current commit-stamped evidence for T1–T5, the
  re-index census, live re-runs of subordinates and the downstream set (M50's
  `verify-a2-test-sources.ts` must pass against the CORRECTED corpus — its
  false-absence disclosure should disappear), mutation self-test for every
  non-infra gate, honest-`pending` rule.

## Gates registry (wired as they land)

| Code | Script | Infra |
|---|---|---|
| T1 | verify-t1-classifier.ts | no |
| T2 | verify-t2-consumers.ts | no |
| T3 | verify-t3-patterns-latency.ts | no |
| T4 | verify-t4-corpus-identity.ts | no |
| T5 | verify-t5-predicate-unity.ts | no |
| X1 | verify-closure.ts | yes |

(Infra gates G1 governance / G2 self-test are added with the first substantive
gate, per the M31/M35/M40/M50 pattern.)

## Ground rules

- No fix without a measured conviction — the receipt exists (M50
  `A2-test-sources.json`); nothing here is speculative.
- Every verdict carries numbers; no prose-only claims.
- The re-index is a first-class event: sandbox DB first, real DB only after the
  sandbox proves the census; every consumer re-measured on the SAME DB.
- Anything a scripted gate cannot observe is declared `pending`, never inferred.
- Co-agent lanes untouched; shared surfaces (parallel-indexer,
  analysis-exclusions) get a coordination note in the commit body.

## Results (delivered — receipts in validation/m57/results/)

| Gate | Receipt | Result |
|---|---|---|
| T1 | T1-classifier.json + T1-before/after-census.json | C1–C5 green; re-index proof: flagged 30→0 (all 30 were non-code; repo has zero test-shaped code files), flag == predicate on all 3,338 rows |
| T2 | T2-consumers.json | 12/12 on the corrected real DB; found + fixed one honesty gap (testQuality lacked the zero-corpus disclosure) |
| T3 | T3-scope-all.json | 17/17 on both runtimes; orphan page bounded (census preserved), long-parameter-list counted by SQLite (json_each), dist freshness asserted |
| T4 | T4-corpus-identity.json | comparator falsifiable; both real-DB receipts carry corpus identity + classifier epoch and match the live world |
| T5 | T5-predicate-unity.json | battery 13/13, delegation proofs, allowlist census (2 duplicate detectors converted), P5 real-DB unity |
| G2 | G2-selftest.json | 5/5: control passes, mutation fails, restore byte-identical |
| X1 | X1-closure.json | 16/16 at the closing commit, incl. 5 downstream gates and the declared foreign red |

Re-index: `node bin/bb index <repo> --force` — 3,338 files, 180,772 symbols, 189,499 relationships, 0 errors, full derived re-processing (746.8s under co-agent load).

Latency context (honest): scope=all min 4.85s / p50 15.8s / max 20.3s through `node bin/bb mcp` while machine load was ~15 (co-agent builds). Structural gates (bounding + parity) are the load-independent proof; the M50-era 1.3s numbers were taken on an idle box and a smaller corpus.

Closure command: `BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> bun run script/m57/verify-closure.ts`

Concurrency ground rule (M50 lesson): M57 gates tamper shared mutation seams; run them serially — never two at once (closure's first run failed exactly this way while G2 ran).
