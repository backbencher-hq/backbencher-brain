# M18 — Semantic Intelligence & Retrieval Truth

Milestone: the product's flagship intelligence (semantic search + bb_ask retrieval)
must be measured, bounded, and honest — never an unverified claim.
GitHub milestone #18 · Issues #411–#417 · Started 2026-08-24

---

## 1. Origin findings (measured, not assumed)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **Embedding coverage is volatile** — two runs on the same lodash corpus, both after flush: 105/1048 = 10.0% then 652/1048 = 62.2% (model nvidia/nemotron-3-embed-1b:free). Coverage is a **per-run statistic**, never a fixed number. | live probe, 2026-08-24 |
| 2 | **No retrieval-quality evidence exists.** The only `semanticVectorSearch` check in the verifier suite is "exports semanticVectorSearch". No verifier measures whether semantic search returns RELEVANT results. | script/m15/verify-search-complete.ts |
| 3 | **bb_ask open-ended QA has zero quality evidence.** Counts proven (319==DB in M17.A8); natural-language retrieval precision never measured. | M17 evidence |
| 4 | **bb_search exposes no semantic mode** (modes: symbols/content/symbol/file) — semantic retrieval is bb_ask-only. Docs must reflect this. | src/mcp/tool-registry.ts |
| 5 | The engine is already model-consistent: same-model+dimension filter, tfidf excluded from cosine, `method: vector|keyword-fallback` + `fallbackReason` labels. Q4/Q5 **verify** this, not reimplement. | src/intelligence/search/semantic-search.ts |
| 6 | Live spot-check: semanticVectorSearch on lodash returns correct top hits (cloneDeep, debounce, baseMergeDeep) — quality is plausible but unproven. | live probe, 2026-08-24 |

## 2. Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| C1 | Governance | master plan, ledger, closure gate, wiring, benchmark governance |
| Q1 | Benchmark | human-reviewed ground-truth query set over rake/lodash/element-plus + negatives + dangling-gold guard |
| Q2 | recall@k | recall@1/5/10 + rank per mode (vector-API / keyword-fallback) per corpus, median+worst, honest floor per model |
| Q3 | bb_ask precision | open-ended answers cite/resolve gold symbol; no fabrication; cold/warm delta |
| Q4 | Coverage gate | per-run post-flush coverage reported through health + machine-checkable; degradation limits surfaced |
| Q5 | Edge cases | corruption, stale, empty, cold-start, model-mismatch — deterministic tests |
| D6 | Docs | EMBEDDINGS.md, BB_ASK.md, BB_SEARCH.md for the website; negatives documented |
| X9 | Gate | closure gate + planted-mutation + no-hardcoded-counts + coverage-presence checks |

## 3. Protocol (every issue)

1. Verifier first — script under `script/m18/` that CAN FAIL; no auto-pass.
2. Real corpora on disk: `~/fixtures/repositories/{rake,lodash,element-plus}`.
   Missing corpus = reported, never silently skipped.
3. Evidence file `validation/m18/results/<CODE>.json`: `verified, checks, passed, failed, negatives, measured, generatedAt` — measured values COMPUTED at runtime, never hardcoded.
4. Ground-truth provenance: every gold answer records WHO wrote it and WHY it is correct, against the ACTUAL indexed symbol (no invented gold).
5. Embedding phase honesty: any coverage/recall number records which phase it was measured in — post-`flushBackgroundEmbeddings` + optional extra wait — and the model label.
6. Closure comment quotes real run output + evidence path.
7. Ledger: `validation/m18/results/manifest.json`; only closed issues require clean evidence.

## 4. Honesty rules (non-negotiable)

- A number that varies between runs is reported as a RANGE/median/worst, never a single optimistic sample.
- API-unavailable runs are labeled; models never mixed.
- "No index" / "no embeddings" / "no candidate" answer honestly — never fabricated.
- The gate itself must fail on planted tampering before the milestone can close (X9).
- Any analyzer-domain defect surfaced (e.g. dangling source relationships) is routed OUT to the analyzer milestone, not hidden.

## 5. Completion record

| # | Issue | Status | Evidence |
|---|-------|--------|----------|
| C1 | Governance | OPEN | validation/m18/results/C1.json |
| Q1 | Benchmark | OPEN | validation/m18/results/Q1.json |
| Q2 | recall@k | OPEN | validation/m18/results/Q2.json |
| Q3 | ask precision | OPEN | validation/m18/results/Q3.json |
| Q4 | Coverage gate | OPEN | validation/m18/results/Q4.json |
| Q5 | Edge cases | CLOSED (issue #418) | validation/m18/results/Q5.json |
| D6 | Docs | CLOSED (issue #416) | validation/m18/results/D6.json |
| X9 | Gate | CLOSED (issue #417) | validation/m18/results/X9.json |

## 6. Negative list (what M18 does NOT claim)

- M18 does not prove analyzer AST correctness (that is M14 + per-analyzer work).
- M18 does not promise a fixed embedding-coverage % — it makes coverage an honest, reported, per-run number.
- Retrieval relevance is measured against a HUMAN-REVIEWED gold set; it is candidate discovery, not behavioral proof.