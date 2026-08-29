# M22 — Indexer User Experience, Observability & Incremental Truth

**Status:** proposed; no production fix is claimed.
**Purpose:** make indexing **visible, resumable, incremental, and usable** from the CLI and MCP — grounded in measured evidence from the M22 probe, not user anecdotes. Directly addresses the user-reported pain: no progress/ETA/totals, invisible errors (WASM/worker/AST-engine), single-worker confusion, multi-hour runs, no incremental "only changed files" path, and no way for an AI agent to make a just-edited file visible in the DB immediately.

## Authority and evidence policy

This document is the local proposal. The GitHub milestone is created from the reviewed issue list. Every issue must produce a persisted result with exact command/commit, repository path + revision, wall-clock and phase timings, counts, positive and negative checks, and explicit limitations. Missing measurements are never represented as zero, and no auto-pass/tautological assertions are allowed.

## Measured baseline (M22 ground-truth probe)

Run on `i7-8650U / 8 cores / 15 GB`, cold worker-pool index of three fixtures corpus repos, with `onProgress` captured and worker/WASM/AST-engine errors collected. Source: `validation/m22/results/probe-index-ux.json`.

| repo | tracked files | candidates | parsed | symbols | workers | wall | parse | dbFlush | progress events |
|---|---|---|---|---|---|---|---|---|---|
| rake (Ruby, small) | 127 | 57 | **0** | 779* | 0 | 85 ms | 0 | 0 | **0** |
| vue-core (Vue/TS, mid) | 705 | — | — | — | — | — | — | — | **CRASH** |
| element-plus (TS/Vue/SCSS, large) | 2704 | 2580 | 2331 | 27781 | 7 | 151.8 s | 141.1 s | 169.1 s | 243 |

\* `rake` returned 779 symbols with `parsed=0` — consistent with a fully-re-indexed (no changed files) run reusing prior DB state; the run gives users **no "N unchanged / N newly parsed / N skipped" breakdown**, which is exactly the stats-visibility gap.

### Data-backed findings

1. **vue-core crashes the whole index.** `ERROR: table brain_index_status has no column named status` aborts the run outright. A single schema/column mismatch takes down an entire project index — the worst possible failure mode (silent, no partial progress preserved, no guidance).
2. **CSS/SCSS silently produce zero symbols.** element-plus `theme-chalk` SCSS files emit `ENGINE_EMPTY: Syntax ERROR detected. The Brain Engine is bypassing this broken node.` → files are "parsed" yet yield nothing. These lossy entries are dumped only to the undocumented `/tmp/bb-parse-errors.log`; the user sees neither the count nor the files. **~250 of 2580 candidates (parsed 2331) are exactly this class of silent loss.**
3. **DB flush is co-dominant with parse, not secondary.** Cumulative `dbFlush` (169.1 s) ≥ `parse` (141.1 s). This refines M21.X3's "parse ~93%" claim: on real repos the durable write path is a first-class bottleneck and must be surfaced and measured per phase.
4. **Progress IS emitted internally — it is purely not surfaced.** element-plus produced 243 `onProgress` events at ~579 ms cadence. The machinery works; the CLI's `cmdIndex` passes `{}` and drops it. This makes observability a **wiring fix, not a feature build** — low risk, high value.
5. **Real parallel worker usage confirmed.** element-plus used the pool with **7 workers** and no timeouts/retries. The "only one worker" user report is therefore environment/repo-size-specific, not a universal bug — it needs **telemetry + docs**, not a concurrency rewrite. The fix for that report is `bb index status` showing live worker count.

## Verified CLI/MCP surface issues (from code audit)

- `bb index` has **no cwd default** — running it inside a project dir errors; every other command defaults to `process.cwd()`.
- **No `bb index status`** subcommand exists; no way to query in-flight/last-run stats.
- **`--post` does not exist** (users report it; it is not implemented).
- No `--verbose`/`--quiet` log control; all logs go raw to stderr; workers hard-set `BB_LOG_LEVEL=error`.
- Parse errors silently appended to an undocumented `/tmp/bb-parse-errors.log`.
- `bb health --refresh` runs a **full index with full post-processing** (`indexProjectParallel(pid, path, {})`).
- **No incremental path from CLI**: full parse + full post-processing every `bb index`; `isIncremental`/changed-files path exists only internally.
- **MCP has no index/reindex tool** — an agent that just wrote a file cannot refresh the index; there is no `bb_index` tool.
- No way to see **index stats anytime** (files/symbols/relationships), not just the end-of-run line.

## Issue families (verifier-sized, data-grounded)

### G — Governance, ledger, gate
- **G1:** milestone ledger, evidence schema, authority doc, fail-closed closure gate (mirrors M21.C1/X3 with dependency-aware staleness so the gate converges without manual ledger surgery).

### V — Index visibility & stats (high-value)
- **V1:** surface live progress via CLI — files done/total, files/s, ETA, current file, current phase. Proven feasible: 243 events already emitted internally.
- **V2:** `bb index status` subcommand (and MCP query) for in-flight/last-run: totals, per-phase (parse/enrich/pattern/taint/gravity/health), elapsed, ETA, worker count, retries/poison/fallbacks. Grounded in F2 (fresh stats impossible today).
- **V3:** per-phase cost visibility, incl. the co-dominant **dbFlush** line (F3) and per-post-processing-phase timings.
- **V4:** index stats anytime (`bb stats` or status) — files/symbols/relationships/embeddings queryable outside the end-of-run line.
- **V5:** run summary honesty — "N unchanged / N newly parsed / N skipped / N SYMBOL-LOSS (parse-empty)" instead of a bare count (rake's parsed=0 + 779 symbols; F2).

### W — Error visibility & troubleshooting (problems users see)
- **W1:** one logging story — `--verbose`/`--quiet`, level control, a discoverable log file/dir, and visible worker + AST-engine + WASM-load diagnostics instead of raw stderr + hardcoded `error` level.
- **W2:** `bb index` must **fail loudly and list** excluded/schema-failed/symbol-loss files instead of crashing silently (vue-core `brain_index_status` schema crash — hard-fail with guidance, and survive per-file).
- **W3:** `docs/TROUBLESHOOTING.md` — WASM-load errors, worker/AST-engine err, single-worker, 5-hour enrich, DB-lock, `/tmp/bb-parse-errors.log`, resume. Each symptom → cause → command.

### C — CLI correctness & ergonomics
- **C1:** `bb index` defaults to `process.cwd()` when no `<dir>` given (like every other command); `cd proj && bb index` works.
- **C2:** `bb index --help` + per-command examples; remove the phantom `--post` confusion (implement or document a real post-processing control).

### D — Incremental & change-driven reindex
- **D1:** `bb index --incremental` / `--changed` — reuse the existing mtime/size `existingStats` + `toIndex` changed-files path to reindex only changed files and run only needed post-processing. Grounded: incremental machinery exists internally; CLI never exposes it.
- **D2:** fix `bb health --refresh` and all "refresh" paths to not run a **full** index+post-processing; an unchanged repo refresh must be a near-no-op.
- **D3:** make the **single-file reindex** reachable and correct, so editing one file refreshes just that file's graph.

### E — Agent-driven freshness (`bb_index` MCP tool)
- **E1:** MCP `bb_index`/reindex tool so an agent that just wrote a function can immediately make it visible — then `bb_search`/`bb_ask` finds it. Direct fix for "agent wrote a function, 2 s later it's 'not in DB'".

### R — Resume from interruption (closes M21.R3 honestly)
- **R1:** implement index **checkpoint/resume**: persist progress; on SIGINT/crash/power-loss, `bb index --resume` continues from checkpoint instead of restarting, with no corrupt partial data. This is the real feature M21.R3 (deferred known-gap) said was missing.

## Acceptance criteria shape (every issue)

Each issue states: (1) the exact current broken behavior with evidence, (2) the required CLI/MCP surface, (3) a verifier script that **can fail**, with ≥2 negative/regression checks, (4) real-corpus evidence (rake/vue-core/element-plus and, where valuable, `$HOME` repos), and (5) the documented limitation if stubbornly unverifiable. No issue closes without its persisted evidence and gate passage.

## Required resources

- `$HOME/fixtures/repositories/{rake,vue-core,element-plus}` (probe baseline).
- Optionally `$HOME` projects (TypeScript, VSCode, openclaw, paperclip) for larger-scale resume/status tests. Active repos must not be reset/cleaned/rewritten.

## Closure requirements

M22 cannot close until: live progress is visible from the CLI; `bb index status` exists and reports per-phase stats + worker count; stats are queryable anytime; a discoverable logging/error path exists with a troubleshooting doc; `bb index` works from inside a project dir; an incremental `--changed` path exists; `bb health --refresh` is not a full index; the `bb_index` MCP tool works; resume-from-interruption works and M21.R3 is converted known-gap → verified; the final gate passes from a clean source state with no unrelated files staged. Every issue leaves persisted, honest evidence.