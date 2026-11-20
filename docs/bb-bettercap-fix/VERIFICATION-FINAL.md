# VERIFICATION-FINAL — independent verifier report (wave-2 FINAL)

Verifier: `go-callgraph` (independent; no product edits). Date **2026-11-20**.
Repo worktree: `/home/ishaq2321/mcp/backbencher-brain/.tools/wt-wave2` (branch `fix-campaign-wave2`,
forked from CP1 commit `380a7e473`). Campaign: `docs/bb-bettercap-fix/FIX-CHARTER.md`.

## STATUS: **PENDING — NOT THE FINAL VERDICT YET**

The read-surface verification on the FINAL build is complete and clean, but the Lead's fresh
bettercap-copy reindex exposed a **write-side regression** that read-only CP1 checks could not see
(P0-2 binding on a FRESH index: same-language Go calls unbound). A bounded fix is landing; the FINAL
verdict below will be re-issued after the post-fix build + fresh reindex numbers arrive and the full
suite is re-run. Nothing in this report is a commit approval.

- Frozen wave-2 tree: HEAD `380a7e4735b083fad2b153df92a1c519767fd98c`, src tree sha
  `323928a18fd1f9efd8db64cf667b960cadc1e677667823b92ec3282eeb89e59b`,
  16 modified + 10 new files (snapshot `.tools/final/frozen-status.txt`, copied to
  `evidence/final/verifier/01-final-build-facts.txt`).
- FINAL build (Lead-built, ONE build): `npm run build` exit 0, "Build success in 1548ms";
  `node bin/bb --version` = 0.1.6; `npx tsc --noEmit` exit 0 (Lead record `.tools/final/tsc-final.log`,
  0 bytes; verifier re-ran tsc exit 0, `evidence/final/verifier/31-final-tsc.log`).
- FINAL dist: 156 JS chunks, 8.9 MB, dir sha `22141f3641390eaeb6ffa83a385ab6aea65b81d46e7bf3cde71c5312ff9537dd`.
  No rebuild run by the verifier.

## 1. Per-fix status on the FINAL read surface

| fix | verdict | independent evidence |
|---|---|---|
| **P0-1** refactor safety | **PASS (read surface); fresh-index symptom PENDING** | `m71/verify-refactor-safety` PASS (planned 3 files/3 sites etc.), `m13/verify-edit-rename` E2 92/92, `m13/verify-edit-freshness` E5 14/14, `m15/verify-edit-crossfile` E4 31/31, E5 5/5, E8 8/8 — all GREEN on FINAL build; symptom script: "P0-1 dry-run plans main.go and >=3 files/sites", plan exposes verification status. NOTE: on a FRESH index the Lead measured the plan regressing to 2 files/2 sites because the `modules.LoadModules` binding is missing (write-side P0-2 regression, §4) — re-check required post-fix. |
| **P0-2** unscoped name binding + cross-language honesty | **PARTIAL — PENDING (write-side regression)** | Read surface: `m57/verify-p02-name-binding` PASS; symptom script "every cross-language fact is declared a candidate (inferred/name-only/<=0.5)". Write surface on a FRESH reindex: same-language Go calls unbound (`main.go:47 modules.LoadModules`, `modules_test.go:16 LoadModules` → `target_symbol_id` NULL; old index bound both) — root cause `applyP02BindingGates` rule 2 blanket unbind of `isPackageQualified` + missing same-package/package-scoped binding; fix in flight (cross-lang, go-imports standby). |
| **P1-1/P1-2** Go import identity + cross-file uses (phase 2) | **PASS (gates); fresh-index write facts PARTIAL-PENDING** | `script/verify-analyze.ts` PASS (`ANALYZE: PASS`, 51 `ok:` lines incl. P2 func-main attribution + module identity/isExternal/dependency assertions), Go fixtures `{"go":{"pass":51,"fail":0}}` / "all fixtures pass", `m13/verify-analyze-modes` An1 **84/84** (27 negatives). Lead's fresh-reindex PASS facts: 327 internal Go imports / 0 same-module external; GO1 378 cross-file reads / 0 fabricated params; func-main calls attributed to func main (21 rows, module 0); `dependencies(session)` returnedInternalDependencies=348 resolved + dependents; cross-language write floors 0 bound name-resolution structural rows. |
| **P1-3** test intelligence | **PASS** | `verify-test-intel` + `verify-test-quality` GREEN on FINAL build; symptom script 5/5 P1-3 PASSes (no caplets/js links, Lock/Unlock fixed, real Go assertions, no JS `it.each` anchor, no stdlib fixture anchor). |
| **P1-4/P2-5** envelope + labels | **PASS** | `m73/verify-payload-envelope` GREEN; graph-family gate slice GREEN (`verify-graph`, `m65/verify-graph-blindspots`, `m13/verify-analyze-modes`, `visualize-views`, `visualize-owner-fold`, `visualize-target-literals`, `m35/verify-s3-graph-migrate`, `m48/verify-p3-agreement`); symptom script 8/8 P1-4 + 4/4 P2-5 PASSes. |
| **P2-1/P2-2** doc scope + search surface | **PASS** | `verify-retrieval-contract` GREEN; symptom script 4/4 P2-1 + 3/3 P2-2 PASSes. |
| **P2-3/P2-4** embeddings lifecycle + health honesty | **PASS** | `verify-embedding-lifecycle` + `verify-health-honesty` GREEN on FINAL build (after pre-creating the gitignored `.tools/triage-fix/embeddings-health` scratch dirs — worktree artifact, see §3); symptom script P2-3 + 4/4 P2-4 PASSes. |
| **P2-6** old-index compatibility | **PASS (FINAL build)** | `script/m-fix/verify-old-index-compat.ts` exit 0: typed `BB_SCHEMA_INCOMPATIBLE` refusal with DB path + detected schema v1/m13-universal-brain + missing `brain_relationship.target_basis`/`evidence_class` + `bb index --post` remedy; all four tools refuse at handler level; **CLI door** throws declared error (no "No index found" masking); **MCP stdio door** `isError:true` + declared text for all four; **remedy heals** (write-path open migrates the old copy, bb_graph then answers); current-schema control opens/answers. Evidence `evidence/final/verifier/20-p26-final-gate.txt`, RED/GREEN history `evidence/verifier/p2/`. |
| **P2-7** dist integrity | **PASS (FINAL build)** | Against the FINAL dist: `npm run verify:dist` exit 0 (156 chunks / 1069 refs / entry present); `--json` ok:true; `--self-test` 4/4 ✓ (clean copy passes; dangling `database-HE6EE3VA.js`-class reference, missing packaged entry, deleted-but-referenced chunk all caught on a COPY under `.tools/`); corrupted COPY exits 1 naming `analysis-exclusions-PRLWHQB4.js -> database-HE6EE3VA.js`; real dist re-verified untouched. Wiring: `prepublishOnly`/`prepack` run clean + self-test; `docs/bb-bettercap-fix/OPS.md` documents single-builder rebuild + MCP restart protocol. Evidence `evidence/final/verifier/10-p27-final-dist.txt`. |
| **Verification/build coordination** | **PASS** | one FINAL build, dist verified, no verifier rebuilds, frozen-tree guard (src sha before/after suite unchanged). |

## 2. Wave-1 gate suite on the FINAL build (read surface)

Method: same gate list and env as CP1 (`script/m-fix/verify-fix-campaign.ts`,
`BB_DATA_DIR=.tools/verifier/bbdata-final`, `BB_M57_DATA_DIR` same; bun for the graph-family/m57 gates,
`npx tsx` for documented-runner gates). Raw records in `evidence/verifier/runs/` (`final-wave1/*`),
machine summary `evidence/final/verifier/50-final-suite-summary.json`.

- **43 runs → 33 exit 0**; **effective 35 PASS** after two environment-only re-runs; **zero new
  regressions vs CP1 (post-CP1-B)**. CP1-B's four previously-fixed gates are all GREEN again
  (`visualize-owner-fold` V8 29/29, `visualize-target-literals` V6 21/21, `m35-s3-graph-migrate`
  S3 23/23, `m48-p3-agreement` 30/0/5).
- **Environment-only failure (1):** `verify-doc-tool-surface` FAILs in this fresh worktree because the
  untracked generated artifact `website/src/data/tools.generated.ts` exists only in the main checkout —
  CP1's PASS was already documented as partly environment-dependent (`VERIFICATION-CP1.md` §6). Not a
  regression; the worktree has no `website/` (verified).
- **Environment-only failures fixed by re-run (2):** `verify-embedding-lifecycle`,
  `verify-health-honesty` initially failed with `mkdtemp .../.tools/triage-fix/embeddings-health/...`
  ENOENT (gitignored scratch dirs absent in the fresh worktree). After pre-creating the dirs both re-run
  **PASS** (`final-wave1-rerun/*`). Not regressions.
- **Pre-existing REDs (7, unchanged from CP1, NOT regressions):** `m13/verify-visualize-options`
  (pre-existing TypeError), `m48/verify-p1-impact-unity` (pre-existing known-gap, proven on pristine
  pre-fix bytes), `m48/verify-p2-honesty-fields` (pre-existing), `m57/verify-t5-predicate-unity`
  (pre-existing source-governance P3), `m57/verify-closure` (T4 needs the populated real corpus DB),
  `m57/verify-gate-selftest` (pre-existing mutation-anchor rot), `m57/verify-governance` (offline
  GitHub check).
- `npx tsc --noEmit` **exit 0** on the FINAL tree (`evidence/final/verifier/31-final-tsc.log`).

## 3. Bettercap read-surface symptom script (FINAL dist)

`bash docs/bb-bettercap-fix/tools/cp1-bettercap-checks.sh --bin "node bin/bb" --out docs/bb-bettercap-fix/evidence/final/symptoms`
→ **SUMMARY: 34 pass / 0 fail / 5 deferred-or-skipped** (exactly the declared expectation), run by the
verifier against the FINAL dist, no `BB_DATA_DIR`. Evidence: `evidence/final/symptoms/` (51 artifacts),
log `evidence/final/verifier/40-final-symptoms.log`. Deferred = index-time checks on the existing
bettercap DB (`P1-1`, `P1-2`, `P0-2` index-time), to be closed by the FINAL copy-reindex.

## 4. PENDING — write-side regression found by the Lead's FINAL copy-reindex (blocking)

The Lead's fresh bettercap-copy reindex (FINAL code, fresh DB) measured:
- `main.go:47 modules.LoadModules` and `modules_test.go:16 LoadModules` → **`target_symbol_id` NULL**
  (same-language Go calls unbound; the old index bound both) → `bb_edit` refactor plan regressed to
  2 files / 2 sites and misses `modules_test.go` (P0-1 symptom on fresh data).
- Root cause: P0-2's `applyP02BindingGates` rule 2 (blanket unbind of `isPackageQualified`) plus the
  missing same-package/package-scoped binding path; fix landing in the worktree (cross-lang, go-imports
  standing by for the package-dir contract).
- Fresh-index facts already PASSED (preserve in FINAL): cross-language write floors = 0 bound
  name-resolution structural rows; GO1 378 cross-file reads, 0 fabricated parameter names; func-main
  calls attributed to `func main` (21 rows, module 0); Go imports 327 internal / 0 same-module external;
  `dependencies(session)` returnedInternalDependencies=348 with dependents; cross-language read facts 0.

The verifier's read-gate suite cannot catch this class (it exercises fixtures/old indexes). Once the
Lead provides the post-fix **build + fresh reindex numbers**, the verifier will re-run this suite and the
reindex-dependent checks and issue the final per-fix verdict. No src edits were made by the verifier in
this phase.

## 5. Evidence index (wave-2 FINAL)

| path | content |
|---|---|
| `evidence/final/verifier/00-frozen-snapshot.txt` | frozen wave-2 tree HEAD/src/dist shas at verification start |
| `evidence/final/verifier/01-final-build-facts.txt` | Lead FINAL build log tail, dist inventory+sha, Lead tsc, frozen-status |
| `evidence/final/verifier/10-p27-final-dist.txt` | P2-7 on FINAL dist: verify:dist, --json, --self-test, corrupt-copy proof, real-dist-untouched |
| `evidence/final/verifier/20-p26-final-gate.txt` | P2-6 old-index compat gate (all doors + remedy + control) |
| `evidence/final/verifier/21-go-verify-analyze.txt` | go-imports phase-2 `verify-analyze` PASS |
| `evidence/final/verifier/22-go-fixtures.txt` | Go fixtures `{"go":{"pass":51,"fail":0}}` / all fixtures pass |
| `evidence/final/verifier/23-analyze-modes.txt` | `An1: VERIFIED (84/84, 27 negatives)` |
| `evidence/final/verifier/30-final-wave1-runs.txt` | suite header/footer (src sha before/after) |
| `evidence/final/verifier/31-final-tsc.log` | tsc exit 0 (empty) |
| `evidence/final/verifier/32-env-fail-diagnosis.txt` | doc-surface/website + scratch-dir environment classification |
| `evidence/final/verifier/40-final-symptoms.log` | Lead symptom script, 34/0/5 on FINAL dist |
| `evidence/final/verifier/50-final-suite-summary.json` | machine-readable per-gate verdicts + classification + regression list (empty) |
| `evidence/verifier/p2/**` | P2-6/P2-7 RED→GREEN history from task-19 |
| `evidence/verifier/runs/` + `index.ndjson` | every harness record (`final-wave1/*`, `final-wave1-rerun/*`, `cp1b/*`, `cp1-final/*`) |
| `.tools/final/{build-final.log,frozen-status.txt,tsc-final.log,reindex-final.log}` | Lead build/reindex records (read-only inputs) |
