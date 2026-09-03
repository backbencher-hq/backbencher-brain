# `bb_visualize`

Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and self-contained HTML. Every node and link carries a stale flag (file changed since index); links inherit worst-of-endpoints; a freshness envelope rides the JSON output.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `project`, `file`, `module`, `symbol`, `feature`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"scope":"project","maxNodes":200,"maxLinks":5000,"format":"text"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "project",
        "file",
        "module",
        "symbol",
        "feature"
      ],
      "description": "graph scope (default project)"
    },
    "target": {
      "type": "string",
      "description": "file, module, symbol, or feature target"
    },
    "maxNodes": {
      "type": "number",
      "description": "max nodes (default 200)"
    },
    "maxLinks": {
      "type": "number",
      "description": "max links (default 5000)"
    },
    "relationshipTypes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "relationship type filter"
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "language filter"
    },
    "format": {
      "type": "string",
      "enum": [
        "text",
        "json",
        "html"
      ],
      "description": "output format (default text)"
    }
  }
}
```

## Returns

- Canonical nodes and links
- Text, JSON, or self-contained HTML projection
- Provenance and explicit truncation metadata

## Examples

`{"scope":"symbol","target":"handleRequest","format":"json"}`

`{"scope":"module","target":"src/api","format":"html"}`

## Errors

- Missing target for a scoped graph
- Unsupported scope or format
- Unavailable index

## Limitations

- The graph reflects static indexed relationships
- Nodes and links beyond configured budgets are omitted and reported

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
