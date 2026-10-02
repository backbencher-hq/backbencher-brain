# Interrupting and resuming an index

> Source of truth: the cooperative-cancellation path in `src/cli/index.ts:257-273`,
> the live status file in `src/ast/index-status.ts`, the mtime/size skip in
> `src/ast/parallel-indexer.ts:848-856`, and the cancel terminal state at
> `src/ast/parallel-indexer.ts:4944-4949` and `:5052-5083`.

An interrupted `bb index` does not have to start over. This document covers how
to interrupt one safely, what survives, how to resume, how to check that the
resume actually worked, and what to do when it cannot.

## How to interrupt safely

Press **Ctrl-C**.

That is not a raw kill. The CLI installs a `SIGINT` handler and aborts
cooperatively (`src/cli/index.ts:261-273`):

```
SIGINT received — cancelling index (draining in-flight files; resume with: bb index --resume)...
```

- New batches stop being dispatched immediately.
- Batches already in flight are allowed to finish.
- The database therefore keeps only **fully stored** files. That is the durable
  checkpoint (`src/ast/parallel-indexer.ts:1355-1357`). A file that was
  half-written is not half-indexed — it is simply not in the index yet.
- Heavy post-processing is skipped entirely on a cancelled run
  (`src/ast/parallel-indexer.ts:4944-4949`). A user who pressed Ctrl-C wants a
  fast stop, and every derived phase rewrites rows the checkpoint assumes are
  untouched.
- When the process exits, you get:

```
⏸ index cancelled — progress saved. Resume with: bb index --resume
```

`SIGTERM` is handled identically (`src/cli/index.ts:271`), so `kill <pid>` is
also safe. What is **not** safe is `kill -9` or a power cut: the process dies
with no chance to write the terminal status. The stored data is still
consistent — batches are committed, not held in memory — but the run never
labels itself, which changes what `--resume` has to go on. See
[When resume cannot find a checkpoint](#when-resume-cannot-find-a-checkpoint).

**Do not `kill -9` an index run.** If you think it is hung, check
[`troubleshooting.md`](troubleshooting.md) first; a serial in-process run on a
large project legitimately looks idle for minutes.

## What the checkpoint is

Two things, and it matters which one you are looking at.

**1. The database is the real checkpoint.** Resume is not a snapshot and there
is no undo log. A resume simply re-runs the incremental filter: for every
discovered file, if the stored record's `mtime` and `size` both match the file
on disk, the file is skipped (`src/ast/parallel-indexer.ts:848-856`).

This is why resume works, and also why it is honest about its limits:

- Files already stored are skipped — **no re-parse, no time cost**.
- Files queued but never parsed are picked up.
- Files whose mtime *and* size changed are re-parsed, which is correct.
- A file edited to the same byte size with a preserved mtime is skipped. This is
  the one real blind spot in the scheme, and it is inherent to mtime+size
  comparison, not to resume specifically.

**2. The status file is the progress marker.** A small JSON file per project at
`<data-dir>/status/<projectId>.json` (`src/ast/index-status.ts:48-50`; the data
dir is `~/.bb` or `$BB_DATA_DIR`, `src/util/bb-data-dir.ts:11`). It contains
the fields in `LiveIndexStatus` (`src/ast/index-status.ts:16-27`):

```json
{
  "projectId": "1d3d57103be91b8f9716d70199fe28a3f39245d9",
  "phase": "cancelled",
  "processedFiles": 70,
  "totalFiles": 2348,
  "filesPerSecond": 3.9,
  "currentFile": "src/ast/engine.ts",
  "startedAt": 1759428000000,
  "updatedAt": 1759428019000
}
```

`phase` is the field that matters: `indexing`, `post-processing`, `complete`,
`failed`, or `cancelled`.

**When it is written:** on every progress tick (throttled to ~100 ms,
`src/ast/parallel-indexer.ts:136`, `:4999-5008`) and once at the end of the run
with the terminal phase (`src/ast/parallel-indexer.ts:5052-5083`). A cancelled
run keeps `phase: "cancelled"` and is **never** relabelled `complete`
(`src/ast/parallel-indexer.ts:5065-5066`) — that phase is what lets a later
resume tell "the user stopped this on purpose" apart from "the process died".

You can read it without the CLI:

```
cat ~/.bb/status/<projectId>.json
```

The project id is the first 8 characters `bb index` prints in
`indexing <dir> (project 1d3d5710…)`. `bb status` shows the same data, parsed.

## How to resume

```
bb index --resume
```

The command reads the checkpoint and tells you which branch it took
(`src/cli/index.ts:225-238`):

```
resuming interrupted index (checkpoint: 70/2348 files done)
```

or, when there is nothing to resume:

```
no in-progress checkpoint; running incremental (only missing/changed files)
```

**That second line is not an error.** Resume unconditionally runs incrementally
(`src/cli/index.ts:237`), so with no checkpoint it degrades to exactly the same
work as `bb index --changed` and exits normally. You never have to guess whether
`--resume` will work — it always runs, and it always tells you which mode it
used.

A real cancelled-then-resumed pair, from
`validation/m21/results/R3-cancel-resume.json`:

| Line | Value |
| --- | --- |
| Original run, live status | `{"phase":"cancelled","processedFiles":70,"totalFiles":2348}` |
| Original run, breakdown | `70 newly parsed \| 0 unchanged \| 0 skipped \| 0 errors \| 0 timeouts \| 2278 cancelled` |
| Resume message | `resuming interrupted index (checkpoint: 70/2348 files done)` |
| Resume progress | `[progress] 2340/2348 files (99%) 118.2/s ETA 0s` |

## Verify the resume was correct

A resume can finish cleanly and still leave derived data stale. This is not a
hypothetical — it is a measured case, and the counts on screen look healthy
while the edges are unattached. Check three lines, in this order.

### 1. The `breakdown:` line

```
  breakdown: 2278 newly parsed | 0 unchanged | 0 skipped | 0 symbol-loss | 0 errors | 0 timeouts
```

`newly parsed` should account for the files the checkpoint said were outstanding.
`cancelled` should be gone from the line — a cancelled bucket on a resume means
the resume itself was interrupted.

### 2. The `derived:` line

```
  derived: bounded (derived data re-processed for touched files (bounded pass))
```

`bounded` is what you want. The other values mean something specific:

| Value | Meaning |
| --- | --- |
| `full` | all derived data recomputed |
| `bounded` | recomputed for what this run touched |
| `skipped-unchanged` | no files parsed, so no derived pass ran |
| `deferred` | derived data is stale — run `bb index --post` |
| `partial` | a derived phase failed; index marked partial, exit 1 |

`skipped-unchanged` on a resume is the trap. A resume that finishes the parse
with nothing left to parse runs no derived pass — and the previous run was
cancelled *during* relationship resolution, so it left edges unresolved. The
relationship **count** recovers to the clean value while a set of edges is
still unattached, and every count on screen reads healthy. This exact sequence is
described in the code at `src/cli/index.ts:330-346`.

### 3. The `consistency:` line

```
  consistency: 0 unresolved relationships — every stored relationship is attached to a symbol
```

This is a real measurement taken from the store after the run, not an inference
from the pass label (`src/cli/index.ts:367-381`). If it is non-zero, you have
the trap above:

```
  consistency: 16 relationship(s) are not attached to a symbol — they are counted above but read as edges by no traversal. Run: bb index --post
```

Fix it with:

```
bb index --post
```

It parses nothing, so it is cheap, and it exits 1 if any phase fails.

A fourth check, if you want the whole picture: `bb stats` for committed counts,
and `bb status` for the previous run's per-phase timings and worker count.

## When resume cannot find a checkpoint

`--resume` recognizes a checkpoint only when **both** conditions hold
(`src/cli/index.ts:228-231`):

1. the status file's `phase` is `indexing` **or** `cancelled`, and
2. `updatedAt` is less than **one hour** old.

So a checkpoint is *not* found when:

| Situation | Why | What to do |
| --- | --- | --- |
| The run finished successfully | `phase` is `complete` | Nothing. Your index is whole. |
| The run errored out | `phase` is `failed` | Read the error. `bb status` shows it. |
| `kill -9`, power loss, OOM | No terminal phase was ever written, and the last tick may already be >1h old | `bb index --resume` still runs, as `--changed` — the database skip means stored files are not re-parsed regardless. If files were still queued, they get parsed. |
| More than an hour between the crash and the resume | Freshness window expired | Same as above. The window governs *whether the checkpoint is reported*, not whether resume works. |
| `BB_DATA_DIR` changed, or you are a different user | The status file is somewhere else | Same as above. The database, not the status file, is what makes resume cheap. |
| The index lock is held | Another run is active | Wait for it. See the lock message in [`README.md`](README.md#one-index-run-at-a-time). |

The important thing: **a missing checkpoint degrades resume, it does not break
it.** The worst case is that you pay for a full incremental pass, which on an
unchanged project is close to free (measured: an unchanged 57-file project
re-indexed in 85 ms with zero files parsed —
`validation/mA/results/probe-index-ux.json`, `noop: true`).

## Recovering with `--force`, honestly

`bb index --force` is the rebuild-everything escape hatch. Before reaching for
it, know what it costs.

**It is the most expensive mode `bb index` has.** It wipes the project's data
in place and then re-parses every eligible file and recomputes every derived
phase from zero. On the measured anchors:

| Corpus | Files | Symbols | Full index wall time | Evidence |
| --- | ---: | ---: | ---: | --- |
| rake | 57 | 779 | 1.9s | `validation/m19/results/S1.json:11-14` |
| lodash | 36 | 1,048 | 3.4s | `validation/m19/results/S1.json:68-73` |
| element-plus | 2,580 | 27,751 | 51.6s | `validation/m19/results/S1.json:74-80` |
| paperclip | 676 | 8,054 | 100.9s | `validation/m19/results/S2-paperclip-timings.json:33` |
| grails (Groovy) | 7,114 | 64,719 | 494.6s | `reviews/groovy/master-review-2026-09-29.md:436-441` |

All of these were measured on one Intel i7-8650U / 15.5 GiB Linux host. They are
**that machine's** numbers, not yours and not a promise. See
[`performance.md`](performance.md).

There is also a real functional cost: the wipe is in place, so a concurrent
reader sees an empty database until the rebuild finishes
(`src/cli/index.ts:190-193`). Anyone querying the index during a `--force` gets
partial or empty results.

**Use `--force` when:**

- `bb doctor` reports `model-mismatch` or `model-mixed` — the fix it names is
  `bb index --force`, because vectors from a different model can never be
  compared against your queries (`src/setup/doctor.ts:159-181`).
- The index is genuinely corrupt: counts that contradict the file tree,
  `database is locked` that survives stopping every writer, or a schema you no
  longer trust.

**Do not use `--force` for:**

- A cancelled run. That is `--resume`.
- Stale derived data. That is `--post`, which parses nothing.
- A few changed files. That is `--changed` or `--file`.

## A recovery order that works

```
bb status                                  # what phase is the index actually in?
bb index --resume                          # cheap; degrades to --changed safely
# then read the run's own report:
#   derived:      → must not be deferred
#   consistency:  → must be 0 unresolved
bb index --post                            # cheap; parses nothing; fixes derived data
bb doctor                                  # read-only; flags model mismatch + permissions
bb index --force                           # last resort; full rebuild
```