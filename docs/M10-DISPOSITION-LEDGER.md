# M10 Intelligence Disposition Ledger

This is the initial, evidence-backed hypothesis ledger created by M10.01. It is not permission
to delete anything. Each row must be confirmed or overturned by the ordered M10 issues, with
caller, import, export, schema, fixture, verification, and public-contract evidence.

| Capability | Evidence observed | Initial decision | Decision owner |
| --- | --- | --- | --- |
| Canonical static test mapping, gaps, impact | `src/intelligence/testing/test-intel.ts`; `verify-test-intel.ts` | `keep` and `improve` | M10.02 (done — provenance); M10.04 (analysis-runs) |
| Canonical test quality | `src/intelligence/testing/quality.ts`; `verify-test-quality.ts` | `keep` and `improve` | M10.02 (done — provenance) |
| Test suggestions engine | `src/intelligence/testing/suggestions.ts`; contract exists; public mode absent | `migrate` or explicitly quarantine | M10.06 |
| Sentinel command multiplexer | `src/ast/tools.ts`; callers are internal legacy aggregation; obsolete persistence queries | `migrate` useful orchestration or `remove` | M10.06 |
| Sentinel trap/API/auth/PII/CVE commands | Empty arrays/objects returned as successful results | `remove` unless rebuilt with real evidence | M10.06 |
| Sentinel regex security rules | Source regex findings; overlaps taint engine | `migrate` useful rules with calibrated provenance | M10.06 |
| Sentinel patrol/status/report/verify storage | References `sentinel_runs` and `sentinel_findings` | `remove` legacy persistence; use analysis history | M10.04/M10.06 |
| Canonical taint security engine | `src/intelligence/security/taint.ts`; `verify-security.ts` | `keep` — provenance confirmed M10.02; thin adapter blessed M10.03 | M10.03 (done) |
| Canonical orphan engine | `src/intelligence/patterns/orphans.ts`; `verify-patterns.ts` | `keep` — adapter routes direct, evidence preserved M10.03 | M10.03 (done) |
| Broad legacy pattern aggregator | `PatternBrainTools.detectPatterns()` and legacy `tools.ts` rules | orphan rule migrated to canonical M10.03; framework/anti-pattern rules remain for M10.06 calibration or quarantine | M10.03 (orphan rule done); M10.06 |
| Legacy architecture intelligence | `revolutionaryArchitectureIntelligence()`; heuristic detectors; no direct coverage | `improve` into evidence-backed rules or `remove` | M10.06 |
| Architecture superiority claims | "WORLD'S FIRST", "revolutionary", "no other tool" | `remove` and replace with factual scope | M10.06 |
| Analysis run/finding history | `brain_analysis_*`; `verify-analysis-history.ts` + `verify-analysis-governance.ts`; governance doc + executeAnalysis wrapper | `keep` — M10.04 schema migration (evidence/limitations/location/provenance), deterministic ordering, shared executeAnalysis wrapper all done | M10.04 (done) |
| Canonical semantic search | `src/intelligence/search/semantic-search.ts`; `verify-semantic.ts` | `keep` — bb_ask fallback now routes to canonical, provenance-bearing M10.03 | M10.03 (done) |
| Legacy quick-answer adapter | `BrainTools.quickAnswer()` superseded by canonical `src/intelligence/search/quick-answer.ts` M10.03 | `migrate` done — active bb_ask routes to canonical; legacy export quarantined for removal | M10.03 (done active path); M10.06 (remove legacy export) |
| Canonical graph and impact | `src/intelligence/graph`, `analysis/impact`; verifiers | `keep` — provenance attached M10.04; budget declared M10.05 | M10.04 (provenance done); M10.05 (budget done) |
| Legacy visualization projection | `src/ast/dependency-graph-visualizer.ts` behind canonical adapter | `migrate` or quarantine adapter | M10.06 |
| Legacy migration internals | AST cross-language intelligence and migration assistant | `migrate` behind typed canonical plan | M10.06 |
| Canonical documentation engine | `src/intelligence/documentation/doc-engine.ts`; `verify-doc.ts` | `keep` and improve direct coverage | keep |
| Root Bun storage export | `src/index.ts` exports `./storage/db.bun` | `improve` or explicitly document runtime boundary | M10.07 |
| `@ts-nocheck` and oversized legacy modules | Current architecture/complexity inventory | `improve`, split, quarantine, or remove based on callers | M10.06 |

## Ledger Rules

- `keep` does not mean perfect; it means valuable enough to remain canonical while gaps are named.

## Obsolete persistence markers audited by M10.06

These markers are expected to be absent from shipped source after M10.06 (see ledger and public surface checkers).

| Marker | Was | Now |
| --- | --- | --- |
| sentinel_runs | Legacy Sentinel orchestration table | Removed (not used by active handlers) |
| sentinel_findings | Legacy Sentinel findings table | Removed (not used by active handlers) |
| FROM symbols | Alias for non-canonical pre-brain_* schema | Removed (canonical brain_symbol survives) |
| FROM files | Alias for non-canonical pre-brain_* schema | Removed (canonical brain_file survives) |
| symbol_relationships | Alias for non-canonical pre-brain_* schema | Removed (canonical brain_relationship survives) |
- `migrate` requires fixture comparison before behavior is moved.
- `improve` requires a measurable acceptance target before implementation.
- `quarantine` requires an owner, compatibility/research rationale, and removal criteria.
- `remove` requires deletion-safety evidence and a verified replacement when behavior is expected.
- No row may be marked final from this initial hypothesis alone.
