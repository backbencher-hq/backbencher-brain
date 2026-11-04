<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_ask: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_ask through any MCP host, the CLI (`bb tool bb_ask`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_ask/descriptor.ts, src/mcp/tools/bb_ask/handler.ts, script/tool-docs/curation/bb_ask.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_ask --write`.
-->
# `bb_ask`

Answer a question about the codebase from the index, with the route and its limits stated. Four routes: (1) an EXACT AGGREGATE over indexed rows (counts of symbols/functions/classes/interfaces/structs/enums/traits/types/constants/relationships/imports/files, optionally by language; the largest file; the most complex function) — exact about the indexed snapshot, with that snapshot's time reported, and never a similarity claim; (2) an EXACT SYMBOL NAME lookup when the query is a single symbol name — matched by name, not by similarity, with its neighbours listed and labelled as neighbours; (3) SEMANTIC RETRIEVAL over stored embeddings — only vectors from the same model and dimension as the query are compared, similarities are cosine scores, and the answer reports which model space it compared, how many symbols exist in that space versus across the whole library, whether the scan cap was reached, and whether the provider embedding timed out (then a capped local 50-dimension fallback runs); (4) a KEYWORD FALLBACK when embeddings are unavailable or nothing clears the similarity floor — lexical matches that carry NO similarity score, with the reason stated. Every answer reports its confidence kind: a mean of returned similarities (bounded 0.2–0.85), a declared floor when no score was computed, or NO confidence number at all when the ranking is declared non-discriminative (the answer then says the scores do not separate candidates). Every answer declares `returned`/`totalMatches`/`truncated` bounds so a prefix is never read as a complete match set. Cited sources carry `[STALE — file changed since index]` or `[MISSING — file no longer on disk]` markers, and nothing is auto-refreshed. `limit` is the page size: whole number 1..100, default 5, values outside refused rather than clamped. When embeddings are configured, the natural-language question itself is sent to the configured embedding provider to compute the query vector; with local word vectors everything stays offline.

## Contract

- Category: `search`
- Mutability: `read`
- Requires index: `true`
- Modes: `answer`
- Planned modes (roadmap, not executable): `explain`, `feature`
- Defaults: `{"limit":5}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "natural-language question, or a symbol name for the exact-name route"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "description": "max results (default 5; whole number 1..100; values outside are refused, not clamped). A larger page also means a larger work budget."
    }
  },
  "required": [
    "query"
  ]
}
```

## Returns

- Exact aggregates over the indexed snapshot — symbol counts by kind (functions count both `function`- and `method`-kind symbols), relationships, imports, files (optionally by language), the largest file and the most complex function — each answer carrying the index snapshot's timestamp
- An exact symbol-name lookup when the query is a symbol name, with its neighbours listed and explicitly labelled as neighbours rather than better matches
- Ranked semantic matches with real cosine similarities when stored embeddings allow it, each answer naming the compared model, the symbols comparable in that model space, the library-wide coverage, the scan bounds, and per-source `[STALE — file changed since index]` / `[MISSING — file no longer on disk]` markers
- Lexical matches when embeddings are unavailable or nothing clears the similarity floor — with NO similarity number printed, because none was computed, and the fallback reason named
- Declared bounds on every answer: `returned`, `totalMatches` (or an explicit unknown), `truncated` and `truncationReason`; plus a confidence kind: exact aggregate, exact name lookup, mean of returned similarities (bounded 0.2–0.85), declared floor, or none when the ranking is declared non-discriminative

## Examples

`{"query":"how many functions are in this project"}`

`{"query":"where is request handling implemented"}`

`{"query":"handleRequest","limit":1}`

## Errors

- Empty or whitespace-only query
- `limit` outside 1..100 (0 included) — refused rather than clamped, because a clamped page looks like the page the caller asked for
- Unknown option, or a mode that exists only in `plannedModes` (`explain`, `feature`)
- No index for the project, or an index that cannot be read — answered as a declared unknown with zero sources, never a fabricated count

## Limitations

- Semantic similarity discovers candidates; it does not prove behaviour, ownership or architecture, and the answer says so
- Local word vectors are a 205-word programming vocabulary plus the project's own vocabulary hashed into 50 dimensions. Their cosines are not comparable with a model embedding's, and an identifier-shaped query whose tokens are all absent produces a zero vector, reported as `reason=degenerate-query-vector`
- Coverage is per comparison space. On a mixed-model index the symbols comparable in the query model's space can be far fewer than the library-wide number; both numbers are reported and labelled
- When the configured embedding provider does not answer within the tool's wait ceiling (2 s, or `BB_EMBEDDING_TIMEOUT_MS` when lower) the question is embedded with the local word-vector model, the answer declares the timeout, and the ranking is limited to that model's space
- A verified aggregate is exact about the indexed snapshot, not the working tree: files changed after the last index write are not reflected, and the answer reports the snapshot time so the reader can judge the gap
- The dense candidate scan is capped at `BB_VECTOR_SCAN_CAP` rows (default 20,000). When the cap is reached the answer declares `truncated=true`, and the candidates are a deterministic prefix of the embedding table ordered by entity id
- A non-discriminative ranking (several candidates within the 0.05 margin of the best) publishes no numeric confidence: the answer says the scores do not separate candidates instead of printing a number it calls unreliable

## Performance

Warm default-argument latency on the 3.6 GB reference index (6,452 files / 310,423 symbols) is p50 ≈ 1.8 s and p95 ≈ 2.1 s with the configured embedding provider; the first call in a cold process takes 9–10 s because the scan loads up to 20,000 vectors (≈164 MB at 2048 dimensions). The exact symbol-name route with `limit: 1` skips the dense scan and answers in milliseconds. The page size bounds both the payload and the work budget, and the candidate scan cap bounds memory independently of index size.

## Safety

Read-only. Every index open is byte-read-only: the tool does not create a database, run migrations, heal indexes or promote embeddings, and it never writes source or rebuilds embeddings behind the caller's back. When embeddings are configured, the natural-language question itself is sent to that embedding provider to compute the query vector; with local word vectors the whole call stays offline.

## Evidence Semantics

Treat matched symbols and resolvable source locations as evidence; treat similarity scores as candidate ranking, not proof. A non-discriminative ranking is not evidence and is labelled as such. A verified aggregate is a fact about the indexed snapshot, with that snapshot's timestamp reported.

## Relationship to other tools

For exact symbol/content/file retrieval use `bb_search`; this tool answers natural-language questions with citations.

## Deep guides

- [Asking questions honestly — routes, confidence, bounds](../BB_ASK.md)

## Staleness

Freshness modes (registered as `freshnessModes`): `answer`. Staleness surfaces as: per-source `[STALE — file changed since index]` markers on retrieval answers, repeated in the source list; a verified aggregate answer carries no per-file marker (it describes the whole index, not a file). This tool does not auto-refresh, and it emits no `freshness` envelope: a verified aggregate answer is a count over the whole index rather than a per-file fact, so there is no per-file envelope to publish. When a cited source is stale, remediation is manual: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only). Nothing is stale → no marker. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
