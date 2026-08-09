# `bb_analyze`

Unified evidence-backed analysis over graph relationships, dependencies, statistics, complexity, impact, and test intelligence. Select exactly one mode.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`
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
      "description": "symbol or analysis target"
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

## Performance

Mode-specific limits and graph traversal bounds prevent unbounded output.

## Safety

Read-only. Analysis never creates tests or edits source.

## Evidence Semantics

Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
