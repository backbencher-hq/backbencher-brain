# M19 — Scale & Performance Truth

Milestone: the product's flagship claim — "does it work on real large codebases" —
must be measured, bounded, and honest. For a Sourcegraph competitor, a 27k-symbol
fixture is not evidence; a 100k+ symbol real repo is.
GitHub milestone #19 · Started 2026-08-25

---

## 1. Origin findings (measured on this machine, not assumed)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **No giant repo has ever been indexed end-to-end.** The largest corpus ever measured in any milestone is element-plus: 27,670 symbols (M18 Q2). Everything else is fixture or sub-30k. | M18 evidence |
| 2 | **Giant corpora ARE available locally** — intellij-community (2.0G source, ~273k files), openclaw (2.6G, ~112k), ProxiCall (21G source, ~201k), aspnetcore (691M, ~59k), paperclip (744M, ~43k). None have been indexed. | `du`/`find`, 2026-08-25 |
| 3 | **Naive semantic coverage collapses at scale.** At 27k symbols, embedding coverage was 20.7% (element-plus, M18 Q2) — API rate limits + batch cost mean full dense coverage on 100k+ symbols is infeasible. The product must degrade honestly, not silently. | M18 Q2 evidence |
| 4 | **Retrieval quality at 100k+ symbols is unproven.** Vector scan is capped at 20,000 rows (`BB_VECTOR_SCAN_CAP`) with deterministic ordering — fine for correctness, but 200k+ symbols means ~90% of candidates never enter the scan. Does retrieval still surface the right symbol? Unknown. | `src/intelligence/search/semantic-search.ts` (read at 2026-08-25) |
| 5 | **Indexer per-file timing from M11/M12 evidence was per-language fixture-level.** Worker pool parallelism, memory peak, and end-to-end wall time on multi-100k-file repos are unmeasured. | M11 corpus evidence |

## 2. Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| C1 | Governance | master plan, ledger, closure gate, wiring, scale-benchmark governance |
| S1 | Scale benchmark | measured baselines: index time, peak RSS, symbols/files per repo — rake/lodash/ep as small/med, then the giants |
| S2 | Giant indexing | index `aspnetcore` (59k files) + `paperclip` (42k) end-to-end; prove the pipeline completes, report honest time/memory |
| S3 | Giant indexing II | `intellij-community` (273k files) — the stress test: worker pool, memory cap, parallelism |
| Q1 | Retrieval at scale | semantic + symbol + content search on a giant index: latency budgets, `BB_VECTOR_SCAN_CAP` truncation honesty, recall against a known subset |
| Q2 | Fallback at scale | when API embeddings cannot cover 100k+ symbols: local-vector/lexical degradation is verified, labeled, never silent |
| D1 | Docs | SCALE.md / BENCHMARKS.md for the website: measured numbers, negative lines ("did NOT index X because...") |
| X9 | Gate | closure gate + planted-mutation + scale-presence checks (extends M18 pattern) |

## 3. Protocol (every issue)

1. Verifier first — script under `script/m19/` that CAN FAIL; no auto-pass.
2. Real corpora on disk: `~/aspnetcore` / `~/intellij-community` / `~/paperclip`.
   Missing corpus = reported, never silently skipped.
3. Evidence file `validation/m19/results/<CODE>.json`: `verified, checks, passed, failed, negatives, measured, generatedAt` — measured values COMPUTED at runtime, never hardcoded.
4. Every measured number records: which repo, which exact tag/commit (or "dirty HEAD"), file count, symbol count, wall-clock time, peak RSS (if attainable), and the machine.
5. Scale honesty: any indexing that times out / OOMs / is skipped is REPORTED with the reason — a skipped giant repo is a finding, not an omission.
6. Closure comment quotes real run output + evidence path.
7. Ledger: `validation/m19/results/manifest.json`; only closed issues require clean evidence.

## 4. Honesty rules (non-negotiable)

- A number that varies between runs is reported as RANGE/median, never a single optimistic sample.
- Memory/time values are reported WITH the machine (kernel, CPU, RAM) — absolute numbers without hardware are not comparable.
- If the worker pool OOMs on a repo, that is a RESULT recorded in evidence, not something to hide.
- Any quiet fallback to uncapped scans, or silent truncation that loses the top match, is a defect — the milestone exists to catch it.
- The gate itself must fail on planted tampering before the milestone can close (X9).

## 5. Completion record

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| C1 | Governance | CLOSED — gate 10/10 | validation/m19/results/C1.json |
| S1 | Scale benchmark at anchors | CLOSED — 16/16 | validation/m19/results/S1.json |
| S2 | Index aspnetcore (59k files) | OPEN — timing ledger missing | validation/m19/results/S2.json |
| S3 | Index intellij-community (273k files) | OPEN — timing ledger missing | validation/m19/results/S3.json |
| Q1 | Retrieval at scale | CLOSED — 7/7 | validation/m19/results/Q1.json |
| Q2 | Fallback at scale | CLOSED — 13/13 | validation/m19/results/Q2.json |
| B1 | Benchmarks docs | CLOSED — 22/22 | validation/m19/results/B1.json |
| X9 | Gate | OPEN — planted mutation pending | validation/m19/results/X9.json |

## 6. Negative list (what M19 does NOT claim)

- M19 does not prove analyzer AST correctness on giant repos (the indexer may complete while AST quality is M14's lane).
- M19 does not promise a fixed embedding-coverage % on giant repos — it proves the fallback ladder is honest at scale.
- Wall-time numbers are hardware-dependent (this machine); they are recorded with the machine so they are comparable, not portable claims.