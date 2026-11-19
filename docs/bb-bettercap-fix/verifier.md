# Verifier + build coordinator — wave-1 status (`go-callgraph`)

Role: independent verifier for the fix campaign and the only wave-1 lane allowed to run
`npm run build` (FIX-CHARTER §5). This page is the verifier's durable handoff: build state, the
pre-fix baseline that CP1 compares against, the verifier harness, and the CP1 protocol.
**Adversarial stance:** the verifier re-runs gates itself and does not accept lane reports as evidence.

- Repo: `/home/ishaq2321/mcp/backbencher-brain`, branch `main`, HEAD `75448b02991e6f6f5b1dfa0630b4e07c06436109`
  (`75448b029`, triage commit; bb `0.1.6`).
- Pre-fix byte copy: `.tools/verifier/pre-fix/` = `git archive HEAD` extract + `node_modules` symlink
  + the baseline `dist/` copied in with mtimes normalized. Not a git worktree; the main tree's git
  state is never touched (`git stash`/`checkout` are forbidden).
- Campaign env for gates: `BB_DATA_DIR=$PWD/.tools/verifier/bbdata` (sandbox cannot `mkdir
  ~/.bb/projects/<hash>`; without it, fixture-index gates die at `src/ast/index-lock.ts:447` — an
  environment failure, not a gate defect). m57 real-DB gates additionally take
  `BB_M57_DATA_DIR=<workspace scratch>`.
- Task: `task-16` (this page). CP1 independent verification = `task-18`; P2-6/P2-7 = `task-19`.

## 1. Build state (baseline build, pre-fix — DONE; no later build run)

| item | value |
|---|---|
| command | `npm run build` (`tsup`, `clean:true`) |
| when | 2026-11-18T23:47:25Z — product source clean at that moment (only pre-existing `M validation/m14/results/M14.0.F1.json` + untracked scratch) |
| result | **exit 0**, `⚡️ Build success in 1292ms`, wall 2.46 s, max RSS 156 MB |
| dist | 155 `.js` chunks (+ `cli/`, `mcp/`, `lsp/` entries), 8.8 MB |
| dist-integrity gate | `npx tsx script/verify-dist-integrity.ts` → exit 0: "155 JS chunk(s), 1055 relative reference(s) … ✓ every relative chunk reference resolves; entry exists" |
| independent dangling-chunk scan | 155 files, 1055 static `./chunk.js` refs, **0 missing**; 151 dynamic-import chunk refs; **no reference to the stale class** `database-HE6EE3VA.js` |
| CLI smoke | `node bin/bb --version` → `0.1.6` |
| dist manifest | `evidence/verifier/dist/manifest-after-baseline-build.txt` (158 sha256 rows); dir sha `d4377e30…` |
| logs | `evidence/verifier/baseline/01-build.log`, `02-build-dist-integrity.txt` |

**Dist-integrity finding: CLEAN.** The triage's stale-chunk failure class (compiled bundle referencing a
chunk from a previous build — `Cannot find module …/dist/database-HE6EE3VA.js`) is **not present**: every
relative chunk reference resolves and no reference names the stale database chunk. Matches the Lead's
BOARD line.

**Honesty notes / limitations**
- `tsup` uses `clean:true`, so the pre-build `dist/` was replaced before a byte-manifest could be taken;
  a claim that the *old* dist contained the stale class rests only on the triage record
  (`docs/bb-bettercap-triage/findings/UNLOCKED.md:156`). What is proven: the new dist is self-consistent.
- This build ran while `src/` was still clean → it is the **pre-fix baseline dist**. No build has been
  run since lanes started editing `src/` (concurrent builds corrupt dist — FIX-CHARTER §5). Next build
  only on the Lead's "build now" at a checkpoint.
- Gates run source-level (`bun`/`npx tsx`), not against `dist/`, except where a gate explicitly asserts
  dist freshness (`m57/verify-t3-scope-all.ts` K6/K6b); the baseline dist copied into the pre-fix tree
  covers that case.

## 2. Pre-fix baseline (RED reference for CP1)

Snapshot: `.tools/verifier/pre-fix` = byte copy of committed HEAD `75448b029` (`git archive`, so lane
edits in the main tree cannot contaminate it), `node_modules` symlinked, baseline `dist/` copied in.
Env: `BB_DATA_DIR=$PWD/.tools/verifier/bbdata` (+ `BB_M57_DATA_DIR` for the m57 real-DB gates).
Authoritative run 2026-11-19T00:18–00:24Z; machine-readable copy with full classification:
`evidence/verifier/baseline/baseline-verdicts.json`.

### Pre-existing failures (must NOT be read as regressions)

| # | gate | runner | exit | verdict | classification | evidence |
|---|---|---|---|---|---|---|
| 1 | `script/m13/verify-edit-rename.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-edit-rename.log` |
| 2 | `script/m13/verify-edit-unit.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-edit-unit.log` |
| 3 | `script/m15/verify-edit-crossfile.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-edit-crossfile.log` |
| 4 | `script/m15/verify-edit-classification.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-edit-classification.log` |
| 5 | `script/verify-analyze.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-analyze.log` |
| 6 | `script/verify-test-intel.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-test-intel.log` |
| 7 | `script/verify-test-quality.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-test-quality.log` |
| 8 | `script/verify-graph.ts` | `npx tsx` → **`bun`** | 1 → **0** | **FAIL under tsx / PASS under bun** | **runner-mode pre-existing**: gate loads a `bun:`-condition module (`#db` → `src/storage/db.bun.ts`), so it must run under `bun run` (the repo's own `verify` chain does exactly that). Not a product failure. | `baseline2-graph.log` (tsx), `baseline2b-graph-bun.log` (bun PASS) |
| 9 | `script/verify-search-modes.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-search-modes.log` |
| 10 | `script/m13/verify-ask-contract.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-ask-contract.log` |
| 11 | `script/verify-health.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-health.log` |
| 12 | `script/verify-doc.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-doc.log` |
| 13 | `script/verify-doc-tool-surface.ts` | `npx tsx` | 1 | **FAIL** | **pre-existing environment**: imports generated `website/src/data/tools.generated.ts`, which is not committed and absent from the checkout (requires the docs-generation prerequisite). Independent of all lanes. | `baseline2-doc-surface.log` |
| 14 | `script/m57/verify-closure.ts` | `bun` | 1 | **FAIL** | **pre-existing RED (campaign-state)**: 13 pass / 3 fail with correct env — `T4` corpus-identity requires a populated real corpus DB (unavailable in-sandbox: live corpus `{0,0,0}`), `T5` fails its own P3 source-governance check, and `foreign-red M20.patterns-orphan-semantics now PASSES` is a documented conviction that no longer reproduces. | `baseline2c-m57-closure-bun-workspace-data.log` |
| 15 | `script/m57/verify-gate-selftest.ts` | `bun` | 1 | **FAIL** | **pre-existing gate rot**: mutation anchors for T3/T5 are absent from the current `src/` (`mutation anchor not found in src/intelligence/patterns/orphans.ts`, `src/ast/analysis-exclusions.ts`), and T4/T5 controls fail with the same real-corpus dependency as row 14. Not caused by wave-1 fixes. | `baseline2c-m57-gate-selftest-bun-workspace-data.log` |
| 16 | `script/m57/verify-governance.ts` | `bun`/`tsx` | 1 | **FAIL** | **pre-existing environment**: 33 checks pass; `G1.4` requires GitHub milestone access (`curl https://api.github.com` → code 000/offline). | `baseline2-m57-verify-governance.log` |
| 17 | `script/m57/verify-t1-classifier.ts` | `npx tsx` | 0 | **PASS** | baseline green (needs `BB_DATA_DIR`) | `baseline2-m57-verify-t1-classifier.log` |
| 18 | `script/m57/verify-t2-consumers.ts` | `npx tsx` | 0 | **PASS** | baseline green | `baseline2-m57-verify-t2-consumers.log` |
| 19 | `script/m57/verify-t3-scope-all.ts` | `npx tsx` → **`bun`** (+ baseline dist) | 1 → **0** | **FAIL on copy without dist / PASS with baseline dist** | needs `dist/` present and newer than `rules.ts` (K6/K6b). In the main tree the baseline dist satisfies this; the snapshot needed the copied dist + mtime normalization. | `baseline2-m57-verify-t3-scope-all.log`, `baseline2b-m57-t3-bun.log` |
| 20 | `script/m57/verify-t4-corpus-identity.ts` | `npx tsx` | 0 | **PASS** standalone | **environment-dependent**: passes standalone; inside `verify-closure` it fails `M2` because the "live corpus" is empty in this sandbox. | `baseline2-m57-verify-t4-corpus-identity.log` |
| 21 | `script/m57/verify-t5-predicate-unity.ts` | `npx tsx` | 1 | **FAIL** | **pre-existing product-level RED**: `P3` reports 55 `src/` files that mention test-shape rules without importing the canonical predicate (governance/consistency backlog at HEAD). Pre-dates the campaign. | `baseline2-m57-verify-t5-predicate-unity.log` |
| 22 | `npx tsc --noEmit` | `npx tsc` | 0 | **PASS** | baseline green | `baseline2-tsc-noemit.log` |

**CP1 regression rule:** a gate that was PASS here must never go RED because of a lane change; a gate
may legitimately change RED→GREEN only through a fix, and only with a positive control (charter §4).
The pre-existing REDs above are the only failures CP1 tolerates without a regression finding.

### Runner / environment guidance for lane gate reports (important)

- Use `bun run script/...` for gates the repo's `npm run verify` chain runs with bun (`verify-graph.ts`,
  `m57/*`); `npx tsx` for the rest of the Lead's list. A tsx-only `bun:` ESM error is a runner-mode
  artifact, not a gate result.
- Always export `BB_DATA_DIR=<workspace>/.tools/verifier/bbdata`; for m57 real-DB gates also export
  `BB_M57_DATA_DIR=<workspace>/.tools/verifier/bbdata` (and `BB_M57_REAL_DB=1`), and note that T4's
  corpus-identity check needs the campaign's populated real corpus DB (unavailable in this sandbox).
- The first baseline run (no `BB_DATA_DIR`) is kept for the record: `baseline-summary.tsv` +
  `baseline-*.log` — every `ENOENT mkdir ~/.bb/projects/<hash>` row there is the **sandbox artifact**.

## 3. Verifier harness (`script/m-fix/verify-fix-campaign.ts`, verifier-owned)

One runner for CP1 re-runs: runs a gate command, captures bounded stdout/stderr, records a JSON verdict
stamped with git HEAD / dirty-file count / `BB_DATA_DIR`, appends to `runs/index.ndjson`.

```bash
# normal expectation (PASS if exit 0, FAIL otherwise)
npx tsx script/m-fix/verify-fix-campaign.ts --label cp1/edit-rename \
  --cwd .tools/verifier/pre-fix --env BB_DATA_DIR=$PWD/.tools/verifier/bbdata \
  -- npx tsx script/m13/verify-edit-rename.ts

# pre-fix RED capture (nonzero exit == RED_CONFIRMED; exit 0 == UNEXPECTED_PASS)
npx tsx script/m-fix/verify-fix-campaign.ts --label cp1/edit-rename-prefix --expect-red \
  --cwd .tools/verifier/pre-fix --env BB_DATA_DIR=$PWD/.tools/verifier/bbdata \
  -- npx tsx script/m13/verify-edit-rename.ts

# machine-readable: --json prints only the verdict record; --cmd "<shell>" for shell commands
```

Verdicts: `PASS | FAIL | TIMEOUT | RED_CONFIRMED | UNEXPECTED_PASS`; exit code mirrors the verdict
(0 for PASS/RED_CONFIRMED, 1 otherwise, 2 usage error). Records:
`docs/bb-bettercap-fix/evidence/verifier/runs/<utc-stamp>-<label>.json` + `runs/index.ndjson`;
stdout/stderr captured into the record (never leaked in `--json` mode), each stream bounded at 256 KB
with the middle elided and `stdoutTruncated`/`stderrTruncated` flags.

Harness self-test (2026-11-19T00:06Z, HEAD `75448b029`):

| case | command | expected | recorded verdict | record |
|---|---|---|---|---|
| pass | `node -e 'console.log("hello-pass")'` | PASS | **PASS** (exit 0) | `20261119T000624Z-selftest-pass.json` |
| fail | `node -e 'process.exit(3)'` | FAIL | **FAIL** (exit 3) | `20261119T000627Z-selftest-fail.json` |
| red-expectation met | `--expect-red … exit 3` | RED_CONFIRMED | **RED_CONFIRMED** | `20261119T000629Z-selftest-red.json` |
| red-expectation violated | `--expect-red … exit 0` | UNEXPECTED_PASS | **UNEXPECTED_PASS** | `20261119T000631Z-selftest-unexpected.json` |
| shell mode | `--cmd 'echo shell-ok; exit 0'` | PASS | **PASS** | `20261119T000633Z-selftest-shell.json` |

## 4. CP1 protocol (task-18 — planned, starts only on the Lead's signal)

For each wave-1 lane, in this order, with the harness recording every run:
1. **RED replay:** run the lane's gate on `.tools/verifier/pre-fix` (pre-fix bytes) with the campaign
   env; record `--expect-red`. A gate that does not fail pre-fix is not a gate (charter §4.1).
2. **GREEN replay:** run the same gate on the main tree (HEAD + lane diff); record normal expectation.
3. **Positive-control audit:** read the gate source and confirm the control asserts legitimate behavior
   (same-module import stays internal; genuine bridge survives; same-package rename still renames;
   table tests score assertions; real impact keeps counts) — a tautological control is a FAIL.
4. **Symptom re-run on bettercap** (read-only CLI; needs a checkpoint build): refactor plan includes
   `main.go:47`; no false `session.New` callers; no cross-language collision rows; Go deps internal;
   test mapping 0 links; impact/graph summary-first ≤ budget; doc subject resolved; search source +
   `projectId:path` fileId; health honest; ask declared fallback; security/visualize labels.
5. **Diff-scope audit:** `git status --porcelain` vs FIX-CHARTER §2 ownership — any lane writing outside
   its owned files is a finding.
6. Write `docs/bb-bettercap-fix/VERIFICATION-CP1.md` with per-fix PASS/FAIL/PARTIAL, evidence paths,
   and any regression (report discrepancies to Lead immediately; do not fix them myself).

## 5. Evidence index

| path | content |
|---|---|
| `evidence/verifier/baseline/00-git-snapshot.txt` | HEAD + working-tree state at baseline start |
| `evidence/verifier/baseline/01-build.log` | full `npm run build` output + wall/RSS |
| `evidence/verifier/baseline/02-build-dist-integrity.txt` | dist-integrity gate + independent dangling-chunk scan + CLI smoke + dist sha |
| `evidence/verifier/baseline/baseline-verdicts.json` | per-gate verdict + classification (machine-readable) |
| `evidence/verifier/baseline/BB_DATA_DIR-note.txt` | campaign data-dir override |
| `evidence/verifier/baseline/dist-copy-note.txt` | baseline dist copied into the pre-fix copy + mtime normalization |
| `evidence/verifier/baseline/baseline-summary.tsv` | first run WITHOUT `BB_DATA_DIR` (sandbox-artifact failures) |
| `evidence/verifier/baseline/baseline2-summary.tsv` | authoritative baseline WITH `BB_DATA_DIR` (exit codes) |
| `evidence/verifier/baseline/baseline-*.log`, `baseline2-*.log`, `baseline2b-*.log`, `baseline2c-*.log` | per-gate full outputs |
| `evidence/verifier/dist/manifest-after-baseline-build.txt` | post-build dist byte manifest |
| `evidence/verifier/runs/` | harness verdict JSON records + `index.ndjson` |
| `.tools/verifier/pre-fix/` | pre-fix byte copy for RED replay (scratch, gitignored) |
| `.tools/verifier/bbdata/` | `BB_DATA_DIR` scratch for fixture-index gates (gitignored) |
