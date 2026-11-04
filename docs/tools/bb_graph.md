<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_graph: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_graph through any MCP host, the CLI (`bb tool bb_graph`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_graph/descriptor.ts, src/mcp/tools/bb_graph/handler.ts, script/tool-docs/curation/bb_graph.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_graph --write`.
-->
# `bb_graph`

Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), the stored evidence class and resolution basis behind each tier, confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent. Traversal semantics: a relationship stored against any member of a class (a method call, an inherited behavior) is attributed to the owner class, so caller/callee sets include the owner-family level — every edge still traces to a stored relationship row and states whether it matched the symbol itself or one of its members. Each edge's `rowId` is the stored relationship key with its leading '<projectHash>:rel:' removed, and each endpoint's `id` is the stored symbol key with its leading '<projectHash>:' removed — both prefixes are constant within one answer, and `root.id` carries the FULL stored form, so '<projectHash>' is the segment before its first ':' and prepending it (plus ':rel:' for a rowId) reconstructs the store key exactly. An `ext:` id has no such prefix and is returned whole. The graph is READ from a read-only index handle: asking a question cannot mutate the index. Measured on this repository's reference index (11,440 files, 310,423 symbols, 820,040 stored relationships), a default call answers in 22-355 ms p95 depending on the symbol's degree, where the same call took 131 s before the engine's cascade and arm queries were rewritten to seek their indexes.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `graph`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"maxDepth":5,"direction":"both"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to root the graph at (`target`/`symbolName`/`query` are accepted as aliases). Required; a blank name is refused as missing. An unknown name is refused after the resolver's declared containment fallback runs: that fallback is a substring scan, and on the 11,440-file reference index it costs about 5 s before answering not-found. It is a documented step of the resolver, not a silent budget breach; an exact-name miss does not run it."
    },
    "maxDepth": {
      "type": "number",
      "description": "traversal depth bound (default 5, max 10). Must be a whole number: a fractional depth is refused rather than floored."
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
      "description": "stored relationship kinds to include. Default: EVERY kind the index stores (calls, extends, implements, uses, instantiates, overrides, contains, references, imports, exports, decorates, renders, mixes_in, part_of) — deliberately not narrowed, because a narrower default silently drops a fifth of the graph and cannot descend a class hierarchy: 'contains' is the parent-to-member edge, so excluding it means a traversal rooted at a class cannot reach that class's own methods. The cost is size — the type-level 'uses'/'references'/'contains' rows are roughly half of what a typical index stores, so a hub symbol's default answer is 2.5-4.8x larger than a filtered one (measured: lodash 487 KiB against 101 KiB, ripgrep 795 against 321). Pass relationshipTypes: ['calls'] for the pure call graph, or ['implements'] to see only interface satisfaction. A kind you do not list is never reported; a filter you supply is a REQUEST, not a bound — it is reported in `summary.filterNarrowed` and `summary.filterReason` (never in `truncationReason`, which is reserved for bounds), and the kinds actually searched come back in `summary.scope.relationshipTypes`."
    },
    "includeCrossLanguage": {
      "type": "boolean",
      "description": "include edges the indexer marked cross-language (default true). Set false for a single-language view; the rows removed BY REQUEST are counted in `summary.crossLanguageExcluded` per direction, so an empty set beside a non-zero count is a request, not an empty store."
    },
    "timeBudgetMs": {
      "type": "number",
      "description": "wall-clock ceiling for the whole walk in milliseconds. DEFAULT 0 = NO clock bound: every other bound on this answer is a function of the DATA (edgeLimit, the 50-symbol per-direction fan-out, maxEdges, maxDepth), so the default answer is complete over them and byte-identical on a re-run. Pass a value only to cap latency, and know what you are buying: the ceiling is checked BETWEEN statements and never inside one — a SQLite statement cannot be interrupted — so a run that hits it returns a SAMPLE of the set. The sample is declared, never silent: `summary.timeBudgetExhausted` is true and `walk-time-budget-exhausted` is among `summary.truncationReasons`. There is no value that makes a clock-bounded answer reproducible; if you need the whole set, leave this unset"
    },
    "maxEdges": {
      "type": "number",
      "description": "hard cap on the number of edges in the WHOLE answer, across both directions and all depths (default 1000, max 5000; whole numbers only). `edgeLimit` bounds one query and this bounds the answer; their product is what a caller receives. Reaching it is declared as `total-edge-limit` with the value in `summary.maxEdges`. Raise it for a hub symbol, lower it for a quick shape check — a value below `edgeLimit` IS honored (the answer stops at it and says so), so `maxEdges` is the knob for \"just show me the shape\""
    },
    "edgeLimit": {
      "type": "number",
      "description": "Per-symbol call-site limit for one edge query (default 200, max 5000; whole numbers only). Reaching it is declared in `summary.truncated` with `summary.truncationReason` and the root's true count in `summary.callersIfUncapped`/`summary.calleesIfUncapped` — the limit is never a silent cap. Raise it to receive more sites in one answer."
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
- Per-edge `evidenceClass`: the stored classification when the index made one, or `null` when the `tier` was DERIVED from the edge's own stored kind and confidence — so a reader can tell a stored claim from a derivation without a second query
- Per-edge `targetBasis`: why the target may claim this identity, from the stored row — `symbol` (a stored declaration), `external` or `unresolved` (a name the index could not attach). Never inferred by this tool
- Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence
- Per-edge call-site address: `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0
- `summary.edgesByType`: the composition of the RETURNED edges by stored relationship kind, counted from the emitted edges. The default filter covers every stored kind, so an answer is usually not all call edges — measured: lodash `baseConvert` 99 of 230, cobra `getCompletions` 36 of 65, rake `standard_rake_options` 72 of 76. This is how you learn the ratio without walking the edges
- `summary.maxEdges` / `totalEdgeLimitReached`: the bound on the WHOLE answer, across both directions and every depth, and whether it bit. `edgeLimit` bounds one query; this bounds the answer, and their product is what a caller receives. A requested `maxEdges` is HONORED even below `edgeLimit` — `{maxEdges: 5}` returns 5 edges with `totalEdgeLimitReached: true` and `truncationReason: "total-edge-limit"` — so it is the way to ask for a quick shape check
- `summary.truncated` / `truncationReason` / `truncationReasons`: a DECLARED BOUND bit — the walk stopped before the store ran out. `truncationReasons` is the same set as a list (`truncationReason` is its `+`-joined rendering, kept for existing consumers)
- `summary.filterNarrowed` / `filterReason`: the `relationshipTypes` argument narrowed the QUESTION — a request, not a bound. `filterNarrowed: true` with `truncated: false` means the edge sets are the whole of what was asked for (and possibly not the whole of what the store holds); `filterReason` names the narrowing (e.g. `relationshipTypes:calls|uses`) and is `null` when the default kind set ran. Asking for `relationshipTypes:["implements"]` on a symbol with none answers 0 edges with `truncated: false, filterNarrowed: true` — an empty subset, not a clipped answer
- `summary.edgeKindPriority`: the order in which kinds survive the per-symbol site limit — dependency kinds first, then lexical, then module-level, then membership. Only observable under `truncated`, published always
- `summary.scope.relationshipTypes`: the relationship kinds this run actually searched, RESOLVED from the engine's own registered list rather than restated, so the filter that produced the answer is never a restatement of a default that may have moved
- `summary.exactCallers` / `cascadedCallers` / `exactCallees` / `cascadedCallees`: DEPTH 0 only — how much of the answer is about the symbol that was asked for and how much the owner cascade folded in from its members. `deeperCallers` / `deeperCallees` hold the edges about symbols the traversal discovered, so exact + cascaded + deeper is the number of edges returned
- `summary.callerBudget` / `calleeBudget` with `callerBudgetExhausted` / `calleeBudgetExhausted`: the fan-out bound in force and whether it bit. `truncationReason` can name `caller-budget-exhausted`; this says what the budget was
- `summary.unattributed`: stored rows that NAME this symbol (or one of its owner-cascade members) but carry no source symbol, so the caller and callee queries — which join the source side — cannot show them in either direction. Per direction, depth 0 only, and `null` (not zero) when the count could not be taken. Measured on this repository's index: 11.0% of stored rows (69,171 of 631,139) carry no source symbol and 2,099 symbols answered `callers: []` while the store held incoming rows for them. The rows are counted, never fabricated into edges
- `summary.noiseFiltered` and `summary.crossLanguageExcluded`: how many stored rows this answer dropped BY POLICY (vendored, generated, fixture, snapshot, dist or build paths, and generated names) and BY REQUEST (`includeCrossLanguage: false`), per direction. Both are filters, not bounds: `truncated` stays false while they bite, which is why they are numbers rather than prose — a zero edge set beside a non-zero count is a policy or a request, not an empty result
- `summary.edgesInBothDirections`: stored rows present in both the caller and the callee list — `totalCallers + totalCallees` double-counts exactly this many
- `root.candidates` and `root.match`: how many stored symbols the requested name resolved among, and which resolution step won — `exact`, `exact-any-kind` (the name is a symbol the graph cannot traverse: a constant, a type alias), or `containment` (the answer is about a symbol whose name CONTAINS the one asked for, so the name was not itself a symbol). When `root.candidates` is greater than 1 the graph is about one of those symbols, so confirm `root` first
- `summary.maxDepth` and `summary.maxDepthReached`: the bound this run actually used and the depth it actually reached. Together they are the only way to tell "the walk finished" from "the walk stopped"
- A per-edge `depth`, which is HOW FAR THE WALK WENT before finding that row — not the shortest distance between two symbols. See Limitations
- `summary.scope`: the `direction`, `relationshipTypes` and `includeCrossLanguage` actually applied, so a narrowed traversal returning zero edges is distinguishable from a widened one that found nothing
- Declared truncation with a reason when the traversal is bounded

## Examples

`{"symbol":"handleRequest"}`

`{"symbol":"handleRequest","maxDepth":8}`

`{"symbol":"handleRequest","direction":"callers"}`

`{"symbol":"Handler","relationshipTypes":["calls"]}`

## Errors

- Missing symbol (a blank/whitespace-only `symbol` is refused as missing, not echoed back)
- `maxDepth` outside the declared 1-10 range, or not a whole number
- `edgeLimit` outside 1-5000, or not a whole number
- `maxEdges` outside 1-5000, or not a whole number
- `direction` outside `callers`|`callees`|`both`
- `relationshipTypes` given as an empty list, or with a blank entry (a narrowed traversal that can match nothing is refused rather than silently reinterpreted)
- `timeBudgetMs` negative (0 is accepted and means no clock bound)
- `includeCrossLanguage` not a boolean
- An option the tool does not accept (the acceptance set and the aliases are named in the error)
- Symbol not found in the index. The refusal runs the resolver's three declared steps first — exact name among traversable kinds, exact name among all kinds, then a `LIKE '%name%'` containment fallback — and the containment step is a substring scan: on the 11,440-file reference index an unknown name costs about 5 s before the not-found error. That cost is the declared fallback, not a hidden budget breach, and it is the same step that lets a near-miss (`root.match: "containment"`) answer instead of refusing

## Limitations

- Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven
- An edge's `depth` is the depth of the query that found its stored row, not the shortest path between the two symbols. The traversal is depth-first and the per-row dedupe is global, so the first traversal to reach a row emits it: measured, 24% of edges on cobra, 57% on lodash and 60% on rake sit deeper than the shortest path in their own answer. No edge ever claims a SHORTER path than its answer can demonstrate, so `depth` is a valid upper bound on distance — read it as 'how far the walk got', not 'how far apart these are'. Use `direction` with a smaller `maxDepth` when the distance itself matters
- The default filter covers every stored relationship kind, so an answer mixes dependency edges with lexical references (`uses`, `references`), structural membership (`contains`) and module edges (`imports`, `exports`). `contains` means owner → member: a class reporting its own methods is structure, not dependency. Filter with `relationshipTypes` for a pure call graph, or read `edgesByType`
- Every kind competes for the per-symbol site limit, and the surviving set is decided by `edgeKindPriority` — dependency kinds first. A truncated answer therefore keeps more `calls` and fewer `contains` than an untruncated one would, and the published order is the rule that decides it
- A target the index could not resolve appears as an `ext:<name>` node rather than as a symbol. That is a real gap in the index, surfaced rather than papered over: the edge `caller --calls--> ext:name` is what the store holds, and no internal symbol is substituted for it
- A blank or whitespace-only `symbol` is refused immediately (it used to be sent through the containment scan and echoed back in the not-found message). An unknown name is refused AFTER the containment fallback runs, which scans symbol names: about 5 s on the 11,440-file reference index. Both refusals are declared here because a caller budgeting latency on this tool should not discover the scan from a timeout
- The graph reflects the index as of the last index run. This tool does not auto-refresh and does not report per-file staleness; when files changed after indexing, run: bb index --changed (or the `bb_index` tool with the project path)
- Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches. The superset is REDUCIBLE: every edge carries `match` (`exact` or `owner-cascade`), `matchedMember` naming the member the stored row actually referenced, and the summary carries the exact/cascade split. Measured on cobra, `Command` (182 methods) answers with 184 caller edges of which 24 name `Command` itself. Every edge also carries the `rowId` it traces to
- A target the index could not resolve is reported as an `ext:<name>` node — a NAME the index saw and could not attach to a symbol — and is never resolved by matching that name against other symbols in the project. The name is not unique there (measured on vscode, `match` names 37,876 stored symbols; on svelte, `end` names 437,570), so matching it would manufacture edges the store does not contain, crowd out the resolvable callees, and seed the traversal with a guess. `ext:` nodes are leaves: there is nothing stored about them to walk into
- Two identical calls return identical answers: the DEFAULT asks for no wall-clock bound, and every remaining bound — the per-query site limit, the fan-out budget, the total-answer bound, the depth — is a function of the data. Passing `timeBudgetMs` ends that guarantee on purpose: the ceiling is checked BETWEEN statements and never inside one (a SQLite statement is not interruptible), so a run that hits it returns a declared SAMPLE of the set — `summary.timeBudgetExhausted: true` with `walk-time-budget-exhausted` among `summary.truncationReasons`
- A symbol name is not a unique identifier. When one name matches several stored symbols the resolver takes the highest-gravity match (ties broken by lowest id, so the pick is reproducible rather than SQLite's whim) and says how many it chose between in `root.candidates` — measured: `build` in lodash resolves among 7, `code_block.go` in cobra among 50, `Command` among 1. When `root.candidates` is greater than 1 the graph is about ONE of those symbols, so confirm `root` is the one you meant before reading the edges. The other candidates are not listed
- A name containing a SQL LIKE wildcard (`%`, `_`) is matched LITERALLY, not as a pattern: it either resolves to a symbol that genuinely contains those characters or is reported not found. It never widens into a match on an unrelated symbol
- Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)
- `summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). The cap fires only when rows were ACTUALLY dropped: the query asks for one row beyond the limit, so a symbol holding exactly `edgeLimit` sites is reported complete instead of falsely truncated
- An empty caller or callee set is not proof that nothing references the symbol. Three populations sit BESIDE the edge sets rather than inside them, each with its own number: rows the JOIN cannot attribute because they carry no source symbol (`summary.unattributed`), rows removed by the noise policy (`summary.noiseFiltered`), and rows removed by the `includeCrossLanguage: false` scope option (`summary.crossLanguageExcluded`). Read them before concluding that a set is empty — in the measured index one symbol had 40 stored `calls` rows and answered three callers, 38 of them in the first population
- `truncated` means a BOUND bit, and nothing else. A `relationshipTypes` filter does not set it: the filter reports through `summary.filterNarrowed` / `filterReason` instead. The two questions are separate and both are answerable — "is this the whole store?" (`truncated`) and "is this the whole of what I asked for?" (`filterNarrowed` + the counts)
- `provenance.evidenceClass` is `inferred` for the ANSWER, not for every edge: root resolution (a gravity tie-break, or the containment fallback), the owner cascade, the noise policy and any cap are constructions over stored rows, so the whole object cannot claim `structural` even when each returned edge carries one stored row. Per-row evidence is on each edge's `tier` (a stored `calls` row is `structural`) and its `evidenceClass` / `targetBasis`

## Performance

maxDepth (default 5, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph. The answer is bounded at four levels and every level is declared: the per-query site limit (`edgeLimit`, default 200, max 5000), the fan-out budget (50 symbols per direction, `callerBudget`/`calleeBudget`), the size of the WHOLE answer (`maxEdges`, default 1000, max 5000) and the depth. The third exists because the product of the first two is not a number a reader can use: measured, ripgrep's `unwrap` returns 206 edges at depth 1, 454 at depth 3 and 702 at depth 5 — 228 KiB, 504 KiB and 770 KiB rendered. Reaching `maxEdges` is declared as `total-edge-limit` with the value in `summary.maxEdges`, and a `maxEdges` below `edgeLimit` is honored rather than raised to it (`{maxEdges: 5}` answers 5 edges, `totalEdgeLimitReached: true`). The wall-clock ceiling (`timeBudgetMs`) is OFF BY DEFAULT (0): it is the ONE bound here that is a function of the clock rather than of the data, so it is the caller's decision, never the tool's — and it is checked between statements, never inside one, so a run that hits it returns a declared SAMPLE (`timeBudgetExhausted`, `walk-time-budget-exhausted`) rather than a bounded latency. Measured on this repository's reference index (11,440 files, 310,423 symbols, 820,040 stored relationships): a default call on a leaf symbol answers in 22 ms p50 / 30 ms p95, a mid symbol with 307 edges in 161 ms / 355 ms, and a hub with 672 callers in 90 ms / 125 ms. Those numbers are 4,000-6,000x faster than the same calls before the engine's cascade and arm queries were rewritten to seek their indexes (a leaf default call was 131 s p50, and mid/hub default calls did not answer inside ten minutes), and the traversal now opens the index read-only, so a question never mutates the index (open cost 19.6 ms, down from 18,714 ms for the read-write open). The engine reference (docs/GRAPH_ENGINE.md) carries the statement-level before/after and the plan shapes that hold it.

## Safety

Read-only. It does not modify source files or index data: the traversal opens the index read-only, with no migrations, no auto-refresh and no write tool. When the index is stale, refresh it deliberately with: bb index --changed (or the bb_index tool with the project path).

## Evidence Semantics

Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier, the stored classification that may have decided it (`evidenceClass`), the stored resolution basis of its target (`targetBasis`), its confidence, the `rowId` of the row it came from, and `match`/`matchedMember` saying whether the row names the traced symbol or one of its members. Every emitted rowId resolves to exactly one stored row and the edge's endpoints agree with that row. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed. Owner-cascade edges are auditable in the same way: `match` and `matchedMember` identify the member the stored row actually named, and the exact/cascade split in the summary is verified against an independent SQL count of direct-target rows on real repos (cobra: tool reports `exactCallers: 24`; oracle counts 24 direct caller rows for the same symbol). The traversal's row sets were compared before and after the query-plan rewrite over a leaf, three classes with 3-6 members, a 143-callee mid symbol and a 672-caller hub: identical rowIds for both arms and both unattributed counts (validation/tools/bb_graph/results/semantics-equivalence.json).

## Relationship to other tools

For richer analysis (dependencies, complexity, tests, impact aggregation) use `bb_analyze`; for plain callers/callees with evidence tiers this is the tool.

## Deep guides

- [The graph engine: what each edge means and how it is resolved](../GRAPH_ENGINE.md)

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
