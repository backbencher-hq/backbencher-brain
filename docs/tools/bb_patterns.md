# `bb_patterns`

Detect orphaned code, framework patterns, and anti-patterns, with staleness markers when a finding's file changed after indexing. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters. Architecture and code-quality analysis are planned, not yet executable.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `orphaned`, `all`
- Planned modes (roadmap, not executable): `quality`, `architecture`
- Defaults: `{"scope":"all","limit":20,"includeOrphaned":true,"includeFramework":true,"includeAntiPatterns":true,"confidenceThreshold":0.6,"history":false,"recordRun":false}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "orphaned",
        "all"
      ],
      "description": "orphaned only, or all pattern classes (default all)"
    },
    "limit": {
      "type": "number",
      "description": "max results (default 20)"
    },
    "includeOrphaned": {
      "type": "boolean",
      "description": "include orphaned-code patterns in an all scan (default true)"
    },
    "includeFramework": {
      "type": "boolean",
      "description": "include framework patterns (default true)"
    },
    "includeAntiPatterns": {
      "type": "boolean",
      "description": "include anti-patterns (default true)"
    },
    "confidenceThreshold": {
      "type": "number",
      "description": "minimum confidence 0..1 (default 0.6)"
    },
    "history": {
      "type": "boolean",
      "description": "return persisted pattern history"
    },
    "recordRun": {
      "type": "boolean",
      "description": "persist this scan as an analysis run"
    }
  }
}
```

## Returns

- Pattern findings with confidence and locations
- Orphan, framework, and anti-pattern classifications
- Optional persisted run history

## Examples

`{"scope":"orphaned"}`

`{"recordRun":true}`

## Errors

- Invalid scope or confidence threshold
- Unavailable index
- Unknown option

## Limitations

- Orphan status is static incoming-reference evidence, not proof that code is unused
- Framework and anti-pattern detection is heuristic and confidence-qualified
- Candidates are derived from analyzer-extracted symbols and relationships; the same graph gaps (dynamic/reflection wiring, unresolved cross-file references) that limit the analyzers also constrain these detections

## Performance

The result limit and confidence threshold bound reporting; history access is separately limited.

## Safety

Source is read-only. recordRun writes only analysis-history records in the brain database.

## Evidence Semantics

Every finding is confidence-qualified and tied to indexed files, symbols, or relationships.

## Relationship to other tools

For security-specific taint findings use `bb_security`; this tool covers orphans, framework patterns, and anti-patterns.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
