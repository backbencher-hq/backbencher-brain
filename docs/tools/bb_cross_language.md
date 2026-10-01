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

- One fact per stored cross-language row touching the name, each naming BOTH ends — the copy of the requested name it came from (`self`: symbol, file, language, line) and the counterparty (`other`: symbol, file, language, line) — plus the stored `rowId`, the direction, the bridge, the evidence tier and the confidence
- `copies`: every indexed symbol that carries the name, with its file, language, line and cross-row count, plus `ambiguous` and `ambiguityNote` when the index holds more than one (the index has one symbol per file/name/line, so a common name is many symbols)
- Declared absent only when NO copy of the name holds a stored cross-language row, with the copy count in the note
- Declared truncation: `truncated`, `truncationReason` and `totalCountIfKnown` when the `limit` bounded the answer; `unpairableRowCount` and `collapsedRowCount` report rows that could not name a pair and rows matched from both directions

## Examples

`{"symbol":"Warehouse"}`

`{"symbol":"invoke","limit":50}`

## Errors

- Missing or blank symbol
- Symbol not found in the index (declared, not an empty set)
- limit outside the declared 1..1000 range (refused, never clamped silently)

## Limitations

- Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts
- Coverage depends on the analyzers that produced cross-language rows — this tool reports what was stored, nothing more
- A name is many symbols: the answer is the UNION over every copy, never a silent choice among them. Narrow with the `copies` list — every fact names the copy it came from
- `bridge` is the stored `bridge_mechanism`. On a real polyglot corpus it is almost always the indexer's `name-resolution` placeholder, which means two identifiers matched by name — not that the two languages communicate by that mechanism. Weigh it with `tier` and `confidence`
- A row whose endpoint file has no detected language cannot name a pair; those rows are counted in `unpairableRowCount` and never dressed up with a guessed language

## Performance

Two indexed queries (the stored cross-language rows for the name, and every symbol carrying the name), no graph traversal; the response is bounded by `limit` and declares what it dropped.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Only brain_relationship rows with is_cross_language=1, filtered by the row's own project_id, classified by the single evidence-tier rule in src/lsp/evidence_tier.ts — the same stored rows and the same rule as the editor cross-language hover section, over a projection that names both ends because a hover card already shows which file the reader is in and an agent does not. Every count is cross-checked against an independent SQL count over a real polyglot corpus (script/m63/verify-cl1-cross-language.ts, validation/m63/results/CL1.json).

## Relationship to other tools

For same-language callers/callees use `bb_graph`; this tool reports cross-language pairs and bridges (declared absent when none).

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
