# bb_analyze Reference (M9.07)

`bb_analyze` exposes graph-derived and metric analyses over the indexed project.
Modes are backed by strict engines in `src/intelligence/`. This issue builds the
engines and fixes the legacy adapters; the consolidated `bb_analyze` MCP tool is
registered in M9.18.

## Modes

| Mode | Engine | Purpose |
| --- | --- | --- |
| `callers` / `callees` / `trace` | `graph/graph-engine.ts` (M9.06) | Relationship traversal |
| `dependencies` | `analysis/dependencies.ts` | Resolved file→file dependency graph |
| `statistics` | `analysis/project-stats.ts` | Project counts |
| `complexity` | `analysis/complexity.ts` | Scope-correct complexity metrics |
| `impact` | `analysis/impact.ts` | Change blast-radius over the graph |
| coupling | `analysis/coupling.ts` | Class fan-in / fan-out |

## Coupling (`getCoupling`)

Per class:
- `incoming` = edges where the class is the **target** (fan-in).
- `outgoing` = edges where the class is the **source** (fan-out).
- `score` = incoming + outgoing.

Fix: the previous implementation counted `target_symbol_id` for **both**
directions, so outgoing always equaled incoming. Now each is a correct grouped
aggregate computed in a single pass (no per-class N+1 queries).

## Dependencies (`getFileDependencies`)

Resolution order:
1. `brain_relationship` edges of type `imports` (the indexer resolves imports
   here; `target_symbol_id` → symbol → file gives a resolved file→file edge).
2. `brain_import` rows for the raw specifier list and external-package flags.
   Note: `brain_import.resolved_symbol_id` is frequently null, so it is not the
   primary resolver.

Each dependency/dependent carries both `path` and `fileId`. Internal specifiers
that the relationship graph did not resolve fall back to basename matching — a
heuristic that can be ambiguous for identically named files in different
directories; the relationship graph is always preferred.

Fix: the previous implementation returned raw dependent **file IDs** and matched
dependents by `import_path LIKE %relative_path%` substring.

## Complexity (`analyzeComplexity`)

Each metric is a `{ value, available }` pair. Unavailable metrics report
`value: null, available: false` — never fabricated.

- `cyclomaticAvg` / `cyclomaticTotal`: from `brain_symbol.complexity`.
- `linesOfCode`: scope-consistent — function/class sum symbol spans, file uses
  that file's `line_count`, project sums all files' `line_count`.
- `couplingEdges`: relationship edges touching the scoped symbols.
- `maintainability`: computed only when symbols and LOC exist (else unavailable,
  never NaN).
- `depthOfInheritance`: **always unavailable** — real hierarchy analysis is not
  implemented, so it is not fabricated (previously hardcoded to 1).

Fixes: removed `depthOfInheritance: 1`, removed `architectural = coupling /
totalSymbols` divide-by-zero NaN, and made LOC scope-consistent.

## Impact (`analyzeImpact`)

Change blast radius using the graph engine's caller direction.

- `scope`: `direct` (depth 1), `transitive` (default, depth 3), `global` (depth 10).
- `directSymbols`: symbols that reference the target directly.
- `affectedFiles`: `{ file, via, depth, crossLanguage }`, deduped to shallowest depth.
- `transitiveFiles`, `crossLanguageFiles`, `unresolvedEdges` (external/unresolved).
- `riskLevel`: `critical` (≥20 files or any cross-language), `high` (≥8),
  `medium` (≥3), else `low`.
- `truncated`: propagated from the graph engine's budget.

Impact makes **no test-coverage claims**. The legacy adapter's `testCoverage`
field is returned as `{ hasTests:false, coverage:"none" }` with a recommendation
to run test intelligence (M9.10) — it no longer asserts coverage it never
measured.

## Verification

`script/verify-analyze.ts` (24 checks) asserts: coupling incoming≠outgoing and
score arithmetic; dependency paths (not IDs) with resolved dependents; complexity
has no NaN, unavailable metrics flagged, scope-consistent LOC; impact
direct/transitive distinction, valid risk labels, not-found handling, and the
absence of fabricated test coverage.
