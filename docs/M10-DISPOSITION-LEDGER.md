# M10 Intelligence Disposition Ledger

This is the initial, evidence-backed hypothesis ledger created by M10.01. It is not permission
to delete anything. Each row must be confirmed or overturned by the ordered M10 issues, with
caller, import, export, schema, fixture, verification, and public-contract evidence.

| Capability | Evidence observed | Initial decision | Decision owner |
| --- | --- | --- | --- |
| Canonical static test mapping, gaps, impact | `src/intelligence/testing/test-intel.ts`; `verify-test-intel.ts` | `keep` and `improve` | M10.02/M10.03/M10.04 |
| Canonical test quality | `src/intelligence/testing/quality.ts`; `verify-test-quality.ts` | `keep` and `improve` | M10.02/M10.03 |
| Test suggestions engine | `src/intelligence/testing/suggestions.ts`; contract exists; public mode absent | `migrate` or explicitly quarantine | M10.03 |
| Sentinel command multiplexer | `src/ast/tools.ts`; callers are internal legacy aggregation; obsolete persistence queries | `migrate` useful orchestration or `remove` | M10.06 |
| Sentinel trap/API/auth/PII/CVE commands | Empty arrays/objects returned as successful results | `remove` unless rebuilt with real evidence | M10.06 |
| Sentinel regex security rules | Source regex findings; overlaps taint engine | `migrate` useful rules with calibrated provenance | M10.03/M10.06 |
| Sentinel patrol/status/report/verify storage | References `sentinel_runs` and `sentinel_findings` | `remove` legacy persistence; use analysis history | M10.04/M10.06 |
| Canonical taint security engine | `src/intelligence/security/taint.ts`; `verify-security.ts` | `keep` and `improve public adapter` | M10.02/M10.03 |
| Canonical orphan engine | `src/intelligence/patterns/orphans.ts`; `verify-patterns.ts` | `keep` and improve adapter | M10.03 |
| Broad legacy pattern aggregator | `PatternBrainTools.detectPatterns()` and legacy `tools.ts` rules | `migrate` verified rules or `remove` duplicates | M10.03/M10.06 |
| Legacy architecture intelligence | `revolutionaryArchitectureIntelligence()`; heuristic detectors; no direct coverage | `improve` into evidence-backed rules or `remove` | M10.03/M10.06 |
| Architecture superiority claims | “WORLD’S FIRST”, “revolutionary”, “no other tool” | `remove` and replace with factual scope | M10.06 |
| Analysis run/finding history | `brain_analysis_*`; `verify-analysis-history.ts` | `keep` and improve shared orchestration | M10.04 |
| Canonical semantic search | `src/intelligence/search/semantic-search.ts`; `verify-semantic.ts` | `keep` and improve public exposure | M10.03 |
| Legacy quick-answer adapter | `BrainTools.quickAnswer()` used by `bb_ask` | `migrate` to preserve evidence metadata | M10.03 |
| Canonical graph and impact | `src/intelligence/graph`, `analysis/impact`; verifiers | `keep` and improve options/coverage | M10.03 |
| Legacy visualization projection | `src/ast/dependency-graph-visualizer.ts` behind canonical adapter | `migrate` or quarantine adapter | M10.03 |
| Legacy migration internals | AST cross-language intelligence and migration assistant | `migrate` behind typed canonical plan | M10.03 |
| Canonical documentation engine | `src/intelligence/documentation/doc-engine.ts`; `verify-doc.ts` | `keep` and improve direct coverage | M10.03 |
| Root Bun storage export | `src/index.ts` exports `./storage/db.bun` | `improve` or explicitly document runtime boundary | M10.03/M10.07 |
| `@ts-nocheck` and oversized legacy modules | Current architecture/complexity inventory | `improve`, split, quarantine, or remove based on callers | M10.03/M10.06 |

## Ledger Rules

- `keep` does not mean perfect; it means valuable enough to remain canonical while gaps are named.
- `migrate` requires fixture comparison before behavior is moved.
- `improve` requires a measurable acceptance target before implementation.
- `quarantine` requires an owner, compatibility/research rationale, and removal criteria.
- `remove` requires deletion-safety evidence and a verified replacement when behavior is expected.
- No row may be marked final from this initial hypothesis alone.
