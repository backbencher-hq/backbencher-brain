# bb_ask & Semantic Retrieval Reference

`bb_ask` answers natural-language questions about the codebase. It combines
**verified factual answers** (exact database aggregates) with **semantic
retrieval** (vector search over indexed embeddings). These two are always kept
distinct: semantic proximity is never presented as a verified fact.

## Answer sources

1. **Verified aggregates** — deterministic counts/lookups (e.g. "how many
   functions", "most complex function"). Returned with high confidence and
   labeled as facts. Counts are **cross-language honest**: "functions" counts
   both `function`- and `method`-kind symbols, so a Ruby/Python project never
   reports 0 functions (verified against the real rake repo, M16 regression).
   Unsupported stat nouns (e.g. "how many modules") never fabricate a count —
   they fall through to labeled search results or an explicit unknown.
   With no index at all, the answer is an explicit "no index exists — index
   first", never a fabricated 0.
2. **Semantic retrieval** — vector similarity over `brain_semantic_embedding`.
   Returned as *closest matches*, explicitly labeled "search results, not a
   verified answer".

## Semantic retrieval engine (`src/intelligence/search/semantic-search.ts`)

### Model consistency (correctness invariant)

The query vector is produced by `SemanticEngine.embed(query)`. The **model that
actually produced it** (`getLastEmbeddingModel()`) is authoritative — the API
layer may transparently fall back to local word vectors, so the configured model
name is not trusted.

Only stored embeddings whose `embedding_model` equals the query model **and**
whose `vector_dimension` equals the query vector length are compared. Vectors
from a different model are never compared, even at equal dimension, because
different models occupy different vector spaces.

### Dense-path guards

- `tfidf-v1` rows (sparse `{token, weight}` maps) are structurally incompatible
  with dense cosine. They carry a distinct model label and therefore never enter
  the query-model scan. As defense in depth, any parsed vector that is not a
  finite numeric array is skipped.
- Any non-finite cosine result is discarded.

### Scalability

The candidate scan is capped at `BB_VECTOR_SCAN_CAP` (default 20000) rows,
ordered deterministically by `entity_id` so truncation is stable. This bounds
memory and CPU regardless of index size.

### Response metadata

Every response includes a `metadata` block:

| Field | Meaning |
| --- | --- |
| `method` | `"vector"` or `"keyword-fallback"` |
| `queryModel` | Model that produced the query vector |
| `indexModel` | Model of the embeddings actually compared |
| `dimension` | Query vector dimension |
| `scannedRows` | Candidate embedding rows loaded |
| `filteredRows` | Rows that yielded a finite similarity |
| `fallbackReason` | Present only when `method = "keyword-fallback"` |

### Fallback

When no usable vector result exists, retrieval falls back to lexical search
(FTS5/BM25 content search) with an explicit `fallbackReason`, one of:
`embedding-error`, `no-query-vector`, `non-dense-query-model`,
`no-matching-model-embeddings`, `no-vector-above-threshold`,
`no-resolvable-entities`.

## Embedding configuration

- **API embeddings** (OpenAI-compatible): configured via `bb.json` /
  environment. Produce dense vectors (typically 768–1536 dims). See
  `EMBEDDINGS.md`.
- **Local word vectors**: offline fallback embedded in the binary. Lower
  dimension (<200), lower absolute cosine values — the default similarity
  threshold adjusts (0.15 local vs 0.35 API).
- **tfidf-v1**: a legacy lexical fallback stored at index time for very large
  batches. It is **not** used by dense semantic retrieval.

### Privacy & cost

API embeddings send code snippets to the configured provider at index time.
Local word vectors keep everything offline at the cost of retrieval quality.
Choose per project sensitivity.

## Confidence semantics

- Verified aggregate answers: high, fixed confidence — they are exact.
- Semantic answers: confidence derived from average similarity of the top
  matches, bounded so a semantic result never claims certainty.

## Examples

- "how many functions are there" → verified aggregate.
- "where is request handling implemented" → semantic retrieval (`method:
  "vector"` when embeddings exist, else `keyword-fallback`).

## Verification

`script/verify-semantic.ts` covers: metadata presence, model consistency,
corrupt-vector tolerance, tfidf exclusion from the dense path, NaN-free
similarities, and the empty-embeddings keyword fallback with a reason.

### Measured precision (M18 evidence, not aspirational)

On the M18 benchmark (rake + lodash + element-plus golds with provenance):

| Path | Precision | Evidence |
| --- | --- | --- |
| Warm (embeddings flushed) | **71.4%** (10/14) | `Q3.json` |
| Cold start (no embeddings) | **42.9%** (6/14) | `Q3.json` |
| Negative queries (no gold) | all confidence < 0.5, zero fabrication | `Q3.json` |

**Coverage honesty:** when embedding coverage is low or zero, `bb_ask`
prepends an explicit note ("semantic embeddings are unavailable or
insufficient… lexical matches, not semantic ones") instead of presenting
lexical matches as semantic. This was a production fix shipped in M18.Q3
(`src/intelligence/search/quick-answer.ts`). Coverage is a per-run,
post-flush, volatile statistic — see Q4/Q5 evidence
(`validation/m18/results/Q4.json`, `Q5.json`) for how 0-coverage is
reported and never hidden.

**Limitation:** narrative answers are *candidate discovery* — the correct
symbol is retrieved and cited, but the prose is not proven behaviorally
complete. Counts ("how many functions") are exact aggregates and are never
mixed into narrative confidence; see M16/M17 A8 for count verification.
