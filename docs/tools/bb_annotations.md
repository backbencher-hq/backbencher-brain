# `bb_annotations`

Read annotations for a symbol (or all annotations up to the declared limit) with full provenance on every row: author class, tool identity, and timestamps. No annotations is a declared absence, never an error.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `false`
- Modes: `annotate`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":50}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name (omit to list all annotations)"
    },
    "limit": {
      "type": "number",
      "description": "max rows returned (default 50, cap 200)"
    }
  },
  "required": []
}
```

## Returns

- Typed annotations for a symbol or the whole project, with full provenance (author class, tool identity, timestamps)
- Declared-absent result when none exist — absence is never an error

## Examples

`{"symbol":"handleRequest"}`

`{"limit":100}`

## Errors

- limit outside the declared 1-200 range

## Limitations

- Reads only stored annotations; absence is declared, not inferred
- Annotation store semantics are owned by the M28 workstream

## Performance

Indexed lookup by project and symbol (brain_annotation_project_symbol_idx).

## Safety

Read-only. It does not modify source files, index data, or annotations.

## Evidence Semantics

Rows come from brain_annotation with provenance fields preserved. Stable today: typed reads per symbol or whole project with full provenance on every row and declared absence when none exist. Store semantics beyond this surface are owned by the M28 workstream.

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
