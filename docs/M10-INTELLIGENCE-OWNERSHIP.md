# M10 Intelligence Ownership Matrix

This matrix records the **canonical owner** of every public intelligence
capability exposed by the ten-tool MCP surface and the CLI gateway, the
**adapter** that maps the public contract to the canonical engine, and any
**legacy duplicate** that still exists but must not be the active path.

It is the M10.03 deliverable required by issue #113: the public adapters must
route to canonical engines, canonical evidence must not be flattened into an
inferior legacy shape, and no active intelligence path may query obsolete
tables.

## Legend

- **Canonical owner** — the `src/intelligence/` module that owns the
  capability and attaches provenance at the result boundary (M10.02).
- **Public adapter** — the code in `src/mcp/tool-handlers.ts` (and the CLI
  `bb tool` gateway that delegates to it) that maps the public tool contract
  to the canonical engine.
- **Legacy path** — older code in `src/ast/tools.ts` and similar that still
  exposes the capability. Legacy paths are kept for the ordered M10 issues to
  quarantine or remove (M10.06) but they must not be the active route.
- **Disposition** — one of `keep`, `migrate`, `improve`, `quarantine`,
  `remove` per `docs/M10-EVIDENCE-GOVERNANCE.md`.

## Capability Matrix

| Tool / Mode | Canonical owner | Public adapter | Legacy path (not active) | Disposition |
| --- | --- | --- | --- | --- |
| `bb_search` (symbol) | `src/intelligence/search/symbol-search.ts` `searchSymbols` | `tool-handlers.ts` bb_search (symbol mode) | `BrainTools.searchCode` (still used by symbols mode) | keep; symbols mode routes to canonical `searchSymbols` in M10.03 via the symbol branch |
| `bb_search` (content) | `src/intelligence/search/content-search.ts` `searchContent` | `tool-handlers.ts` bb_search (content mode) | — | keep |
| `bb_search` (file) | `src/intelligence/search/symbol-search.ts` | `tool-handlers.ts` bb_search (file mode) | `BrainTools.searchCode` | keep; routes through canonical `searchSymbols` |
| `bb_ask` (NL-stat shortcuts) | `src/intelligence/search/quick-answer.ts` `quickAnswer` (stat branch) | `tool-handlers.ts` bb_ask | `BrainTools.quickAnswer` (legacy NL-stat branch) | keep stat shortcuts; canonical adapter owns them in M10.03 |
| `bb_ask` (semantic fallback) | `src/intelligence/search/semantic-search.ts` `semanticVectorSearch` | `tool-handlers.ts` bb_ask via canonical `quickAnswer` | `AdvancedBrainTools.semanticSearch` (keyword-only) | migrate; `bb_ask` semantic fallback routes to canonical `semanticVectorSearch` (provenance-bearing) in M10.03 |
| `bb_ask` (last-resort symbol) | `src/intelligence/search/symbol-search.ts` `searchSymbols` | `tool-handlers.ts` bb_ask via canonical `quickAnswer` | `BrainTools.searchCode` | migrate; last-resort symbol route uses canonical `searchSymbols` in M10.03 |
| `bb_analyze` (callers/callees/trace) | `src/intelligence/graph/graph-engine.ts` `graphTraversal` | `tool-handlers.ts` bb_analyze | `BrainTools.traceFunctionCalls`/`getFunctionCallers`/`getFunctionCallees` | keep; canonical since M9 |
| `bb_analyze` (dependencies) | `src/intelligence/analysis/dependencies.ts` `getFileDependencies` | `tool-handlers.ts` bb_analyze (dependencies) | `BrainTools.getFileDeps` | keep |
| `bb_analyze` (stats) | `src/intelligence/analysis/project-stats.ts` `getProjectStats` | `tool-handlers.ts` bb_analyze (stats) | `BrainTools.getStats` | keep |
| `bb_analyze` (complexity) | `src/intelligence/analysis/complexity.ts` `analyzeComplexity` | `tool-handlers.ts` bb_analyze (complexity) | `BrainTools.analyzeComplexity` | keep |
| `bb_analyze` (impact) | `src/intelligence/analysis/impact.ts` `analyzeImpact` | `tool-handlers.ts` bb_analyze (impact) | `BrainTools.analyzeImpact` | keep |
| `bb_analyze` (test_mapping) | `src/intelligence/testing/test-intel.ts` `testMapping` | `tool-handlers.ts` bb_analyze (test_mapping) | `TestIntelligenceBrainTools.analyzeTestIntelligence` | keep; canonical since M9, provenance since M10.02 |
| `bb_analyze` (test_gaps) | `src/intelligence/testing/test-intel.ts` `testGaps` | `tool-handlers.ts` bb_analyze (test_gaps) | `TestIntelligenceBrainTools.analyzeTestIntelligence` | keep |
| `bb_analyze` (test_impact) | `src/intelligence/testing/test-intel.ts` `testImpact` | `tool-handlers.ts` bb_analyze (test_impact) | `TestIntelligenceBrainTools.analyzeTestIntelligence` | keep |
| `bb_analyze` (test_quality) | `src/intelligence/testing/quality.ts` `testQuality` | `tool-handlers.ts` bb_analyze (test_quality) | — | keep; provenance since M10.02 |
| `bb_health` | `src/intelligence/health/health-provider.ts` `getUnifiedHealth` | `tool-handlers.ts` bb_health | — | keep; canonical since M9 |
| `bb_health` (history) | `src/intelligence/analysis/run-history.ts` | `tool-handlers.ts` bb_health (history flag) | — | keep |
| `bb_patterns` (scope=orphaned) | `src/intelligence/patterns/orphans.ts` `detectOrphans` | `tool-handlers.ts` bb_patterns (orphaned) — routes directly to canonical in M10.03 | `PatternBrainTools.findOrphanedCode` (flattens evidence) | migrate; M10.03 routes handler directly to canonical `detectOrphans` preserving the `PatternReport` (evidence + limitations + provenance) |
| `bb_patterns` (scope=all, orphan rule) | `src/intelligence/patterns/orphans.ts` `detectOrphans` (orphan rule routed to canonical in M10.03) | `tool-handlers.ts` bb_patterns (all) via `PatternBrainTools.detectPatterns` whose orphan branch now calls canonical `detectOrphans` | `PatternRecognition.detectOrphanedCode` (legacy SQL orphans, bypassed for orphan rule) | migrate; orphan rule routes to canonical `detectOrphans` with evidence, framework/anti-pattern rules remain legacy pending M10.06 calibration |
| `bb_patterns` (scope=all, framework + anti-pattern rules) | legacy — no canonical owner yet | `tool-handlers.ts` bb_patterns (all) via `PatternBrainTools.detectPatterns` | `PatternRecognition.detectFrameworkPatterns`/`detectLogicalErrors`/`detectArchitecturalViolations` | improve; M10.06 must calibrate evidence with provenance or quarantine |
| `bb_patterns` (history) | `src/intelligence/analysis/run-history.ts` | `tool-handlers.ts` bb_patterns (history flag) | — | keep |
| `bb_patterns` (recordRun) | `src/intelligence/analysis/run-history.ts` `startAnalysisRun`/`completeAnalysisRun` | `tool-handlers.ts` bb_patterns (recordRun flag) | — | keep |
| `bb_security` | `src/intelligence/security/taint.ts` `analyzeTaintFlows` | `tool-handlers.ts` bb_security via `CrossLanguageSecurityAnalysis` (thin adapter) | — | keep; `CrossLanguageSecurityAnalysis` is a thin mapping over canonical `analyzeTaintFlows`, not duplicate logic |
| `bb_security` (history) | `src/intelligence/analysis/run-history.ts` | `tool-handlers.ts` bb_security (history flag) | — | keep |
| `bb_edit` | `src/intelligence/edit/edit-engine.ts` `executeEdit` | `tool-handlers.ts` bb_edit | — | keep |
| `bb_docs` | `src/intelligence/documentation/doc-engine.ts` `generateDocumentation` | `tool-handlers.ts` bb_docs | — | keep |
| `bb_visualize` | `src/intelligence/visualization/visualization-engine.ts` `visualizeProject` | `tool-handlers.ts` bb_visualize | `DependencyGraphVisualizer` (legacy) | keep; canonical since M9 |
| `bb_migrate` | `src/intelligence/migration/migration-engine.ts` `generateMigrationPlans` | `tool-handlers.ts` bb_migrate | `CrossLanguageMigrationAssistant` (legacy) | keep; canonical since M9 |

## M10.03 Routing Changes

The following routing changes are applied by M10.03 to eliminate evidence
flattening and legacy semantic fallback:

1. **`bb_patterns scope=orphaned`** now calls canonical `detectOrphans`
   directly in the handler, preserving the full `PatternReport` (findings
   with evidence, limitations, remediation, and `provenance`). The previous
   route through `PatternBrainTools.findOrphanedCode` flattened findings into
   a legacy `{orphaned, statistics}` shape that dropped evidence,
   limitations, and provenance.

2. **`bb_ask` semantic fallback** now routes through the canonical
   `quickAnswer` adapter (`src/intelligence/search/quick-answer.ts`) which:
   - Keeps the NL-statistical shortcuts (simple SQL counts) which are not
     intelligence claims and carry no evidence requirement.
   - Routes the semantic fallback to canonical `semanticVectorSearch`
     (provenance-bearing, real vector cosine) instead of legacy
     `AdvancedBrainTools.semanticSearch` (keyword-only, no provenance).
   - Routes the last-resort symbol lookup to canonical `searchSymbols`.

3. **`bb_patterns scope=all`** orphan rule now routes to canonical
   `detectOrphans` inside `PatternBrainTools.detectPatterns` (replacing the
   legacy `PatternRecognition.detectOrphanedCode` SQL path for the orphan
   rule), mapping canonical findings — with evidence, limitations, and
   remediation — into the pattern shape. Framework (`detectFrameworkPatterns`)
   and anti-pattern (`detectLogicalErrors`, `detectArchitecturalViolations`)
   rules remain legacy pending M10.06 evidence calibration or quarantine.

4. **`bb_search` symbols mode** already routes to canonical
   `searchSymbols`: `BrainTools.searchCode` is a one-line delegation to
   `src/intelligence/search/symbol-search.ts`. No other change is needed for
   this tool.

## Provenance Coverage After M10.03

| Capability | Provenance owner | Evidence class |
| --- | --- | --- |
| semantic search (bb_ask fallback) | `semanticVectorSearch` | `semantic_candidate` |
| orphan detection (bb_patterns orphaned) | `detectOrphans` | `static_finding` |
| graph traversal (bb_analyze callers/callees/trace) | `graphTraversal` | `inferred` |
| impact (bb_analyze impact) | `analyzeImpact` | (M10.04 — pending) |
| taint security (bb_security) | `analyzeTaintFlows` | `static_finding` |
| test mapping/gaps/impact (bb_analyze test_*) | `testMapping`/`testGaps`/`testImpact` | `inferred` |
| test quality (bb_analyze test_quality) | `testQuality` | `static_finding` |

Capabilities still missing provenance after M10.03 (deferred to M10.04):
analyze `impact`/`coupling`/`dependency`/`stats` modes, framework and
anti-pattern rules in `bb_patterns scope=all`.

## Obsolete Table Audit

M10.03 confirms no **active** intelligence path (any code reachable from a
public tool handler or CLI gateway) queries obsolete `sentinel_*` tables or
any table outside the canonical `brain_*` schema.

- `BrainTools.quickAnswer` NL-stat branch: queries `brain_symbol`,
  `brain_relationship`, `brain_import`, `brain_file` — all canonical.
- `PatternBrainTools.findOrphanedCode` / `detectOrphanedCode`: delegates to
  canonical `detectOrphans` which queries `brain_symbol`, `brain_relationship`,
  `brain_file` — all canonical.
- `AdvancedBrainTools.semanticSearch` (no longer active for bb_ask after
  M10.03): `performSemanticKeywordSearch` queries `brain_symbol`/`brain_file`.
- Sentinel persistence (`sentinel_runs`, `sentinel_findings`) is reachable
  only via `BrainTools.sentinel()` which is not called by any handler or CLI
  gateway. M10.06 will quarantine/remove.

## Residual Risks

- Framework and anti-pattern rules in `bb_patterns scope=all` remain
  legacy heuristics without provenance. M10.06 must calibrate evidence or
  quarantine.
- `analyzeImpact`, `getFileDependencies`, `getProjectStats`,
  `analyzeComplexity`, and `graphTraversal` now carry `provenance` (M10.04
  fixed).
- The legacy `BrainTools.quickAnswer` and `AdvancedBrainTools.semanticSearch`
  remain in `src/ast/tools.ts` as dead-but-reachable code. M10.06 owns their
  quarantine or removal.
- `script/verify-m10-benchmarks.ts` emits `docs/data/m10-benchmark-last-run.json`
  with measurement artifacts; budgets are declared in `docs/M10-BENCHMARKS.md`
  and `docs/data/m10-benchmark-baseline.json`.
- `script/demo-tools.ts` remains an untracked developer script and is not part
  of any M10 issue.
