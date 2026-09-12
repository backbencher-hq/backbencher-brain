# `bb_annotations`

Read annotations for a symbol (or all annotations up to the declared limit) with full provenance on every row: author class, tool identity, and timestamps. No annotations is a declared absence, never an error. To write a note use bb_annotate.

## Contract

- Category: `annotations`
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
      "description": "symbol name (omit to list all annotations); `target`/`query` are accepted as aliases"
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

Rows come from brain_annotation with provenance fields preserved.

## Relationship to other tools

To write a note use `bb_annotate`; this tool reads stored annotations and declares absence.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
