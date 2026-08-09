# `bb_ask`

Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.

## Contract

- Category: `search`
- Mutability: `read`
- Requires index: `true`
- Modes: `answer`
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

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
