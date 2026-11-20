# go-testintel — P1-3: validated test mapping + language-aware test-quality model

- **Lane:** `go-testintel` · **Task:** task-12 (P1-3) · **Triage spec:** `docs/bb-bettercap-triage/findings/ISSUE-05-test-mapping.md`, `ISSUE-06-test-quality.md`, `PLAN.md` §6
- **Landed in:** `380a7e473` (`fix: wave-1 bettercap-report fixes across analyzers and tools`) · **Verified at HEAD:** `09b82be95`
- **Status:** **GREEN** — both lane gates PASS on the landed tree; RED evidence retained; bettercap E2E recorded.
- **Read-only specimen:** `/home/ishaq2321/bettercap` (projectId `4c7590f1…`, never reindexed/written). All E2E reads went through the shipped engines.

## 1. What was wrong (measured, pre-fix)

**Issue 5 — a stored `calls` row was published as `direct_call` at 0.85 with no reachability check.** The Go analyzer records a package-qualified call as its bare leaf (`errors.New` → `New`, `otto.New` → `New`; `src/ast/real-go-analyzer.ts:6581-6588`) and the name resolver binds that leaf to the project-wide lowest-id symbol (`src/ast/parallel-indexer.ts:3863-3872`, I13 pass `:6656-6696`). Test-intel then trusted the stored `target_symbol_id` unconditionally (`src/intelligence/testing/test-intel.ts` `DIRECT_TYPES = {calls, instantiates}` → 0.85).

Measured on bettercap (triage evidence `docs/bb-bettercap-triage/evidence/go-testintel/`):

- `session/session.go:New:155` was reported tested by `caplets/caplet_test.go:142` (`TestCapletEvalError`, which calls only `errors.New`/`NewCaplet`) and by **12 `js/data_test.go` rows** (8 `Test*` + 4 `Benchmark*`; the report's "ten benchmarks" was an imprecise count of this same false block) plus 7 `js/fs_test.go` rows — all `direct_call`/`calls` at 0.85. Ground truth: **zero `New()` calls in `session/*_test.go`**.
- `session.Lock`/`Unlock` (152 stored rows each) were "tested" by module tests locking an **embedded `sync.Mutex`** (`modules/arp_spoof/arp_spoof_test.go:66`, `m.Lock()` at :96).
- Project-wide: 3,245 test-file `calls` rows, **457 (14.1 %)** the stdlib-leaf shape; gqlgen/graphql reproduced (`executor.New` 155 leaf rows over 5 `New` symbols).

**Issue 6 — one JS-shaped regex table measured every language.** Seven bettercap `session/` test files with **114 real `t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error` assertion sites** all scored `assertions: 0` + `no_assertion_evidence` at dimension confidence 0.85; `error_handling` was also 0 (14 `if err != nil` checks, report omitted); "parameterization" fired on the printf verb **`%s`** (`quality.ts:124`) while `observedAnchor` hard-coded `"it.each/test.each template"` (no `it.each` token existed); `fixtures` anchored on the `testing` stdlib import; the penalty term `clamp01(strength − 0.5·penalty)` floored at 0 so it was **inert**; aggregate **0.322222** = mean of the 7 per-file overalls.

## 2. RED — gates first, on unmodified code

Commands (the sandbox cannot create `~/.bb/projects/<hash>`; `BB_DATA_DIR` is the Lead-provided workaround so the index-backed half runs):

```bash
BB_DATA_DIR=$PWD/.tools/triage-fix/go-testintel/bbdata npx tsx script/verify-test-intel.ts
BB_DATA_DIR=$PWD/.tools/triage-fix/go-testintel/bbdata npx tsx script/verify-test-quality.ts
```

- `evidence/go-testintel/RED-verify-test-intel.txt` → exit 1, **1 FAILURE**:
  `FAIL: test-intel engine exports validateTestLink (validation capability)` — plus the gate's printed pre-fix defect snapshot (`DIRECT_TYPES` has no reachability check).
- `evidence/go-testintel/RED-verify-test-quality.txt` → exit 1, **4 FAILURES**:
  `measureTestContent` / `TEST_VOCABULARIES` / `aggregateQuality` / `overallScore` absent — plus the pre-fix snapshot (Go t.Fatalf assertions=0, t.Run table param=0, `%s` param>0 labelled it.each, session aggregate 0.3222).
- All pre-existing integration checks (2-file fixture, rich/weak, unknown-content handling, suggestions) were **green at RED** — they are the positive controls.

## 3. Fix (changed files — all within lane ownership; `contracts.ts` untouched)

### `src/intelligence/testing/test-intel.ts` — mapping publishes only provable evidence

- New exported **`validateTestLink`** (+ `TestLinkRejection` / `TestLinkValidationInput` types) returning one of five specific reasons:
  `external-stdlib-leaf`, `target-name-mismatch`, `qualified-call-target-is-a-leaf`, `receiver-selector-unresolved`, `cross-package-unreachable`.
  Rules: a row whose own metadata says `isStdlib:true` is rejected outright; a qualified spelling stored as a bare leaf is accepted only when the qualifier names the **target's package** *and* the test file imports it; receiver/member chains fail closed (no receiver types in the index); an unqualified callee must be in the caller's own package directory (Go/Java/Kotlin/Scala/C#) or reachable through the test file's imports; non-call kinds (references/uses/…) require reachability.
- `loadGraph` now selects the target symbol name + target file + test-file language + `brain_relationship.metadata`, reads the test corpus's `brain_import` specifiers once, and validates **only classifiable kinds** whose target is in the queried production population (so a scoped report never publishes project-wide counts).
- Rejected rows are **not dropped silently**: counted per reason, declared in `provenance.unknowns` as `unvalidated-test-links: N stored relationship row(s) … (reason=count, …)` for both **test_mapping and test_gaps**, and surfaced as summary fields `unvalidatedLinks` / `unvalidatedByReason` attached as a declared intersection field (contract file frozen for the wave).

### `src/intelligence/testing/quality.ts` — the language's vocabulary is the evidence

- New exported **`TEST_VOCABULARIES`** (go, python, javascript/typescript, rust, and a declared `generic-superset` fallback) and **`measureTestContent({relativePath, language, content, imports})`** (pure), **`overallScore`**, **`aggregateQuality`** (pure, used by the projection gate).
  - Go: `t.Fatalf`/`t.Errorf`/`t.Fatal`/`t.Error`, `require.*`/`assert.*`, `cmp.Diff`; error paths `if err != nil` / `if err == nil` / `recover()`; parameterization `t.Run` + `range tests`; long test names `func Test…`.
  - Python: `assert` statement / `self.assert*`, `pytest.raises`/`assert_raises`/`except`, `@pytest.mark.parametrize`/`subTest`.
  - JS/TS: `expect`/`assert`/`should.`/matchers, `try`/`catch`/`toThrow`, `it.each`/`test.each`/`describe.each`.
  - Rust: `assert!`/`assert_eq!`/`assert_ne!`/`debug_assert!`, `should_panic`/`panic!`; parameterization **declared unsupported** (never fabricated 0).
- **`%s`/`$x` removed from parameterization entirely** (no language keeps it); the shared `CONTENT_CLASSIFIERS` export keeps the low-level token table (all global RegExps, for `script/m15`).
- **`observedAnchor` is now the observed token** — `t.Fatalf × 49, t.Fatal × 7`, `t.Run × 6`, `require × 2`, `pytest.mark.parametrize × 1`, `t.TempDir × 3`, `// × 6`; never a hard-coded construct label.
- **Fixtures measure real fixtures**: fixture-setup calls (`t.TempDir`/`TempFile`/`MkdirAll`/`httptest`/`beforeEach`/`tmp_path`/…) plus local fixture imports; stdlib and test-framework imports are infrastructure, not fixtures (a stdlib-only Go test now correctly has `fixtures: 0`, anchor null).
- **Effective penalty** (`clamp01(strength·(1−0.5·penalty))`): zero-evidence no longer contributes exactly 0 with the penalty silently swallowed.
- Payload surfaces the heuristic: per-file `strengths` includes `vocabulary: go`; `provenance.unknowns` declares `language-vocabulary: go (7 file(s))` and any `language-vocabulary-fallback:` use.

### Gates (extended, not weakened)

- `script/verify-test-intel.ts`: **validation gate** — MUST-REJECT the measured bettercap rows (caplet `errors.New`, `js/data_test.go` `otto.New`, embedded-Mutex `m.Lock`, cross-package bare `New`) with their exact reasons; CONTROLS must ACCEPT same-package `session_test.go → session.ParseCommands`, genuinely-imported `session.New`, same-package reference. Existing mapping/gaps/impact checks preserved; index-unavailable is a **narrow declared SKIP** (`ENOENT … .bb/projects`, FIX-CHARTER §5 sandbox precondition), not a silent pass.
- `script/verify-test-quality.ts`: language-aware section — Go table+`t.Run` assertions>0.5 with `t.Run` anchor, testify `require/assert` with observed-token anchor, `if err != nil`, `%s`-only → parameterization 0 + null anchor, real-fixture anchor vs stdlib-import null, JS `it.each`, Python `assert`/`pytest.raises`/`parametrize`, anchors-are-observed-tokens invariant, penalty effectiveness, **dual projection pins** (below); all pre-existing quality/suggestions/unknown checks preserved.

## 4. GREEN — final confirmation run on the landed tree

```bash
BB_DATA_DIR=$PWD/.tools/triage-fix/go-testintel/bbdata npx tsx script/verify-test-intel.ts   # -> TEST-INTEL: PASS   (exit 0)
BB_DATA_DIR=$PWD/.tools/triage-fix/go-testintel/bbdata npx tsx script/verify-test-quality.ts # -> TEST-QUALITY: PASS (exit 0)
```

- `evidence/go-testintel/GREEN-final-verify-test-intel.txt`: **PASS**, 24 `ok:` checks, 0 failures.
- `evidence/go-testintel/GREEN-final-verify-test-quality.txt`: **PASS**, 56 `ok:` checks, 0 failures.
- Projection line from the GREEN run (engine-computed, no hand-tuning):
  `info: pre-fix=0.32222222222222224 counterfactual_projection=0.5114197530864197 honest_full_model=0.46140400604686327 recorded_corpus=7 files`
  - **Counterfactual projection = 0.5114**, which is the triage projection **0.502778 ± 0.05** (gate pin) — language-aware assertions/error/parameterization only, other dimensions held as recorded pre-fix.
  - **Honest full-model = 0.4614** on the session-shaped gate corpus (every dimension measured by the new engine, real-fixture basis, effective penalty) — band pin `[0.39, 0.47]` and `≥ pre-fix + 0.08`, both met.
  - Both numbers are reported because the triage's ~0.50 did not model the mandated real-fixture basis (stdlib-only corpus → `fixtures: 0`) or the now-effective penalty; the Lead accepted pinning both.

## 5. bettercap E2E (`evidence/go-testintel/GREEN-bettercap-e2e.json`, frozen index `4c7590f1…`, `matchesFrozenIndex: true`)

Command: `node_modules/.bin/tsx .tools/triage-fix/go-testintel/e2e-bettercap.ts` (no `BB_DATA_DIR` → opens the existing `~/.bb` index read-only; no reindex).

| Measure | Pre-fix (triage) | Post-fix (E2E) |
|---|---|---|
| `test_mapping filePath=session` tested symbols | 34 | **18** |
| evidence links (session scope) | 264 | **127** |
| unvalidated rows (declared) | — | **137** (`qualified-call-target-is-a-leaf=127`, `external-stdlib-leaf=3`, `receiver-selector-unresolved=7`) |
| `session.New` links | 50 stored test-file rows; caplets `caplet_test.go:142` + 12 `js/data_test.go` + 7 `js/fs_test.go` | **20** (page cap) from **8 module test files**, every one a verified genuine `s, _ := session.New()` call site; **0 caplets/`js` rows** |
| `session.Lock` / `session.Unlock` links | 16 / 16 (embedded `sync.Mutex`, module tests + `routing/tables_test.go`) | **0 / 0**, `strongestEvidence: "none"` |
| test_quality `session/` aggregate | **0.322222** | **0.488095** (+0.166) |
| assertions (per-dim / files) | 0 across 7/7, all `no_assertion_evidence` | per-dim **0.8571**; anchors `t.Fatalf × 49, t.Fatal × 7` … `t.Errorf × 1`; `no_assertion_evidence` **gone** |
| error_handling | 0 (report omitted) | **0.3333** (`if err != nil` credited where present) |
| parameterization | `%s` proxy, label `it.each/test.each template` | **0.6667**, anchors `t.Run × 6, range tests × 6` (real Go table/subtest token) |
| docs / fixtures / mocking | 0.881?→ (pre: 0.714) / 0.607 / 0 | **0.8810** / **0** (honest: stdlib-only imports are not fixtures) / 0 |
| vocabulary disclosure | none | `language-vocabulary: go (7 file(s))` |

**One triage-expectation correction (flagged to Lead):** the correct project-wide answer for `session.New` is **not 0 links**. `session/*_test.go` truly never calls it (0 occurrences), but 24 genuine `session.New()` calls exist in module tests (`modules/api_rest/api_rest_test.go:26/594/603/615`, `ticker_test.go:19/379/398`, `any_proxy_test.go:21`, `ble_recon_test.go:22`, `can_test.go:19/377/391`, `update_test.go:18/320/339`, `view_selector_test.go:19/417/430/443`, …); the post-fix mapping now lists **only** those proven callers and no unrelated package. The reported symptom (caplets/js false mappings, embedded-Mutex Lock/Unlock) is gone.

## 6. Controls (must keep working — all green)

- Same-package Go call `session/session_test.go → session.ParseCommands` **accepted** (direct_call).
- Genuinely imported package call `session.New` from a file importing `…/v2/session` **accepted**.
- Same-package `references` edge **accepted**.
- JS same-name isolation: `src/a.ts helper` mapped, `src/b.ts helper` **not** mapped (`helper in b.ts is NOT mapped (same-name isolation + import reachability)`).
- JS rich test still out-scores weak test; weak file still flags `no_assertion_evidence`; unread content still reports content dims `supported:false`; suggestions (`extend_existing_test`/`create_test`/naming fallback/deleted coverage) unchanged.
- Existing `test_gaps`/`test_impact`/mapping integration checks unchanged and passing.

## 7. Typecheck

`evidence/go-testintel/tsc-noemit.txt` (captured at GREEN): repo-wide `npx tsc --noEmit` had **8 errors, all in files being edited by other lanes at the time** — `src/intelligence/health/health-provider.ts` (embeddings-health) and `src/lsp/cross_language_hover.ts` (cross-lang), both `git status: M` WIP. **0 errors attributable to this lane's files** (grep filter count 0); the two lane gates execute the changed modules end-to-end and pass. The Lead's integration checkpoint is the authority for a clean repo-wide tsc.

## 7b. CLI/dist E2E (final build, bettercap specimen — read-only)

- `bb_analyze test_mapping filePath=session` → `testedSymbols=18`, `evidenceLinks=127`,
  `unvalidatedLinks=137` with `{qualified-call-target-is-a-leaf:127, external-stdlib-leaf:3,
  receiver-selector-unresolved:7}`; `unvalidated-test-links: 137 …` declared in `provenance.unknowns`
  (`DIST-E2E-test_mapping-session.json`).
- `bb_analyze test_quality filePath=session` → aggregate `0.488095` (assertions `0.8571`, docs
  `0.8810`, error_handling `0.3333`, parameterization `0.6667`, fixtures `0`); per-file anchors are the
  observed tokens (`t.Fatalf × 49, t.Fatal × 7` …) (`DIST-E2E-test_quality-session.json`).

## 8. Residuals / open items

1. **Docs pages — FIXED (commit `39f69b4b5`).** `docs/BB_TEST_INTEL.md` and `docs/BB_TEST_QUALITY.md` were rewritten to the landed validation contract (five reasons, `unvalidatedLinks`/`unvalidatedByReason`, scope-relative counts, `test_impact` not validated) and the language-aware model (vocabularies/anchors/penalty/anchor invariant/dual projection); docs-truth gates PASS (m31 71/71; tool docs 16 tools/18 artifacts).
2. **Receiver-selector evidence fails closed.** Genuine `s.Lock()` on a `*session.Session` is indistinguishable from `sync.Mutex.Lock()` without receiver-type resolution, so it is declared `receiver-selector-unresolved` (7 rows in scope) rather than published; Lock/Unlock are therefore 0 links. That is the honest answer for this engine; full coverage needs type resolution (out of lane scope).
3. **Rejection counts are scope-relative.** Scoped `filePath=session` reports 137 rejects for session's production population; a project-wide mapping run reports the larger corpus-wide set. The payload states the count and reasons, and the scoping rule is documented in the code comment.
4. **`test_impact` is unchanged**: it walks the graph engine's caller traversal (P0-2 / issue 4 domain) and is not validated by this lane.
5. `contracts.ts` deliberately untouched (Lead decision): `unvalidatedLinks`/`unvalidatedByReason` are an attached intersection field; if the contract is later extended they should move into `TestMappingReport.summary`.
6. Python/JS vocabularies are gate-tested via `measureTestContent` only (no indexed non-Go specimen with test files was available in-sandbox); bettercap/gqlgen give the indexed Go evidence.

## 9. Evidence index (`docs/bb-bettercap-fix/evidence/go-testintel/`)

| File | Content |
|---|---|
| `RED-verify-test-intel.txt` | RED: 1 failure (validation capability absent) |
| `RED-verify-test-quality.txt` | RED: 4 failures (language-aware API absent) |
| `GREEN-final-verify-test-intel.txt` | final GREEN: PASS (24 checks) |
| `GREEN-final-verify-test-quality.txt` | final GREEN: PASS (56 checks) + projection line |
| `GREEN-verify-test-intel.txt`, `GREEN-verify-test-quality.txt`, `GREEN1-*.txt` | intermediate GREEN runs retained |
| `GREEN-bettercap-e2e.json` / `.err` | frozen-index E2E numbers (§5) |
| `tsc-noemit.txt` | tsc run at GREEN (other lanes' WIP only) |
| `.tools/triage-fix/go-testintel/e2e-bettercap.ts` | E2E script (workspace scratch, gitignored) |
