# `bb_cross_language`

Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Every fact names both ends — the copy of the requested name it came from and the other symbol's name, file, language and line — plus the stored row id. A name is many symbols (the index holds one per file/name/line), so facts are the union over every copy; `copies` names them and `ambiguous` says so. SEPARATELY, `memberFacts` holds the rows on the copies' MEMBERS, each marked `match: 'owner-cascade'` with `matchedMember` naming the member: 95% of stored cross-language rows target a member, so a class often has none of its own, and those rows are reported as the MEMBER's edges rather than absorbed into the symbol's — `ownFactCount`, `memberFactCount` and `silentItselfButNotItsMembers` tell the two apart. Absence is declared only when neither the copies nor their members hold a stored row. The answer is bounded by `limit` (default 200, max 1000) with `truncated` and `totalCountIfKnown` declared. This tool never infers, guesses, or aspires. Same source and laws as the editor's cross-language hover section.

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

- One fact per stored cross-language row about the name. `facts` holds the rows on the copies themselves; `memberFacts` holds the rows on their MEMBERS, each marked `match: "owner-cascade"` with `matchedMember` and `matchedMemberId` naming the member. Every fact names both ends — `self` (symbol, file, language, line) and `other` — plus the stored `rowId`, direction, bridge, evidence tier and confidence
- `copies`: every indexed symbol carrying the name, with file, language, line and cross-row count, plus `ambiguous` and `ambiguityNote`
- `ownFactCount` and `memberFactCount` separately, so a reader can tell a symbol that is itself connected from one that is connected only through its members — and `silentItselfButNotItsMembers` when that is the case
- Declared absence only when NEITHER the copies nor their members hold a stored row, with `absenceNote` saying so
- Declared truncation: `truncated`, `truncationReason` and `totalCountIfKnown` when the `limit` bounded the answer; `unpairableRowCount` and `collapsedRowCount` report rows that could not name a pair and rows matched from both sections

## Examples

`{"symbol":"Warehouse"}`

`{"symbol":"Iterate"}`

`{"symbol":"invoke","limit":50}`

## Errors

- Missing or blank symbol
- Symbol not found in the index (declared, not an empty set)
- limit outside the declared 1..1000 range (refused, never clamped silently)

## Limitations

- Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts
- Coverage depends on the analyzers that produced cross-language rows — this tool reports what was stored, nothing more
- A name is many symbols: the answer is the UNION over every copy, never a silent choice among them. Narrow with the `copies` list — every fact names the copy it came from
- MEMBER ROWS ARE REPORTED, NOT ABSORBED. 95.4% of stored cross-language rows target a member rather than a class or namespace, so a by-name answer for an owner finds almost nothing on the owner itself. Those rows appear in `memberFacts`, attributed to the member, because an edge on `Label.newLabel` is not an edge on `Label`. bb_graph answers the same question by CASCADING member edges onto the owner, so its count is larger: its cascade is a lexical id-prefix range, this tool's is the store's `owner_symbol_id`. Both are declared; neither is reconciled into the other
- `bridge` is the stored `bridge_mechanism`. On a real polyglot corpus it is almost always the indexer's `name-resolution` placeholder, which means two identifiers matched by name — not that the two languages communicate by that mechanism. Weigh it with `tier` and `confidence`
- A row whose endpoint file has no detected language cannot name a pair; those rows are counted in `unpairableRowCount` and never dressed up with a guessed language
- Over half of the stored cross-language rows on the measured corpus carry no analyzer evidenceClass, so their tier is derived by the shared rule rather than claimed by the analyzer

## Performance

Three indexed queries — the stored rows for the name, the rows on its members, and every symbol carrying the name — with no graph traversal. Measured on a 230-file JVM corpus: the mean answer is 7 facts and 7.5KB, p90 is 12 facts, and the response is bounded by `limit`. For scale, `bb_graph` returns 3-8x more bytes for the same symbols, and on owner-heavy symbols it took 29-79s where this tool takes 14-53ms.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Only brain_relationship rows with is_cross_language=1, filtered by the row's own project_id, classified by the single evidence-tier rule in src/lsp/evidence_tier.ts — the same stored rows and the same rule as the editor cross-language hover section, over a projection that names both ends because a hover card already shows which file the reader is in and an agent does not. Every count is cross-checked against an independent SQL count over a real polyglot index, and nine planted defects are all caught, including three specific to the member section (cascade laundered, the pre-CL2 absence rule, and a cascade reported with no member to check it against): script/m63/verify-cl1-cross-language.ts, validation/m63/results/CL1.json.

## Relationship to other tools

For same-language callers/callees use `bb_graph`; this tool reports cross-language pairs and bridges (declared absent when none).

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
