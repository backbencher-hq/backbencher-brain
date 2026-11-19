# Fix board (Lead-owned)

Campaign: fix the verified bettercap-report defects. Charter: FIX-CHARTER.md. Frozen evidence base:
../bb-bettercap-triage/. Specimens: bettercap (read-only), gql-gqlgen/graphql, gh-cli/internal,
workspace `.corpus/`.

| lane | fix | status | gate (RED→GREEN) | notes |
|---|---|---|---|---|
| edit-safety | P0-1 refactor safety | **GREEN FULL**: R1/R2 landed; CC1 slice all 8 gates exit 0 (crossfile E4 31/31, freshness E5 14/14, E8 8/8); m71 23/23; bettercap 3 files/3 sites; tsc clean. Pre-fix baselines recorded | script/m71/verify-refactor-safety.ts | source frozen |
| cross-lang | P0-2 unscoped name binding + cross-language honesty | **GREEN2 FINAL** — retro-honesty landed: old bettercap DB now renders all 7 report facts bridge=name-resolution + candidate=true + tier=inferred at 0.9/0.6; gate 15/15; mutant caught; DB-copy arm clean; m26 contract correction 12/12 (count unchanged); tsc clean | script/m57/verify-p02-name-binding.ts + old-row-shape assertions | SOURCE FROZEN; open risks documented (43,367 unbinds→Go phase 2; target_basis schema-ddl; reindex for write-side floors) |
| go-imports | P1-1 Go imports (phase 2 after P0-2) + P1-2 Go uses + package-main attribution | **phase-1 GREEN (guard-complete)**: Go fixtures 51/51 incl cross-file-value-read (pre-guard RED recorded); bettercap session probe: cross-file rows 56→40, fabrication controls 0, all 8 callbacks retained; verify-analyze PASS; tsc clean. Lead applied the param-name guard after the lane was cut (bounded, lane-designed). Phase 2 HELD for CP1 | validation/m14/fixtures/go + script/verify-analyze.ts Go section | package-main = store-side nameToSymbol (parallel-indexer:4351) → phase-2 acceptance; phase-2 plan note prepared |
| go-testintel | P1-3 test intelligence | **GREEN evidence** (both gates + bettercap e2e saved); status page pending | script/verify-test-quality.ts + verify-test-intel.ts | dual projection pin; task complete |
| payload-honesty | P1-4 envelope + P2-5 labels | m73+labels GREEN; **CP1 blocker: 4 legacy gates regressed on old flat paths** (verify-graph, m13 analyze-modes, m65 blindspots, m13 visualize-views) → bounded path-only fix window open now | script/m73/verify-payload-envelope.ts + the 4 legacy gates | predicates must stay identical; verifier re-runs after |
| retrieval | P2-1 doc scope + P2-2 search surface | **GREEN evidence** (gate-green); final confirmation/status page after a harness cut; task complete | script/verify-retrieval-contract.ts | handler-boundary fix; engine.ts residual noted |
| embeddings-health | P2-3 embeddings lifecycle + P2-4 health honesty | **GREEN FINAL** (05-gates-GREEN-final: both gates PASS, tsc clean, semantic/health gates PASS, source-level bettercap e2e); 03 was superseded; embedOutcome durability PARTIAL disclosed | script/verify-embedding-lifecycle.ts + script/verify-health-honesty.ts | mock provider, no config mutation |
| go-callgraph | verifier + build coordinator; P2-6 old-index + P2-7 dist | **task-16 COMPLETE** — pre-fix baseline 17/22 PASS, 5 pre-existing FAIL classified; build+dist integrity clean; harness+selftests; standby for CP1 | build 2.46s, dist 155 chunks/0 dangling; BB_DATA_DIR required; gates needing bun flagged | CP1 (task-18) starts on Lead signal; 5 pre-existing fails recorded (env/campaign/gate-rot/genuine T5 predicate-unity) |

Checkpoints: CP1 = wave-1 integrated (typecheck+build+gates+verifier+commit). CP2 = go-imports phase 2
+ cross-cutting e2e. FINAL = full suite + bettercap symptom re-run + FINAL.md.

## Verifier facts (CP baseline)
- Build: `npm run build` GREEN (1.3s build, 2.46s wall), dist 8.8 MB / 155 chunks / 1055 relative refs; `script/verify-dist-integrity.ts` exit 0 = **no dangling chunk references** (the triage `database-HE6EE3VA.js` class is gone after rebuild).
- Pre-fix snapshot: `.tools/verifier/pre-fix` from `git archive 75448b02` — CP1 RED reference.
- Baseline with default env: many gates fail with `ENOENT mkdir ~/.bb/projects/<hash>`; **with `BB_DATA_DIR=.tools/verifier/bbdata`, edit-rename/edit-unit pass (exit 0)** ⇒ those are environment failures, not pre-existing product failures.
- Harness: `script/m-fix/verify-fix-campaign.ts --label <name> --json [--expect-red] -- <cmd>` + selftest records under evidence/verifier/runs/.
- Lanes detected during RED: 4 gate suites RED-accepted (edit-safety 6 fails; payload-honesty 48 fails; retrieval 26 fails; go-testintel 5 fails; embeddings-health 2 gate legs; cross-lang mutation-gated P02 gate). Go phase1 + verifier baseline2 outstanding.

## CP1 status (pre-final)
- Wave-1 lane gates + tsc: 23/23 GREEN; edit-crossfile regression CLOSED (E4 31/31, E5 5/5, E8 8/8, freshness 14/14, rename 92/92).
- Lead bettercap symptom run: 31 pass / 1 real gap / 5 deferred → after retro-honesty recalibration expected 32 pass / 0 fail / 5 deferred.
- Verifier-extended legacy sweep found 4 envelope-path regressions (above) + 2 pre-existing REDs (m13 visualize-honesty, m48 P1) + bun-vs-tsx environment caveats.
- Final window: cross-lang retro-honesty + payload-honesty path-only gate fixes → then ONE final build + CP1 suite + symptom script → CP1 commit.

## CP1 verifier run (final build 05:03Z)
- Build GREEN (746ms), dist integrity GREEN (155 chunks/1058 refs/0 missing), fresh manifest; tsc exit 0; src sha stable through build+suite.
- Final suite 44 runs: 32 exit 0 — ALL wave-1 gates PASS (edit-rename 92/92, edit-crossfile E4 31/31/E5 5/5/E8 8/8, edit-freshness 14/14, analyze, test-intel, test-quality, search-modes, ask-contract, health, doc, doc-surface, m57-t1/t2/t4, m71 23/23, p02 13/13, m73 78/78, retrieval-contract, embedding-lifecycle, health-honesty, m26 12/12, m28 26/26, graph PASS, m35-envelope, m15-contracts, m57-t3, visualize-fidelity).
- Lead bettercap symptom script on final dist: 34 pass / 0 fail / 5 deferred (matches).
- REMAINING: 4 more legacy gates regressed by envelope access paths (visualize-owner-fold, visualize-target-literals, m35 s3-graph-migrate, m48 p3-agreement) → payload-honesty bounded gate-side window open; verifier will re-run those 4 then finalize VERIFICATION-CP1.md. No rebuild needed.
- Pre-existing REDs (not regressions): m48-p1/p2, m57-t5/closure/gate-selftest/governance, m13 visualize-options/honesty, m12-surface (cmd typo in one run excluded).
- DoD gaps: lane status pages for go-imports/go-testintel/retrieval would be nice; Lead to write consolidated STATUS if lanes stay cut.
