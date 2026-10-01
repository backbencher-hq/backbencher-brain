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
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "project-relative file or DIRECTORY paths; every indexed symbol in them joins the request, so a whole module can be planned in one call. UNION with symbolNames, not a replacement: naming a symbol AND a path that contains it plans it once"
    },
    "symbolIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "indexed symbol ids, the ONLY unambiguous way to name a component. Use this when a refusal reported that a name matches several symbols; a name is not an identity, and two components can share one name in two files"
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

- Dependency-ordered migration plans, grouped into parallel-workable waves
- Scope completeness: how much of the cited integration surface the request actually covers
- Cohort rollup by source file and by wave
- Effort methodology, library mappings, and risks
- Explicit unsupported and truncation results, naming the symbols the cap dropped

## Examples

`{"symbolName":"handleRequest","targetLanguage":"go"}`

`{"symbolNames":["parse","handle"],"targetLanguage":"rust","format":"json"}`

`{"paths":["src/api"],"targetLanguage":"go"}`

`{"symbolIds":["sym_01H..."],"targetLanguage":"go"}`

## Errors

- Missing targetLanguage
- No symbolName, symbolNames or paths
- A path that matches no indexed file (the tool says so rather than returning an empty plan set)
- Unknown option

## Limitations

- Plans are estimates, not translated source
- Library mappings are advisory and unsupported routes remain explicit
- Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; edge cases that the analyzers cannot resolve (reflection, dynamic dispatch, or cross-file relations the grammar does not model) limit the completeness of the resulting plan
- The index records no per-file imports, so a component's library dependencies are UNKNOWN rather than empty; this is stated on every affected plan
- A request names a bounded set of symbols, and the cited integration surface is usually much larger: measured 98.6-99.8% out of scope on cobra for requests of 1-16 symbols. The `scope` block reports this on every result
- 56 of 486 dictionary rows (11.5%) are not import specifiers — API idioms, a framework, Flutter widget class names, display names with a space, and a mis-keyed dart->typescript block — so they cannot be reached by an import lookup. Audited by script/m20/verify-migration-dictionary.ts

## Performance

Work is bounded by the requested symbols' own fan-in and fan-out, not by repository size. A request is capped at 100 symbols; the dropped names are reported in `truncation.cappedNames`.

## Safety

Read-only. It does not generate, replace, or compile target-language source.

## Evidence Semantics

Dependency ordering comes from indexed relationships; effort and mappings are labeled methodology-driven estimates. Relationship line, confidence, cross-language flag and bridge mechanism are read from the index; none is synthesized.

## Relationship to other tools

For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations.

## Staleness

Freshness modes (registered as `freshnessModes`): `plan`. Staleness surfaces as: per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
