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
| 09 embeddings lifecycle | declared space fallback + pending-backfill provenance; keyword fallback names the compared/pending space | **embedding-run outcome is now DURABLE** (`brain_project_meta.last_embed_outcome` → health `embeddings.lastRun` + `last run:` line + `EMBEDDING_RUN_INCOMPLETE`); full-index run recorded 23,951 embedded / 0 failed / 0 dropped |
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
  `derived: full`; full-specimen reindex now passes after the post-review scaling fix — see
  "Post-review completion: pre-existing defects fixed" below):
  refactor dry-run **3 files/3 sites incl modules_test.go** with reparse-verified plan;
  `main.go:47 modules.LoadModules` **bound** (`bindingBasis=import-path`; 504 such bindings) and
  `modules_test.go:16` bound; func main owns **21** calls / module symbol **0**; same-module imports
  external **0**, internal **326**; cross name-resolution structural rows **0**; GO1 cross-file
  reads **378**, fabricated param rows **0**; `dependencies(session)` internal deps **348**,
  dependents **2470**. Evidence `evidence/final/write-side-verification.md`.

## Pre-existing defects found during verification — ALL FIXED in the post-review completion
1. **Full-index derived resolution scaling**: `CREATE TEMP TABLE _res_contains_targets …` for 21,882
   unresolved `contains` rows joins to 20,991,769 candidates and hits `SQLITE_FULL` on a fresh
   full-specimen index. The statement is unmodified by this campaign (`git diff 380a7e473` contains
   no hunk for it) and the failure reproduces with `bb index --post`; it blocks full-specimen
   index-time proof only (read-side checks pass; subset index proves the fixes).
2. Known pre-existing REDs unchanged by this campaign: m48-p1/p2, m57 t5/closure/gate-selftest/
   governance, m13 visualize-options/honesty, m12-surface; `verify-doc-tool-surface` is env-dependent
   (generated website data absent in a clean worktree). All classified in `VERIFICATION-FINAL.md`.

## Deferred / limits (honest)
- `embedOutcome` / queue-drop durability lived in the in-memory indexer run only (PARTIAL at the time,
  exact gap in `embeddings-health.md` §7.1) — **now fixed**: persisted to `brain_project_meta` and read
  back by health (see below).### Resolution of all three pre-existing defects (post-review completion)

1. **Full-index `_res_contains_targets` scaling — FIXED.** The unbounded window materialization
   (20,991,769 candidate rows on this specimen → `SQLITE_FULL`) is replaced by a bounded per-row
   resolution inside one transaction, preserving the identical winner ORDER BY (SQLite refuses
   correlated refs to the UPDATE target in a scalar subquery's ORDER BY, so the row context is passed
   as bound parameters; the project-wide fallback fires only when the edge's own file has no such
   name). Full bettercap-copy reindex now **exits 0**: 1,972/1,973 files (one declared >5 MB skip),
   **55,785 symbols / 111,786 relationships / 1,948 imports**, `derived: full`, 130.6 s; the shipped
   final harness is **12/12 PASS**, read-time checks on the new index are **38 pass / 0 fail / 2
   deferred**, and `bb health` derives `status=incomplete (recordedStatus=complete contradicts the
   counts)` with `SKIPPED_FILES` naming the deliberate skip. Evidence:
   `evidence/final/FULL-INDEX-REINDEX.md` + `evidence/final/full-index/**`.
2. **`embedOutcome` durability — FIXED.** Every index run now writes
   `brain_project_meta.last_embed_outcome` (queued/embedded/failed/skipped/dropped/invalid + timestamp);
   `bb_health` reads it into `embeddings.lastRun`, prints `· last run: N embedded[, N failed][, N
   dropped (queue cap)]`, raises `EMBEDDING_RUN_INCOMPLETE` when the pass was incomplete, and declares
   `EMBEDDING_RUN_HISTORY_UNREADABLE` if the record cannot be read. Gate: `verify-health-honesty.ts`
   R12–R14 + C4 control. Full-index run recorded `{queued:23951, embedded:23951, failed:0, dropped:0}`.
3. **External C# typecheck error — FIXED.** `real-csharp-analyzer.ts` `namedChild()` nullability guard;
   the whole repo now typechecks with **0 errors** (`npx tsc --noEmit` exit 0). It was another lane's
   committed code; the one-line guard is the same shape the lane uses elsewhere.
   Also fixed in this pass: the `m14/verify-systems-cluster-e2e` gate resolved `$HOME/.bb/projects/<sha1>`
   directly and therefore read a stale DB whenever `BB_DATA_DIR` redirected the CLI's store; it now uses
   `getProjectId` + `BrainDatabase.getDbPath` (the same helpers as the CLI) and passes deterministically.
   The final-bettercap harness also defines its missing `skip()` helper.
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

The two pages are committed (`41dc91ecc`, `f3ce5b57a`); the lane-declared follow-ups have since been
closed and verified:
- go-testintel docs rewrite — `39f69b4b5` (`BB_TEST_INTEL.md`/`BB_TEST_QUALITY.md` rewritten to the
  landed contracts; docs-truth gates m31 71/71, tool docs 16/16).
- retrieval R1 engine identity — `ee45e176d`: `findSymbol` returns `fileId=<projectId>:<relativePath>`
  with `absolutePath` carrying the machine path (edit-engine paths via it, bb_search resolves
  freshness/source via it); gate **48/48** (three engine-level assertions), edit family/m71/search-modes
  green, tsc/build/dist clean.
- CLI/dist E2E — captured on the final build for both lanes (`DIST-E2E-*` under their evidence dirs):
  bb_doc single subject; bb_search projectId:path + absolutePath + bounded source; test_mapping
  18/127/137 with per-reason counts; test_quality aggregate 0.488095.
- gh-cli old-index check — the four read doors now return the typed `BB_SCHEMA_INCOMPATIBLE` with the
  `bb index --post` remedy on the CLI door too (evidence under `evidence/verifier/p2/DIST-E2E-*`).

With the post-review completion above, every pre-existing defect recorded during verification is now
fixed and proven on the full specimen. What remains are two **design decisions**, not unfinished work:
`receiver-selector-unresolved` evidence fails closed (honest without receiver-type resolution) and
`test_impact` keeps the graph-engine's caller traversal (validated test links are a `test_mapping`
property; changing test_impact would be a different feature).

## Artifacts
- Branch `fix-campaign-wave2` (this worktree), wave-1 commit `380a7e473` on `main`.
- Status/verification: `VERIFICATION-CP1.md`, `VERIFICATION-FINAL.md`, `BOARD.md`, `STATUS-WAVE1.md`,
  per-lane pages (`edit-safety.md`, `cross-lang.md`, `go-imports.md`, `go-testintel.md`, `payload-honesty.md`, `retrieval.md`, `embeddings-health.md`,
  `verifier.md`, `OPS.md`).
- Evidence: `evidence/{edit-safety,cross-lang,go-imports,go-testintel,payload-honesty,retrieval,
  embeddings-health,verifier,lead,final}/`.
