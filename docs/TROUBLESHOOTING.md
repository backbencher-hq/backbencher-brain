# bb Troubleshooting Guide

Diagnose and fix the most common `bb` problems. For every symptom: **likely cause** → **how to confirm** → **the fix/command**. This is the manual users asked for; it is kept in sync with behavior in `src/` (indexer, worker, CLI) and not copy-pasted from assumptions.

## Indexing is slow / takes hours

**Likely cause:** a full `bb index` runs parse **and** all heavy post-processing (relationship resolution, enrichment, gravity, taint, health) over the whole project every time. The measured profile on a real repo (`validation/m22/results/probe-index-ux.json`) shows **parse and DB-flush are co-dominant**; enrichment is secondary. Watch a small-mode: `bb index --incremental`/`--changed` processes only changed files and skips nothing; an unchanged project is a near-no-op.

**Confirm:** `bb status --dir <project>` shows the last-run per-phase breakdown (`parse`, `dbFlush`, `post-processing …`). `bb stats --dir <project>` shows the committed counts.

**Fix:**
- Force only changed files: `bb index --changed` (incremental; reindexes files whose mtime/size changed since last run).
- A refresh that should be cheap must not rebuild the world: `bb health --refresh` is intended to be a near-no-op on an unchanged repo.
- Watch progress live: progress line prints files done / total, files/s, current file, and ETA. `bb status` from another shell shows the in-flight run.

## Only one worker is running / not using all cores

**Likely cause:** worker pool parallelism is `min(concurrency, ceil(files/10))` — a repo with few files legitimately uses **one** worker even on a many-core machine. It is usually correct behavior, not a bug.

**Confirm:** run the index, then `bb status --dir <project>` — it reports `mode` and `workers`. `bb index --verbose` shows the worker-pool lines.

**Fix:** nothing to fix for small repos; for large repos confirm `cpus` and batch size. If you believe a large run is stuck at one worker, run `bb index --verbose` and note the worker count and any `[WORKER-ERR]` lines.

## "worker err" / "ast engine error" / "html wasm error" during indexing

**Likely cause:** a grammar WASM asset failed to load, or a worker hit a per-file timeout. Workers suppress everything below ERROR by default; these diagnostics are only visible at `--verbose`.

**Confirm:** `bb index --verbose` captures the per-file worker/WASM/engine lines. Detailed parse failures are appended to a **discoverable** log: `~/.bb/logs/parse-errors.log` (or `$BB_DATA_DIR/logs/parse-errors.log`). This replaces the old, undocumented `/tmp/bb-parse-errors.log`.

**Fix:** ensure grammar WASM assets are present (see WASM section). Run with `--verbose` to identify the exact file/language, then either supply the missing grammar or exclude the file.

## SQLite "database is locked" / lock contention

**Likely cause:** multiple writers on the same `brain.db` (e.g. two `bb index` runs, or an MCP server holding a write handle while a CLI index runs). The database runs in WAL mode; busy-timeout behavior differs by runtime (see M21.D2 known-gap: Node enables WAL, Bun configures neither by default).

**Confirm:** The exact message plus which command was writing. `bb status` shows whether a run is in flight.

**Fix:** only run one indexing write at a time per project; stop a conflicting in-flight run or wait for it to finish. Don't delete the `brain.db` file (deleting + recreating orphans a running MCP server's open handle — use `bb index --force`, which wipes in place).

## Symbols seem missing after an edit (agent wrote a function, "not in DB")

**Likely cause:** nothing refreshed the index after the file changed. The index is not auto-updated on every file write; a full reindex (or an explicit reindex) is required for the new symbol to be queryable.

**Confirm:** `bb search <name> --dir <project>` returns nothing (or a "stale" hint).

**Fix:** reindex only the changed file, or the changed set:
- `bb index --file <path>` (single file), or via the MCP `bb_index` tool after an agent edit.
- `bb index --changed` (all changed since last index).
This is the direct fix for "agent created a function, seconds later it's not queryable."

## "no index for …" when running search/health/tool

**Likely cause:** the project has never been indexed, or the DB is elsewhere.

**Confirm:** `bb stats --dir <project>` prints `no index for …`.

**Fix:** `bb index` (from inside the project, or `bb index <dir>`). The index command defaults to the current directory, so `cd <project> && bb index` works.

## Can't find the parse errors / symbol losses

**Likely cause:** previously they went to an undocumented `/tmp/bb-parse-errors.log`.

**Fix:** all diagnostics now write to `~/.bb/logs/` (or `$BB_DATA_DIR/logs/`): `parse-errors.log`, `worker-debug.log`. `bb index` final summary also prints an honest breakdown: `newly parsed | unchanged | skipped | symbol-loss | errors | timeouts`.

## WASM / grammar assets missing

**Likely cause:** the tree-sitter grammar `.wasm` for the file's language isn't discoverable. Assets are resolved from the repo `wasm/`, the data-dir `~/.bb/wasm`, or the install directory.

**Confirm:** `bb index --verbose` — a WASM-load failure surfaces there (it is suppressed at default level).

**Fix:** ensure the grammar is present in one of the `bbWasmCandidates` locations, or reinstall the package that ships the grammars.

## Resume after an interrupt / power loss

**Status:** index **checkpoint/resume** is implemented under M22.R1 — `bb index --resume` continues from a checkpoint instead of restarting. If a run was interrupted before resume existed, you must re-run `bb index` (a full run that skips unchanged files is fast for file reads; post-processing still runs unless incremental).

**Confirm:** `bb status --dir <project>` shows the last persisted run and whether files were left partial.

**Fix:** after an interrupt, `bb index --resume` (or plain `bb index`, which reindexes only changed files).

## How do I see how much time / how many files remain?

**Fix:** the live progress line during `bb index` shows `files done / total (%), files/s, current file, ETA`. `bb status --dir <project>` (from another shell) shows the in-flight totals.

## Command reference (quick)

| Command | Purpose |
|---|---|
| `bb index [<dir>]` | index (default: cwd). `--force` wipes in place; `--changed` only changed files; `--file <path>` single file |
| `bb status [<dir>]` | in-flight / last-run per-phase breakdown (parse, dbFlush, post-processing), worker count |
| `bb stats [<dir>]` | committed files / symbols / relationships / embeddings anytime |
| `bb search <q> [--dir]` | find a symbol |
| `bb health [--dir]` | index health + freshness |
| `bb version` | print version (also `--version`) |
| `bb --verbose` / `bb --quiet` | raise / lower log verbosity (worker + WASM diagnostics at `--verbose`) |