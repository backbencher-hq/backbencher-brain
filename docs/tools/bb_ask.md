# `bb_ask`

Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores. When the answer's source files are stale/missing within budget, those files are auto-refreshed exactly before the answer is re-built, declared (auto-refresh: ... with the machine-readable refresh block naming the reason). In a git worktree, brand-new untracked files whose content matches the query are also repaired and included (or named explicitly as unindexed when out of budget / refresh=false); refresh=false opts out and answers from existing data with stale sources flagged.

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
    },
    "refresh": {
      "type": "boolean",
      "description": "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering)"
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

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
