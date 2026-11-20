# FINAL — bettercap-report fix campaign

Status: **COMPLETE for the 12 verified defects**, with two pre-existing defects documented as
out-of-scope (not introduced or worsened by this campaign) and their evidence recorded.

## What was fixed (all RED-on-pre-fix → GREEN-after, with positive controls)

| report item | fix (wave 1, commit `380a7e473`) | wave-2 follow-up |
|---|---|---|
| 01 refactor unsafe rename | caller-span enclosing-function fallback; module-binding-aware qualified-reference classifier; zero-site plan refusal; declared `verification` (reparse + unresolved scan + bounded build) | write-side package-scoped binding fix restores the 3rd file on a fresh index (see below) |
| 02 false cross-language edges | one language-agnostic binding policy pair around both marker sites (external/non-code/language-pair gates; name-only ⇒ confidence ≤0.5, inferred, `bindingBasis`), read-surface retro-honesty for pre-fix rows, genuine-bridge candidates retained | — |
| 03 Go deps all external | Go module identity in `brain_project_meta` (go-module.ts), analyzer+store `isExternal`, dependency-engine Go branch (module path → package dir → files, `resolved` + dependents) | phase 2 landed (same wave-2 branch) |
| 04 orphan/callers false positives | cross-file function-value `uses` leaf rows with declared reason; parameter-name guard; package-main attribution by enclosing span | source attribution made package-scoped and verified on a real index |
| 05/06 test mapping/quality | link validation (exact symbol + reachability) rejects unvalidated links; language-aware assertion/parameterization model; inert clamp removed | — |
| 07 doc wrong symbol | symbol-mode subject resolution (declaration preference, qualified disambiguation, `quality.scope` term), limit decoupled from subject | — |
| 08 search symbol mode | bounded source + `sourceTruncated`, unified `projectId:path` fileId, descriptor/docs truth | — |
| 09 embeddings lifecycle | declared space fallback + pending-backfill provenance; keyword fallback names the compared/pending space | embedOutcome durability PARTIAL (off-limits reconcile section, documented) |
| 10 payload bounds | ONE summary-first `{summary, data}` envelope (256 KB declared budget, payloadBytes/Budget on every answer) across impact/graph/visualize-json/analyze-impact; graph node-table dedupe; `engineCallerRows` units | 8 legacy gates adapted by access path only, predicates untouched |
| 11 index health honesty | derived status from every completion cause; skipped-size-tier cause named (force cannot fix); less/scss syntax attribution split; library-vs-configured two-space coverage; doctor remedy | — |
| 12 sentinel labels | security "lead-tier analyzers" registry census vs stored leads; visualize whole-project claim gated on scope/truncation/offset | — |
| P2-6 old-index compat | — | typed `BB_SCHEMA_INCOMPATIBLE` refusal naming DB path/schema/missing columns/remedy at handler + CLI + MCP doors; remedy heals |
| P2-7 dist integrity | — | `verify:dist` + `--self-test` on corrupted copies, prepublish/prepack wiring, OPS rebuild/restart protocol |

## Verification (independent verifier + Lead)
- **CP1** (wave 1, commit `380a7e473`): build GREEN, dist integrity clean, 44-run suite, 8 legacy-gate
  regressions found by the verifier and closed (access-path-only), tsc clean, bettercap read-time
  symptoms **34 pass / 0 fail / 5 deferred**, verdict CLEAN (`VERIFICATION-CP1.md`).
- **FINAL** (wave 2, branch `fix-campaign-wave2`): build GREEN (566 ms), `verify:dist` GREEN
  (156 chunks/1069 refs), tsc clean; full wave-1 suite **35 PASS after env-only re-runs, ZERO new
  regressions vs CP1**; P2-6/P2-7 gates GREEN; go-imports phase-2 gates GREEN (verify-analyze PASS,
  Go fixtures 51/51, analyze-modes 84/84); Lead symptom script **34/0/5** on the final dist.
- **Write-side (index-time) proof** — real bettercap source, fresh index (393-file source subset,
  `derived: full`; full-specimen reindex blocked by a pre-existing scaling defect below):
  refactor dry-run **3 files/3 sites incl modules_test.go** with reparse-verified plan;
  `main.go:47 modules.LoadModules` **bound** (`bindingBasis=import-path`; 504 such bindings) and
  `modules_test.go:16` bound; func main owns **21** calls / module symbol **0**; same-module imports
  external **0**, internal **326**; cross name-resolution structural rows **0**; GO1 cross-file
  reads **378**, fabricated param rows **0**; `dependencies(session)` internal deps **348**,
  dependents **2470**. Evidence `evidence/final/write-side-verification.md`.

## Pre-existing defects found during verification (documented, not introduced here)
1. **Full-index derived resolution scaling**: `CREATE TEMP TABLE _res_contains_targets …` for 21,882
   unresolved `contains` rows joins to 20,991,769 candidates and hits `SQLITE_FULL` on a fresh
   full-specimen index. The statement is unmodified by this campaign (`git diff 380a7e473` contains
   no hunk for it) and the failure reproduces with `bb index --post`; it blocks full-specimen
   index-time proof only (read-side checks pass; subset index proves the fixes).
2. Known pre-existing REDs unchanged by this campaign: m48-p1/p2, m57 t5/closure/gate-selftest/
   governance, m13 visualize-options/honesty, m12-surface; `verify-doc-tool-surface` is env-dependent
   (generated website data absent in a clean worktree). All classified in `VERIFICATION-FINAL.md`.

## Deferred / limits (honest)
- `embedOutcome` / queue-drop durability lives in the off-limits parallel-indexer reconcile section
  (PARTIAL, exact gap in `embeddings-health.md` §7.1).
- Read surfaces are retro-honest on old indexes; write-side floors require the next index run.
- Full-specimen reindex stays blocked by pre-existing defect (1) until fixed separately.

## Post-review correction (lane close-outs — this section corrects the record)

The completion statement above was written while **two lanes had never delivered their closing
message or lane status page**: `go-testintel` (P1-3) and `retrieval` (P2-1/P2-2). Their turns had been
cut repeatedly by harness failures; the Lead compiled a substitute status in `STATUS-WAVE1.md` and
then marked the campaign complete. **That was premature: a Lead-compiled summary is not the lane's own
required close-out, and completion was called before the campaign's Definition of Done was met.**

Remediation: both lanes were reopened and delivered their own status pages and final replies, and the
Lead independently re-ran their gates on the landed tree:

| lane | delivered | Lead re-run on landed tree |
|---|---|---|
| `go-testintel` | `docs/bb-bettercap-fix/go-testintel.md` + `GREEN-final-*` evidence; E2E: mapping tested 18 / links 127 / 137 declared-unvalidated with per-reason counts, Lock/Unlock 0 links, quality aggregate 0.322222→0.488095, assertions 0→0.857, `%s` proxy removed; corrected `session.New` answer (20 genuine module-test links, caplets/js false rows gone) | `verify-test-intel` **PASS (24 checks)**, `verify-test-quality` **PASS (56 checks)** |
| `retrieval` | `docs/bb-bettercap-fix/retrieval.md` + `RETRIEVAL-R1-engine-fileid.md`; real-specimen probe (Session → single subject `struct session/session.go:72`, copies 5, declaration-kind, unchanged at `limit:1`; `session.Session` qualified-path; New function; LoadModules byte-compatible) | `verify-retrieval-contract` **45/45** (RED was 16/42) |

The two pages are committed (`41dc91ecc`, `f3ce5b57a`). With them present, the campaign's close-out
requirements are now met; the completion statement is accurate **as of these close-outs**, not as of
the earlier commit. Remaining items are the lanes' declared follow-ups, not missing close-outs:
go-testintel: rewrite `docs/BB_TEST_INTEL.md`/`BB_TEST_QUALITY.md` for the new five reasons and
language vocabularies; receiver-selector evidence fails closed by design; `test_impact` untouched.
retrieval: engine-level absolute `fileId` (R1, cross-lane with edit-engine); CLI-dist E2E needs the
coordinator rebuild; gh-cli source check blocked by its old index schema (P2-6 scope). Pre-existing and
unrelated: full-specimen reindex blocked by the `_res_contains_targets` scaling defect; `embedOutcome`
durability PARTIAL; external C# typecheck error on main.

## Artifacts
- Branch `fix-campaign-wave2` (this worktree), wave-1 commit `380a7e473` on `main`.
- Status/verification: `VERIFICATION-CP1.md`, `VERIFICATION-FINAL.md`, `BOARD.md`, `STATUS-WAVE1.md`,
  per-lane pages (`edit-safety.md`, `cross-lang.md`, `go-imports.md`, `go-testintel.md`, `payload-honesty.md`, `retrieval.md`, `embeddings-health.md`,
  `verifier.md`, `OPS.md`).
- Evidence: `evidence/{edit-safety,cross-lang,go-imports,go-testintel,payload-honesty,retrieval,
  embeddings-health,verifier,lead,final}/`.
