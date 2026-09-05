# `bb_impact`

Bounded reverse-dependency impact for one symbol via the same component the editor graph panel uses: declared node budget (200) and depth (5), truncation as a first-class field with reason, and an independently declared total when computable. Unknown symbols are loud declared errors — an empty impact set is never invented.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `impact`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to compute impact for"
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Downstream dependents of the symbol with per-edge evidence tiers and confidence
- Declared-absent result when the symbol is unknown — never an empty guess

## Examples

`{"symbol":"handleRequest"}`

## Errors

- Missing symbol
- Symbol not found in the index

## Limitations

- Static impact analysis cannot establish runtime behavior
- Reflects the index as of the last index run

## Performance

Traversal bounds match the canonical graph engine limits; output scales with the dependents subgraph.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Impact derives from brain_relationship rows via the same engine the editor impact panel uses.

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
