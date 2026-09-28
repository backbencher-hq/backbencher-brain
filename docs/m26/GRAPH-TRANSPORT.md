# bb/graph — the graph transport (M26.W2)

The declared, versioned custom LSP request that carries graph queries between
`bb_lsp` and the webview. Owner: `src/lsp/graph_request.ts`. This document is
drift-gated by `script/m26/verify-graph-transport.ts` (method name, schema
version, error prefixes, and provider advertisement are asserted against the
code).

## Method

`bb/graph` — a custom request in the `bb/` namespace (same convention as
`bb/staleness`, the private honesty plumbing). Advertised in `initialize`
capabilities as:

```json
"graphProvider": { "schemaVersion": 2 }
```

## Schema version 2 (M44.U1: grouped usages)

Schema version 2 changes ONLY the `mode: "usages"` RESPONSE: it is grouped
per symbol (below). The `graph` mode response is unchanged from version 1.
A version-1 client is rejected loudly (`schema version mismatch`), never
served a v2 payload it would mis-render.

Request params (all keys except `schemaVersion` and `symbol` optional):

| param | type | constraint |
|---|---|---|
| `schemaVersion` | integer | must be exactly `2` |
| `symbol` | string | non-empty; symbol name to root the graph at |
| `direction` | string | `"callers"` \| `"callees"` \| `"both"` |
| `maxDepth` | integer | 1–10 (server clamps traversal to 10 regardless) |
| `mode` | string | `"graph"` (default) \| `"usages"` — M42.H5: the hub's declared profile (direction defaults to `"both"`, maxDepth to the W5 cap of 5; see docs/m42/HUB.md) |
| `relationshipTypes` | string[] | non-empty strings; defaults to the engine set |
| `includeCrossLanguage` | boolean | |

### `mode: "graph"` response

The `GraphTraversalResult` model (src/intelligence/contracts.ts) —
`root`, `callers`, `callees`, `nodes`, `provenance`, `summary`. Every edge in
`callers`/`callees` carries:

- `rowId` — the `brain_relationship` row id. **Traceability rule:** every
  rendered edge must trace to a stored row; the response is gated at the
  boundary and an edge without a row id fails the request rather than ship.
- `metadata.evidenceClass` — the stored evidence tier when the indexer wrote
  one; the webview renders tiers from this field (W4), never from guesswork.

### `mode: "usages"` response (v2: grouped, M44.U1)

The hub must understand WHO uses a symbol — and a caller legitimately owns
several stored rows (calls + instantiates + references), so a raw edge list
repeats the same symbol. The v2 usages response groups per symbol
(Understanding Rules §13.1/§13.2/§13.4/§13.5, owner: `src/lsp/graph_usages.ts`):

- `callers` / `callees` — arrays of **groups**, one per SYMBOL (identity =
  symbol id, never name): `{ symbolId, name, file, line, symbolType,
  isExternal, relationshipTypes: [{type, occurrences}], occurrences, rows }`.
- `rows[]` — every stored row behind the group, declared and traceable
  (`rowId`, `relationshipType`, `callSite`, `confidence`, `depth`, …).
  Nothing is dropped: the served row-id set equals the stored set.
- M44.U3 added the tree-parent fields to every group row: `parentSymbolId`
  + `parentName` — the true edge endpoint one hop toward the root (callers:
  the row's `to`; callees: the row's `from`; depth-0 rows parent to the root
  symbol). The hub tree nests from these and never invents a level.

- `fileLevel` — `{ imports, exports }`: file-level rows (NULL source symbol,
  module-specifier identity) in DECLARED, labeled sections — never merged
  into symbol rows, never dropped (§13.5).
- `counts` — header counts count **groups** (`callerGroups`, `calleeGroups`)
  plus row totals — the renderer's header can never disagree with the list.
- `summary` — truncation is declared (never silent); `crossLanguageGroups`
  counts groups carrying a cross-language row.

## Declared errors (loud, machine-parseable)

Every failure throws with the `bb/graph:` prefix; the server wraps it into a
JSON-RPC error response with the message intact. Clients match the prefix to
distinguish declared errors from bugs.

| condition | message shape |
|---|---|
| params not an object | `bb/graph: params must be an object carrying schemaVersion and symbol` |
| missing/mismatched version | `bb/graph: schema version mismatch — request carries …, server implements 2 …` |
| missing/empty symbol | `bb/graph: params.symbol (non-empty string) is required` |
| bad direction/maxDepth/… | `bb/graph: params.<field> must be …` |
| **unindexed workspace** | `bb/graph: workspace is not indexed — run `bb index` first …` |
| unknown symbol | `bb/graph: symbol '<name>' not found — no graph exists (declared error; run `bb index` or check the name)` |
| untraceable edge (internal) | `bb/graph: internal consistency failure — edge … has no brain_relationship row id` |

Note: a client that never sends `schemaVersion` (a legacy caller) gets the
loud version error **by design** — that is the versioning mechanism. Honest
clients read `capabilities.graphProvider.schemaVersion` before calling.

## What is NOT declared

- No batching, no subscriptions, no streaming. One request, one result.
- No server-side render payload — the webview renders from the model
  (one-renderer rule, M26.W1).
- Other languages are declared absent, never "coming soon".
