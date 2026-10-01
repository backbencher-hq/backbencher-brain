# `bb_analyze`

Unified evidence-backed analysis over graph relationships, dependencies, statistics, complexity, impact, and test intelligence. Select exactly one mode. Every read mode carries a freshness block (fresh/stale/missing counts + remediation) resolved against the live working tree; graph nodes and report rows carry a stale flag when their file changed after indexing. Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class. Per-mode parameters: target applies to callers, callees, trace, complexity, impact, and test_impact; filePath scopes dependencies, test_mapping, test_gaps, and test_quality to a project-relative path prefix (others ignore it); stats is always project-wide.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":20}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "callers",
        "callees",
        "trace",
        "dependencies",
        "stats",
        "complexity",
        "impact",
        "test_mapping",
        "test_gaps",
        "test_impact",
        "test_quality"
      ],
      "description": "analysis mode"
    },
    "target": {
      "type": "string",
      "description": "symbol or analysis target (`symbol`/`symbolName`/`query` are accepted as aliases)"
    },
    "filePath": {
      "type": "string",
      "description": "file scope for file-based analysis"
    },
    "limit": {
      "type": "number",
      "description": "result limit"
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Mode-specific typed analysis
- Graph, dependency, complexity, impact, or test evidence
- Explicit unavailable and truncation states

## Examples

`{"mode":"callers","target":"handleRequest"}`

`{"mode":"complexity","target":"src/api"}`

`{"mode":"test_quality"}`

## Errors

- Missing required mode
- Missing target for a target-based mode
- Option irrelevant to the selected mode

## Limitations

- Static relationships cannot establish runtime behavior
- Test results describe indexed static evidence, not executed coverage
- Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class
- The callers/callees/trace modes bound each edge query by a declared per-symbol site limit (200) and report it in `summary.truncated` / `summary.truncationReason` with the root's true count in `summary.callersIfUncapped`; `summary.totalCallers` is the returned count, never a silent total (M59.A12, #888)

## Performance

Mode-specific limits and graph traversal bounds prevent unbounded output.

## Safety

Read-only. Analysis never creates tests or edits source.

## Evidence Semantics

Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications.

## Relationship to other tools

For the plain per-symbol call graph use `bb_graph` (same engine, evidence tiers). For bounded impact-with-files use mode `impact` (numbers identical to `bb_impact`).

## Staleness

Freshness modes (registered as `freshnessModes`): `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`. Staleness surfaces as: `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`); graph nodes and report rows carry `stale` flags (project-wide modes sample or resolve visible rows only — the block names its coverage mode). When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
