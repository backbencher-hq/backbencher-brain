<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_impact: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_impact through any MCP host, the CLI (`bb tool bb_impact`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_impact/descriptor.ts, src/mcp/tools/bb_impact/handler.ts, script/tool-docs/curation/bb_impact.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_impact --write`.
-->
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
    "file": {
      "type": "string",
      "description": "optional defining-file hint for a symbol NAME that several stored symbols carry — the same server-resolved identity the editor's hover sends as `file`. Accept the stored project-relative path, or an absolute path ending in it. It must identify the symbol: a hint that does not is REFUSED with a named error, never silently ignored and never silently relabelled to another same-named copy. Ambiguous MEMBER names (constructors, members outside the graph's root types) resolve through their owning declaration at the hinted file; for a traversable name the walk roots where the graph engine resolves it, and a hint naming another copy is refused rather than answered. Omit it for unique names."
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

- The rule the answer was MEASURED under, in `rule`: which relationship kinds count as dependencies (the applied list is echoed here on every answer), the owner-cascade, the noise policy, and the depth cap. The set and the declared total are measurements of this same list
- The declared limits, from the component that owns them: `budget` (node budget 200, depth cap 5, and the three ceilings the declared total is computed under) and `traversal` (depth actually reached, the engine's own truncation state and reason, its per-query site limit, its capped-query count, and the root's uncapped caller count when computable). `maxDepth` is an EXPANSION cap: direct dependents are `depth: 0`, so the deepest dependent the engine can report is `maxDepth - 1` (4), and the depth cap is shared by the completeness measurement, so a declared total is the total UNDER that cap
- Whether the set is the WHOLE truth or a prefix of a larger one, and how that was established: whenever truncation was declared or the walk reached the last expandable depth, the returned set is measured against an unbounded walk of the same rule, and a prefix is declared when the two disagree. `countVerification` carries `ran`, `timedOut`, `boundarySuspect` and `complete` — `complete: true` means the measurement proved the returned set IS the whole truth (an ENGINE row cap may still have fired on the way; it is then published in `traversal.engineTruncated`, because a row cap that dropped only duplicate call sites of an already-counted dependent hides no dependent), `false` means a prefix or a declared unknown, and `null` means no measurement was bought because the set is complete by construction (shallow walk, no bound fired)
- Downstream dependents of the symbol with per-edge evidence tiers and confidence, cross-language flags, bridge mechanism, and each dependent's own position. Every one of those describes ONE stored row, and `evidenceAtDepth` says which path that row is on: `depth` is the MEASURED shortest path, while the graph engine walks depth-first and stamps the first trace, so the two can name different rows (measured across nine repositories before this was fixed: 340 of 4 258 rows, 7.98%). The evidence is re-read at the reported depth, and where no row can be attributed every evidence field is null rather than quoted from a longer path
- How the requested name became the root it walked: `rootMatch` carries the name asked for, whether the match was exact, an `exact-exempt-kind` hit (the name matched EXACTLY and unambiguously but the kind — an enum variant, a constant, a plain field — is outside the graph whitelist, so the walk is the one every other root gets and nothing was substituted), a containment match, or the member→owner substitution, and how many stored symbols carry that exact name. An ambiguous traversable name is ANSWERED about the copy the engine resolves, with `rootMatch.nameMatches` disclosing the ambiguity; an ambiguous member name is refused unless a `file` hint identifies its owning declaration
- How each dependent is a dependent, per row, in `via`: `exact` (the stored row names the symbol asked about), `member` (it names one of its members — the owner cascade working as declared, with the member named in `viaMember`), or `range-folded` (it names neither, and the row is in the answer only because the cascade RANGE widened). `cascade` is the composition of the returned set by those three, or `null` when the index refused the member lookups it needs to establish it
- `directCount` — the number of DIRECT dependents (depth 0), or `null` when the completeness measurement hit a declared ceiling, was refused, or stopped on its clock. `totalCountIfKnown` is the transitive total under the same rule, or `null` for the same declared unknowns. Neither is ever smaller than `shownCount`; when the measurement proves the set complete they equal it
- `file` — an optional defining-file hint for a name several stored symbols carry. For a member name (a constructor, or a member the graph cannot root) it resolves the walk through the MEMBER'S OWNING DECLARATION at that file and the result says so in `resolution`. For a traversable name the walk roots where the graph engine resolves the name, and the hint is a REFUSAL input: it either identifies that copy or the answer is a named error, never a silent relabel to another copy
- Freshness: a per-dependent `stale` flag (`true`/`false`, or `null` when the file is not in the index at all) and a summary `freshness` envelope; `rootStale` declares the root's own file separately, since a stale root with fresh dependents is still a stale answer. Stale files inside the answer are repaired within budget and the walk is re-run, declared in `autoRefresh`; `refresh=false` opts out
- Loud declared errors instead of fabricated empty sets: an unknown symbol, an ambiguous member name with no usable hint, a hint that does not identify the symbol, an empty `relationshipTypes` list, and the option refusals the shared validator raises are all named errors with `isError` set

## Examples

`{"symbol":"handleRequest"}`

## Errors

- Missing symbol
- Symbol not found in the index — a declared error, never an empty impact set that would read as "nothing depends on this"
- The requested NAME is an ambiguous MEMBER name (a constructor or a kind outside the graph's root types) and no usable `file` hint was given. The error lists the candidate copies with file and line (bounded to 8, plus a count of the rest) and names the `file` option as the remediation
- A `file` hint that does not identify the symbol — an unknown path, or a path naming a different copy than the symbol the walk would root at — is refused with a named error instead of being ignored or answered about another copy
- `relationshipTypes` given as an empty list: refused rather than silently re-read as the engine's default kind set (an empty rule matches nothing, and the engine would substitute its default)
- The root resolves to a non-traversable kind AND is not the symbol that was asked for — a gravity pick, a containment match, or a re-root through an owner. The graph whitelist exists so a request is never answered about a DIFFERENT symbol, and that is the only case left where it applies
- An option this tool does not accept, or a value of the wrong type, is rejected by the shared tool validator with the accepted options named

## Limitations

- Static impact analysis cannot establish runtime behavior: it reads stored relationship rows, not executed calls
- The depth cap is an EXPANSION cap. Direct dependents are `depth: 0`, the deepest reported dependent is `maxDepth - 1` (4), and the completeness measurement shares that cap — so a declared total is the total under the declared depth, and a chain deeper than the cap keeps a declared `caller-depth-cap-reached` truncation rather than claiming a bounded set is the whole truth
- The engine's row bounds are not truncations of the DEPENDENT SET: a per-query call-site limit, a per-traversal caller budget and a total-edge cap drop ROWS. When the measurement proves the returned set complete, those bounds stay visible in `traversal.engineTruncated` / `engineTruncationReason` and `truncated` stays false — the set is whole even though the engine stopped emitting rows
- When the completeness measurement cannot finish — 50 000 scanned rows, 2 000 expansions, or its own 4 000 ms circuit breaker — `totalCountIfKnown` and `directCount` are BOTH `null` (a declared unknown). The clock is the one bound that is a property of the machine rather than the index; when it fires, `reproducible: false` is published and the truncation reason names it
- The graph engine applies NO wall-clock bound to the caller walk unless a caller asks for one, so this tool's walk is bounded by the index itself. What can still make two identical calls differ is the completeness measurement's own circuit breaker, which is published rather than hidden
- Latency depends on the index's own planner state as well as on the size of the database: the walk's per-symbol caller query must be planned through the owner-range and target indexes to stay index-bounded. On the current reference index it is (per-symbol p95 153.6–327.7 ms, measured byte-read-only); an earlier campaign measurement on a pre-fix index state returned multi-second-to-minute answers and is retained in the evidence as the reason the owner-range index exists. The fixture tiers are the regression baselines (see Performance)
- Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class. The cascade RANGE is a strict SUPERSET of the owner relation — it never loses a dependent the owner relation has, but it folds in siblings of a member: ripgrep `RegexMatcher` answered 21 dependents of which 7 were `range-folded` and 0 were real members. `cascade.rangeFolded` counts those rows, so the over-count is visible instead of silent
- A `file` hint cannot select a DIFFERENT copy of a traversable name: the graph engine roots by name (gravity-ordered), and the hint can only confirm that copy or refuse. Member names are the case the hint resolves, through their owning declaration
- `relationshipTypes` is not validated against the index's stored-kind vocabulary: a misspelled kind is measured as an empty set with `truncated: false`, and `rule.relationshipTypes` echoes the misspelling so the mistake is auditable rather than disguised as "no dependents"
- Reflects the index as of the last index run; the freshness envelope and the per-dependent `stale` flags state how far that is from the files on disk

## Performance

Warm, five-run measurements on the three declared tiers, with the exact commands and raw runs in validation/tools/bb_impact/LATENCY.json. All three tiers are inside budget on the current index. Fixture tiers: p50 83.8 ms / p95 100.8 ms on test/fixtures/polyglot/ts-js and p50 176.5 ms / p95 243.5 ms on the 100-file synthetic scale fixture, both default-argument calls. Reference large index (.bb-data, 11,440 files, ~3.4 GB, measured through the tool's byte-read-only open with the index's own files hashed before and after, `dbUnchanged: true`): per-symbol p95 was 327.7 ms for the widest studied hub (`join`), 321.2 ms for `named`, 236.0 ms for `refReachable` and 153.6 ms for `computeImpact` — every measured call stayed inside the 5 s budget, and p50s were 42.9–284.2 ms. The walk's per-symbol caller query is planned through `brain_symbol_project_owner_idx` for the owner range and `brain_rel_proj_type_target_idx` for the relationship filter, so the cost is index-bounded. One correction belongs on the record: an earlier campaign measurement on THIS index returned 13.7–359.5 s for default calls, and a hand-built comparison attributed it to the engine's owner-cascade JOIN form (10,351 ms against 12.5 ms for a flat target-indexed form). That measurement predates the owner-range index and the planner state now on disk; re-measured byte-read-only on the current index, the same JOIN form answers in 1.1 ms and the walk in 40–63 ms. The absolute millisecond figures belong to the machine, so the fixture-tier numbers are the regression baselines this tool holds.

## Safety

Read-only. It does not modify source files or index data. Staleness repair, when it runs, reindexes changed files through the shared bounded auto-refresh budget and never rewrites source.

## Evidence Semantics

Impact derives from brain_relationship rows through the same graph engine the editor impact panel uses. The returned set is the engine's caller traversal under the declared dependency kinds, owner cascade, noise policy and depth; the declared total is an INDEPENDENT bounded walk under exactly that rule, so it is the size of the set the answer is a prefix of. Completeness is PROVED rather than inferred: whenever truncation was declared or the walk reached the last expandable depth, the set is measured against an unbounded walk of the same rule, so an answer that is short of the whole truth says so even when no bound fired (measured: cobra `HasAvailableFlags` answers 28 with `truncated: true` instead of 27 with `truncated: false`), and an engine row cap that hides no dependent no longer masquerades as a truncation. Evidence lives in validation/tools/bb_impact/ (AUDIT.md, LATENCY.json, probes, latency-t2-query-cost.json) and in the gate evidence of the three verifiers named below.

## Relationship to other tools

This is the bounded-impact specialist; `bb_analyze` mode `impact` aggregates the same canonical walk with file-level risk — the numbers are identical by gate.

## Staleness

Freshness modes (registered as `freshnessModes`): `impact`. Staleness surfaces as: per-dependent `stale` flag (three states: `true`/`false`, or `null` when the file is not in the index at all), the root's own `rootStale`, and a `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`). Stale files inside the answer are repaired within budget and the walk is re-run, declared in `autoRefresh`; `refresh=false` opts out. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
