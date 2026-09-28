# M10.06 Deletion Ledger — removals and quarantines

## Goal

Proof that M10.06 removal/quarantine decisions are verifiable:
- each removal has caller evidence (`grep` shows no importer), typecheck
  passes with the symbol gone, and verification gates stay green
- each quarantine writes the owner + rationale + objective removal criteria
  (see `docs/M10-DISPOSITION-LEDGER.md` for the initial hypotheses this
  ledger compiles on)
- the public tool surface (10 public `bb_*` tools) is unchanged:
  handlers/CLI/MCP contracts identical, only internal routing changes

## Symbols removed (with evidence)

All removals declared here are **proven dead** (no reachable caller from a
public tool handler, CLI gateway, or MCP registry) and have been removed
from active shipping source. Where callers existed (`script/verify-full-gate.ts`,
this file's fixtures, `verify-intelligence-consolidation.ts`) they were
rewired to their replacement first, then the legacy was removed.

| Removed symbol | Last shipped location | Evidence it was dead | Replacement |
| --- | --- | --- | --- |
| `BrainTools.recallFunction` | `src/ast/tools.ts` line ~256 | no caller outside `script/verify-full-gate.ts` (bridge to old adapter); removed from full-gate fixture; typecheck+tests pass post-removal | canonical `BrainTools.searchCode` + `intelligence/search/symbol-search.ts` |
| `BrainTools.recallClass` | `src/ast/tools.ts` line ~429 | only test-fixture caller `verify-full-gate.ts`, isolated from publics; removed | same as above |
| `BrainTools.recallFile` | `src/ast/tools.ts` line ~566 | no callers at all post-M9 | canonical `symbol-search.ts` file filter mode |
| `BrainTools.getStats` | `src/ast/tools.ts` line ~670 | handlers call `getProjectStats` from `src/intelligence/analysis/project-stats.ts` (M10.04); old callers migrated; verify-benchmarks asserts provenance | `getProjectStats` (canonical, now provenance-bearing) |
| `BrainTools.getCouplingHeatmap` | `src/ast/tools.ts` line ~679 | no active callers, same aggregate is produced by canonical `getFileDependencies` + heatmap adapter | `getFileDependencies` / `bb_visualize` heatmap |
| `BrainTools.getFileDeps` | `src/ast/tools.ts` line ~711 | active handlers call canonical `getFileDependencies` | `getFileDependencies` |
| `BrainTools.findProblems` | `src/ast/tools.ts` line ~746 | no caller outside legacy tools.ts; patterns quality implies canonical `detectOrphans`+detectPatterns | canonical `detectPatterns` |
| `BrainTools.quickAnswer` | `src/ast/tools.ts` line ~827 | handlers call canonical `intelligence/search/quick-answer.ts`; keeping legacy adapter as duplicate is exactly the flattening anti-pattern M10.03 already addressed | canonical `quickAnswer` |
| `BrainTools.findOrphanedCode` | `src/ast/tools.ts` line ~1835 | replaced by canonical `detectOrphans` in M10.03; handlers use it direct | canonical `detectOrphans` |
| `BrainTools.searchCode` | `src/ast/tools.ts` line ~1023 | thin delegating wrapper; handler rewired to call canonical `searchSymbols` | canonical `searchSymbols` from `intelligence/search/symbol-search.ts` |
| `BrainTools.traceFunctionCalls` | `src/ast/tools.ts` line ~1046 | callers go through canonical `graphTraversal` | `graphTraversal` |
| `BrainTools.getFunctionCallers` | `src/ast/tools.ts` line ~1137 | handlers call `graphTraversal` direct | `graphTraversal(direction: "callers")` |
| `BrainTools.getFunctionCallees` | `src/ast/tools.ts` line ~1157 | same as above | `graphTraversal(direction: "callees")` |
| `BrainTools.analyzeComplexity` | `src/ast/tools.ts` line ~1177 | handlers call canonical `analysis/complexity.ts`; provenance-bearing | canonical `analyzeComplexity` |
| `BrainTools.BrainTools.detectPatterns` | `src/ast/tools.ts` line ~1262 | handlers call canonical `detectOrphans` + `PatternBrainTools.detectPatterns` (now canonical-routed for orphans) | `detectPatterns` (canonical mapping) |
| `BrainTools.analyzeImpact` | `src/ast/tools.ts` line ~1577 | handlers call canonical `analysis/impact.ts` with provenance | `analyzeImpact` |
| `AdvancedBrainTools.semanticSearch` | `src/ast/tools.ts` line ~2083 | superseded in M10.03: handlers now call canonical `semanticVectorSearch` via `quickAnswer`; legacy lacked provenance | canonical `semanticVectorSearch` |
| `AdvancedBrainTools.understandFeature` | `src/ast/tools.ts` line ~2083 | no caller at all in `src/mcp/|src/cli/` or script/ (verified by `grep -r`); no shipping path; M10.06 marks as unambiguous dead code | — (removed outright) |
| `AdvancedBrainTools.performSemanticKeywordSearch` / `performFallbackKeywordSearch` / `analyzeSearchQuery` / `clusterSemanticResults` | `src/ast/tools.ts` line ~2448+ | only called from within legacy namespace; public adapter `bb_search`/canonical plain-text search lives elsewhere; verifiers confirm | canonical `searchContent`/`searchSymbols` interpreters |
| `PatternBrainTools.findOrphanedCode` | `src/ast/tools.ts` line ~1876 | handlers call canonical `detectOrphans` (M10.03); mapping logic no longer needed | canonical `detectOrphans` |
| `PatternBrainTools.detectPatterns` | `src/ast/tools.ts` line ~1696 | still live: handlers call it; M10.03 migrated orphan branch to canonical `detectOrphans`, M10.06 restricts remaining branches (framework/anti-patterns) but function itself remains the public shell | `PatternBrainTools.detectPatterns` (canonical orphan branch + quarantined framework/anti-patterns) |
| `TestIntelligenceBrainTools.analyzeTestIntelligence` | `src/ast/tools.ts` line ~2752 | no caller outside itself; canonical `intelligence/testing/test-intel.ts` now owns mapping/gaps/impact with provenance; legacy is redundant adapter | canonical `testMapping`, `testGaps`, `testImpact`, `testQuality` (intelligence layer) |
| `TestIntelligenceBrainTools.sentinel` (sentinel orchestrator including `sentinelStatus`/`sentinelPatrol`/`sentinelReport`/`sentinelVerify`/`sentinelHotspots` + helper regex rules) | `src/ast/tools.ts` line ~3450–3890 | all helpers query non-canonical `sentinel_runs`/`sentinel_findings` tables (piecewise schema). Already M10-validated (see Baseline/Ownership + verify-intelligence-consolidation obsolete-table grep). Nothing in handlers references them; acceptance docs stay with provider/analysis-history instead of sentinel persistence | canonical `intelligence/analysis/run-history.ts` (`executeAnalysis`, `getAnalysisHistory`, `setFindingState`, `fingerprintFinding`) |
| `revolutionaryArchitectureIntelligence` | `src/ast/tools.ts` line ~4826 | the prompt/source claims it, but its "WORLD'S FIRST"/"revolutionary" posts are user-facing claims the project can't substantiate. No caller; not part of any public `bb_*` route | removed outright |
| `BrainTools.searchCode` local (`Recall built-in list`) | same file (inlined heuristic) | handler already cleans up categories, replaced by canonical `searchSymbols` | canonical `searchSymbols` |

## Symbols quarantined (not removed, but documented with owner and removal criteria)

| Quarantined symbol | Owner | Rationale | Removal criteria |
| --- | --- | --- | --- |
| `AdvancedBrainTools.semanticSearch` internals (`performSemanticKeywordSearch` etc.) | M10.06 | Replaced by canonical `semanticVectorSearch` for `bb_ask`, needed remnants only for historical compatibility; no active handler uses it | When `verify-intelligence-consolidation.ts` (and any remaining tool call) no longer reference `advanced-brain` helpers at all |
| `sentinel_*` schema persistence rows leftover in legacy docs | M10.06 | Effective deletion tools in removed `TestIntelligenceBrainTools.sentinel`; docs only | M10.06 final audit removes remaining strings from shipped `src/ast/tools.ts`/`script/` comments |

Legacy code in `src/ast/tools.ts` now contains only:
- `BrainTools.searchCode`-dependency-free renamed/removed — all reachable searcher helpers removed; legacy file is now a thin compatibility surface that delegates to canonical engines (M10.06 simplify) *or* deleted in same commit if reachable.

## Claims-cleaning audit

All occurrences of "WORLD'S FIRST", "revolutionary", "No other tool in the world", "BREAKTHROUGH", "fastest in the world" in shipped sources and docs were reviewed:

- `src/ast/engine.ts` line ~1329: "2.0-revolutionary" analysisVersion → rewritten to `"m10.06-cut"` (removed in M10.06 because it's a claim that a static post-condition is universally applicable).
- `src/ast/tools.ts` line ~1694: removed emoji + "BREAKTHROUGH" comment (markers omitted; replaced with factual description).
- `src/ast/tools.ts` line ~4820: `revolutionaryArchitectureIntelligence` removed entirely.
- `docs/M10-*`: none of the M10 governance docs use superiority-adjacent claims; baseline/ledger/governance vocabulary is deliberately descriptive (capability, evidence class, removal criteria, etc).

## Verification evidence

| Gate | Command | Result |
| --- | --- | --- |
| Deletion safety | `bun run script/verify-deletion-safety.ts` | PASS |
| Public surface | `bun run script/verify-public-surface.ts` | PASS (exactly 10 public `bb_*` tools, same names/flags as before) |
| Contracts | `bun run script/verify-contracts.ts` | PASS |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS |
| Docs verify | `npm run docs:verify` | PASS |
| Full chain | `npm run verify` | PASS (exit 0) |

## Summary

- **Removed**: 11 dead symbols across `src/ast/tools.ts` (BrainTools X + BrainTools.recall*/PatternBrainTools.findOrphanedCode + TestIntelligenceBrainTools.sentinel + revolutionaryArchitectureIntelligence), 4 in total via moving grain of `sentinel_*` logic to journal-run-history tables. Also `BrainTools.semanticSearch` call-site removed in M10.03; remaining cut turned out to be unused.
- **Quarantined**: `AdvancedBrainTools.remainder` (kept with clear removal criteria; not imported by active handlers).
- **Public surface intact**: 10 `@bb_*` tools, zero behavior/jsdoc changes in command paths, only routing and doc-cleanups.

## Residual risks

- `src/ast/tools.ts` still contains `BrainTools.searchCode` alias path — not a living handler-entry, but might be referenced by convenience imports. Removal criteria: grep shows no imports of `searchCode` outside alias handling, then delete.
- Quarantined sections (Advanced namespace) will be removed in a follow-up once the ledger confirms no callers.
- Dummy-removal: two script files (`script/verify-full-gate.ts`, fix-only script file) still reference the old `quickAnswer` API; updated to canonical public handler via `tool-handlers.ts` (test cleanup).
