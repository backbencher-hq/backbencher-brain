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

**The local model label is versioned: `local-word-vectors-v3`.** Version 2
tokenizes identifiers — `CpuCounter` → `cpu`, `counter` — where version 1
tokenized on whitespace alone. Version 3 additionally derives each word's
vector from the word itself, so a project's own vocabulary is a pure coverage
increase: it can never perturb a vector the base vocabulary already produced,
and the index side and the query side may use different vocabularies without
comparing two unrelated points. A v1/v2 vector and a v3 vector occupy
*different* spaces despite both being 50-dimensional, so the version suffix is
what stops the guard above from comparing them. An index embedded before the
change reports `reason=no-matching-model-embeddings` until it is re-embedded,
which is the honest outcome; reusing the old label would have produced
real-looking cosines between two unrelated vector constructions.

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
(FTS5/BM25 content search) with an explicit `fallbackReason`. The reasons are
distinguished because they have different remedies, and collapsing them is what
once made the tool blame a correctly-embedded index for a query-side failure —
see `degenerate-query-vector` in the table above.

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

- Verified aggregate answers: high, fixed confidence (`0.95`) — they are exact
  SQL aggregates, and the noun that was counted is named in the answer.
- Semantic answers: confidence derived from the average of the real similarity
  scores of the returned matches, bounded to `0.2..0.85` so a semantic result
  never claims certainty.
- Lexical (keyword-fallback) answers: a declared low constant (`0.2`). No
  similarity was computed on that path, so there is nothing to average — the
  confidence is a floor, not a measurement.
- Unknown answers: `0.1`, or `0` when the tool itself failed.

`confidence` is printed on every answer.

## What the answer does and does not tell you

Three independent honesty facts travel with every answer, and each fails
separately, so each is reported separately:

| Fact | Where it appears |
| --- | --- |
| Which route answered | `[provenance: … (aggregate)]` |
| Confidence | `confidence: <0..1>` |
| Path, models, coverage, true reason | `[retrieval: method=…, queryModel=…, indexModel=…, dimension=…, embeddingCoverage=N% (a/b symbols embedded), reason=…]` |

**`method=keyword-fallback` means the matches are lexical, not semantic.** The
answer says so in words and prints no similarity score, because none was
computed — a score of `0.000` under a "these are not semantic" banner is a
number that looks like evidence and is not.

**`embeddingCoverage` is the fraction of the index that can be compared at
all.** At low coverage a symbol that answers your question may be absent from
the results entirely, and the answer says what the fraction is. This is
measured per run against the database, not assumed.

**`reason` names the real cause, and the causes are not interchangeable:**

| reason | meaning |
| --- | --- |
| `degenerate-query-vector` | The query produced a vector of all zeros — usually an identifier, or terms outside the offline vocabulary. **Nothing was compared.** The cause is in the query, not the index. |
| `no-vector-above-threshold` | Vectors WERE compared and none cleared the threshold. |
| `no-matching-model-embeddings` | No stored embedding matches the query's model. After a tokenizer change this is expected until the project is re-embedded. |
| `no-query-vector` | The embedding step returned nothing at all. |
| `embedding-error` | The embedding provider threw. |
| `no-resolvable-entities` | Vectors were compared and the winners no longer resolve to indexed symbols. |
| `non-dense-query-model` | The query model is sparse (`tfidf-v1`) and cannot enter the dense path. |

## Countable nouns, and the ones that are not

`bb_ask` counts these exactly, and names the aggregate it used:

symbols · functions (counting **both** `function` and `method`, so a
method-first language is not reported as zero) · classes · interfaces · structs ·
enums · traits · types · constants · relationships · imports · files (optionally
by language)

A count question about anything else — `how many endpoints`, `how many lines of
code` — is **refused by name**, with the countable list attached, rather than
being answered with unrelated search results. A refusal is a fact about the
tool; an unrelated search presented as an attempt is not.

## Local embeddings: what they can and cannot represent

The offline model is a 190-word programming vocabulary hashed into 50
dimensions. Two measured limits, on 9 real repositories in the shipped
(no-API-key) configuration:

- A query whose every term is outside that vocabulary produces an **all-zero
  vector**. Cosine against it is 0 for every stored row, so nothing is
  compared and the answer comes from lexical search. The tool reports
  `reason=degenerate-query-vector` and says so in words.
- Symbol names are tokenized (`CpuCounter` → `cpu`, `counter`) like the index
  was, so they are representable in principle — but only for names whose parts
  appear in the base vocabulary or the project vocabulary. Names whose parts
  are absent still produce a zero vector.

Embedding an identifier is a poor proxy for understanding it. When a query
names a symbol, `bb_search` is the tool for precision; `bb_ask` is for the
question you cannot phrase as a symbol name.


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
