# `bb_migrate`

Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases. Plans whose source file changed since the last index are flagged stale up front — a plan is a claim about current code; JSON output carries the freshness block.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `plan`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"format":"text"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbolName": {
      "type": "string",
      "description": "legacy single symbol alias"
    },
    "symbolNames": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "one or more symbols to migrate"
    },
    "targetLanguage": {
      "type": "string",
      "description": "e.g. rust, go, python"
    },
    "format": {
      "type": "string",
      "enum": [
        "text",
        "json"
      ],
      "description": "output format (default text)"
    }
  },
  "required": [
    "targetLanguage"
  ]
}
```

## Returns

- Dependency-ordered migration plans
- Effort methodology, library mappings, and risks
- Explicit unsupported and truncation results

## Examples

`{"symbolName":"handleRequest","targetLanguage":"go"}`

`{"symbolNames":["parse","handle"],"targetLanguage":"rust","format":"json"}`

## Errors

- Missing targetLanguage
- No symbolName or symbolNames
- Unknown option

## Limitations

- Plans are estimates, not translated source
- Library mappings are advisory and unsupported routes remain explicit
- Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; edge cases that the analyzers cannot resolve (reflection, dynamic dispatch, or cross-file relations the grammar does not model) limit the completeness of the resulting plan

## Performance

Requests are capped at 100 symbols and dependency traversal is bounded.

## Safety

Read-only. It does not generate, replace, or compile target-language source.

## Evidence Semantics

Dependency ordering comes from indexed relationships; effort and mappings are labeled methodology-driven estimates.

## Relationship to other tools

For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations.

## Staleness

Freshness modes (registered as `freshnessModes`): `plan`. Staleness surfaces as: per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
