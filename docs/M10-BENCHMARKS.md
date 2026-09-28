# M10.05 Correctness and Performance Regression Budgets

This document declares the *numeric* budgets that gate M10.05. They are
declared **before** measuring any results. Any change to these budgets must
be reasoned in a follow-up commit; no retreating to make a regression pass.

## Scope of correctness

| Capability | Correctness invariant | Owner |
| --- | --- | --- |
| Public tool contract | Exactly 10 registered tools with baseline descriptors in `docs/data/m10-baseline.json` (runtimeMcp + cli + libraryExports unchanged) | `tool-registry.ts`, `cli/index.ts` |
| Search (symbol, content, file) | Returns stable, freshness-aware results; known queries hit known symbols on the contract fixture | `verify-search-modes.ts`, `verify-contracts.ts` |
| Semantic search | Uses the `brain_semantic_embedding` vectors or a documented keyword fallback; provenance attached; method is `vector` or `keyword-fallback` | `verify-semantic.ts` + `quickAnswer` fallback |
| Graph traversal | `callers/callees/trace/both` produce bounded, stable output; graph result has provenance | `verify-graph.ts` |
| Patterns (orphan rule) | Returns evidence-bearing findings with exact `linesOfCode` and limitations; provenance attached | `verify-patterns.ts` + `verify-intelligence-consolidation.ts` |
| Security | Uses canonical `analyzeTaintFlows`; findings have state, mitigated, and provenance metadata | `verify-security.ts` |
| Test mapping / gaps / impact / quality | Returns evidence-bearing reports with `runtimeCoverage.available === false` separate from static evidence | `verify-test-intel.ts` + `verify-test-quality.ts` |
| Documentation | `bb_doc` returns citation-backed structured docs | `verify-doc.ts` |
| Visualization / Migration | Return typed results; visualization and migration remain wired to canonical engine adapters | `verify-visualize-migrate.ts` |
| Edit | Writes return reconciliation results; no panics on missing file | `verify-edit.ts` |
| Health | `bb_health refresh` returns bounded report (wait/warning states handled) | `verify-health.ts` |

| Capability | Evidence-class invariant |
| --- | --- |
| Semantic candidates | `semantic.provenance.evidenceClass === "semantic_candidate"` and `provenance.limitations` includes "candidate discovery" |
| Orphans | `static_finding` with exact `location`, `evidence`, `limitations`, non-`safe to remove` remediation |
| Taint security | `static_finding` with state classification (`confirmed`/`mitigated`/`unresolved`/`source_only`) |
| Test mapping/gaps/impact | `inferred` with explicit `runtimeCoverage.available === false` (never conflated with static) |
| Complexity/stats/dependencies/impact | `indexed` or `inferred` with declared limitations |

## Performance budgets (declared cold)

We run on a 6-core CI/workstation with Bun 1.3+. Budgets are per-call SLO
p99.9 on the contract fixture (small codebase, indexed cache warm):

| Operation | Budget |
| --- | --- |
| `bb_search` (symbol) | <= 400ms cold, <= 100ms hot |
| `bb_ask` (stat shortcut) | <= 300ms |
| `bb_ask` (semantic fallback) | <= 2.5s (embedding call dominates) |
| `bb_search` (content) | <= 500ms |
| `bb_analyze` (graph traversal depth<=3) | <= 400ms |
| `bb_patterns` (orphan scan) | <= 600ms |
| `bb_patterns` (full pattern scan, maxResults<=100) | <= 1.5s |
| `bb_security` (taint scan) | <= 1.2s |
| `bb_health` (status, no refresh) | <= 800ms |
| `bb_health` (refresh, wait=true) | <= 60s |
| `bb_visualize` (project scope) | <= 1.0s |
| `bb_migrate` (plan, 1-3 symbols) | <= 2.0s |
| `bb_doc` (symbol|project) | <= 2.5s |
| `bb_edit` (write) | <= 300ms |
| Index cold (fixture ~12 files) | <= 8s |
| Index warm reindex single file | <= 1.5s |

These budgets are **upper bounds**, not targets. They are declared before measurement
and are kept as SLO *limits*; tightening them is allowed only after
publishing a delta with justification. These are soft budgets used by
verification to catch regressions: exceeding them is a budget violation,
not a correctness failure.

## MCP/CLI parity

`bb tool` (CLI) and MCP `tools/call` share the same centralized handlers in
`src/mcp/tool-handlers.ts`. Parity invariants:

- Same tool names on both surfaces (`mcp tools/list` == baseline `runtimeMcp.toolNames`).
- Same validation layer (`validateToolArguments` rejects unknown fields,
  missing required, enum mismatches, out-of-bounds numerics — identical
  behavior on both surfaces, verified by `verify-mcp.ts` and CLI gateway E2E).

## Embedding model parity rules

Do **not** compare a local embedding model with a remote model and brand the
results equivalent. Guardrails:

- `semanticVectorSearch` records `queryModel`/`indexModel`/`dimension` in
  `SemanticSearchResults.metadata`. The verifier asserts `queryModel === indexModel`
  and `method` matches the *actual* path taken (vector vs keyword-fallback).
- If the embedding model is changed, the benchmark re-runs with the new model,
  old vector baselines are cleared, and scores are re-declared with the new
  model's name in `docs/data/m10-benchmark-baseline.json`.

## Rules

- Thresholds are declared in this doc and in `docs/data/m10-benchmark-baseline.json`.
- Correctness regressions block closure regardless of speed.
- No comparisons between incompatible embedding models or runtime
  configurations as if they were equivalent.
- Every baseline difference must be explained in closure evidence.
- Verifier emits `docs/data/m10-benchmark-last-run.json` on every run;
  it is treated as the artifact of measured results.

## Residual risks

- Performance budgets are SLO upper bounds, not formal hardware regressions;
  CI machines with different disk/CPU profiles may exceed them without an
  apples-to-apples baseline. Budgets are chosen to be attainable on commodity
  development hardware.
- `bb_health refresh` can be dominated by indexing cold start; the budget is
  defined for the small contract fixture. Large-monorepo budgets come via a
  follow-up iteration that introduces a heavier fixture.
