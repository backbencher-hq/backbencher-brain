# VERIFICATION-CP1 — independent verifier report (wave-1 integration checkpoint)

Verifier: `go-callgraph` (independent; no product edits, adversarial). Date **2026-11-19**.
Repo `/home/ishaq2321/mcp/backbencher-brain`, HEAD `75448b02991e6f6f5b1dfa0630b4e07c06436109`,
bb `0.1.6`. Frozen-tree snapshots and every raw record are under
`docs/bb-bettercap-fix/evidence/verifier/` (CP1 artifacts in `…/cp1/`, harness records in `…/runs/`).

**Status: CLEAN — CP1 PASS (final, after CP1-B).** Every wave-1 fix gate is GREEN, the bettercap
read-time symptoms are 34 pass / 0 fail / 5 deferred, and the last 4 legacy graph-family gate
regressions found by this verifier were closed by payload-honesty with **gate-side-only** changes and
independently re-verified GREEN (§5, CP1-B). No open blockers; pre-existing REDs are documented in §6;
no rebuild was required for CP1-B (product `src/` sha `8b8ae8bc…` and `dist/` sha `4e9c7221…`
unchanged).

## 1. Method (reproducible)

- **Pre-fix bytes**: `.tools/verifier/pre-fix` = `git archive 75448b02` extract + `node_modules`
  symlink + the baseline `dist` (mtimes normalized). Never `git stash`/`checkout`; scratch dirs
  `.tools/triage-fix/*` pre-created (gitignored artifacts absent from the archive would otherwise be
  mistaken for RED).
- **Runner**: `script/m-fix/verify-fix-campaign.ts --label … [--expect-red] --cwd … -- <cmd>` records
  JSON verdicts (`PASS|FAIL|TIMEOUT|RED_CONFIRMED|UNEXPECTED_PASS`) with git HEAD, dirty count and
  `BB_DATA_DIR` under `evidence/verifier/runs/` + `index.ndjson` (harness self-tested 5/5 earlier).
- **Env**: `BB_DATA_DIR=$PWD/.tools/verifier/bbdata-*` (+ `BB_M57_DATA_DIR` for m57 gates). Without it,
  fixture-index gates die at `src/ast/index-lock.ts:447` (sandbox cannot `mkdir ~/.bb/projects/<hash>`)
  — environment, never counted as product failure.
- **Runner caveats**: `verify-graph.ts`, m57 and most m13/m35/m48 gates must run under **bun** (repo
  verify chain); `verify-mcp-tools.ts` and `verify-polyglot-e2e.ts` must run under **`npx tsx`**
  (their own documented runner — bun cannot load better-sqlite3). Mis-runner results were classified,
  not counted (`m26`, `m28`).
- **RED-first** was replayed independently for every wave-1 gate file (new gate copied into the pre-fix
  tree at its repo-relative path so `ROOT`/imports resolve to pre-fix `src/`; see
  `cp1/red-replay-summary.{json,md}`).

## 2. Final CP1 build (single, on frozen tree)

| item | value |
|---|---|
| when | 2026-11-19T05:03Z; src tree sha `8b8ae8bc…` before and after build+suite (no src change during CP1) |
| result | `npm run build` **exit 0**, "Build success in 746ms" (1.72 s wall); dist 155 chunks / 8.9 MB; `node bin/bb --version` = 0.1.6 |
| dist integrity | `npx tsx script/verify-dist-integrity.ts` **exit 0** — 155 JS chunks, 1058 relative refs, **0 missing**; independent scan: 1058 refs / 0 missing |
| dist manifest | `evidence/verifier/dist/manifest-after-cp1-final2.txt`, dir sha `4e9c7221…` |
| tsc | `npx tsc --noEmit` **exit 0** (`cp1/71-final-tsc.log`) |
| tree-change guard | src sha unchanged through build + suite; one bogus self-run (`m12-surface` typo command) excluded from accounting |
| **CP1-B follow-up** | 2026-11-19T05:15:24–05:16:32Z: 4 gate files adapted by payload-honesty (`m13/verify-visualize-owner-fold.ts`, `m13/verify-visualize-target-literals.ts`, `m35/verify-s3-graph-migrate.ts`, `m48/verify-p3-agreement.ts`); **gate-side only — `src/` sha `8b8ae8bc…` and `dist/` sha `4e9c7221…` unchanged, no rebuild**; 11/11 re-runs GREEN incl. the graph-family slice, `npx tsc --noEmit` exit 0 (`cp1/95-cp1b-runs.txt`, `cp1/96-cp1b-tsc.log`, logs `cp1/cp1b-*.log`) |

## 3. Per-fix verdicts

| fix | verdict | independent evidence |
|---|---|---|
| **P0-1** `bb_edit` refactor safety | **PASS** | gates GREEN: `script/m71/verify-refactor-safety.ts` (planned 3 files/3 sites, main.go present, refusal on zero-site files, applied tree compiles), `script/m13/verify-edit-rename.ts` (E2 92/92), `script/m13/verify-edit-freshness.ts` (E5 14/14), `script/m15/verify-edit-crossfile.ts` (E4 31/31, E5 5/5, E8 8/8). RED replay: m71 pre-fix `RED_CONFIRMED` (2 files/2 sites, main.go MISSING, silent-success, applied tree fails `go build: undefined: modules.LoadModules`). Bettercap: "P0-1 dry-run plans main.go and >=3 files/sites", "plan exposes verification status", raw plan body mentions `main.go`. Positive controls meaningful (G1 same-package rename still happens; G4 value-receiver member untouched; named import renamed). Earlier CP1 regression in `verify-edit-crossfile` (D2 shadow) was found by this verifier and is **CLOSED** by R1/R2 (re-verified: E4 31/31). |
| **P0-2** unscoped name binding + cross-language honesty | **PASS (index-time reindex DEFERRED to FINAL)** | `script/m57/verify-p02-name-binding.ts` GREEN (collision fixture 0 forbidden bindings; committed polyglot PC1 3 / PC2 2 bridge rows retained; mutant caught). RED replay: `RED_CONFIRMED` pre-fix (cross-lang 3, non-code target 1, bare-name imports 3, isFieldAccess 2, external-claim 4). Approved m26 contract correction GREEN under documented runner (`npx tsx`, 12.4 s; no weaker assertion — it replaces an over-claim with the candidate contract). Bettercap read-time retro-honesty: "every cross-language fact is declared a candidate (inferred/name-only/<=0.5)" + "read text marks candidate rows". Existing-DB index-time rows remain old by design → FINAL-stage reindex honesty. |
| **P1-1/P1-2 phase 1** Go analyzer-local (GO1 cross-file value reads, package-main analyzer half, import-identity prerequisites) | **PASS at fixture level; store-side index-time effects DEFERRED to FINAL / phase 2** | `script/verify-analyze.ts` GREEN including the new Go section (GO1 cross-file leaf row + out-of-scope reason code, same-file control, import externality directions incl. lookalike/undecided, readGoModulePath, package-main call-site line). RED replay available in lane evidence (`go-imports/RED-guard-fixtures-go.txt`; Lead applied the designed param-name guard after lane cut). Bettercap cross-file/package-main symptoms are index-time → recorded SKIP/DEFERRED by the Lead symptom script. Go fixtures 51/51 per Lead (verify-analyze re-confirms the two new fixtures). |
| **P1-3** test intelligence | **PASS** | `script/verify-test-intel.ts` + `script/verify-test-quality.ts` GREEN; RED replay: `RED_CONFIRMED` but **api-presence-weak** (pre-fix bytes lack the new exports; behavioral assertions cannot execute pre-fix — disclosed, lane's own RED captured separately). Positive controls substantive (same-package/imported call accepted; unrelated same-named rejected; Go table/`t.Fatalf`/testify evidence; `%s` no longer parameterization; JS/Python vocabularies preserved). Bettercap: "session mapping has no caplets/ or js/ links", "session.New links are only validated reachable tests", "Lock/Unlock not mapped to unrelated module tests", "Go test files score real assertions", "parameterization is not the JS it.each anchor", "fixtures anchor is not the testing stdlib import". |
| **P1-4 + P2-5** envelope + label honesty | **PASS (CP1-B closed the last 4 gate regressions)** | New gate `script/m73/verify-payload-envelope.ts` GREEN (summary-first across impact/graph/visualize/analyze-impact; bounds in `head -c 4096`; byte budget declared; security tier units; visualize whole-project claim gated; 78/78 re-verified in CP1-B). m28/m48 adapted path-only gates GREEN. Bettercap symptoms 34 pass/0 fail: impact/graph first key `summary`, `payloadBytes` honest, bounds reachable in 4096 bytes, graph ≤256 KB or declares truncation, security "lead-tier analyzers", no unlabelled "39 leads", visualize drops whole-project claim on scoped/truncated page. The four legacy gates that had regressed were adapted gate-side-only and re-verified GREEN (§5). |
| **P2-1 + P2-2** doc subject scope + search symbol mode | **PASS** | `script/verify-retrieval-contract.ts` GREEN; RED replay `RED_CONFIRMED` (flat union/property subject, `limit:1` subject drift, qualified target not disambiguated, search contract fails). Positive controls: unique symbol single declaration/scope/citation, sibling modes unaffected. Bettercap: doc `quality.scope`/`resolvedBy` declared, qualified target one subject; search source slice returned (or declared unavailable reason), `fileId` = `projectId:path` never absolute, `absolutePath` separate. |
| **P2-3 + P2-4** embeddings lifecycle + health honesty | **PASS** | `script/verify-embedding-lifecycle.ts` GREEN with leg-B positive control (populated configured space answers with vectors, no fallback declared, config not mutated) and leg-A RED pre-fix (`RED_CONFIRMED`: hard-filter to 1/24, keyword fallback, no pending state). `script/verify-health-honesty.ts` GREEN with complete-run control; RED pre-fix (`RED_CONFIRMED`: status=complete beside 1972/1973, force-remedy on size-tier skip, no per-language syntax grouping, embeddings line lacks configured-model split). Bettercap: P2-3/P2-4 symptom PASSes (4/4 + ask fallback). |
| **Verification/build coordination (this lane), P2-6/P2-7** | **PASS (build/verifier)** / **P2-6/P2-7 not in CP1 (task-19)** | baseline 17/22 + 5 classified pre-existing; build+dist integrity clean; harness; pre-fix RED reference; ownership audit. Old-index compat and dist gate wiring deferred to task-19. |

## 4. Gate matrix (final suite on frozen tree — 44 runs, 32 exit 0; one bogus self-run excluded)

GREEN wave-1 gates (each with meaningful positive controls, see `cp1/14-positive-control-audit.md`):
`m13/verify-edit-rename`, `m13/verify-edit-unit`, `m13/verify-edit-freshness`, `m15/verify-edit-crossfile`,
`m15/verify-edit-classification`, `verify-analyze`, `verify-test-intel`, `verify-test-quality`,
`verify-search-modes`, `m13/verify-ask-contract`, `verify-health`, `verify-doc`, `verify-doc-tool-surface`,
`m57/verify-t1-classifier`, `m57/verify-t2-consumers`, `m57/verify-t4-corpus-identity`,
`m71/verify-refactor-safety`, `m57/verify-p02-name-binding`, `m73/verify-payload-envelope`,
`verify-retrieval-contract`, `verify-embedding-lifecycle`, `verify-health-honesty`,
`m26/verify-polyglot-e2e` (documented runner), `m28/verify-mcp-tools` (documented runner),
`verify-graph` (fixed + adapted), `m65/verify-graph-blindspots` (fixed + adapted),
`m13/verify-analyze-modes` (fixed + adapted), `m13/verify-visualize-views` (fixed + adapted),
`m13/verify-visualize-fidelity`, `m15/verify-contracts`, `m35/verify-envelope-contract`,
`m57/verify-t3-scope-all`, plus `npx tsc --noEmit` exit 0.

**CP1-B re-runs (all GREEN on the frozen tree, no rebuild):** `m13/verify-visualize-owner-fold`
**V8 29/29** · `m13/verify-visualize-target-literals` **V6 21/21** · `m35/verify-s3-graph-migrate`
**S3 23/23** · `m48/verify-p3-agreement` **30 passed / 0 failed / 5 negatives** · graph-family slice
(`verify-graph`, `m65/verify-graph-blindspots`, `m13/verify-analyze-modes`,
`m13/verify-visualize-views`, `m73/verify-payload-envelope`, `m28/verify-mcp-tools`) all PASS ·
`npx tsc --noEmit` exit 0.

## 5. Regressions — every regression found during CP1 is CLOSED

### CP1-B — 4 envelope access-path regressions, closed gate-side-only and re-verified GREEN

Before CP1-B these four gates were PASS on pre-fix bytes and FAIL on fixed HEAD (fixed-vs-pre-fix
records `runs/*cp1-final-*` vs `runs/*cp1-final-prefix-*`); payload-honesty adapted only their
response-reading layer, and the verifier re-ran them on the same frozen tree:

| gate | pre-CP1-B failure (fixed HEAD) | CP1-B result |
|---|---|---|
| `script/m13/verify-visualize-owner-fold.ts` | `TypeError: … evaluating 'r.nodes.map'` | **V8: VERIFIED 29/29 (8 negatives)** — bun runner (`import.meta.dir`) |
| `script/m13/verify-visualize-target-literals.ts` | `TypeError: … evaluating 'plain.nodes.length'` | **V6: VERIFIED 21/21 (5 negatives)** |
| `script/m35/verify-s3-graph-migrate.ts` | `FAIL: viz: freshness block with exact registered keys` | **M35 S3 GRAPH+MIGRATE: PASS 23/23** |
| `script/m48/verify-p3-agreement.ts` | `FAIL: P3: caller set identical (leaf) — graph= analyze=…` | **M48 P3 AGREEMENT: PASS 30 passed / 0 failed / 5 negatives** |

**p3-nuance audit (access-path, not semantic):** `git diff script/m48/verify-p3-agreement.ts` is
parse-only — it adds `flattenEnvelope(payload) = { ...payload.summary, ...payload.data, summary, data }`
and applies it in `call()`; no assertion, expected value or comparison expression changed. The
collision is intentional: `summary.nodes` is a COUNT (number) while `data.nodes` is the node TABLE, so
spreading summary first and data second lets the table win — exactly what the gate's pre-existing
`nameOf()` already expects (it resolves caller names through the node table). The caller-set
comparison predicates are byte-identical to the pre-envelope version → **access-path adaptation, no
relaxed assertion**. Gate-side only: `src/` sha `8b8ae8bc…` and `dist/` sha `4e9c7221…` unchanged; no
rebuild required. Evidence: `cp1/95-cp1b-runs.txt`, `cp1/96-cp1b-tsc.log`, `cp1/cp1b-*.log`,
harness records `runs/*cp1b/*`.

### CLOSED earlier in CP1
- `script/m15/verify-edit-crossfile.ts` D2-shadow regression (found by this verifier on the first green
  slice; fixed by edit-safety R1/R2) — **re-verified GREEN**: E4 31/31, E5 5/5, E8 8/8; freshness E5 14/14.
- The first four envelope regressions (`verify-graph`, `m65/verify-graph-blindspots`,
  `m13/verify-analyze-modes`, `m13/verify-visualize-views`) — fixed by payload-honesty path-only
  adaptations; **re-verified GREEN** in the final suite and re-confirmed in CP1-B.

No open regressions remain.

## 6. Pre-existing REDs (NOT regressions — failed on pre-fix bytes / before campaign)

| gate | class |
|---|---|
| `script/m48/verify-p1-impact-unity.ts` | pre-existing known-gap (79 pass / 1 fail on pristine pre-fix copy; `cp1/m48-p1-prefix.log`) |
| `script/m48/verify-p2-honesty-fields.ts` | pre-existing (fails pre-fix too; depends on unverified P1 evidence) |
| `script/m57/verify-t5-predicate-unity.ts` | pre-existing product-level P3 source-governance RED (55 src files; line shifts only) |
| `script/m57/verify-closure.ts` | pre-existing campaign-state (T4 real-corpus unavailable in sandbox; foreign-red M20) |
| `script/m57/verify-gate-selftest.ts` | pre-existing gate rot (mutation anchors absent from current src) |
| `script/m57/verify-governance.ts` | pre-existing environment (G1.4 needs GitHub network; offline) |
| `script/m13/verify-visualize-options.ts` | pre-existing (fails on pre-fix bytes too) |
| `script/m13/verify-visualize-honesty.ts` | pre-existing (fails on pre-fix bytes too) |
| `script/m12/verify-m12-surface.ts` | pre-existing (fixture/language-matrix drift, fails pre-fix too) |
| `verify-doc-tool-surface.ts` | was a pre-existing env failure at baseline (missing generated `website/src/data/tools.generated.ts`); now GREEN partly because that generator ran → **environment change, not a lane fix** |

## 7. RED-first replay (independent, pre-fix bytes) — 8/8 RED_CONFIRMED

`cp1/red-replay-summary.{json,md}`: m71 refactor-safety (honest behavioral), m57 p02 (honest),
payload m73 (honest), retrieval contract (honest), embedding lifecycle (honest), health honesty
(honest), test-intel / test-quality (**api-presence-weak** — pre-fix bytes lack the new exports, so
their behavioral assertions cannot run pre-fix; their RED direction is valid but the lane's own
behavioral RED is required and is recorded in lane evidence). Two gates needed pre-created
`.tools/triage-fix` scratch dirs in the pre-fix tree (gitignored artifacts); after that they report
behavioral failures — documented, not a product pass.

## 8. Bettercap read-time symptoms (Lead's script, run by verifier against final dist)

`bash docs/bb-bettercap-fix/tools/cp1-bettercap-checks.sh --bin "node bin/bb" --out evidence/verifier/cp1-bettercap`
→ **SUMMARY: 34 pass / 0 fail / 5 deferred-or-skipped** (matches the Lead's expectation).
Raw per-check stdout/stderr/json in `evidence/verifier/cp1-bettercap/`, log
`cp1/90-bettercap-symptoms.log`. Deferred = index-time effects (P1-1 imports, P1-2 package-main /
cross-file uses on the existing DB, P0-2 index-time binding) → FINAL-stage bettercap-copy reindex.
Bettercap was read-only throughout (CLI read tools only; no writes, no reindex).

## 9. Positive controls & ownership

- **Positive controls**: audited all wave-1 gates; no tautological control found; two evidence-strength
  caveats (test-intel/test-quality api-presence RED; doc-surface env change). Full table:
  `cp1/14-positive-control-audit.md`.
- **Ownership audit**: `cp1/10-ownership-audit.md` + final snapshot `cp1/80-final-git-status.txt`
  (120 rows) / `cp1/82-final-ownership-classification.json`. No unapproved source-scope violation;
  the Lead-resolved flags are recorded (analyze handler = approved envelope scope; generated docs/
  website = ignore; m26 correction = approved; m48 P1 = pre-existing). Hot file
  `src/ast/parallel-indexer.ts` changes sit in covered resolution regions. Remaining hygiene:
  untracked `.scratch/`, `validation/m14/measurements/csharp-grammar-nodes.json`, `validation/m65/`
  (campaign artifacts, not product source); **lane status pages still missing for go-imports,
  go-testintel, retrieval** (FIX-CHARTER §7 DoD gap to note at commit).

## 10. Recommendation — CP1 is CLEAN

CP1 is **PASS** for all wave-1 fixes: P0-1, P0-2, P1-1/P1-2 (phase-1, index-time effects deferred to
FINAL), P1-3, P1-4+P2-5 (all 4 post-envelope regressions closed and re-verified), P2-1+P2-2,
P2-3+P2-4. Build and dist integrity are clean and the frozen tree did not change during verification
(src sha `8b8ae8bc…`, dist sha `4e9c7221…`). Bettercap read-time symptoms: 34 pass / 0 fail /
5 deferred (index-time reindex honesty is a FINAL-stage check by design). Pre-existing REDs in §6 are
documented and must not be counted against a wave-1 lane. Residuals to carry forward, not blockers:
index-time bettercap reindex verification (FINAL), go-imports phase 2, P2-6/P2-7 (task-19), missing
lane status pages for go-imports/go-testintel/retrieval, and untracked campaign artifacts (§9).

## 11. Evidence index

| path | content |
|---|---|
| `evidence/verifier/cp1/60-final-frozen-snapshot.txt` | frozen tree HEAD/sha/status at CP1 start + after build |
| `cp1/61-final-build.log`, `62-final-dist-integrity.log` | final build + dist integrity |
| `evidence/verifier/dist/manifest-after-cp1-final2.txt` | final dist byte manifest (dir sha `4e9c7221…`) |
| `cp1/70-final-suite-runs.txt` | final suite header/footer + src sha |
| `cp1/71-final-tsc.log` | `npx tsc --noEmit` (empty = pass) |
| `cp1/90-bettercap-symptoms.log` + `evidence/verifier/cp1-bettercap/` | Lead symptom script, 34/0/5 |
| `cp1/red-replay-summary.{json,md}` | independent RED replay of the 8 lane gates on pre-fix bytes |
| `cp1/14-positive-control-audit.md` | control-by-control tautology audit |
| `cp1/10-ownership-audit.md`, `80-final-git-status.txt`, `81-final-diffstat.txt`, `82-final-ownership-classification.json` | diff-vs-ownership |
| `cp1/50-legacy-gate-regressions.md` | envelope-regression dossier (open + closed) |
| `cp1/95-cp1b-runs.txt`, `cp1/96-cp1b-tsc.log`, `cp1/cp1b-*.log` | CP1-B re-runs: 4 adapted gates + graph-family slice + tsc, frozen-tree src/dist shas |
| `cp1/m48-p1-prefix.log`, `cp1/regress*.log`, `cp1/rerun-*.log` | fixed-vs-pre-fix logs |
| `evidence/verifier/runs/` + `index.ndjson` | every harness verdict (PASS/FAIL/RED_CONFIRMED/…) |
| `.tools/verifier/pre-fix/` | byte-exact pre-fix tree for RED comparisons (scratch) |
