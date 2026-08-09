# `bb_patterns`

Detect orphaned code, framework patterns, anti-patterns, and architecture issues. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `orphaned`, `all`
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

## Performance

The result limit and confidence threshold bound reporting; history access is separately limited.

## Safety

Source is read-only. recordRun writes only analysis-history records in the brain database.

## Evidence Semantics

Every finding is confidence-qualified and tied to indexed files, symbols, or relationships.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
