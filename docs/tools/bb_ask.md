# `bb_ask`

Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.

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
      "description": "natural-language question"
    },
    "limit": {
      "type": "number",
      "description": "max results (default 5)"
    }
  },
  "required": [
    "query"
  ]
}
```

## Returns

- Natural-language answer
- Ranked semantic matches
- Similarity and source provenance

## Examples

`{"query":"how does request handling work?"}`

## Errors

- Empty query
- Unavailable index or embedding state
- Unknown option

## Limitations

- Semantic similarity discovers candidates but does not independently prove a claim
- Local word vectors provide lexical-quality fallback rather than model-quality semantics

## Performance

The limit bounds returned semantic matches; embedding coverage and model choice affect ranking quality.

## Safety

Read-only. It does not write source or silently rebuild embeddings.

## Evidence Semantics

Treat matched symbols and resolvable source locations as evidence; treat generated explanation as interpretation.

## Relationship to other tools

For exact symbol/content/file retrieval use `bb_search`; this tool answers natural-language questions with citations.

## Staleness

Freshness modes (registered as `freshnessModes`): `answer`. Staleness surfaces as: per-source `[STALE — file changed since index]` markers on retrieval answers, repeated in the source list; a verified aggregate answer carries no per-file marker (it describes the whole index, not a file). This tool does not auto-refresh, and it emits no `freshness` envelope: a verified aggregate answer is a count over the whole index rather than a per-file fact, so there is no per-file envelope to publish. When a cited source is stale, remediation is manual: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only). Nothing is stale → no marker. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
