# `bb_annotate`

Attach an agent-authored annotation to a symbol in the shared index. Provenance is enforced: the row records author class 'agent' (never spoofable), the calling tool identity, and timestamps. Re-annotating the same symbol+path updates the note in place — one note per author per location. Annotations are opinions layered on evidence, never index facts, and surface in the editor where the human reads (hover + graph). To change source code use bb_edit; to read notes back use bb_annotations.

## Contract

- Category: `annotations`
- Mutability: `write`
- Requires index: `false`
- Modes: `annotate`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to annotate (`target`/`query` are accepted as aliases)"
    },
    "body": {
      "type": "string",
      "description": "annotation text (max 2000 chars)"
    },
    "path": {
      "type": "string",
      "description": "optional file path to disambiguate same-named symbols"
    },
    "toolIdentity": {
      "type": "string",
      "description": "optional name of the calling agent/tool (recorded verbatim)"
    }
  },
  "required": [
    "symbol",
    "body"
  ]
}
```

## Returns

- Stored annotation id and provenance (tool identity, timestamp)
- Declared refusals for missing symbol, empty body, or over-limit body

## Examples

`{"symbol":"handleRequest","body":"Legacy auth path — scheduled for removal in Q3."}`

## Errors

- Missing or unknown symbol
- Empty body (a refusal, not a silent no-op)
- Body exceeds the declared 2000-char limit

## Limitations

- Annotations are opinions layered on index evidence, never index truth
- Annotation store semantics are owned by the M28 workstream

## Performance

Constant-time store write bounded by the 2000-char body limit.

## Safety

Write-capable against the annotation store only. It never modifies source files.

## Evidence Semantics

Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation.

## Relationship to other tools

To change source code use `bb_edit`; this tool stores provenance-enforced notes on symbols.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
