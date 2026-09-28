# `bb_visualize`

Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and self-contained HTML. Every node and link carries a stale flag (file changed since index); links inherit worst-of-endpoints; a freshness envelope rides the JSON output. Same owner-cascade semantics as bb_graph: member-level relationships are attributed to the owner class.

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
      "description": "file, module, symbol, or feature target (`symbol`/`symbolName`/`query` are accepted as aliases)"
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
- Owner-cascade attribution: member-level relationships are attributed to the owner class, same as bb_graph

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

## Relationship to other tools

For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
