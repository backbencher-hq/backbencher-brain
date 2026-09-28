# `bb_graph`

Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent. Traversal semantics: a relationship stored against any member of a class (a method call, an inherited behavior) is attributed to the owner class, so caller/callee sets include the owner-family level — every edge still traces to a stored relationship row.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `graph`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"maxDepth":3}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to root the graph at (`target`/`symbolName`/`query` are accepted as aliases)"
    },
    "maxDepth": {
      "type": "number",
      "description": "traversal depth bound (default 3)"
    },
    "edgeLimit": {
      "type": "number",
      "description": "Per-symbol call-site limit for one edge query (default 200, max 5000). Reaching it is declared in `summary.truncated` with `summary.truncationReason` and the root's true count in `summary.callersIfUncapped`/`callersIfUncapped` — the limit is never a silent cap. Raise it to receive more sites in one answer."
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Per-symbol dependency graph: callers and callees
- Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence
- Per-edge call-site address (M62.A2): `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0
- Declared truncation with a reason when the traversal is bounded

## Examples

`{"symbol":"handleRequest"}`

`{"symbol":"handleRequest","maxDepth":5}`

## Errors

- Missing symbol
- maxDepth outside the declared 1-10 range
- Symbol not found in the index

## Limitations

- Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven
- The graph reflects the index as of the last index run
- Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches — every edge still traces to a stored relationship row
- Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)
- `summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). Before M59.A12 (#888) the limit was silent: a symbol with 3,437 call sites answered 200 rows with `truncated: false`

## Performance

maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier and confidence. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed — verified against an independent SQL count on real repos (validation/m59/results/cap-real-corpus.json).

## Relationship to other tools

For richer analysis (dependencies, complexity, tests, impact aggregation) use `bb_analyze`; for plain callers/callees with evidence tiers this is the tool.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
