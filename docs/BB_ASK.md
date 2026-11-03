<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the operator's guide to bb_ask: which route answers a question,
what each number means, how freshness is marked, what the limits are, and how the
behaviour is verified.

WHO IT IS FOR — anyone calling bb_ask through an MCP host, the CLI or a library, and the
maintainer who must keep the page true when the engine changes.

EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_ask/{descriptor,handler}.ts,
src/intelligence/search/{quick-answer,semantic-search}.ts,
script/tool-docs/curation/bb_ask.ts, docs/tools/bb_ask.md, and the gates named in
"Verification" below.
-->

# bb_ask — answers, retrieval and what the numbers mean

`bb_ask` answers a natural-language question from the index. It is not one algorithm: it
picks one of four routes before retrieving anything, and every answer states which route
answered, how confident the route can be, and how many matches exist versus how many are
shown.

## Routes

| route | when | answer | similarity printed? |
| --- | --- | --- | --- |
| **exact aggregate** | "how many …", "largest file", "most complex function" | an exact SQL count/extreme over the indexed snapshot, with the snapshot's timestamp | no — it is not a similarity claim |
| **exact symbol name** | the query is a single symbol name that exists in the index | that symbol, matched by name; its neighbours are listed and labelled as neighbours | only on the neighbour blocks |
| **semantic retrieval** | stored embeddings exist in the query model's vector space and at least one clears the floor | ranked matches with cosine similarities | yes, with the model and coverage named |
| **keyword fallback** | embeddings are unavailable, or nothing clears the floor | lexical matches | **no** — none was computed, and the answer says so |

When nothing matches, the answer is an explicit "I couldn't find…" with zero sources; it
never claims the code does not exist. When there is no index at all, the answer says so and
does not create one.

## The answer envelope

Every answer contains five blocks:

```
answer: <the answer, with any route-specific notes>
confidence: <value> (<kind>)        — or "not a measurement" when the ranking is non-discriminative
[index: snapshot <iso> (<age> ago)] — exact aggregates only
[retrieval: method=…, queryModel=…, indexModel=…, dimension=…, embeddingCoverage=…,
            libraryCoverage=…, reason=…, scanned=…/cap, filtered=…, candidates=…,
            ranking=non-discriminative (n within the margin of the best)]
[bounds: returned=N, totalMatches=<N|unknown>, truncated=<bool>[, truncationReason=…]]
[provenance: <evidenceClass> via <engine> (<route>)[; unknown: …]]
```

`confidence` kinds:

| kind | meaning |
| --- | --- |
| `exact aggregate over the index` | a direct SQL aggregate, exact about the snapshot |
| `exact name lookup, not a similarity claim` | the symbol identity is exact; its behaviour is not described |
| `mean of the returned similarities, bounded 0.2–0.85` | a real cosine mean from the vector path |
| `capped, because the ranking cannot separate its top results` | the ranking is declared non-discriminative. The mean would be 0.6–0.8 by accident of body length, so **no number is printed**; the answer says the scores are not a measurement |
| `declared floor; no score was computed on that path` | lexical fallback (0.2) or declared-low no-match (0.1) |
| `name-match heuristic` | symbol-search fallback, from the engine's relevance tiers |

`[bounds:]` is how a caller decides whether the list is complete: `totalMatches` is the
number of candidates above the similarity floor (or an explicit `unknown` on routes that
cannot know it), `truncated` is true when the scan cap or the page size cut the set, and
`truncationReason` names which one. A page is never presented as a corpus.

## The page size

`limit` is a whole number **1..100**, default **5**. Values outside it are refused with a
named error, never clamped: `0` used to become the engine default, print results and then
add "no matches were requested", and a very large page turns a question into a snippet
dump. A larger page is also a larger work budget.

## Exact aggregates

Counts cover: symbols · functions (both `function`- and `method`-kind, so a method-first
language is not reported as zero) · classes · interfaces · structs · enums · traits · types ·
constants · relationships · imports · files (optionally by language) · the largest file ·
the most complex function.

A count question about anything else (`how many endpoints`, `how many lines of code`) is
refused by name with the countable list attached, rather than answered with unrelated
search results.

Every aggregate reports the index snapshot it describes:

```
[index: snapshot 2026-11-01T22:09:34.000Z (693 s ago); these counts describe the indexed
 snapshot, not the working tree]
```

A count is exact about that snapshot. Files changed after the last index write are not
reflected, and the timestamp is how a reader judges the gap.

## Semantic retrieval

### Model consistency

The query vector's producing model is authoritative (`SemanticEngine.getLastEmbeddingModel()`,
or the local label after a provider timeout). Only stored embeddings whose `embedding_model`
equals the query model **and** whose `vector_dimension` equals the query vector's length are
compared. Different models occupy different vector spaces even at equal dimension, so
cross-model comparison is prohibited; `tfidf-v1` and any non-finite vector are excluded from
the dense path, and a non-finite cosine is discarded (never NaN).

### Similarity floors

| query space | floor |
| --- | --- |
| local word vectors (< 200 dimensions) | **0.50** |
| model embeddings (API-configured) | **0.35** |

The local floor is measured, not taste: over two populations known apart without human
judgement, 0.50 kept 61% of true matches and 0% of false ones, while the old 0.15 sat below
the false-positive median.

### Coverage, and why there are two numbers

`embeddingCoverage` counts the symbols that have an embedding **in the model space this
query was compared in** — measured after the query vector exists, for the exact model and
width that are compared. `libraryCoverage` counts every stored embedding regardless of
model. On a mixed-model index they differ materially: on the reference index the model
space had 30,906 comparable symbols of 310,423 (10%), while the library held 32,837 (11%),
and with local word vectors only 1,931 symbols (0.6%) are comparable. Both numbers are
printed and labelled.

### Scan bounds

The dense candidate scan is capped at `BB_VECTOR_SCAN_CAP` rows (default **20,000**),
ordered deterministically by entity id. A capped scan sets `truncated=true`, names the cap
in `truncationReason`, and `[provenance:]` carries `truncated: the candidate scan was
capped`. On the reference index every default call reaches the cap, so the candidate set is
a 20,000-row prefix, not the whole embedding table.

### Non-discriminative rankings

The local model is a bag of words with no inverse-document-frequency weighting, and cosine
normalises by length, so short bodies that contain a query word can outrank a long body
that is actually about the question. When several candidates score within **0.05** of the
best, the ranking is declared non-discriminative:

```
Note: this ranking does not distinguish its top results — 49 other symbol(s) scored within
the same margin of the best. … treat the ORDER as unreliable and the scores as a weak
signal at best. The confidence figure is capped for the same reason.
```

In that case the handler prints `confidence: not a measurement (…)` instead of a number.

### Provider timeout

The ask-time query embedding is an HTTP call when a provider is configured. The provider's
own bound defaults to 30 s (`BB_EMBEDDING_TIMEOUT_MS`), which is longer than this tool's
budget, so the call is bounded at **min(2 s, BB_EMBEDDING_TIMEOUT_MS)**. When the bound
fires, the question is embedded with the local word-vector model, the answer says so, and
`[retrieval:]` carries `embeddingTimeout=2000ms (fell back to local-word-vectors-v3)`.

### Fallback

When no usable vector result exists, retrieval falls back to lexical content search and
names the reason. The reasons have different remedies:

| reason | meaning |
| --- | --- |
| `degenerate-query-vector` | the query produced an all-zero vector — usually an identifier or terms outside the offline vocabulary. **Nothing was compared**; the cause is in the query, not the index |
| `no-vector-above-threshold` | vectors WERE compared and none cleared the floor |
| `no-matching-model-embeddings` | no stored embedding matches the query's model — expected after a model or tokenizer change until the project is re-embedded |
| `no-query-vector` | the embedding step returned nothing at all |
| `embedding-error` | the embedding step threw |
| `no-resolvable-entities` | vectors were compared and the winners no longer resolve to indexed symbols |
| `non-dense-query-model` | the query model is sparse (`tfidf-v1`) and cannot enter the dense path |
| `index-not-readable` | the index could not be opened read-only; nothing was compared |

A fallback answer prints **no similarity**, because the lexical path computes none
(`similarity` is `null`, deliberately not `0` — a zero is a number and would be averaged
and printed as a score).

## Embeddings

- **Local word vectors** (`local-word-vectors-v3`): offline, 50 dimensions, a 205-word
  programming base vocabulary plus the project's own vocabulary (up to 5,000 words from its
  symbol names). Identifier parts are representable; a query whose terms are all absent
  still produces a zero vector, reported as above.
- **API embeddings** (OpenAI-compatible): configured through `bb.json` or environment
  variables; typically 768–1536 dimensions, 2048 in the reference configuration. The model
  name is the stored identity, so an index embedded with one model is only comparable with
  a query from that same model.

### Privacy

With API embeddings configured, **the natural-language question is sent to that embedding
provider at ask time** to compute the query vector (indexing also sends code snippets).
With local word vectors the whole call stays offline. Choose per project sensitivity.

## Freshness

- A cited source whose file changed on disk since indexing is marked
  `[STALE — file changed since index]`.
- A cited source whose file no longer exists is marked `[MISSING — file no longer on disk]`.
  It is not "changed", and the two markers are distinct.
- A verified aggregate carries no per-file marker: it describes the whole index, and its
  `[index: snapshot …]` line says which snapshot.
- The tool does not auto-refresh. Remediation is manual: `bb index --changed` (or the
  `bb_index` tool with the project path) repairs the index, after which the stale marker
  clears.

Detection uses an mtime+size fast path with a content-hash fallback: an edit that leaves
both size and mtime unchanged is reported fresh without hashing (same trade-off as git's
index stat-cache, documented in `src/brain/freshness.ts`).

## Measured precision

On the rake + lodash + element-plus benchmark with gold sources
(`validation/m18/results/Q3.json`): warm precision **10/14 = 71.4%**, cold-start precision
**6/14 = 42.9%**, and zero confidence violations on negative queries (all below 0.5, zero
fabrication). Precision means the answer cites the gold source; it does not prove the prose
is behaviourally complete.

## Measured latency

Reference index: 6,452 files / 310,423 symbols / 820,040 relationships (3.64 GB), measured on
an isolated copy of that index so other work cannot colour the number:

| configuration | p50 | p95 |
| --- | --- | --- |
| configured provider embeddings, warm process, `limit: 5` | 1.78 s | 2.19 s |
| local word vectors (offline), `limit: 5` | 0.08–0.10 s | 1.33 s |
| exact symbol name with `limit: 1` (no dense scan) | 0.93 ms | 1.26 ms |
| first call in a cold process, provider configuration | 2.5–11.3 s | — |

Two qualifications the table cannot show:

- **The local-vector p95 is the lexical fallback, not the vector path.** With local word
  vectors only 1,931 of 310,423 symbols (0.6%) are comparable, so questions that fail the
  0.50 floor take the lexical route. That route is bounded: on a giant corpus it probes at
  most two content words and defers the whole-phrase needle until those come back empty
  (one substring needle is a full 310k-row scan of ≈0.30 s); the cap is declared through
  `truncated` and `termMatch.queryTerms`. Measured on the reference index, a fallback
  answer is 0.86–1.33 s end to end; before the bound it was 3–8 s. With provider
  embeddings configured, every measured question cleared the floor and used the vector
  path.
- **Provider latency is the floor, not a constant.** Raw provider calls measured
  0.23–2.38 s on the same machine; the tool bounds its ask-time wait at
  min(2 s, `BB_EMBEDDING_TIMEOUT_MS`) and declares the local fallback, so a slow provider
  cannot stretch a call by the provider's 30 s default.

On the shared live index while other processes were writing (4.1 MB of WAL frames present),
the same calls took p50 5.1 s / p95 13.3 s — wall-clock contention, not tool time. The
read-only proof held in that run too: `brain.db` bytes and WAL frames were unchanged.

Full per-run evidence, commands and the index population are in
`validation/tools/bb_ask/LATENCY.json`; the real-repository MCP-stdio proof is in
`validation/tools/bb_ask/REAL-CORPUS.json`.

## Verification

Run from the repository root, with a writable per-lane data directory:

```bash
export BB_DATA_DIR=validation/tools/bb_ask/bbdata/verify BB_NO_AUTO_REFRESH=1
bun run script/m13/verify-ask-contract.ts      # modes, both doors, query/limit boundaries
bun run script/m13/verify-ask-provenance.ts    # route provenance, confidence kinds, bounds
bun run script/m13/verify-ask-adversarial.ts   # corrupt vectors, foreign models, page abuse
bun run script/m13/verify-ask-integration.ts   # index join, stale vs missing, read-only
bun run script/m13/verify-ask-honesty.ts       # confidence/NaN/bounds/coverage/read-only
bun run script/verify-semantic.ts              # retrieval engine contract
bun run script/m16/verify-ask-stats.ts         # aggregate correctness
bun run script/m15/verify-ask-deep.ts          # deep behavioural coverage
bun run script/m13/verify-ask-e2e-corpus.ts    # real corpus + real transports
npx tsx script/verify-tool-docs.ts --only bb_ask   # this page is byte-fresh
```

The lane's red-then-green evidence (each gate shown failing on a planted mutant before
passing on the fixed tree) is recorded under `validation/tools/bb_ask/`.
