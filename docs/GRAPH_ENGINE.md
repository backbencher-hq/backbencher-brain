# Graph Engine Reference (M9.06)

A single bounded, symbol-ID-keyed traversal engine
(`src/intelligence/graph/graph-engine.ts`) powers all relationship analysis:
callers, callees, both-direction traces, and architectural flow. It replaces
several divergent traversal implementations.

## Public entry point

`graphTraversal(projectId, name, options)` resolves `name` to its
highest-gravity symbol (exact match, then fuzzy `LIKE`), then traverses.

### Options (`GraphTraversalOptions`)

| Option | Default | Meaning |
| --- | --- | --- |
| `direction` | `"both"` (adapter-dependent) | `callers`, `callees`, or `both` |
| `maxDepth` | 5 (max 10) | Transitive traversal depth |
| `relationshipTypes` | `calls, instantiates, extends, implements` | Edge types to follow |
| `includeCrossLanguage` | include all | `false` excludes cross-language edges |
| `callerBudget` / `calleeBudget` | 50 each | Independent fan-out budgets per direction |

## Result (`GraphTraversalResult`)

- `root`: the resolved `GraphNode`.
- `callers` / `callees`: arrays of `GraphEdge`.
- `nodes`: id → `GraphNode` map (deduplicated).
- `summary`: `totalCallers`, `totalCallees`, `maxDepthReached`,
  `crossLanguageEdges`, `truncated`, `truncationReason`.

### GraphNode

`id` (symbol id, or `ext:<name>` for unresolved externals), `name`,
`symbolType`, `file`, `filePath`, `line`, `lineEnd`, `language`, `complexity`,
`isExternal`.

### GraphEdge

`from`, `to` (node ids), `relationshipType`, `confidence`, `isCrossLanguage`,
`bridgeMechanism`, `callSite`, `depth`.

## Semantics & correctness invariants

- **Call-site = source location.** A callee edge's `callSite` is the file/line
  where the call is *written* (the source symbol), not the target's file. The
  previous implementation reported the target file for callees — corrected here.
- **Independent budgets.** Callers and callees each have their own fan-out
  budget, so tracing one direction can never starve the other (the old shared
  budget could).
- **Edge metadata preserved.** Relationship type, confidence, cross-language
  flag, and bridge mechanism are carried on every edge.
- **Cycle handling.** A per-direction `visited` set makes self-recursive and
  cyclic graphs terminate deterministically.
- **External nodes.** Unresolved targets become `ext:<name>` nodes with
  `isExternal: true`; they have no outgoing edges.
- **Truncation is explicit.** When a budget is exhausted, `truncated` is true
  and `truncationReason` names the budget.

## Performance

The class→method cascade uses an indexed range predicate
(`owner_symbol_id >= prefix AND < prefix||';'`) via `IN (subquery)` so SQLite
uses composite indexes rather than a `LIKE` full scan. Per-query row limits and
per-direction budgets bound total work regardless of index size.

## Adapters

- `BrainTools.traceFunctionCalls` — legacy shape reconstructed from engine edges.
- `BrainTools.getFunctionCallers` / `getFunctionCallees` — internal/library
  wrappers; MCP graph access is through `bb_analyze` callers/callees/trace modes.
- `BrainTools.explainFlow` — architectural flow view; `downstream`→callees,
  `upstream`→callers, `both`→both. Rebuilt over the engine (previously queried
  obsolete `layer`/`system` columns).

## Verification

`script/verify-graph.ts` builds an `alpha → beta → gamma` chain plus a
self-recursive function and asserts: direction, source-side call sites, edge
type/confidence, direction isolation, transitive reach, cycle termination,
relationship-type filtering, truncation metadata, and unknown-symbol errors.
