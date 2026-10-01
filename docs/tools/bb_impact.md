# `bb_impact`

Bounded reverse-dependency impact for one symbol via the same component the editor graph panel uses: declared node budget (200) and depth (5), truncation as a first-class field with reason, and an independently declared total when computable. Unknown symbols are loud declared errors — an empty impact set is never invented. Owner-cascade applies: impact includes dependents attributed at class level, not only exact-symbol rows.

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
    }
  },
  "required": [
    "symbol"
  ]
}
```

## Returns

- Downstream dependents of the symbol with per-edge evidence tiers and confidence, cross-language flags, bridge mechanism, and each dependent's own position
- How the requested name became the root it walked: `rootMatch` carries the name asked for, whether the match was exact, a containment match, or the member→owner substitution, and how many stored symbols carry that exact name
- The declared limits, from the component that owns them: `budget` (node budget, depth, and the two ceilings the declared total is computed under) and `traversal` (depth actually reached, the engine's own truncation state and reason, its per-query site limit, its capped-query count, and the root's uncapped caller count when computable)
- `directCount` — the exact number of DIRECT dependents, or `null` when the counting walk hit a declared ceiling. `totalCountIfKnown` is the true transitive total under the same rule, or `null` for a declared unknown. Neither is ever smaller than `shownCount`
- Freshness: a per-dependent `stale` flag (`true`/`false`, or `null` when the file is not in the index at all) and a summary `freshness` envelope; `rootStale` declares the root's own file separately, since a stale root with fresh dependents is still a stale answer
- Declared-absent result when the symbol is unknown — never an empty guess

## Examples

`{"symbol":"handleRequest"}`

## Errors

- Missing symbol
- Symbol not found in the index
- The named symbol exists but is not a traversable root (an enum member, a constant, a plain field) — a declared error naming the kind, never an empty set

## Limitations

- Static impact analysis cannot establish runtime behavior
- Reflects the index as of the last index run; the freshness envelope states how far that is from the files on disk
- Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class
- A truncated answer is a bounded PREFIX of the set, not a sample of it: the walk is depth-first, so a hub's 200 returned rows are an exploration order, not the 200 nearest dependents. `directCount` is the field that makes the shape readable

## Performance

Complete answers stay under ~250 ms on the lane's corpora. A truncated hub pays for an unbounded counting walk so the declared total is honest: 0.5–2.0 s, bounded by two declared ceilings (50 000 scanned rows, 2 000 expansions) past which the total is a declared `null` rather than a number paid for with seconds.

## Safety

Read-only. It does not modify source files or index data.

## Evidence Semantics

Impact derives from brain_relationship rows via the same engine the editor impact panel uses. The declared total is measured by an independent bounded walk under the traversal's own rule — same relationship kinds, same owner cascade, same noise policy, same depth — so it is the size of the set the answer is a prefix of, and an independent oracle in the bb_impact corpus lane checks both against the stored tables on nine real repositories.

## Relationship to other tools

This is the bounded-impact specialist; `bb_analyze` mode `impact` aggregates the same canonical walk with file-level risk — the numbers are identical by gate.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
