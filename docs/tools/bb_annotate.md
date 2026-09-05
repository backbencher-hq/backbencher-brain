# `bb_annotate`

Attach an agent-authored annotation to a symbol in the shared index. Provenance is enforced: the row records author class 'agent' (never spoofable), the calling tool identity, and timestamps. Re-annotating the same symbol+path updates the note in place — one note per author per location. Annotations are opinions layered on evidence, never index facts, and surface in the editor where the human reads (hover + graph).

## Contract

- Category: `graph`
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
      "description": "symbol name to annotate"
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

Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation. Stable today: row provenance (author class, tool identity, timestamps), one note per author per location, in-place update on re-annotate, and declared absence on reads. Store semantics beyond this surface are owned by the M28 workstream.

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
