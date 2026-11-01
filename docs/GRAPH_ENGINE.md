<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference for the one bounded traversal engine behind
`bb_graph`, `bb_analyze`'s call-graph modes, `bb_impact` and the editor's graph
panel: its options, its answer shape, the declarations it must publish, and the
index/statement shapes that keep a call fast on a large index.
WHO IT IS FOR — the caller who needs to know what a traversal answer means, and
the maintainer who changes the engine's SQL.
EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/graph/graph-engine.ts
(options, defaults, declarations), src/intelligence/contracts.ts (GraphEdge /
GraphTraversalResult), docs/tools/bb_graph.md and docs/tools/bb_analyze.md,
script/verify-graph.ts, script/m65/verify-graph-plan.ts,
script/m65/verify-edge-kind-scoping.ts.
-->

# Graph engine reference

One bounded, symbol-ID-keyed traversal engine
(`src/intelligence/graph/graph-engine.ts`) powers every relationship answer in
the product. Callers and callees are separate walks with separate budgets; both
report declarations for every bound that can bite.

## Entry points

- `graphTraversal(projectId, name, options)` — resolve `name` to one stored
  symbol, then walk. Throws `Symbol '<name>' not found` when nothing resolves.
- `traverseGraph(projectId, root, options)` — walk from an already-resolved
  row (used when the caller has its own root).
- `resolveGraphRootDetailed(projectId, name)` — the three-step resolver:
  exact name among traversable structural kinds → exact name among all kinds →
  `LIKE '%name%'` containment among structural kinds. The step that won is
  returned as `match` (`exact` / `exact-any-kind` / `containment`) beside
  `candidates`, the number of rows the step chose between. `containment` means
  the answer is about a symbol whose name CONTAINS the one asked for; a case
  difference also lands there because SQLite's `LIKE` is case-insensitive for
  ASCII. A name containing `%`, `_` or `\` is escaped by value and matched
  literally.

The engine opens the index **read-only** (`getRawInstance(projectId,
{ readonly: true })`): a graph question must not mutate the index by being
asked. A project with no index is a loud error, never an empty graph.

## Options (`GraphTraversalOptions`)

| Option | Default | Meaning |
| --- | --- | --- |
| `direction` | `"both"` | `callers`, `callees`, or `both`. A one-sided walk computes only that side; each tool surface says which ran in its scope echo. |
| `maxDepth` | 5 (max 10) | Transitive traversal depth. `bb_graph` asks for 3 by default and declares it; the engine default applies when a caller passes nothing. |
| `relationshipTypes` | **every kind the index stores**: `calls`, `extends`, `implements`, `uses`, `instantiates`, `overrides`, `contains`, `references`, `imports`, `exports`, `decorates`, `renders`, `mixes_in`, `part_of` | Edge kinds to follow. Deliberately NOT narrowed: `contains` is the parent→member edge, so excluding it stops a traversal rooted at a class from reaching that class's own methods. The consequence a reader must know is composition — a `callers` set is "who has a stored edge INTO this", not only who calls it (measured: lodash `baseConvert` 99 `calls` rows of 230 edges, cobra `getCompletions` 36 of 65, rake `standard_rake_options` 72 of 76). A consumer whose claim is about ONE kind must pass a filter — `["calls"]` for the pure call graph, or `["calls", "instantiates", "extends", "implements"]` for "what breaks". A filter is a REQUEST, not a bound: it is reported through `filterNarrowed`/`filterReason` and never sets `truncated`. The kinds a run actually searched come back as `relationshipTypesUsed`. |
| `includeCrossLanguage` | include all | `false` removes edges the indexer marked cross-language, and the number removed is reported (`crossLanguageExcluded`, per direction). |
| `callerBudget` / `calleeBudget` | 50 each | Independent fan-out budgets per direction — one direction can never starve the other. Exhaustion is declared (`callerBudgetExhausted`, `calleeBudgetExhausted`). |
| `edgeLimit` | 200 (max 5000) | Per-query site limit. Reaching it is DECLARED — `truncated`, `cappedQueries`, and the root's true count as `callersIfUncapped`/`calleesIfUncapped` (`null` = not counted, never zero). The query asks for one row beyond the limit so a symbol holding exactly `edgeLimit` sites is reported complete, not falsely truncated. |
| `maxEdges` | 1000 (max 5000) | Bound on the SIZE OF THE WHOLE ANSWER, across directions and depths. Reaching it is declared as `total-edge-limit` with the applied value in `maxEdges`. A requested value below `edgeLimit` is honored, not raised. |
| `timeBudgetMs` | **0 — no clock bound** | The one bound that is a function of the clock. It is checked BETWEEN statements, never inside one: a SQLite statement cannot be interrupted, so a value is a ceiling on the walk's decisions, not on a single query. When it fires, `timeBudgetExhausted` is true and `walk-time-budget-exhausted` is among `truncationReasons`; the answer is then a declared SAMPLE. Leaving it unset keeps the answer reproducible: every other bound is a function of the data, so two identical questions on an unchanged index agree exactly. |

## Result (`GraphTraversalResult`)

- `root`: the resolved `GraphNode`.
- `rootCandidates`, `rootMatch`: which step resolved the name and how many rows
  it chose between.
- `callers` / `callees`: `GraphEdge[]`.
- `nodes`: id → `GraphNode` map, deduplicated.
- `provenance`: `evidenceClass: "inferred"` for the ANSWER (root resolution, the
  owner cascade, the noise policy and any cap are constructions over stored
  rows), with an `unknowns` list for each filter or blind spot that removed
  rows. Per-row evidence is on each edge.
- `summary`: every declaration below.

### GraphNode

`id` (symbol id, or `ext:<name>` for an unresolved target), `name`,
`symbolType`, `file`, `filePath`, `line`, `lineEnd`, `language`, `complexity`,
`isExternal`.

### GraphEdge

`from`, `to` (node ids), `relationshipType`, `confidence`, `isCrossLanguage`,
`bridgeMechanism`, `callSite` (the address owner: `call-site` for a stored line,
a LABELLED `declaration` substitute when none is stored, `unknown` with a reason
when the answer has no position — never a fabricated line 0), `depth`, `rowId`
(the stored `brain_relationship` row this edge traces to), `targetMatch` /
`sourceMatch` (`exact` when the stored row names the traced symbol itself,
`owner-cascade` when it names one of its members), `matchedMember` (the member
the row actually named, for a cascade edge), `targetBasis`
(`symbol`/`external`/`unresolved` — the stored resolution basis), and
`metadata` (the declared pass-through fields: `evidenceClass` and index-computed
enrichment).

### Summary declarations

| Field | What it declares |
| --- | --- |
| `totalCallers` / `totalCallees` | Edges RETURNED, not the store's totals. |
| `maxDepth`, `maxDepthReached` | The cap this run enforced, and how far it actually walked — together they separate "finished" from "stopped". |
| `callerBudget`, `calleeBudget`, `callerBudgetExhausted`, `calleeBudgetExhausted` | The fan-out bound and whether it bit. |
| `edgeLimit`, `maxEdges`, `cappedQueries`, `totalEdgeLimitReached` | The per-query and whole-answer bounds in force, and which fired. |
| `callersIfUncapped`, `calleesIfUncapped`, `totalsAreLowerBounds` | The root's true site count when a cap was hit and it was computable; `null` means not counted. |
| `truncated`, `truncationReason`, `truncationReasons` | A DECLARED BOUND bit only. The string is the `+`-joined list; the list is the same set as data. |
| `filterNarrowed`, `filterReason` | The caller's kind filter narrowed the QUESTION — a request, not a bound. |
| `noiseFiltered`, `crossLanguageExcluded` | Rows removed BY POLICY / BY REQUEST, per direction — filters that leave a number, so an empty set is never mistaken for an empty store. |
| `unattributed` | Rows that NAME this symbol (or an owner-cascade member) but carry no source symbol, so no traversal arm can show them in either direction. Depth 0 only; `null` = not counted. |
| `exactCallers` / `cascadedCallers` / `exactCallees` / `cascadedCallees` / `deeperCallers` / `deeperCallees` | Depth-0 attribution split; `exact + cascaded + deeper` equals the edges returned for that direction. |
| `edgesInBothDirections` | Stored rows present in both lists, so `totalCallers + totalCallees` is not read as a distinct-row count. |
| `edgesByType`, `edgeKindPriority`, `relationshipTypesUsed` | The composition of the RETURNED edges, the order kinds survive a cap in, and the kinds actually searched. |
| `dedupedAtToolLayer` | Stored rows collapsed before becoming edges: cascade repeats (the same rowId re-reached by a deeper cascade) and same-site spelling variants. Both declared. |
| `crossLanguageEdges` | Cross-language edges in the returned set. |

## Semantics and invariants

- **Call-site = source location.** A callee edge's `callSite` is where the call
  is written (the source symbol's file and line), never the target's.
- **Independent budgets and visited sets per direction.** A self-recursive or
  cyclic graph terminates deterministically.
- **One stored row emits at most one edge per direction.** The owner cascade can
  reach the same row from more than one traced symbol; the first depth to reach
  it emits, and the repeat is counted in `dedupedAtToolLayer`.
- **Owner cascade.** A relationship stored against a member of a class is
  attributed to the class: the member set is the lexical range of
  `brain_symbol.owner_symbol_id` for the traced symbol's `…:<Name>:` prefix
  (measured: for a class with six members the range returns exactly those six,
  equal to the rows whose owner is that class id). The cascade is a declared
  SUPERSET and it is REDUCIBLE: every edge carries `targetMatch`/`sourceMatch`
  and `matchedMember`, and the summary carries the exact/cascade split.
- **Unresolved targets are `ext:<name>` nodes.** The name is kept — it is what
  the store saw — and is never joined back onto other symbols to manufacture an
  edge; `ext:` nodes are leaves.
- **Truncation is explicit.** Every bound that fires contributes its own reason;
  a filter that removes rows does not claim to be a bound.

## Performance: the plan is the contract

A traversal is cheap or catastrophic depending on the plan SQLite chooses for
its statements, not on the number of rows it returns. Measured on an 11,440-file
reference index (310,423 symbols, 820,040 stored relationships):

| Shape | Before | After |
| --- | --- | --- |
| Cascade owner range materialised per statement | `SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)` — 976 ms for one row | `SEARCH m USING INDEX brain_symbol_project_owner_idx (project_id=? AND owner_symbol_id>? AND owner_symbol_id<?)` — 0.83 ms |
| Caller/callee arm | `SEARCH r USING INDEX brain_rel_proj_type_idx (project_id=? AND relationship_type=?)` — 4.99 s for two rows | `SEARCH r USING INDEX brain_rel_proj_type_target_idx (project_id=? AND relationship_type=? AND target_symbol_id=?)` — 9 ms |
| Unattributed counts | 10.70 s for one row | 0.49 ms |
| Exact root resolution | `ORDER BY gravity` scan — 945 ms | `SEARCH s USING INDEX brain_sym_proj_name_idx (project_id=? AND name=?)` — 1.2 ms |
| One default `bb_graph` call on a leaf symbol | p50 131 s | p50 22 ms |

Three structural facts make that hold, and each has a gate:

1. The owner cascade is resolved ONCE per traced symbol and reused by both arms
   and both unattributed counts as a bounded id list. Writing the range into
   each statement makes SQLite materialise a co-routine per statement, and the
   planner scans the project for it. The range JOIN remains the fallback when a
   class has more than `CASCADE_INLINE_MAX` members, so the answer never depends
   on the size of a class.
2. Every hint is a guarded `INDEXED BY`: the index is probed on the connection
   first, because a hint naming a missing index is a prepare-time error. The
   owner range prefers `brain_symbol_project_owner_idx` and falls back to
   `brain_symbol_owner_idx`; exact root resolution uses
   `brain_sym_proj_name_idx`; the unresolved/external arm uses
   `brain_rel_proj_source_idx`.
3. `script/m65/verify-graph-plan.ts` captures the SQL a real traversal prepares,
   explains it, and asserts these shapes — with the pre-fix plans embedded as a
   built-in negative control, so the gate fails if it ever stops catching the
   regression it exists for.

## Adapters

- `bb_graph` — the agent door: `src/mcp/tools/bb_graph/handler.ts`.
- `bb/graph` (LSP) — the editor door: `src/lsp/graph_request.ts` (graph and
  grouped `usages` modes), shared by the graph panel and hover.
- `bb_analyze` graph modes (`callers`, `callees`, `trace`) pass their own
  declared wall-clock ceiling and read the same declarations.
- `BrainTools.traceFunctionCalls` / `getFunctionCallers` / `getFunctionCallees`
  / `explainFlow` — internal wrappers over the same answers.

## Verification

- `bun run script/verify-graph.ts` — direction isolation, source-side call
  sites, transitive reach, cycle termination, kind filtering, the
  filter-is-not-a-bound rule, `maxEdges`, the default having no clock bound, and
  reproducibility, plus a corrupted-stored-line negative control.
- `npx tsx script/m65/verify-graph-plan.ts` — the plan shapes above, with the
  pre-fix plan as a negative control.
- `bun run script/m65/verify-graph-blindspots.ts` — noise/cross-language filters
  and the JOIN's blind spot, through the real tool handler.
- `npx tsx script/m65/verify-edge-kind-scoping.ts` — every consumer that names
  one relationship kind owns a filter, and the documented default is the
  engine's own list.
- `npx tsx script/m28/verify-union.ts` and
  `npx tsx script/m28/verify-surface-parity.ts` — the agent door and the editor
  door answer the same stored rows with the same evidence tiers.
