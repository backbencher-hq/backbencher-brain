# `bb_impact`

Bounded reverse-dependency impact for one symbol via the same component the editor graph panel uses: declared node budget (200) and depth (5), truncation as a first-class field with reason, and a declared total that is the size of the set the answer is a prefix of — measured, not inferred, so an answer that is short of the whole set says so even when no bound fired. Unknown symbols are loud declared errors — an empty impact set is never invented. Owner-cascade applies: impact includes dependents attributed at class level, not only exact-symbol rows. The relationship kinds that count are named in every answer's `rule.relationshipTypes` and can be overridden; a dependent carries its evidence tier, cross-language flag, bridge and position.

## Contract

- Category: `graph`
- Mutability: `read`
- Requires index: `true`
- Modes: `impact`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to compute impact for (`target`/`symbolName`/`query` are accepted as aliases)"
    },
    "relationshipTypes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "stored relationship kinds to count as dependencies. Default: calls, instantiates, extends, implements. A kind that is not listed is never reported, and the applied list is echoed in `rule.relationshipTypes` on every answer. This is the same control bb_graph has, so a caller who wants the type-level `uses`/`references` rows can ask for them on either door."
    },
    "refresh": {
      "type": "boolean",
      "description": "set false to skip the bounded staleness repair and answer from the existing index. When omitted, stale files inside the answer are repaired and the walk is re-run so the answer is not built from the rows the refresh replaced."
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- The rule the answer was MEASURED under, in `rule`: which relationship kinds count as dependencies (the applied list is echoed here on every answer), the owner-cascade, the noise policy, and the depth
- Whether the set is the WHOLE truth or a prefix of a larger one, and how that was established: the component measures the returned set against an unbounded walk of the same rule whenever truncation was declared or the walk reached the last expandable depth, and declares a prefix when they disagree — even when no bound fired. The same measurement reports each dependent at its SHORTEST path rather than at the depth the traversal's depth-first walk first reached it by, and `countVerification` says whether that measurement ran
- Downstream dependents of the symbol with per-edge evidence tiers and confidence, cross-language flags, bridge mechanism, and each dependent's own position. Every one of those describes ONE stored row, and `evidenceAtDepth` says which path that row is on: `depth` is the MEASURED shortest path, while the engine that produced the set walks depth-first and stamps the first trace, so the two can name different rows (measured on nine repositories before this was fixed: 340 of 4 258 rows, 7.98%). The evidence is re-read at the reported depth, and where no row can be attributed every evidence field is null rather than quoted from a longer path
- How the requested name became the root it walked: `rootMatch` carries the name asked for, whether the match was exact, a containment match, or the member→owner substitution, and how many stored symbols carry that exact name
- The declared limits, from the component that owns them: `budget` (node budget, depth, and the THREE ceilings the declared total is computed under) and `traversal` (depth actually reached, the engine's own truncation state and reason, its per-query site limit, its capped-query count, and the root's uncapped caller count when computable). The two work ceilings (`totalScanCeiling`, `totalExpansionCeiling`) are properties of the INDEX, so the same question always gets the same answer; `totalTimeCeilingMs` is a property of the MACHINE, and it is the one bound that can make two identical calls differ — `countVerification.timedOut` says when that happened
- How completeness was established, in `countVerification`: `ran: false` means the walk never reached the depth boundary, so no node could have been blocked and every bound that could fire has declared itself — the set is the whole truth by construction, with no measurement paid for. `ran: true` means the set was measured against an unbounded walk of the same rule and the two agree. `timedOut: true` means the measurement stopped on the wall clock, which is the only published reason the same question can get two different answers
- How each dependent is a dependent, per row, in `via`: `exact` (the stored row names the symbol asked about), `member` (it names one of its members — the owner cascade working as declared, with the member named in `viaMember`), or `range-folded` (it names neither, and the row is in the answer only because the cascade RANGE widened). `cascade` is the composition of the returned set by those three, or `null` when the index refused the member lookups it needs to establish it
- `directCount` — the exact number of DIRECT dependents, or `null` when the counting walk hit a declared ceiling. `totalCountIfKnown` is the true transitive total under the same rule, or `null` for a declared unknown. Neither is ever smaller than `shownCount`. `rule.relationshipTypes` names the kinds that count, so a `uses` or `references` relationship that did not appear is explained rather than mysterious
- Freshness: a per-dependent `stale` flag (`true`/`false`, or `null` when the file is not in the index at all) and a summary `freshness` envelope; `rootStale` declares the root's own file separately, since a stale root with fresh dependents is still a stale answer
- Declared-absent result when the symbol is unknown — never an empty guess

## Examples

`{"symbol":"handleRequest"}`

## Errors

- Missing symbol
- Symbol not found in the index
- The named symbol exists but is not a traversable root (an enum member, a constant, a plain field) — a declared error naming the kind, never an empty set
- relationshipTypes given as an empty list (a narrowed rule that can match nothing is refused rather than silently re-read as the default — the same refusal bb_graph raises)

## Limitations

- Static impact analysis cannot establish runtime behavior
- Reflects the index as of the last index run; the freshness envelope states how far that is from the files on disk
- Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class
- A truncated answer is a bounded PREFIX of the set, not a sample of it: the walk is depth-first, so a hub's 200 returned rows are an exploration order, not the 200 nearest dependents. `directCount` is the field that makes the shape readable. The set is then re-sorted by the SHORTEST path the measurement found, so `depth` is minimal rather than first-traced, but membership is still the walk's exploration order
- The owner cascade is a RANGE over symbol ids, and a range widens: for a member `P:container:29` it covers [`P:container:`, `P:container;`) — the whole container — so every sibling of `29` is folded in with it. Measured, the range is a strict SUPERSET of the owner relation (it never loses a dependent the owner relation has) but it adds dependents the owner relation does not: ripgrep `RegexMatcher` answers 21 of which 7 are `range-folded` and 0 are real members, graphql-js `join` 9 of 128, lodash `call` 2 of 85. `cascade.rangeFolded` counts them, so the over-count is visible instead of silent. The walk that implements the range is the graph engine's and is not changed here

## Performance

Two costs, bounded by different things, measured over 41 hub and mid-fan-in answers on eight real repositories (a machine that was NOT idle, so these are an upper bound): cold p50 298 ms / p95 1 777 ms / max 4 207 ms, warm p50 427 ms / p95 2 047 ms / max 3 488 ms; slowest cargo `all` 4 207/3 488 ms, cargo `file` 1 777/2 436 ms, svelte `flushSync` 1 508/2 047 ms. A COMPLETE answer pays for one engine walk and nothing else — the completeness verification is not paid for at all, because a node can only be lost at the depth boundary, so one query over the last level's nodes decides whether anything was and the unbounded walk runs only when that says maybe. A PREFIX answer additionally pays for the counting walk that makes the declared total honest: one statement per LEVEL rather than one per symbol, bounded by two WORK ceilings (50 000 scanned rows, 2 000 expansions) past which the total is a declared `null` rather than a number paid for with seconds, and by a 4 000 ms circuit breaker that no measured corpus reaches. The expansion ceiling is not what makes it fast or slow: eleven of twelve hubs give an exact total at 300 expansions at the same wall time as at 2 000, and the ones that stay unknown do so at every ceiling because their closures are wide rather than deep.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Impact derives from brain_relationship rows via the same engine the editor impact panel uses. The declared total is measured by an independent bounded walk under the traversal's own rule — same relationship kinds, same owner cascade, same noise policy, same depth — so it is the size of the set the answer is a prefix of. Completeness is PROVED rather than inferred: whenever truncation was declared, or the walk reached the last expandable depth, the set is measured against an unbounded walk and declared a prefix when the two disagree, which is how cobra `HasAvailableFlags` came to answer 28 with `truncated: true` instead of 27 with `truncated: false`. An independent SQL oracle in the bb_impact corpus lane re-derives both the set and the total from the stored tables on nine real repositories, with an SQL-level differential between the cascade range rule and the owner relation behind the `via` numbers above.

## Relationship to other tools

This is the bounded-impact specialist; `bb_analyze` mode `impact` aggregates the same canonical walk with file-level risk — the numbers are identical by gate.

## Staleness

Freshness modes (registered as `freshnessModes`): `impact`. Staleness surfaces as: per-dependent `stale` flag (three states: `true`/`false`, or `null` when the file is not in the index at all), the root's own `rootStale`, and a `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`). Stale files inside the answer are repaired within budget and the walk is re-run, declared in `autoRefresh`; `refresh=false` opts out. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
