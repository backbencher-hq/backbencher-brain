#!/bin/bash
# script/m22/create-issues.sh — create M22 issues (verifier-sized, data-grounded).
# Run: bash script/m22/create-issues.sh   (idempotent-ish: skips if title exists)
set -euo pipefail
REPO=backbencher-hq/backbencher-brain
MILESTONE="M22: Indexer UX, Observability & Incremental Truth"

mkissue() {
  local title="$1"
  local body="$2"
  # skip if already created
  if gh issue list --repo "$REPO" --milestone "$MILESTONE" --state all --json title --jq '.[].title' | grep -Fxq "$title"; then
    echo "SKIP (exists): $title"
    return
  fi
  gh issue create --repo "$REPO" --milestone "$MILESTONE" --title "$title" --body "$body" >/dev/null
  echo "CREATED: $title"
}

# ---- G1 ----
mkissue "M22.G1 governance: M22 ledger, evidence schema, fail-closed closure gate" '## Scope
Mirror M21.C1/X3 governance but with dependency-aware staleness (accepts evidence whose `src/` is byte-identical to HEAD, rejects real `src/` drift) so the gate converges with zero manual ledger surgery.

## Deliverables
- `docs/m22/M22-MASTER-PLAN.md` (exists) + `validation/m22/ledger.json` (every issue -> evidence file -> pass/fail/gate).
- `script/m22/verify-g1-governance.ts` that CAN FAIL: asserts every M22 evidence file exists, parses, carries `command`, `commit`, positive+negative checks, and no auto-pass/tautological/`|| true` patterns (self-audits itself too).
- Closure gate `script/m22/verify-gate.ts`: all M22 issues evidence at head, 0 stale, 0 mutation gaps.

## Acceptance
- Gate passes from a clean `git status` (only intended M22 files staged) with evidence re-pointing automatic and non-churning.
- Negative: an evidence pointing at a commit with genuinely changed `src/` is rejected as stale.

## Evidence
`validation/m22/results/*.json`, `validation/m22/ledger.json`'

# ---- V1 ----
mkissue "M22.V1 surface live index progress in the CLI (files/total, files/s, ETA, current file, phase)" '## Scope
The machinery already computes progress and calls `options.onProgress` (measured: 243 events @ ~579ms cadence on element-plus), but `cmdIndex` passes `{}` and discards it. Wire it to a live CLI line.

## Deliverables
- `bb index` shows live: files done / total, files/s, ETA, current file, current phase (parse/enrich/...), overwriting a single line on real terminals.
- `script/m22/verify-v1-progress.ts` asserts `onProgress` flows end-to-end to a capture sink with the measured cadence and correct totals on a controlled fixture.

## Acceptance (can fail)
- On a fixture with a known file count, received total equals ground truth; at least N progress events emitted (not 0); final event reports 100%.
- Negative: passing no callback yields no crash; passing a callback yields >0 events.

## Evidence
controlled-fixture run + real-repo element-plus sample.'

# ---- V2 ----
mkissue "M22.V2 add `bb index status` + per-phase cost visibility (incl. the co-dominant dbFlush line)" '## Scope
No way to query in-flight/last-run index state. Probe shows `dbFlush` (169.1s) >= `parse` (141.1s) cumulative on element-plus — a first-class bottleneck users cannot see.

## Deliverables
- `bb index status` (and an MCP-equivalent query) reports: totals, per-phase timings (discovery/startup/parse/**dbFlush**/finalAccounting + each post-processing phase), elapsed, ETA, worker count, retries/poison/fallbacks, last-run state.
- Works for an in-flight run (from another shell) AND last-run.

## Acceptance (can fail)
- During a slow index on element-plus, `bb index status` in a second shell shows rising files-done and an explicit `dbFlush` ms line; never shows only a bare end-of-run summary; never fabricates a zero for an unmeasured phase.

## Evidence
real-repo in-flight observation + fixture assertions.'

# ---- V4 ----
mkissue "M22.V4 queryable index stats anytime (`bb stats`)" '## Scope
Symbols/relationships/files/embeddings are printed only in the end-of-run line; no way to query them anytime against a committed DB.

## Deliverables
- `bb stats [<dir>]` (or `bb index status --stats`) returns files/symbols/relationships/embeddings from the DB for the project.
- `script/m22/verify-v4-stats.ts` cross-checks counts against an independent DB query (not the same code path) on a fixture and a real repo.

## Acceptance (can fail)
- Counts match an independent SQL count; empty/never-indexed project returns explicit "not indexed" (not a fabricated zero); ≥2 negatives: stale/no-DB project and mismatched project id.

## Evidence
fixture + rake/element-plus DB counts.'

# ---- V5 ----
mkissue "M22.V5 honest run summary ('N unchanged / N newly parsed / N skipped / N SYMBOL-LOSS')" '## Scope
rake probe returned 779 symbols with `parsed=0` (re-index, all unchanged) but users get no breakdown. element-plus parsed 2331 of 2580 candidates; ~250 were SCSS files that produced zero symbols (ENGINE_EMPTY bypass). The end-of-run summary must expose these losses.

## Deliverables
- `bb index` final summary reports: total candidates, unchanged (noop), newly parsed, symbol-loss (parse-empty), syntax-error, timeout/retry counts — one row each, never conflated.
- `script/m22/verify-v5-summary.ts` builds a fixture mixing changed/unchanged/SCSS-broken files and asserts the exact breakdown.

## Acceptance (can fail)
- A fixture with 1 changed + 2 unchanged + 1 broken-SCSS yields distinct non-negative counts for each bucket and the SCSS file is counted as symbol-loss (not silently). Negatives: all-unchanged yields parsed=0 but unchanged=N; broken fixture yields symbol-loss>0.

## Evidence
controlled fixture + element-plus SCSS-loss sample.'

# ---- W1 ----
mkissue "M22.W1 one logging story: --verbose/--quiet, discoverable log file, visible worker/AST-engine/WASM diagnostics" '## Scope
All logs go raw to stderr; `pool-worker.ts` hard-sets `BB_LOG_LEVEL=error`; no `--verbose`/`--quiet`; no discoverable log file. Users see unexplained "worker err"/"ast engine error"/"html wasm error".

## Deliverables
- `--verbose`/`--quiet` on the CLI controlling worker + AST-engine + WASM-load diagnostics; a documented log file/dir (e.g. `~/.bb/logs/index.log`) instead of undocumented stderr-only.
- Remove the worker hard-set suppression in favor of CLI-driven level.
- `script/m22/verify-w1-logging.ts`: asserts level control toggles emitted diagnostics, and WASM-load failures are visible at `--verbose`.

## Acceptance (can fail)
- Running with `--quiet` shows no diagnostics; `--verbose` shows the per-file worker/WASM lines that are currently suppressed; a forced WASM-load failure is visible at `--verbose` and absent at `--quiet`. Negatives: default level is neither fully silent nor fully verbose.

## Evidence
CLI runs at each level capturing stderr.'

# ---- W2 ----
mkissue "M22.W2 index must fail loudly and survive per-file schema errors, not crash the whole run (vue-core)" '## Scope
Probe: vue-core aborts entirely with `table brain_index_status has no column named status`. A single schema/column mismatch takes down the whole index with no partial progress preserved and no guidance. CSS/SCSS files "parse" but emit zero symbols (ENGINE_EMPTY) silently.

## Deliverables
- The `brain_index_status` schema/column mismatch (root-caused and fixed or cleanly surfaced); a hard, actionable error telling the user the exact file/table/column, instead of an abort.
- Per-file survival: a schema error in one file/language must be recorded and skipped, not kill the project.
- Record per-file `ENGINE_EMPTY`/symbol-loss count and surface it (ties to V5).
- `script/m22/verify-w2-failloud.ts`: reproduces the vue-core crash pre-fix, asserts post-fix behavior (error surfaced, run continues, excluded/loss files listed).

## Acceptance (can fail)
- Indexing vue-core now either succeeds or reports the exact schema issue with guidance and preserves other files; a synthetic bad-language file is skipped-and-listed, not fatal. Negatives: pre-fix crash is gone; a genuinely unparseable grammar asset still fails visibly (never silently swallowed).

## Evidence
vue-core full index + synthetic per-file failure fixture.'

# ---- W3 ----
mkissue "M22.W3 write docs/TROUBLESHOOTING.md: every reported index symptom -> cause -> command" '## Scope
Users have no manual: WASM-load errors, "worker err"/"ast engine error", single-worker, 5-hour enrich, DB-lock/SQLITE_BUSY, the undocumented `/tmp/bb-parse-errors.log`, resume, "how much time remains".

## Deliverables
- `docs/TROUBLESHOOTING.md` covering each symptom with real cause (tie to W1/W2/V2/V5/R1) and the exact command to diagnose/fix.
- Document `bb index`, `bb index status`, `bb stats`, `--incremental`, `--verbose`, log file location, resume.
- `script/m22/verify-w3-doc.ts`: asserts the doc exists and every canonical symptom string maps to a "cause" and "command" section (structural, can fail).

## Acceptance
- Every reported user symptom appears with a non-empty cause and command; no dead/phantom references (e.g. no mention of a `--post` that does not exist).

## Evidence
doc + linted section map.'

# ---- C1 ----
mkissue "M22.C1 `bb index` defaults directory to process.cwd()" '## Scope
`bb index` requires `<dir>`; running it inside a project dir errors, unlike every other command (search/health/mcp default to cwd).

## Deliverables
- `bb index` with no `<dir>` indexes `process.cwd()`; `cd proj && bb index` works.
- `script/m22/verify-c1-cwd.ts`: launches `bb index` from inside a temp project and asserts the project is indexed (not an error).

## Acceptance (can fail)
- From inside a project dir, `bb index` (no arg) indexes that dir; from outside without arg likewise defaults to cwd. Negative: a nonexistent explicit path still errors clearly.

## Evidence
scripted CLI runs in temp dirs.'

# ---- C2 ----
mkissue "M22.C2 CLI help/examples + honest post-processing control (kill the phantom `--post`)" '## Scope
Users reference `--post` which does not exist; help text is one-line only with no examples; no way to control whether post-processing runs.

## Deliverables
- Rich per-command help with examples (`bb index --help` explains dir default, status, incremental, verbose, resume).
- A real, working post-processing control: either implement `--skip-post-processing`/`--only-parse` or document the intended flag; never leave users issuing a nonexistent `--post`.
- `script/m22/verify-c2-help.ts`: asserts help output contains the documented flags and no phantom flags.

## Acceptance (can fail)
- Every documented flag exists and is accepted; a phantom flag (e.g. `--post`) is either implemented or clearly absent+documented. Negative: an unknown flag errors.

## Evidence
CLI `--help` captures.'

# ---- D1 ----
mkissue "M22.D1 `bb index --incremental` / `--changed`: reindex only changed files" '## Scope
Incremental machinery exists internally (mtime/size `existingStats` map; `toIndex` changed-files path) but the CLI never exposes it — every `bb index` does full parse + full post-processing.

## Deliverables
- `bb index --incremental` / `bb index --changed` reindexes only changed/added files and runs only the needed post-processing; unchanged files report as such (ties to V5).
- `script/m22/verify-d1-incremental.ts`: fixture, index once, edit one file, `--changed` -> asserts only that file parsed and its graph edges updated; unchanged-then-`--changed` -> 0 newly parsed.

## Acceptance (can fail)
- Editing one file of N and running `--changed` parses exactly 1 (not N); a symbol added to that file is queryable afterwards; unchanged run parses 0. Negatives: full `bb index` still parses everything (no regression); deleted file is reflected.

## Evidence
fixture + real repo edit.'

# ---- D2 ----
mkissue "M22.D2 `bb health --refresh` and refresh paths must not run a full index + full post-processing" '## Scope
`bb health --refresh` calls `indexProjectParallel(pid, path, {})` — as expensive as a first index, with heavy post-processing on every refresh.

## Deliverables
- Refreshes reuse the incremental/changed-files path; an unchanged repo refresh is a near-no-op (parses 0 changed files, skips expensive post-processing).
- `script/m22/verify-d2-refresh.ts`: run full index, then `bb health --refresh` on unchanged repo -> asserts parse count ≈ 0 and no expensive post-processing phases run; edit a file -> refresh parses only that file.

## Acceptance (can fail)
- Second refresh on unchanged repo is dramatically cheaper (near-no-op), not a full re-index. Negative: a genuine change still gets reflected.

## Evidence
timed refresh runs.'

# ---- D3 ----
mkissue "M22.D3 make the single-file reindex reachable + correct (edit one file -> refresh just that file's graph)" '## Scope
A single-file reindex path exists internally (`brain/service.ts` ~line 108) but is not reachable/correct as a user/MCP surface; the "AI agent edited a file, graph is stale" gap starts here.

## Deliverables
- Expose single-file reindex (CLI `bb index --file <path>` and/or the MCP tool, see E1) so one file refreshes its own symbols + relationships.
- `script/m22/verify-d3-single-file.ts`: index, edit one symbol in one file, single-file reindex -> assert old symbol gone, new symbol present, relationships updated, unrelated files untouched.

## Acceptance (can fail)
- Only the target file re-parsed; its graph reflects the edit; sibling files' symbols unchanged. Negatives: a deleted-file-origin reference does not linger as a phantom.

## Evidence
fixture + real single-file edit.'

# ---- E1 ----
mkissue "M22.E1 MCP `bb_index` reindex tool so an agent can refresh a just-edited file (agent-fresh)" '## Scope
MCP exposes 10 tools, no index/reindex tool. An agent that just wrote a function has no way to make it visible; `bb_search`/`bb_ask` reflect stale index until a full reindex. The `ensureIndexed` error even says "Run: bb index" but the server cannot do it.

## Deliverables
- MCP `bb_index` tool: accepts a file path (and/or dir), triggers a single/changed reindex, returns success with the counts (new/updated/unrelated) — wired to E1/D3 incremental.
- `script/m22/verify-e1-mcp.ts`: via the MCP tool definitions + a direct handler call, write a new function then `bb_index {file}` then assert `bb_search`/`bb_ask` finds the symbol immediately; second run is an idempotent near-no-op.

## Acceptance (can fail)
- After an agent writes a function and calls `bb_index`, the symbol is queryable without any full reindex; negative: calling with an unindexed/nonexistent path returns a clear error, never a silent no-op.

## Evidence
MCP-tool-level E2E on a temp project.'

# ---- R1 ----
mkissue "M22.R1 implement index checkpoint/resume (SIGINT/crash/power-loss) — converts M21.R3 known-gap to verified" '## Scope
M21.R3 (deferred known-gap) documented that cancellation/checkpoint/resume was "not implemented." This issue implements it for real.

## Deliverables
- Persist index progress; on SIGINT/exit, `bb index --resume` (or auto-resume) continues from the checkpoint instead of restarting, with no corrupt partial data.
- `script/m22/verify-r1-resume.ts`: start an index on a non-trivial fixture, interrupt it mid-run, `--resume` -> assert only remaining files processed, DB consistent (no orphan rows), and the run completes.

## Acceptance (can fail)
- Interrupted run + resume processes strictly fewer files than a fresh run and produces a consistent, queryable DB; negative: resuming on an already-complete run is a no-op; corrupt checkpoint is detected, not silently accepted.

## Evidence
interrupted-run reproduction on a real repo.'

echo
echo "M22 issue creation complete."