# `bb_impact`

Bounded reverse-dependency impact for one symbol via the same component the editor graph panel uses: declared node budget (200) and depth (5), truncation as a first-class field with reason, and an independently declared total when computable. Unknown symbols are loud declared errors — an empty impact set is never invented. Owner-cascade applies: impact includes dependents attributed at class level, not only exact-symbol rows.

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
      "description": "symbol name to compute impact for (`target`/`symbolName`/`query` are accepted as aliases)"
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
- Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class

## Performance

Traversal bounds match the canonical graph engine limits; output scales with the dependents subgraph.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Impact derives from brain_relationship rows via the same engine the editor impact panel uses.

## Relationship to other tools

This is the bounded-impact specialist; `bb_analyze` mode `impact` aggregates the same canonical walk with file-level risk — the numbers are identical by gate.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
