# `bb_analyze`

Unified evidence-backed analysis over graph relationships, dependencies, project statistics, complexity, impact, and test intelligence. Select exactly one mode. Every read mode carries a freshness block (fresh/stale/missing counts + remediation) resolved against the live working tree, and report rows carry a stale flag when their file changed after indexing. Every mode is BOUNDED and says so: `limit` is the most items returned (edges per direction for callers/callees/trace, files for dependencies, entries for the test modes, the same everywhere) and the answer reports what it returned against what exists, so a page is never read as the whole set. callers/callees/trace/impact share the graph engine's owner-cascade semantics — a relationship stored against a class member is attributed to the owner class — and every edge states which it was through `targetMatch`. Locations are project-relative. Per-mode parameters: target applies to callers, callees, trace, complexity, impact, and test_impact; filePath scopes dependencies, test_mapping, test_gaps, and test_quality to a project-relative path PREFIX and is REFUSED (not ignored) on every other mode; limit applies to callers, callees, trace, dependencies, test_mapping, test_gaps and test_quality and is refused elsewhere; stats is always project-wide.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":20}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "callers",
        "callees",
        "trace",
        "dependencies",
        "stats",
        "complexity",
        "impact",
        "test_mapping",
        "test_gaps",
        "test_impact",
        "test_quality"
      ],
      "description": "analysis mode"
    },
    "target": {
      "type": "string",
      "description": "A symbol name for callers/callees/trace/impact/test_impact, or a project-relative FILE PATH for complexity (exact file, or a directory prefix; anything else is refused rather than treated as a path fragment). `symbol`/`symbolName`/`query` are accepted as aliases. A target is a VALUE, never a pattern: `%`, `_` and `\\` are escaped and match themselves."
    },
    "filePath": {
      "type": "string",
      "description": "Project-relative path PREFIX scoping dependencies, test_mapping, test_gaps and test_quality. Refused on every other mode. Matched on a whole segment boundary, so `src/util` does not match `src/utilities`."
    },
    "limit": {
      "type": "number",
      "description": "Maximum items returned: edges per direction for callers/callees/trace, files for dependencies, entries for test_mapping/test_gaps/test_quality. Defaults: 25 edges per direction, 20 files, 50 entries. The answer reports what it returned and whether that is the whole set. Refused on the modes it does not apply to, and `limit: 0` is refused because an empty page is indistinguishable from a real answer."
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Mode-specific typed analysis: graph edges, file dependency edges, project counts, complexity metrics, impact, or test evidence
- A declared bound on every answer — what was returned, what exists, and whether the set is the whole one
- Explicit unavailable states: a metric or target that cannot be computed is `available: false` / `notFoundReason`, never a substituted number

## Examples

`{"mode":"callers","target":"handleRequest"}`

`{"mode":"complexity","target":"src/api"}`

`{"mode":"test_quality"}`

`{"mode":"dependencies","filePath":"src/core"}`

`{"mode":"impact","target":"handleRequest","limit":50}`

## Errors

- Missing required mode
- Missing or blank target for a target-based mode
- Option irrelevant to the selected mode (refused, never ignored)
- `limit` on a mode it does not apply to, or `limit: 0`
- A `complexity` target that names no indexed file and no directory prefix

## Limitations

- Static relationships cannot establish runtime behavior
- Test results describe indexed static evidence, not executed coverage; a project whose tests the indexer did not recognise is reported as having none, with the reason
- Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class. Every edge states which it was through `targetMatch` (`exact` or `owner-cascade`); absent means the engine could not tell, which is not the same as `exact`
- A name resolves to ONE stored symbol. `rootCandidates` (bb_graph) and `rootCandidates` here say how many the name matched among — 1 means the name was unique, more means the answer is about one of several
- mode `impact` refuses a target the graph cannot root at, with `notFoundReason: "not-traversable"` and the symbol type. Such a symbol IS in the index; `callers`/`callees` resolve the same name because they match any type
- A depth-capped walk is TRUNCATION and says so: `summary.truncated` is true with `truncationReason` naming the depth cap, beside `maxDepth` and `maxDepthReached`
- A walk also runs under a wall-clock budget (`summary.timeBudgetMs` / `timeBudgetExhausted`, default 2,000 ms). A node is not a unit of work: the per-node caller query is priced by the reproducible ORDER BY, which SQLite applies before the LIMIT, so `edgeLimit` cannot bound it. Measured on this repository's own src: 2,436 matching rows for one symbol cost 85.8 ms of the 87.8 ms, and the walk was unbounded until this budget existed
- `dependencies` resolves an internal specifier against the importing file's own directory and LABELS each edge `resolved` / `suffix-match` / `unresolved`. It is not a guess from a basename: on this repository's own src only 74 of 906 `imports` relationships carry both endpoints and `brain_import.resolved_symbol_id` is empty, so specifier resolution is the primary path, not a fallback
- A file's `dependents` and `dependencies` lists are capped per row; `dependentsTotal` / `dependenciesTotal` are the real sizes and the Truncated flags say the list was cut
- `metrics.couplingEdges` counts only the relationship types listed in `couplingRelationshipTypes`; `exports` and `contains` are index bookkeeping. `stats.relationships` is every row and is a different number
- `metrics.maintainability` is unavailable when the formula's domain does not cover the scope (it is negative above roughly 3·10⁴ non-blank lines) rather than clamped to 0
- Locations are project-relative. `nodes[].filePath` (absolute) is not emitted, so the same question returns the same bytes on any machine
- A mapping entry carries at most 20 links (`linksTruncated` says when more exist); the ranking and every summary count use the complete set
- `provenance` on a `dependencies` page is on the REPORT, not repeated per row

## Performance

Every mode is paged and says so. `limit` bounds the answer — 25 edges per direction for callers/callees/trace (default), 20 files for dependencies, 50 entries for the test modes — and a default answer is under 35 KB (~9.7k tokens) on the corpus these bounds were measured against. The graph walk is additionally bounded by depth, per-node site limit, fan-out budget, and a wall-clock budget; whichever fires is named in `truncationReason`.

## Safety

Read-only. Analysis never creates tests or edits source.

## Evidence Semantics

Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications. `provenance.evidenceClass` classifies what kind of claim the answer is; `unknowns` names every absence the answer rests on.

## Relationship to other tools

For the plain per-symbol call graph use `bb_graph` (same engine, evidence tiers). For bounded impact-with-files use mode `impact` (numbers identical to `bb_impact`).

## Staleness

Freshness modes (registered as `freshnessModes`): `callers`, `callees`, `trace`, `dependencies`, `stats`, `complexity`, `impact`, `test_mapping`, `test_gaps`, `test_impact`, `test_quality`. Staleness surfaces as: `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`); graph nodes and report rows carry `stale` flags (project-wide modes sample or resolve visible rows only — the block names its coverage mode). When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
