# Re-verification after residual closure (landed HEAD `7c31d2c03`)

Clean worktree `.tools/wt-final2` at `main` HEAD; bb 0.1.6. This run re-verifies the two lane
close-outs' fixes and the campaign gates they touch, on the LANDED tree.

## Commits verified
`ee45e176d` (R1: `ASTEngine.findSymbol` fileId identity + edit-engine/bb_search path use),
`39f69b4b5` (test-intel/test-quality docs rewrite), `7c31d2c03` (docs closure), plus the earlier
lane close-out commits `41dc91ecc`, `f3ce5b57a`.

## Gates on landed HEAD (all run here, outputs captured)
| gate | result |
|---|---|
| `npx tsc --noEmit` | exit 2 — **1 error only**, `src/ast/real-csharp-analyzer.ts` (another lane's committed change); 0 in campaign files |
| `npm run build` | exit 0 ("Build success in 2167ms") |
| `npm run verify:dist` | exit 0 — 156 chunks / 1069 refs / entry present |
| `script/verify-retrieval-contract.ts` | **48/48** (3 new engine-level assertions for R1) |
| `m13/verify-edit-rename` | E2 **92/92** (24 negatives) |
| `m15/verify-edit-crossfile` | E8 8/8 (and E4/E5 in the same run) |
| `m13/verify-edit-freshness` | E5 **14/14** (5 negatives) |
| `m13/verify-edit-honesty` | E11 **10/10** |
| `m13/verify-edit-batch` | E13 **61/61** (19 negatives; needs the built dist for its wire case) |
| `m71/verify-refactor-safety` | **23/23** |
| `verify-search-modes` | S1 **48/48** |
| `m31/verify-bb-docs-truth` | **PASS 71/71** |
| `verify-tool-docs` | **PASS** (16 tools / 18 artifacts; needs `npm run docs:generate` in a clean worktree — known environment prerequisite) |

## CLI / dist E2E on the bettercap specimen (read-only, final build)
- `bb_doc symbol Session` → `symbol: Session`, `quality.scope {declared:single, passed:true,
  subjects:1, copies:5, resolvedBy:declaration-kind}` (same at `limit:1`).
- `bb_search symbol Session` → 5 matches; every `fileId` is `<projectId>:<relativePath>`,
  `absolutePath` present, bounded `source` + `sourceTruncated`.
- `bb_analyze test_mapping filePath=session` → `testedSymbols=18`, `evidenceLinks=127`,
  `unvalidatedLinks=137` = `{qualified-call-target-is-a-leaf:127, external-stdlib-leaf:3,
  receiver-selector-unresolved:7}`.
- `bb_analyze test_quality filePath=session` → aggregate **0.488095** (assertions 0.8571, docs
  0.8810, error_handling 0.3333, parameterization 0.6667, fixtures 0).
- Old-index doors (gh-cli 2026-10-17 index): `bb_graph`, `bb_impact`, `bb_visualize`, `bb_security`
  all exit 1 with the typed `bb index schema incompatible … BB_SCHEMA_INCOMPATIBLE … missing
  brain_relationship.target_basis/evidence_class … bb index --post` remedy — no raw SQLite, no partial
  answer.

## State
All lane-declared residuals are closed. Remaining are pre-existing defects or declared design
limitations, listed in `FINAL.md` ("Post-review correction"): full-specimen reindex blocked by the
unmodified `_res_contains_targets` scaling defect; `embedOutcome` durability PARTIAL; the external C#
typecheck error committed by another lane; receiver-selector evidence fails closed by design;
`test_impact` unchanged by design.
