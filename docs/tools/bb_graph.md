# `bb_graph`

Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `graph`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"maxDepth":3}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to root the graph at"
    },
    "maxDepth": {
      "type": "number",
      "description": "traversal depth bound (default 3)"
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Per-symbol dependency graph: callers and callees
- Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence
- Declared truncation with a reason when the traversal is bounded

## Examples

`{"symbol":"handleRequest"}`

`{"symbol":"handleRequest","maxDepth":5}`

## Errors

- Missing symbol
- maxDepth outside the declared 1-10 range
- Symbol not found in the index

## Limitations

- Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven
- The graph reflects the index as of the last index run

## Performance

maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier and confidence.

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
