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
    "timeBudgetMs": {
      "type": "number",
      "description": "wall-clock budget for the whole walk in milliseconds (default 2000; 0 disables it). This is the one bound that is a function of the CLOCK rather than of the data, so a run that hits it can return fewer edges than an otherwise identical run moments later — `summary.timeBudgetExhausted` says when. Raise it, or set 0 to accept the runtime, when you need the whole set or a reproducible answer"
    },
    "maxEdges": {
      "type": "number",
      "description": "hard cap on the number of edges in the WHOLE answer, across both directions and all depths (default 1000, max 5000). `edgeLimit` bounds one query and this bounds the answer; their product is what a caller receives. Reaching it is declared as `total-edge-limit` with the value in `summary.maxEdges`. Raise it for a hub symbol, lower it for a quick shape check"
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
- Per-edge `rowId`: the stored `brain_relationship` row the edge came from, so every claim is auditable against the index (measured: every emitted rowId resolves to exactly one stored row, and the edge's endpoints agree with that row)
- Endpoints the index could not resolve as `ext:<name>` nodes, with `isExternal: true` — a recorded name, never a symbol guessed from that name
- Per-edge `match` (`exact` | `owner-cascade`) and `matchedMember` (`{ name, file }` when the cascade matched): whether the stored row names the symbol that was asked for, or one of its members folded onto it
- Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence
- Per-edge call-site address (M62.A2): `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0
- `summary.edgesByType`: the composition of the RETURNED edges by stored relationship kind, counted from the emitted edges. The default filter covers every stored kind, so an answer is usually not all call edges — measured: lodash `baseConvert` 99 of 230, cobra `getCompletions` 36 of 65, rake `standard_rake_options` 72 of 76. This is how you learn the ratio without walking the edges
- `summary.maxEdges` / `totalEdgeLimitReached`: the bound on the WHOLE answer, across both directions and every depth, and whether it bit. `edgeLimit` bounds one query; this bounds the answer, and their product is what a caller receives
- `summary.edgeKindPriority`: the order in which kinds survive the per-symbol site limit — dependency kinds first, then lexical, then module-level, then membership. Only observable under `truncated`, published always
- `summary.relationshipTypesUsed`: the relationship kinds this run actually searched, resolved. `summary.scope.relationshipTypes` echoes it, so the filter that produced the answer is never a restatement of a default that may have moved
- `summary.exactCallers` / `cascadedCallers` / `exactCallees` / `cascadedCallees`: DEPTH 0 only — how much of the answer is about the symbol that was asked for and how much the owner cascade folded in from its members. `deeperCallers` / `deeperCallees` hold the edges about symbols the traversal discovered, so exact + cascaded + deeper is the number of edges returned
- `summary.callerBudget` / `calleeBudget` with `callerBudgetExhausted` / `calleeBudgetExhausted`: the fan-out bound in force and whether it bit. `truncationReason` can name `caller-budget-exhausted`; this says what the budget was
- `summary.edgesInBothDirections`: stored rows present in both the caller and the callee list — `totalCallers + totalCallees` double-counts exactly this many
- `root.candidates`: how many stored symbols the requested name resolved among — 1 means the name was unique, more means the answer is about one of several and `root` is what to confirm
- `summary.maxDepth`: the depth bound this run actually used, alongside `summary.maxDepthReached`. Together they are the only way to tell "the walk finished" from "the walk stopped"
- A per-edge `depth`, which is HOW FAR THE WALK WENT before finding that row — not the shortest distance between two symbols. See Limitations
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
- maxEdges below 1
- direction outside callers|callees|both
- relationshipTypes given as an empty list (a narrowed traversal that can match nothing is refused rather than silently returning an empty graph)
- Symbol not found in the index

## Limitations

- Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven
- An edge's `depth` is the depth of the query that found its stored row, not the shortest path between the two symbols. The traversal is depth-first and the per-row dedupe is global, so the first traversal to reach a row emits it: measured, 24% of edges on cobra, 57% on lodash and 60% on rake sit deeper than the shortest path in their own answer. No edge ever claims a SHORTER path than its answer can demonstrate, so `depth` is a valid upper bound on distance - read it as 'how far the walk got', not 'how far apart these are'. Use `direction` with a smaller `maxDepth` when the distance itself matters
- The default filter covers every stored relationship kind, so an answer mixes dependency edges with lexical references (`uses`, `references`), structural membership (`contains`) and module edges (`imports`, `exports`). `contains` means owner → member: a class reporting its own methods is structure, not dependency. Filter with `relationshipTypes` for a pure call graph, or read `edgesByType`
- Every kind competes for the per-symbol site limit, and the surviving set is decided by `edgeKindPriority` — dependency kinds first. A truncated answer therefore keeps more `calls` and fewer `contains` than an untruncated one would, and the published order is the rule that decides it
- A target the index could not resolve appears as an `ext:<name>` node rather than as a symbol. That is a real gap in the index, surfaced rather than papered over: the edge `caller --calls--> ext:name` is what the store holds, and no internal symbol is substituted for it
- The graph reflects the index as of the last index run
- Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches. The superset is REDUCIBLE: every edge carries `match` (`exact` or `owner-cascade`) and, when cascaded, `matchedMember` naming the member the stored row actually referenced, and the summary carries the exact/cascade split. Measured on cobra, `Command` (182 methods) answers with 184 caller edges of which 24 name `Command` itself — a ratio no per-edge field alone makes obvious, and one no count in the payload revealed before the split existed. Every edge also carries the `rowId` it traces to
- A target the index could not resolve is reported as an `ext:<name>` node — a NAME the index saw and could not attach to a symbol — and is never resolved by matching that name against other symbols in the project. The name is not unique there (measured on vscode, `match` names 37,876 stored symbols; on svelte, `end` names 437,570), so matching it would manufacture edges the store does not contain, crowd out the resolvable callees, and seed the traversal with a guess. `ext:` nodes are leaves: there is nothing stored about them to walk into
- Two identical calls return identical answers unless the wall-clock bound fired in one of them, in which case `summary.timeBudgetExhausted` says so. Every other bound here — the per-query site limit, the fan-out budget, the total-answer bound, the depth — is a function of the data, so two identical calls on an unchanged index always agree
- A symbol name is not a unique identifier. When one name matches several stored symbols the resolver takes the highest-gravity match (ties broken by lowest id, so the pick is reproducible rather than SQLite's whim) and says how many it chose between in `root.candidates` — measured: `build` in lodash resolves among 7, `code_block.go` in cobra among 50, `Command` among 1. When `root.candidates` is greater than 1 the graph is about ONE of those symbols, so confirm `root` is the one you meant before reading the edges. The other candidates are not listed
- A name containing a SQL LIKE wildcard (`%`, `_`) is matched LITERALLY, not as a pattern: it either resolves to a symbol that genuinely contains those characters or is reported not found. It never widens into a match on an unrelated symbol
- Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)
- `summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). Before M59.A12 (#888) the limit was silent: a symbol with 3,437 call sites answered 200 rows with `truncated: false`. The cap now fires only when rows were ACTUALLY dropped: the query asks for one row beyond the limit, so a symbol holding exactly `edgeLimit` sites is reported complete instead of falsely truncated

## Performance

maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph. The answer is bounded at three levels and every level is declared: the per-query site limit (`edgeLimit`, default 200, max 5000), the fan-out budget (50 symbols per direction, `callerBudget`/`calleeBudget`) and the size of the WHOLE answer (`maxEdges`, default 1000, max 5000). The third exists because the product of the first two is not a number a reader can use: measured, ripgrep's `unwrap` returns 206 edges at depth 1, 454 at depth 3 and 702 at depth 5 - 228 KiB, 504 KiB and 770 KiB rendered. Reaching `maxEdges` is declared as `total-edge-limit` with the value in `summary.maxEdges`. A fourth bound is a wall-clock budget for the walk (`timeBudgetMs`, default 2000, 0 disables it), and it is the ONE bound here that is a function of the clock rather than of the data: a run that hits it can return fewer edges than an otherwise identical run moments later, and `summary.timeBudgetExhausted` says when. Measured, one run of cobra's busiest symbol at depth 3 rendered 526,043 bytes and the next 493,988. Raise `timeBudgetMs`, or set `0` to accept the runtime, when you need the whole set or a reproducible answer. The depth bound (`maxDepth`, paired with the `maxDepthReached` that says how far the walk actually got) is the fourth `direction` halves the work when only one side is wanted. `direction` halves the work when only one side is wanted — measured on cobra, a caller-only question about a symbol with 36 callees returned 1 edge instead of 37. The per-direction fan-out budget (50 symbols) is internal and is not exposed: truncation is declared in the summary when it bites.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier, its confidence, the `rowId` of the row it came from, and `match`/`matchedMember` saying whether the row names the traced symbol or one of its members. Every emitted rowId resolves to exactly one stored row and the edge's endpoints agree with that row — verified against an independent SQL oracle on real repositories. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed — verified against an independent SQL count on real repos (validation/m59/results/cap-real-corpus.json). Owner-cascade edges are auditable in the same way: `match` and `matchedMember` identify the member the stored row actually named, and the exact/cascade split in the summary is verified against an independent SQL count of direct-target rows on real repos (cobra: tool reports `exactCallers: 24`; oracle counts 24 direct caller rows for the same symbol).

## Relationship to other tools

For richer analysis (dependencies, complexity, tests, impact aggregation) use `bb_analyze`; for plain callers/callees with evidence tiers this is the tool.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
