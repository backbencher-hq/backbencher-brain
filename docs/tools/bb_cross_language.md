# `bb_cross_language`

Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Pairs with no stored rows are declared absent — this tool never infers, guesses, or aspires. Identical semantics to the editor's cross-language hover section.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `cross-language`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to fetch cross-language facts for (`target`/`symbolName`/`query` are accepted as aliases)"
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Cross-language relationship pairs for the symbol with bridge mechanism and evidence tier
- Declared-absent result when no stored cross-language rows exist

## Examples

`{"symbol":"Warehouse"}`

## Errors

- Missing symbol
- Symbol not found in the index (declared, not an empty set)

## Limitations

- Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts
- Coverage depends on the analyzers that produced cross-language rows

## Performance

Bounded by the stored cross-language rows for the symbol; no graph traversal.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Only brain_relationship rows with is_cross_language=1; identical semantics to the editor cross-language hover section.

## Relationship to other tools

For same-language callers/callees use `bb_graph`; this tool reports cross-language pairs and bridges (declared absent when none).

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
