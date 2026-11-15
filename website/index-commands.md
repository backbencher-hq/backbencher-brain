# Backbencher Brain — Index Command Reference

> Source of truth: `bb index --help`, the CLI semantics matrix in `src/cli/index.ts`, and the M40 lifecycle work. Every flag, default, and behavior below is verified against the shipped code — this document must never promise an option that does not exist.

---

## The one command that matters most

```
bb index
```

Indexes the project in your **current directory** (or pass a path: `bb index ../my-project`).

- **First run** parses every discovered file (respecting `.gitignore`, `.bbignore`, and built-in skips like `node_modules`, `dist`, `build`) and then runs the derived-data phases: relationship resolution, enrichment, gravity, taints, health. Progress is printed live; interrupted runs resume, they do not restart.
- **Re-runs are incremental**: files whose size + modification time are unchanged are skipped entirely (reported as `unchanged`), so a re-run over an already-indexed project takes seconds, not hours.

## Every flag, verified

| Flag | What it does |
|---|---|
| *(no flags)* | **Full index + all post-processing.** The default and the right choice for a first index. |
| `--changed` | **Reindex only files changed since the last index**, then run the bounded derived-data pass for exactly the touched files (relationships, enrichment, gravity, taints, health, deleted-file purge). This is the daily driver after edits. |
| `--file <path>` | **Reindex a single file** — its symbols plus a scoped derived pass for that file. Ideal right after an AI agent creates or edits a function. |
| `--resume` | **Continue an interrupted run** from its checkpoint (power cut, Ctrl+C). Incremental: only missing/changed files are processed. |
| `--post` | **No re-parsing.** Re-runs the derived phases only (relationships, enrichment, gravity, taints, health). The remediation for stale derived data after `--changed`/`--resume`/agent edits. Prints per-phase timings; a failed phase marks the index `partial` — never silently. |
| `--skip-post-processing` | **Parse + store only**, deferring derived data. Fastest way to get symbols searchable; finish later with `bb index --post`. |
| `--import <db>` | **Adopt an existing `brain.db`** — re-homes a moved project's index so you don't start from zero. Follows with an incremental top-up. |
| `--force` | **Wipe and rebuild everything in place.** Use when the index is suspected corrupt or you changed analyzer settings. Rarely needed. |
| `--no-setup` | Skip the first-run embedding-provider setup prompt. |

### Combination rules (enforced, not folk wisdom)

The CLI defines exactly **eight legal combinations** — one flag carries the intent, and conflicting combinations are rejected *before* any work starts, with a message naming the conflict and the remediation:

| Combination | Behavior |
|---|---|
| *(none)* | full index + all post-processing |
| `--changed` | incremental parse + bounded post-pass |
| `--resume` | incremental from checkpoint + bounded post-pass |
| `--post` | no parse; re-run derived phases only |
| `--skip-post-processing` | parse+store only; derived data deferred |
| `--file <path>` | single-file reindex + scoped post-pass |
| `--import <db>` | adopt DB, then incremental top-up |
| `--force` | wipe + full index + full post-processing |

Everything else (e.g., `--force --changed`) exits with:

```
✗ conflicting bb index options: force changed
  This combination has no defined behavior. …
  Remediations: --force alone rebuilds everything; --post alone re-runs derived-data phases;
  --changed/--resume alone run the bounded pass.
```

## Typical workflows

### Daily loop after edits (the one to remember)

```
bb index --changed
```

Changed files are re-parsed; **symbols, relationships, enrichment, gravity, taints, and health are all re-derived for what those files touch**; new/changed symbols are queued for embeddings automatically in the background. Unchanged files keep everything they had.

### After an agent creates a function mid-session

Read tools auto-refresh stale files within a budget before answering (`auto-refreshed 1 file in Xms`), so nothing is usually required. To force it explicitly:

```
bb index --file src/services/auth.ts
```

### After an interrupted index

```
bb index --resume
```

### Derived data feels stale (patterns/taints lag behind edits)

```
bb index --post
```

### Project moved to a new path or a new laptop

```
bb index --import /old/location/brain.db
```

The codebase fingerprint is matched, the index is re-homed to the new path, and a top-up brings it current.

### Starting over (only if something is genuinely wrong)

```
bb index --force
```

## Checking on your index

| Command | What it tells you |
|---|---|
| `bb stats` | Committed counts: files, symbols, relationships, imports. |
| `bb health` | Full report: counts, embedding model + coverage, schema, freshness. Flags: `--complete` (check every file instead of a 200-file sample), `--integrity` (deep 12-point check), `--refresh`/`--force` (reindex before reporting), `verbose=true` on the MCP tool for stale file names. |
| `bb projects` | Every indexed project with sizes: `--sort name|size|time`, `--remove <id>` to reclaim space (`--force` to remove an actively-indexed project). |
| `bb doctor` | Read-only diagnosis of setup/index problems; `--fix` applies permission repairs explicitly. |

## Where your data lives

```
~/.bb/projects/<project-id>/brain.db    # the index (symbols, relationships, embeddings)
~/.bb/wasm/                             # parser cache
```

- `<project-id>` is a stable hash of the project's absolute path; `BB_DATA_DIR` relocates the whole data directory (sandboxes, CI).
- Indexes survive bb updates and reinstalls — the database migrates itself forward on every open; nothing is wiped by upgrading.
- Removing an index (or its disk space) is explicit: `bb projects --remove <id>`.

## Honest operating notes

- **Embeddings are asynchronous.** Structural data (symbols/relationships) is consistent the moment a pass finishes; vectors may trail by seconds. Semantic search quality is reflected honestly in `bb health` coverage.
- **Cancelled runs stay cancelled.** Ctrl+C stops work and saves progress; queued-but-unparsed files are *not* auto-processed afterward — `bb index --resume` picks them up deliberately.
- **Partial means partial.** If a derived phase fails, the index status is marked `partial` and the failed phase names itself in `bb index --post` output.
- **Indexing is workspace-aware:** `.gitignore` is always respected; a local `.bbignore` (same syntax) overrides it when you want git to track something but the indexer to skip it.
