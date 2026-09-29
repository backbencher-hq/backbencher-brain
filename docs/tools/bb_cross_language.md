# `bb_cross_language`

Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Every fact names both ends: the copy of the requested name it came from, and the other symbol's name, file, language and line, plus the stored row id. A name is many symbols — the index holds one per (file, name, line) — so facts are the union over every copy, `copies` names them, and `ambiguous` says so; absence is declared only when no copy holds a stored row. The answer is bounded by `limit` (default 200, max 1000) with `truncated` and `totalCountIfKnown` declared. Pairs with no stored rows are declared absent — this tool never infers, guesses, or aspires. Same source and laws as the editor's cross-language hover section.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `cross-language`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":200}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to fetch cross-language facts for (`target`/`symbolName`/`query` are accepted as aliases)"
    },
    "limit": {
      "type": "number",
      "description": "max facts to return (default 200, max 1000); truncation is declared, never silent"
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

`{"symbol":"invoke","limit":50}`

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
