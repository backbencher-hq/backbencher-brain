# CP1 pre-fix RED replay (no build needed)

Generated 2026-11-19T04:16:31.724Z · method: Gate file copied from the lane working copy into .tools/verifier/pre-fix at the same repo-relative path (product src under it stays pre-fix bytes, gate ROOT resolves via import.meta to the pre-fix tree); run via script/m-fix/verify-fix-campaign.ts --expect-red --cwd .tools/verifier/pre-fix. Scratch dirs .tools/triage-fix/* were pre-created in the pre-fix tree (gitignored, absent from git archive) so mkdtemp setup is not mistaken for RED.

**8/8 RED_CONFIRMED** — 6 honest-behavioral, 2 api-presence-weak.

| gate | runner | verdict | exit | dur | class | red evidence |
|---|---|---|---|---|---|---|
| `script/m71/verify-refactor-safety.ts` | npx tsx | **RED_CONFIRMED** | 1 | 37.6s | honest-behavioral | plan renamedFiles/renamedSites 2/2 vs expected 3/3; main.go MISSING; silent-success instead of refusal; applied tree fails `go build` (undefined: modules.LoadModules) |
| `script/m57/verify-p02-name-binding.ts` | npx tsx | **RED_CONFIRMED** | 1 | 19.4s | honest-behavioral | collision fixture: cross-lang imports/calls/instantiates=3, bound non-code targets=1, bare-name imports=3, isFieldAccess=2, external-claim=4 |
| `script/verify-test-intel.ts` | npx tsx | **RED_CONFIRMED** | 1 | 8.6s | api-presence (weak) | only FAIL is 'test-intel engine exports validateTestLink'; the gate hard-fails on the missing new export before it can exercise pre-fix mapping behavior — RED direction is right but it is not a behavioral reproduction; lane needs behavioral RED evidence or a negative control |
| `script/verify-test-quality.ts` | npx tsx | **RED_CONFIRMED** | 1 | 8.9s | api-presence (weak) | 4 export-presence FAILs (measureTestContent, per-language vocabularies, aggregateQuality, overallScore) — same limitation as test-intel |
| `script/m73/verify-payload-envelope.ts` | npx tsx | **RED_CONFIRMED** | 1 | 7.2s | honest-behavioral | bb_impact first key is not summary; payloadBytes/budget absent; each declared bound not inside head -c 4096; shownCount<=budget check absent |
| `script/verify-retrieval-contract.ts` | npx tsx | **RED_CONFIRMED** | 1 | 5.7s | honest-behavioral | doc subject unresolved union/property; declaration not preferred; limit:1 documents property; qualified target not disambiguated; search symbol-mode contract fails |
| `script/verify-embedding-lifecycle.ts` | npx tsx | **RED_CONFIRMED** | 1 | 12.0s | honest-behavioral | under-covered configured space not declared; read path hard-filters/degraded to keyword-fallback; no populated-space fallback; no pending-backfill state |
| `script/verify-health-honesty.ts` | npx tsx | **RED_CONFIRMED** | 1 | 7.4s | honest-behavioral | status=complete beside 1972/1973 INCOMPLETE; force=true remedy on deliberate skip; no per-language syntax grouping; embeddings line lacks configured-model/coverage split |

## Captured red lines (first 10 each)

### m71-refactor-safety — RED_CONFIRMED
```
FAIL G1 files planned — expected {"renamedFiles":3,"renamedSites":3}, got {"renamedFiles":2,"renamedSites":2}
FAIL G1 main.go in plan — MISSING
FAIL G2 main.go caller file planned despite module-symbol attribution — MISSING
FAIL G3 namespace-import caller planned — MISSING
FAIL G6 outcome is a refusal (or an explicitly-named survivor) — expected "refused", got "silent-success"
FAIL G7 plan includes the qualified caller file — ["/tmp/bb-refactor-safety-g7plan-V0ROes/modules/modules.go"]
FAIL G7 plan-applied tree compiles — go build FAILED: # example.com/g7
FAIL G7 commit succeeds on a build-complete plan — bb_edit wrote nothing: 1 target file(s) changed on disk between planning and committing — main.go (planned 29d35bb6f1f7, now gone). The edit was planned from those bytes, so applying it now
- G7 G7 plan-applied tree compiles: go build FAILED: # example.com/g7
```

### p02-name-binding — RED_CONFIRMED
```
FAIL: P1a collision fixture: no cross-language imports/calls/instantiates — cross imports/calls/instantiates = 3
FAIL: P1b collision fixture: no bound non-code-language target — bound non-code-language targets = 1
FAIL: P1c collision fixture: no bare-name import binding — cross-language bare-name imports bound = 3
FAIL: P1d collision fixture: no bound isFieldAccess row — isFieldAccess rows bound = 2
FAIL: P1e collision fixture: no bound external-claim row — external-claim rows bound = 4
```

### test-intel — RED_CONFIRMED
```
FAIL: test-intel engine exports validateTestLink (validation capability)
TEST-INTEL: 1 FAILURES
```

### test-quality — RED_CONFIRMED
```
FAIL: quality engine exports measureTestContent (language-aware basis)
FAIL: quality engine exports per-language vocabularies (go/python/javascript)
FAIL: quality engine exports aggregateQuality (pure aggregate)
FAIL: quality engine exports overallScore (pure per-file overall)
TEST-QUALITY: 4 FAILURES
```

### payload-envelope — RED_CONFIRMED
```
FAIL: A1: bb_impact first top-level key is summary — {
FAIL: A1: bb_impact declares payloadBytes/payloadBudgetBytes in summary — {}
FAIL: A1: bb_impact bound "truncated" is inside head -c 4096
FAIL: A1: bb_impact bound "truncationReason" is inside head -c 4096
FAIL: A1: bb_impact bound "shownCount" is inside head -c 4096
FAIL: A1: bb_impact bound "totalCountIfKnown" is inside head -c 4096
FAIL: A1: bb_impact bound "payloadBytes" is inside head -c 4096
FAIL: A1: bb_impact declares the byte-budget vocabulary on every answer — {}
FAIL: A1: bb_impact summary.shownCount <= summary.budget.maxNodes — {}
FAIL: A1-control: real bb_impact answer keeps counts and rows — {}
```

### retrieval-contract — RED_CONFIRMED
```
FAIL: A1 control: unique symbol declares single scope
FAIL: A2: ambiguous name documents a DECLARED scope
FAIL: A2: declaration preferred over the property — src/module.ts:4,src/session.ts:5
FAIL: A2: subject is the single declaration (not a silent union)
FAIL: A2: summary states the resolved subject — 2 file(s) and 2 symbol(s) in scope, 18 cited claim(s) across 5 section(s) from 10 source(s). No indexed evidence was found for: Tests.
FAIL: A3: limit:1 still documents the declaration, not the first line-ordered property — src/module.ts:4
FAIL: A3: limit:1 does not silently document a property — ["property Session: Session | null is defined in src/module.ts at lines 4-4."]
FAIL: A4a: qualified target resolves exactly one subject
FAIL: A4a: qualified target documents the qualified declaration only — src/module.ts:4,src/session.ts:5
FAIL: A4b: qualified target on a bare-name corpus shape resolves exactly one subject
```

### embedding-lifecycle — RED_CONFIRMED
```
FAIL: A1: the under-covered configured space (1/24) is measured and named — ["no-vector-above-threshold"]
FAIL: A2: read path does NOT hard-filter to the near-empty configured space — method=keyword-fallback
FAIL: A3: answered from the populated local space — queryModel=none
FAIL: A4: fallback is DECLARED — fallbackReason=no-vector-above-threshold
FAIL: A5: pending backfill is named with the configured model — ["no-vector-above-threshold"]
EMBEDDING LIFECYCLE: 5 FAILURE(S)
```

### health-honesty — RED_CONFIRMED
```
FAIL: R2: bare `status=complete` never prints beside the shortfall — index: version=v1.0.0 indexedFiles=1972/1973 — INCOMPLETE, 1 file(s) found by the walk were never written status=complete errors=0
FAIL: R3: the derived status names the shortfall — index: version=v1.0.0 indexedFiles=1972/1973 — INCOMPLETE, 1 file(s) found by the walk were never written status=complete errors=0
FAIL: R4: no `force=true to rebuild from scratch` remedy on a deliberate-skip shortfall — the last index run recorded 1972 of 1973 files as indexed — 1 file(s) were found by the walk but never written, so the index is INCOMPLETE even though
FAIL: R5: a warning explains the skip (size tier / deliberate skip), so force is not implied to fix it — the last index run recorded 1972 of 1973 files as indexed — 1 file(s) were found by the walk but never written, so the index is INCOMPL
FAIL: R8: syntax grouping states a count per language — 2 indexed files have syntax errors: assets/_mixins.scss, assets/_variables.less
FAIL: R9: embeddings line names the configured model and its coverage — embeddings: 2 rows / 2 entities / 100% of symbols
FAIL: R10: backfill-pending state is declared for the under-covered configured space — codes=SYNTAX_ERRORS,INCOMPLETE_INDEX
FAIL: R11: embeddings line distinguishes library-wide from configured-space coverage — embeddings: 2 rows / 2 entities / 100% of symbols
HEALTH HONESTY: 8 FAILURE(S)
```

## Environment notes

- `.tools/triage-fix/*` scratch dirs were pre-created in the pre-fix tree: two gates (`verify-embedding-lifecycle`, `verify-health-honesty`) call `mkdtemp` under ROOT/.tools, which is gitignored and therefore absent from the git-archive copy. Without the dirs the gates crash on setup (not honest RED); after creating them the gates report behavioral FAILs.
- Every gate resolves ROOT from its own `import.meta` location, so copying the gate into the pre-fix tree is what keeps the run honest: its imports resolve to pre-fix `src/`.
- `verify-test-intel` / `verify-test-quality` are RED but classified **api-presence (weak)**: they hard-fail because the pre-fix engine lacks the new exports the gate was written against, so their behavioral assertions never execute. Their GREEN at CP1 will be meaningful only together with the lane's own pre-fix behavioral evidence or a negative-control run.
- Gate file sha256 at replay time: `cp1/00-replay-overlay-manifest.txt`.
