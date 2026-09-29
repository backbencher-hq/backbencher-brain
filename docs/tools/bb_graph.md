# `bb_graph`

Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent. Traversal semantics: a relationship stored against any member of a class (a method call, an inherited behavior) is attributed to the owner class, so caller/callee sets include the owner-family level — every edge still traces to a stored relationship row.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `graph`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"maxDepth":3,"direction":"both"}`

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
    "direction": {
      "type": "string",
      "enum": [
        "callers",
        "callees",
        "both"
      ],
      "description": "which side to traverse (default both). 'callers' answers \"who depends on this\" and skips the callee walk entirely — on a real index that is the difference between 1 edge and 37 in the same payload."
    },
    "relationshipTypes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "stored relationship kinds to include. Default: calls, instantiates, extends, implements. Pass e.g. ['calls'] for the pure call graph, or ['implements'] to see only interface satisfaction. A kind that is not listed is never reported, so this is how you exclude the type-level 'uses'/'references' rows that make up roughly half of what a typical index stores."
    },
    "includeCrossLanguage": {
      "type": "boolean",
      "description": "include edges the indexer marked cross-language (default true). Set false for a single-language view."
    },
    "edgeLimit": {
      "type": "number",
      "description": "Per-symbol call-site limit for one edge query (default 200, max 5000). Reaching it is declared in `summary.truncated` with `summary.truncationReason` and the root's true count in `summary.callersIfUncapped`/`summary.calleesIfUncapped` — the limit is never a silent cap. Raise it to receive more sites in one answer."
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Per-symbol dependency graph: callers and callees
- Per-edge endpoints as described nodes — `{ id, name, symbolType, file, line, isExternal }` on BOTH ends, so an edge is self-contained and no id has to be parsed or looked up in a second call
- Per-edge `rowId`: the stored `brain_relationship` row the edge came from, so every claim is auditable against the index (measured: every emitted rowId resolves to exactly one stored row)
- Per-edge `match` (`exact` | `owner-cascade`) and `matchedMember` (`{ name, file }` when the cascade matched): whether the stored row names the symbol that was asked for, or one of its members folded onto it
- Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence
- Per-edge call-site address (M62.A2): `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0
- `summary.exactCallers` / `cascadedCallers` / `exactCallees` / `cascadedCallees`: how much of the answer is about the symbol that was asked for and how much the owner cascade folded in
- `summary.edgesInBothDirections`: stored rows present in both the caller and the callee list — `totalCallers + totalCallees` double-counts exactly this many
- `root.candidates`: how many stored symbols the requested name resolved among — 1 means the name was unique, more means the answer is about one of several and `root` is what to confirm
- `summary.scope`: the `direction`, `relationshipTypes` and `includeCrossLanguage` actually applied, so a narrowed traversal returning zero edges is distinguishable from a widened one that found nothing
- Declared truncation with a reason when the traversal is bounded

## Examples

`{"symbol":"handleRequest"}`

`{"symbol":"handleRequest","maxDepth":5}`

`{"symbol":"handleRequest","direction":"callers"}`

`{"symbol":"Handler","relationshipTypes":["calls"]}`

## Errors

- Missing symbol
- maxDepth outside the declared 1-10 range
- edgeLimit below 1
- direction outside callers|callees|both
- relationshipTypes given as an empty list (a narrowed traversal that can match nothing is refused rather than silently returning an empty graph)
- Symbol not found in the index

## Limitations

- Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven
- The graph reflects the index as of the last index run
- Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches. The superset is REDUCIBLE: every edge carries `match` (`exact` or `owner-cascade`) and, when cascaded, `matchedMember` naming the member the stored row actually referenced, and the summary carries the exact/cascade split. Measured on cobra, `Command` (182 methods) answers with 184 caller edges of which 24 name `Command` itself — a ratio no per-edge field alone makes obvious, and one no count in the payload revealed before the split existed. Every edge also carries the `rowId` it traces to
- A symbol name is not a unique identifier. When one name matches several stored symbols the resolver takes the highest-gravity match (ties broken by lowest id, so the pick is reproducible rather than SQLite's whim) and says how many it chose between in `root.candidates` — measured: `build` in lodash resolves among 7, `code_block.go` in cobra among 50, `Command` among 1. When `root.candidates` is greater than 1 the graph is about ONE of those symbols, so confirm `root` is the one you meant before reading the edges. The other candidates are not listed
- A name containing a SQL LIKE wildcard (`%`, `_`) is matched LITERALLY, not as a pattern: it either resolves to a symbol that genuinely contains those characters or is reported not found. It never widens into a match on an unrelated symbol
- Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)
- `summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). Before M59.A12 (#888) the limit was silent: a symbol with 3,437 call sites answered 200 rows with `truncated: false`. The cap now fires only when rows were ACTUALLY dropped: the query asks for one row beyond the limit, so a symbol holding exactly `edgeLimit` sites is reported complete instead of falsely truncated

## Performance

maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph. `direction` halves the work when only one side is wanted — measured on cobra, a caller-only question about a symbol with 36 callees returned 1 edge instead of 37. The per-direction fan-out budget (50 symbols) is internal and is not exposed: truncation is declared in the summary when it bites.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier, its confidence, and the `rowId` of the row it came from. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed — verified against an independent SQL count on real repos (validation/m59/results/cap-real-corpus.json). Owner-cascade edges are auditable in the same way: `match` and `matchedMember` identify the member the stored row actually named, and the exact/cascade split in the summary is verified against an independent SQL count of direct-target rows on real repos (cobra: tool reports `exactCallers: 24`; oracle counts 24 direct caller rows for the same symbol).

## Relationship to other tools

For richer analysis (dependencies, complexity, tests, impact aggregation) use `bb_analyze`; for plain callers/callees with evidence tiers this is the tool.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
