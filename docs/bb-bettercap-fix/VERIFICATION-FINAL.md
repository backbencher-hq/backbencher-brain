# VERIFICATION-FINAL — independent verifier report (wave-2 FINAL)

Verifier: `go-callgraph` (independent; no product edits). Date **2026-11-20**.
Repo worktree: `/home/ishaq2321/mcp/backbencher-brain/.tools/wt-wave2` (branch `fix-campaign-wave2`,
forked from CP1 commit `380a7e473`). Campaign: `docs/bb-bettercap-fix/FIX-CHARTER.md`.

## STATUS: **FINAL PASS — wave-2 fixes independently verified; one PRE-EXISTING full-index scaling defect recorded**

Wave-2 (go-imports phase 2, old-index compatibility, dist integrity) plus the write-side P0-2 binding
regression the Lead found on a fresh bettercap-copy reindex are all resolved and independently
re-verified on the FINAL2 build (src sha `ab0176b98ba4…`). The full bettercap-copy reindex remains
blocked by a **pre-existing** full-index scaling defect (not introduced or touched by this campaign,
§4.2); the write-side fixes were proven on a real bettercap SOURCE SUBSET index with `derived: full`.
No verifier rebuilds; no verifier source edits.

- Frozen tree: HEAD `380a7e4735b083fad2b153df92a1c519767fd98c`; FINAL2 src tree sha
  `ab0176b98ba42374b4f90c9cafe46480ba61807afba709e13206cd7dcbf909dd` (snapshot
  `.tools/final/frozen-status.txt`).
- FINAL2 build (Lead-built, ONE build): `npm run build` exit 0, "Build success in 566ms";
  `node bin/bb --version` = 0.1.6; `npx tsc --noEmit` exit 0 (Lead `.tools/final/tsc-final2.log` 0 bytes;
  verifier re-ran tsc exit 0, `evidence/final/verifier/71-final2-tsc.log`).
- FINAL2 dist: 156 JS chunks / 8.9 MB, dir sha
  `c2ea3fb2bb2c9b30df4c82b0c7edb7327c5fc31056235f075d9170104af406ef`; `npm run verify:dist` exit 0
  (156 chunks / 1069 relative refs / entry present). No verifier build.
- (History: FINAL1 build `323928a18fd1…`/`22141f36…` passed the read-surface suite but the fresh-index
  reindex exposed the write-side P0-2 regression; it was fixed and re-verified in FINAL2.)
- Commit provenance: wave-2 branch commit **`9de770006`**, cherry-picked onto `main` as **`9caaebdde`**
  (campaign paths clean on main; verified state in this report is the frozen worktree tree).

## 1. Per-fix FINAL verdicts

| fix | verdict | independent evidence |
|---|---|---|
| **P0-1** refactor safety | **PASS** | `m71/verify-refactor-safety`, `m13/verify-edit-rename` E2 92/92, `m13/verify-edit-freshness` E5 14/14, `m15/verify-edit-crossfile` E4 31/31 E5 5/5 E8 8/8 — GREEN on FINAL2. **Real-source fresh-index proof** (Lead artifact re-read by verifier, `evidence/final/verifier/91-subset-refactor-dryrun-independent.txt` + DB checks `90-write-side-independent.txt`): refactor dry-run plans **3 files / 3 sites** — `modules/modules.go`, `main.go`, `modules/modules_test.go`; `verification.reparsed = passed`, `unresolvedReferences = []`. Symptom script "P0-1 dry-run plans main.go and >=3 files/sites". |
| **P0-2** unscoped name binding + cross-language honesty | **PASS (write-side regression found, fixed, re-verified)** | Read surface: `m57/verify-p02-name-binding` GREEN (fixtures 18/18; with bettercap arm 21/21 on the real-source subset index — see §4.1), cross-language facts all candidates, cross-language name-resolution bound rows 0. Write surface on the real-source subset index (`derived: full`, 393 files): `main.go:47 modules.LoadModules` **bound** to `modules/modules.go:LoadModules:42` with `bindingBasis=import-path`; `modules/modules_test.go:16 LoadModules` **bound** (same-package bare-call path); **504 import-path bindings**; bettercap arm `package-scoped bound=504 refused=0`, cross-language name-resolution imports/calls 0, `session.New` unverified qualified callers 0, LoadModules bind ≥2 → **21/21 assertions passed**. Regression history/root/fix in §4.1. |
| **P1-1/P1-2** Go import identity + cross-file uses (phase 2) | **PASS** | `script/verify-analyze.ts` `ANALYZE: PASS` (51 `ok:` lines incl. func-main attribution + module identity/isExternal/dependency assertions); Go fixtures `{"go":{"pass":51,"fail":0}}` "all fixtures pass"; `m13/verify-analyze-modes` An1 **84/84** (27 negatives), all on FINAL2. Real-source subset index: same-module imports marked external **0**, internal Go imports **326**, func-main calls **21** / module **0**, GO1 cross-file value reads **378** / fabricated function-type param rows **0**, `dependencies(session)` returnedInternalDependencies **348** / dependents **2470**, embedded module identity `github.com/bettercap/bettercap/v2`. |
| **P1-3** test intelligence | **PASS** | `verify-test-intel` + `verify-test-quality` GREEN; symptom script 5/5 P1-3 PASSes (no caplets/js links, Lock/Unlock fixed, real Go assertions, no JS `it.each` anchor, no stdlib fixture anchor). |
| **P1-4/P2-5** envelope + labels | **PASS** | `m73/verify-payload-envelope` GREEN; graph-family slice GREEN (`verify-graph`, `m65/verify-graph-blindspots`, `m13/verify-analyze-modes`, `visualize-views`, `visualize-owner-fold` V8 29/29, `visualize-target-literals` V6 21/21, `m35/verify-s3-graph-migrate` 23/23, `m48/verify-p3-agreement` 30/0/5); symptom script 8/8 P1-4 + 4/4 P2-5 PASSes. |
| **P2-1/P2-2** doc scope + search surface | **PASS** | `verify-retrieval-contract` GREEN; symptom script 4/4 P2-1 + 3/3 P2-2 PASSes. |
| **P2-3/P2-4** embeddings lifecycle + health honesty | **PASS** | `verify-embedding-lifecycle` + `verify-health-honesty` GREEN on FINAL2; symptom script P2-3 + 4/4 P2-4 PASSes. |
| **P2-6** old-index compatibility | **PASS** | `script/m-fix/verify-old-index-compat.ts` exit 0 on FINAL2: typed `BB_SCHEMA_INCOMPATIBLE` naming DB path + detected schema v1/m13-universal-brain + missing `brain_relationship.target_basis`/`evidence_class` + `bb index --post` remedy; all four tools refuse; **CLI door** throws declared error (no "No index found" masking); **MCP stdio door** `isError:true` for all four; remedy heals (write-path open migrates old copy → bb_graph answers); current-schema control opens/answers. Evidence `evidence/final/verifier/24-p26-final2-gate.txt`, RED/GREEN history `evidence/verifier/p2/`. |
| **P2-7** dist integrity | **PASS** | On FINAL2 dist: `npm run verify:dist` exit 0 (156 chunks / 1069 refs); `--json` ok:true; `--self-test` 4/4 ✓; corrupted COPY exits 1 naming `analysis-exclusions-PRLWHQB4.js -> database-HE6EE3VA.js`; real dist untouched. Wiring: `prepublishOnly`/`prepack` run clean + self-test; `docs/bb-bettercap-fix/OPS.md` documents single-builder rebuild + MCP restart protocol. Evidence `evidence/final/verifier/11-p27-final2-dist.txt`, `12-p27-final2-corrupt-copy.txt`. |
| **Verification/build coordination** | **PASS** | one Lead build per round; dist verified; no verifier rebuilds; frozen-tree guard (src sha unchanged across the FINAL2 suite: `70-final2-suite-runs.txt` header/footer). |

## 2. Gate suite on FINAL2 (wave-1 + wave-2 gates)

Method: same gate list/env as CP1 plus wave-2 gates (`script/m-fix/verify-fix-campaign.ts`;
`BB_DATA_DIR=.tools/verifier/bbdata-final2`, `BB_M57_DATA_DIR` same; bun for graph-family/m57 gates,
`npx tsx` for documented runners and the GREEN3 gate). Raw records `evidence/verifier/runs/`
(`final2/*`), machine summary `evidence/final/verifier/72-final2-suite-summary.json`.

- **46 runs → 38 exit 0**, **zero regressions vs CP1 (post-CP1-B)**. CP1-B's four previously-fixed
  gates GREEN (`visualize-owner-fold` V8 29/29, `visualize-target-literals` V6 21/21,
  `m35-s3-graph-migrate` 23/23, `m48-p3-agreement` 30/0/5). Wave-2 gates in-suite:
  `p26-old-index` PASS, `crosslang-green3-fixtures` PASS (18/18), `crosslang-green3-mutant` PASS
  (expected assertion failures caught → mutant load-bearing; exit 0).
- **Environment-only failure (1, not a regression):** `verify-doc-tool-surface` FAILs in this fresh
  worktree because the untracked generated artifact `website/src/data/tools.generated.ts` exists only in
  the main checkout; CP1's PASS was already documented as partly environment-dependent
  (`VERIFICATION-CP1.md` §6). Worktree has no `website/` (verified).
- **Pre-existing REDs (7, unchanged from CP1, NOT regressions):** `m13/verify-visualize-options`,
  `m48/verify-p1-impact-unity`, `m48/verify-p2-honesty-fields`, `m57/verify-t5-predicate-unity`,
  `m57/verify-closure`, `m57/verify-gate-selftest`, `m57/verify-governance`.
- go-imports phase-2 gates on FINAL2: `verify-analyze` `ANALYZE: PASS`; Go fixtures
  `{"go":{"pass":51,"fail":0}}`; `verify-analyze-modes` `An1: VERIFIED (84/84, 27 negatives)`.
- `npx tsc --noEmit` **exit 0** (`71-final2-tsc.log`).

## 3. Bettercap read-surface symptom script (FINAL2 dist)

`bash docs/bb-bettercap-fix/tools/cp1-bettercap-checks.sh --bin "node bin/bb" --out docs/bb-bettercap-fix/evidence/final/symptoms-final2`
→ **SUMMARY: 34 pass / 0 fail / 5 deferred-or-skipped** (exactly the declared expectation), run by the
verifier against the FINAL2 dist with no `BB_DATA_DIR`. Evidence: `evidence/final/symptoms-final2/`,
log `evidence/final/verifier/83-final2-symptoms.log`. Deferred = index-time checks that need a fresh
index of the real tree (closed by §4's real-source subset reindex).

## 4. Write-side verification — regression found, fixed, re-verified

### 4.1 The regression and its fix (RESOLVED)

- **Found by** the Lead's fresh bettercap-copy reindex (read-only suites cannot see this class): on a
  FRESH index, same-language Go calls were unbound — `main.go:47 modules.LoadModules` and
  `modules_test.go:16 LoadModules` had `target_symbol_id` NULL (the old index bound both), so the
  `bb_edit` refactor plan regressed to 2 files / 2 sites and missed `modules_test.go`.
- **Root cause:** P0-2's `applyP02BindingGates` rule 2 blanket-unbound every
  `metadata.isPackageQualified` row (Go marks ANY selector call with that flag, not only cross-language
  collisions), and the package-scoped binding path did not exist.
- **Fix (cross-lang, GREEN3; both sourced from go-imports' verified package-dir contract):**
  `applyP02PackageScopedBinding()` runs at both marker sites before `applyP02BindingGates` — qualifier
  validated against exactly one file-local internal `brain_import` row, qualified → `goPackageDirForSpecifier`
  → exactly-one callable in the package dir; bare calls resolve same-package (same-file first);
  bindings stamp `bindingBasis=import-path`; refusals record `bindingPolicy=<reason>`; rule 2 keeps
  blanket refusal for `isStdlib`/`isExternalTarget`/`isFieldAccess` and applies the
  `isPackageQualified` refusal only when the row is not evidence-backed (`bindingBasis != import-path`).
  Gate additions P4 (qualified binds, same-package binds, variable receiver not package-bound);
  mutant caught; `m26` 12/12; tsc clean.
- **Verifier re-verification on the real bettercap SOURCE SUBSET index** (project
  `ddaf987f4b9b474f1446b1f28ee529e3c8c965d3`, 393 files, `derived: full`; evidence
  `write-side-verification.md` + verifier's own `90-write-side-independent.txt`,
  `91-subset-refactor-dryrun-independent.txt`, `64-crosslang-green3-bettercap-arm-subset.txt`):
  - refactor dry-run **3 files / 3 sites** (`modules/modules.go`, `main.go`, `modules/modules_test.go`),
    `verification.reparsed=passed`, `unresolvedReferences=[]`;
  - `main.go:47 → modules/modules.go:LoadModules:42`, `bindingBasis=import-path`;
    `modules_test.go:16` bound (same-package path); **504 import-path bindings**;
  - GREEN3 gate **21/21 assertions passed** with the bettercap arm
    (`bound=504 refused=0`, cross-language name-resolution imports/calls 0, `session.New` unverified
    qualified callers 0);
  - func main **21** calls / module **0**; imports **326** internal / **0** same-module external;
    GO1 **378** reads / **0** fabricated param rows; `dependencies(session)` internal deps **348**,
    dependents **2470**; cross-language read facts **0**.

### 4.2 PRE-EXISTING full-index scaling defect (recorded, NOT a campaign regression, NOT fixed here)

A FULL bettercap-copy reindex (2031 files / 55,785 symbols) fails derivation with `SQLITE_FULL`:
`CREATE TEMP TABLE _res_contains_targets AS SELECT … ROW_NUMBER() OVER (PARTITION BY r.id …)`
materializes 20,991,769 candidate rows for 21,882 unresolved `contains` rows (all `contains` rows arrive
NULL from the worker pool). The statement predates the campaign and is unmodified by it — verifier
confirmation: `git diff 380a7e473 -- src/ast/parallel-indexer.ts | grep -c _res_contains_targets` = **0**
(`90-write-side-independent.txt`). It is a data/scale-only full-index defect; the full-index READ-side
checks still pass **12/12** (`evidence/final/reindex-final-fixed2.log` — cross floors 0, GO1 378/0,
func-main 21/module 0, imports 327 internal/0 same-module external, deps 348, cross facts 0). The
index-time write fixes were therefore proven with a real-source subset index whose derivation completes
(`derived: full`). Recommended follow-up (outside this campaign's fix scope): bound/rewrite the
`contains` candidate derivation for large fresh indexes.

## 5. Evidence index (wave-2 FINAL)

| path | content |
|---|---|
| `evidence/final/verifier/00-frozen-snapshot.txt`, `02-final2-build-facts.txt` | frozen tree + FINAL2 build/dist facts, src/dist shas |
| `evidence/final/verifier/10-p27-final-dist.txt`, `11-p27-final2-dist.txt`, `12-p27-final2-corrupt-copy.txt` | P2-7 on FINAL/FINAL2 dist: verify:dist, --json, --self-test, corrupt-copy exit 1, real dist untouched |
| `evidence/final/verifier/20-p26-final-gate.txt`, `24-p26-final2-gate.txt` | P2-6 old-index compat gate (all doors + remedy + control) |
| `evidence/final/verifier/60-crosslang-green3-gate.txt`, `61-…-mutant.txt`, `62-…-m26.txt`, `63/64-…-bettercap-arm*.txt` | GREEN3 gate 18/18 fixtures, mutant caught, m26 12/12, bettercap arm 21/21 on real-source subset |
| `evidence/final/verifier/70-final2-suite-runs.txt`, `71-final2-tsc.log`, `72-final2-suite-summary.json` | FINAL2 46-run suite header/footer, tsc, machine summary + regression list (empty) |
| `evidence/final/verifier/80-go-verify-analyze-final2.txt`, `81-go-fixtures-final2.txt`, `82-analyze-modes-final2.txt` | go-imports phase-2 gates on FINAL2 |
| `evidence/final/verifier/83-final2-symptoms.log`, `evidence/final/symptoms-final2/` | symptom script on FINAL2 dist, 34/0/5 |
| `evidence/final/verifier/90-write-side-independent.txt`, `91-subset-refactor-dryrun-independent.txt` | verifier's own subset-index binding/dry-run checks + pre-existing-statement proof |
| `evidence/final/write-side-verification.md`, `subset-*` | Lead's real-source subset reindex + write-side proof |
| `evidence/verifier/p2/**`, `evidence/verifier/runs/` (+ `index.ndjson`) | P2-6/P2-7 RED→GREEN history and every harness record (`final2/*`, `final-wave1/*`, `cp1b/*`, `cp1-final/*`) |
| `docs/bb-bettercap-fix/OPS.md` | rebuild + MCP restart protocol (P2-7 deliverable) |

## 6. FINAL VERDICT

**PASS for all wave-2 fixes and the wave-1 regression-free re-verification on FINAL2 (src sha
`ab0176b98ba4…`, dist sha `c2ea3fb2…`).** No new regressions vs CP1; the write-side P0-2 regression was
found by the fresh-index reindex, fixed, and independently re-verified on a real bettercap source subset
index; P2-6/P2-7 PASS on the FINAL2 build/dist; 7 pre-existing REDs and 1 environment-only gate failure
are documented and not attributable to the campaign; one pre-existing full-index scaling defect
(`_res_contains_targets`/SQLITE_FULL) is recorded for follow-up and does not invalidate the write-side
proof. Verifier made no source edits and ran no build.
