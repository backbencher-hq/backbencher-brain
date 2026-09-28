# EMBEDDINGS — how semantic embeddings work in the brain

> Status: verified against real evidence — M18 (Semantic Intelligence & Retrieval
> Truth): `validation/m18/results/Q1..Q5.json`. Every claim below is either a
> code invariant or a number measured on real corpora in M18. Nothing here is
> aspirational.

## What embeddings are

The brain stores one dense vector per indexed symbol in
`brain_semantic_embedding`:

| Column | Meaning |
| --- | --- |
| `entity_id` | The symbol this embedding belongs to |
| `embedding_model` | Canonical model label **that actually produced the vector** |
| `vector_dimension` | Dimension of that model's vectors |
| `embedding_vector` | JSON numeric array |
| `content_hash` | Hash of the snippet that produced the embedding (insert-time dedupe; **not** consulted at query time) |
| `similarity_threshold` | Per-row threshold hint (insert-time) |

Embeddings are generated in the background after indexing, batched through
`SemanticEngine.embedMany`. They are **additive**: an index run flushes new
batches; coverage is never a one-shot snapshot.

## 2. Model labels & vector spaces (the correctness invariant)

- The **query vector** is produced by `SemanticEngine.embed(query)`. The model
  that actually produced it (`getLastEmbeddingModel()`) is authoritative —
  the API layer may transparently fall back to local word vectors, so the
  configured model name is never trusted.
- Semantic vector search compares **only** stored embeddings whose
  `embedding_model` equals the query model **and** whose `vector_dimension`
  equals the query vector length. Cross-model comparison is **prohibited**
  even at equal dimension, because different models occupy different vector
  spaces (verified: Q4 inserts a fake foreign-model row; it is never compared;
  Q5 model-mismatch case re-verifies it deterministically).
- `tfidf-v1` rows are sparse `{token, weight}` maps — structurally
  incompatible with dense cosine. They carry a distinct model label and are
  excluded from the dense path (`non-dense-query-model`). Verified in Q5.
- Any stored vector that is not a finite numeric array is skipped (corrupt
  rows — malformed JSON, non-numeric, `Infinity` — are skipped without crash;
  Q5 case 1). Zero/norm-0 vectors never produce NaN similarity (Q5 case 9).

## 3. Coverage semantics — volatile, per-run, never hidden

**Coverage is a per-run, post-flush statistic, not a fixed product number.**
Measured on the rake corpus in M18:

| Run | Embeddings | Symbols | Coverage | Phase |
| --- | --- | --- | --- | --- |
| Q2 rake | 445 / 779 | 445 | 57.1% | post-flush (flush 15.4s) |
| Q4 rake | 445 / 779 | 445 | 57.1% | post-flush (flush 15.4s) |
| Q4 pre-flush | 0 / 779 | 0 | 0.0% | during background drain |

The **pre-flush `0 of N` line is distinguishable from the post-flush number**:
evidence records which phase a number was measured in, and the health line
labels it. Coverage is reported through `bb_health` (machine-checkable) and is
**never hidden — even when 0** (Q4: a zero-coverage index reports `0 of N`
explicitly, and `bb_ask` surfaces the degradation note instead of presenting
lexical matches as semantic).

Coverage is **volatile by design**: the embedding API batches and rate-limits,
so one run may embed 62.2% of lodash and another 10.0% of the same corpus (both
post-flush). The product therefore never claims a fixed coverage target — it
reports what it measured, per run (see Q4 negative line).

## 4. Fallback ladder (explicit, never silent)

When no usable vector result exists, retrieval falls back to lexical search
(FTS5/BM25 content search) with an explicit `fallbackReason`:

`embedding-error` · `no-query-vector` · `non-dense-query-model` ·
`no-matching-model-embeddings` · `no-vector-above-threshold` ·
`no-resolvable-entities`

Each of these is a real, reachable path — the deterministic wire‑tests in Q5
prove the `embedding-error`, `no-query-vector`, `no-matching-model-embeddings`,
`non-dense-query-model`, and degenerate-row paths offline.

## 5. Retrieval quality (measured, bounded, honest)

On the M18 benchmark (rake + lodash + element-plus, gold answers with
provenance in `validation/m18/benchmark/benchmark.json`):

| Metric | Measured | Floor asserted |
| --- | --- | --- |
| Vector recall@10 (median over query runs) | **71.4%** (10/14) | >= 50% |
| Vector recall@5 | **57.1%** (8/14) | >= 0.3 |
| `bb_ask` warm precision (answer cites gold symbol) | **71.4%** (10/14) | >= 0.5 |
| `bb_ask` cold-start precision (no embeddings) | **42.9%** (6/14) | >= 0.3 |
| cold/warm delta | -28.6 pts | reported, not hidden |

The deltas exists for a reason: cold start has **zero** stored embeddings, so
`bb_ask` falls back to lexical symbol/content search — symbol-name queries
still land, natural-language paraphrases degrade (Q3 measured the full delta;
Q3's "does not know" honesty floor: all negative queries return confidence
< 0.5, zero fabrication).

These are **candidate-discovery** numbers — they prove the correct symbol is
*retrieved*; they do not prove behavioral semantics. Ranks are per-embedding-model
and per-run; a gold embedded under a different model than the query is an
out-of-domain (coverage) miss, not a retrieval defect (Q2 negative line).

## 6. What embeddings do NOT do

- Embeddings are **not** stored file source; content search covers the indexed
  symbol + docstring corpus, not full file text.
- Embeddings do **not** rank `bb_search`: `bb_search` has **no semantic mode**
  (modes: `symbols` / `content` / `symbol` / `file`). Semantic retrieval is
  `bb_ask`-only. No doc or UI may imply `bb_search` ranks semantically.
- Embedding rows are **not** validated against `content_hash` at query time —
  staleness is proven by the file-level hash (`checkResultsFreshness`), and
  semantic results are flagged `stale` when the underlying file changed on
  disk. Verified in Q5 case 10.

## 7. Scalability

The candidate scan is capped at `BB_VECTOR_SCAN_CAP` (default 20000) rows,
ordered deterministically by `entity_id`, so truncation is stable; when the
cap is hit, `provenance.truncated` is `true` and `metadata.scannedRows` reports
exactly how many rows were loaded (Q5 case 11 proves this with a closed set).

## 8. Verification references

- `script/m18/verify-recall.ts` — recall@k / rank / latency / model labels
- `script/m18/verify-ask.ts` — bb_ask warm/cold precision + honesty floors
- `script/m18/verify-coverage.ts` — coverage reporting + phase labeling
- `script/m18/verify-edge-cases.ts` — corrupt / stale / empty / mismatch
- `script/m18/verify-scan-cap.ts` — scan-cap truncation (child process)
- Evidence: `validation/m18/results/Q1.json .. Q5.json`