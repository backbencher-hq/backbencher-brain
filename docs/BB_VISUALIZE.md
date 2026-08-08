# `bb_visualize` Reference

`bb_visualize` is a read-only graph projection over the canonical graph engine.
It supports `project`, `file`, `module`, `symbol`, and `feature` scopes.

## Formats

- `text` reports node/link counts, scope, truncation, and provenance.
- `json` returns `nodes`, `links`, `provenance`, and explicit `truncation` metadata.
- `html` returns the existing self-contained interactive graph artifact with the exact bounded node/link set used by JSON.

Optional `relationshipTypes`, `languages`, `maxNodes`, and `maxLinks` filters
are applied before output. Links are emitted only when both endpoints survive
the canonical graph engine and output bounds. Omitted dangling links are counted
in `provenance.omittedDanglingLinks`; they are never silently rendered.

## Examples

```json
{"scope":"symbol","target":"handleRequest","format":"json","maxNodes":100,"maxLinks":500}
```

```json
{"scope":"module","target":"src/api","format":"html"}
```

## Limitations

Feature scope uses indexed lexical feature evidence. It does not invent edges
from semantic similarity. Truncation is explicit and deterministic.
