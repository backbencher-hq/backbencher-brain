# Indexing

> **These pages are gated against the code.** `script/verify-docs-indexing.ts`
> asserts that every env var, flag, default and quoted output line below exists
> in `src/`, and (`--live`) that the behavioural claims hold when `bb index` is
> actually run. Run it after touching anything here:
>
> ```bash
> npx tsx script/verify-docs-indexing.ts            # static claims
> npx tsx script/verify-docs-indexing.ts --live     # + run bb index on a fixture
> ```
>
> A claim that cannot be verified is not in these pages. Source of truth:
> `bb index --help` (`src/cli/index.ts:743-772`), the executable semantics matrix
> at `src/cli/index.ts:89-104`, and `indexProjectParallel`
> (`src/ast/parallel-indexer.ts`). Everything quoted below is quoted from code
> or from a real run, not described from memory.

`bb index` reads a project, parses every file it decides to index, stores the
structural result in a per-project SQLite database, and then derives the
expensive cross-file data from it. This directory explains what each mode
actually does, how to resume an interrupted run, what the timings look like,
what to do when the worker pool does not start, and how embeddings are
configured.

| Document | Use it when |
| --- | --- |
| [`resume.md`](resume.md) | a run was interrupted, or you want to know what survives an interrupt |
| [`performance.md`](performance.md) | the run is taking longer than you expect |
| [`troubleshooting.md`](troubleshooting.md) | "the workers don't start" / "it says it parsed in-process" |
| [`embeddings.md`](embeddings.md) | you want semantic search, or `bb setup` / `bb doctor` confused you |

## The command

```
bb index [dir] [flags]
```

`dir` defaults to the current working directory (`src/cli/index.ts:67`), so
`cd my-project && bb index` and `bb index ../my-project` are equivalent.

## What a full index actually does

`bb index` with no flags is a single run with six phases. The boundaries matter
because almost every confusion below comes from attributing a symptom to the
wrong phase.

1. **Discovery.** Walk the project and decide what is a file worth indexing.
   `.gitignore` is always respected; a project-level `.bbignore` (same syntax)
   is loaded on top of it and wins (`src/ast/parallel-indexer.ts:799-812`,
   `:915-932`). Built-in skip patterns exclude `node_modules`,
   `bower_components`, `dist`, `build`, `out`, `target`, `coverage`,
   `__pycache__`, `.venv`/`venv`, `.next`, `.nuxt`, `.svelte-kit` and friends
   (`src/ast/parallel-indexer.ts:253-300`).
2. **Size tiering.** Files over **5 MB** are skipped entirely. Files over
   **1 MB** get structural extraction instead of a full AST
   (`src/ast/parallel-indexer.ts:850-877`). A file over the limit is counted in
   `skipped`, not in `errors` — that is expected, not a failure.
3. **Worker-pool fork test.** One worker is forked and asked to say `ready`. If
   it cannot, the whole run degrades to serial in-process parsing
   (`src/ast/parallel-indexer.ts:4770-4825`). See
   [`troubleshooting.md`](troubleshooting.md).
4. **Parse + store.** Files are parsed in parallel workers and flushed to the
   database in batches of 20, to avoid blocking the event loop
   (`src/ast/parallel-indexer.ts:1674-1678`).
5. **Derived phases.** `runPostProcessing` runs **eight** recorded phases —
   `relationships`, `enrichment`, `gravity`, `taint`, `health`, `integrity`,
   `vectorBlobs`, `analyze`
   (`src/ast/parallel-indexer.ts:576`, `:5561-5680`). Measured by running
   `bb index --post`:

   ```
   ✓ post-processing complete in 0.1s
     ✓ relationships  2ms
     ✓ enrichment     10ms
     ✓ gravity        3ms
     ✓ taint          2ms
     ✓ health         56ms
     ✓ integrity      10ms
     ✓ vectorBlobs    3ms
     ✓ analyze        3ms
   ```

   The first five are the derived data; `integrity`, `vectorBlobs` and
   `analyze` are checks/maintenance that run with them. This whole phase is the
   expensive half on a large project.
6. **Background embeddings.** Vectors are queued and drained after the parse,
   not during it. Coverage is therefore always a per-run measurement, never a
   fixed product number (`docs/EMBEDDINGS.md` §3).

## The eight legal flag combinations

The CLI holds an explicit whitelist of legal combinations
(`src/cli/index.ts:89-98`). **Any combination not on the list is rejected
before any work starts**, with exit code 1 (`src/cli/index.ts:99-104`). Real
output:

```
✗ conflicting bb index options: --force --changed
  This combination has no defined behavior. See the semantics matrix: bb index --help, docs/m40/PLAN.md
  Remediations: --force alone rebuilds everything; --post alone re-runs derived-data phases; --changed/--resume alone run the bounded pass.
```

Note the flag names carry their `--` prefix; they are built from the flags you
actually passed (`src/cli/index.ts:100-101`).

| Flags | Defined behavior |
| --- | --- |
| *(none)* | full index + all post-processing |
| `--changed` | incremental parse + bounded post-pass |
| `--resume` | incremental from checkpoint + bounded post-pass |
| `--post` | no parse; re-run the derived phases only |
| `--skip-post-processing` | parse+store only; derived data deferred |
| `--file <path>` | single-file reindex + scoped post-pass |
| `--import <db>` | adopt DB, then incremental top-up |
| `--force` | wipe + full index + full post-processing |

`--no-setup` is **not** part of this matrix. It is orthogonal — it only skips the
first-run embedding prompt (`src/cli/index.ts:71`) — so it may be combined
with any of the eight rows above.

## `bb index` — full

```
bb index
```

**Does:** discovers, parses every eligible file, stores symbols/imports, then
runs all eight derived phases.

**Use when:** first index of a project, or after a large structural change.

**Does NOT:** save you the derived pass on a re-run. Discovery *does* skip files
whose `mtime` and `size` both match what is stored — that filter is not gated on
any flag (`src/ast/parallel-indexer.ts:887-894`) — so a re-run of an unchanged
project parses nothing. When a re-run *does* parse something, it then pays for
the **full** derived pass over the whole project, where `--changed` would have
paid for a bounded one. That is the whole difference between the two modes.

Measured, second bare run with nothing changed:

```
✓ nothing to index — already up to date (7 unchanged, 0 skipped, 0.3s)
  stats: {"totalFiles":7,"processed":7,"errors":0}
  breakdown: 0 newly parsed | 7 unchanged | 0 skipped | 0 symbol-loss (parsed 0 symbols) | 0 errors | 0 timeouts
  parsed nothing — no files needed parsing, so no parse mode was used
  derived: skipped-unchanged (no files parsed, so no derived pass ran)
  consistency: every internal relationship is attached to a symbol (external references are attached to an external identity, which is correct)
```

Note the first line is not the `✓ indexed N files` form. A run that parsed nothing
says so in words rather than printing a zero-file success
(`src/cli/index.ts:298-304`).

Read those lines carefully; they are the run's own report on itself.

- `breakdown:` — `newly parsed | unchanged | skipped | symbol-loss | errors |
  timeouts`, plus `| N cancelled` on an interrupted run
  (`src/cli/index.ts:356`).
- `parsed with the worker pool` / `parsed in-process …` — which parse path ran
  (`src/cli/index.ts:376-384`). `in-process` means the run was **serial** and is
  correspondingly slower, even though every other number on the line looks
  pristine. A fourth value exists: `parsed nothing — no files needed parsing, so
  no parse mode was used`, which is what a run that parsed nothing reports.
- `derived:` — one of `full`, `bounded`, `deferred`, `skipped-unchanged`,
  `partial`, with its own note (`src/cli/index.ts:388-418`). **`deferred` means
  the relationships/enrichment/gravity/taints/health data in your index is
  stale.** Finish it with `bb index --post`.
- `consistency:` — a measurement taken from the store after the run, not an
  inference from the `derived:` label (`src/cli/index.ts:426-449`). At zero it
  prints a sentence; **non-zero means some internal edges are counted in the
  relationship total above and traversed by nothing**, and it names the
  remediation. A third form, `not measured for this run`, means the run predates
  the measurement — that is *not* an all-clear.

## `bb index --changed` — incremental

```
bb index --changed
```

**Does:** sets the run to incremental mode (`src/cli/index.ts:206`). Discovery
compares each file against the stored record and **skips files whose mtime and
size both match** (`src/ast/parallel-indexer.ts:887-894`); the rest are parsed.
Then it runs a **bounded** derived pass scoped to what this run touched, plus a
purge of files that no longer exist on disk. Measured:

```
✓ indexed 8 files, 24 symbols, 22 relationships, 6 embeddings in 4.8s
  breakdown: 1 newly parsed | 7 unchanged | 0 skipped | 0 symbol-loss (parsed 0 symbols) | 0 errors | 0 timeouts
  derived: bounded (derived data re-processed for touched files (bounded pass))
  bounded: 10 symbols touched
```

**Use when:** this is the daily driver after editing code.

**Does NOT:** re-parse unchanged files, and does not do a whole-project derived
pass. Write cost is proportional to what changed, not to the size of the
project.

Expect `derived: bounded (derived data re-processed for touched files (bounded pass))`.

## `bb index --resume` — continue an interrupted run

```
bb index --resume
```

**Does:** reads the run's checkpoint, reports whether it found one, and runs
incrementally (`src/cli/index.ts:216-229`). Because resume is incremental, the
mtime/size skip means strictly fewer files are processed than a fresh run.
Measured with no checkpoint present:

```
no in-progress checkpoint; running incremental (only missing/changed files)
```

and then, after changing one file:

```
✓ indexed 8 files, 24 symbols, 22 relationships, 6 embeddings in 2.9s
  breakdown: 2 newly parsed | 6 unchanged | 0 skipped | 0 symbol-loss (parsed 0 symbols) | 0 errors | 0 timeouts
  derived: bounded (derived data re-processed for touched files (bounded pass))
  bounded: 11 symbols touched
```

When there is nothing left to parse, it reports `derived: skipped-unchanged`
instead — see the trap in
[`resume.md`](resume.md#verify-the-resume-was-correct).

**Use when:** a run was cancelled with Ctrl+C, or the machine died mid-index.

**Does NOT:** rewind anything, and does not re-run derived phases for work a
previous run already did — see the measured caveat in
[`resume.md`](resume.md#verify-the-resume-was-correct) before you trust it.

Full detail in [`resume.md`](resume.md).

## `bb index --file <path>` — one file

```
bb index --file src/services/auth.ts
```

**Does:** restricts the run to that one path **and** sets incremental mode so
the derived pass is scoped to it (`src/cli/index.ts:198-205`).

**Use when:** an agent just created or edited a function and you want it
queryable immediately.

**Does NOT:** reindex neighbours. If the edit changed an import or a call site
elsewhere, that other file is stale too — use `--changed` instead. Note the
mtime/size check applies to `--file` as well, so a file whose mtime and size did
not change is not parsed and the run reports `derived: skipped-unchanged`.

## `bb index --post` — derived phases only

```
bb index --post
```

**Does:** parses nothing. Re-runs all eight derived phases over the existing
index (`src/cli/index.ts:109-127`), printing a per-phase timing and outcome for
each. Real output, in the exact column alignment the CLI prints
(`p.name.padEnd(14)`):

```
✓ post-processing complete in 0.1s
  ✓ relationships  2ms
  ✓ enrichment     10ms
  ✓ gravity        3ms
  ✓ taint          2ms
  ✓ health         56ms
  ✓ integrity      10ms
  ✓ vectorBlobs    3ms
  ✓ analyze        3ms
```

Exits 1 if any phase failed, and the index is marked `partial`
(`src/cli/index.ts:117-121`). If the project has no index at all it refuses with
`no index for project … — post-processing derives from indexed symbols; run bb
index first` (`src/ast/parallel-indexer.ts:5539-5541`).

**Use when:** `derived: deferred`, or `consistency:` reported unattached
internal relationships. This is the documented remediation for both.

**Does NOT:** parse, so it cannot fix a file whose symbols were never extracted.

## `bb index --force` — wipe and rebuild

```
bb index --force
```

**Does:** takes the project's index lock first, then wipes the project's data
**in place — the `brain.db` file itself is kept** so a running MCP server's open
handle is not orphaned onto a stale view (`src/cli/index.ts:168-193`), then
does a full parse and all derived phases.

**Use when:** the index is genuinely corrupt, or you changed analyzer settings.

**Does NOT:** preserve anything. This is the most expensive mode there is — every
eligible file is re-parsed from scratch and every derived phase is recomputed.
See the measured costs in [`performance.md`](performance.md).

The functional cost of the in-place wipe is real: a concurrent reader sees an
empty database until the rebuild finishes (`src/cli/index.ts:181-184`).

## `bb index --skip-post-processing` — parse and stop

```
bb index --skip-post-processing
```

**Does:** parses and stores, then stops. The run reports
`derived: deferred (derived data deferred — run: bb index --post)`
(`src/cli/index.ts:410`). Verified by running it.

**Use when:** you want symbols searchable immediately and do not need
relationships, enrichment, gravity, taints or health yet.

**Does NOT:** update any derived data. Until you run `bb index --post`, the
cross-file layer of the index is stale, and anything that reads it will be
reading stale data. This is the fastest route to "my new symbol is in the
index", not a way to skip work permanently.

## Other flags

| Flag | Does |
| --- | --- |
| `--import <db>` | Adopt an existing `brain.db` onto this checkout's project id, then top up incrementally. For a project you moved or copied to another machine (`src/cli/index.ts:130-140`, `:144-164`). |
| `--no-setup` | Skip the first-run embedding prompt. Orthogonal to the semantics matrix. |
| `--verbose` | Raise log level to `debug` (`src/cli/index.ts:713`, `:720-723`). This is how you see worker-pool and WASM diagnostics — workers default to `error` and swallow everything below it. **There is no short form.** |
| `--quiet` | Raise log level to `warn` (`src/cli/index.ts:724-727`). **There is no short form.** |

There is deliberately no `-v` for verbose: `-v` is bound to `--version`
(`src/cli/index.ts:710`), so `bb index -v` prints a version number. `bb index -q`
is an error — `unknown option '-q'`.

`--import` deserves a caveat: adoption matches on the **codebase fingerprint**.
If no adopted index matches, `bb index` just builds a new one. Adoption also
implies incremental mode, because a move preserves mtimes and a full re-parse
would duplicate symbol rows (`src/cli/index.ts:210`).

## Watching a run

The progress line goes to **stderr** so stdout stays clean for anything
consuming it (`src/cli/index.ts:236-254`). Shape, not a captured run — the
renderer adapts to TTY vs pipe (`src/cli/index-progress.ts`):

```
312/2580 files (12%) 18.4/s ETA 2m 9s — src/components/button.ts
```

From another shell, `bb status` reports the in-flight run, and afterwards the
last run's per-phase breakdown — total, parse, dbFlush, discovery, worker
startup, worker count, and any post-processing timings the run recorded
(`src/cli/index.ts:630-662`):

```
✓ last index of /proj: 8 files, 24 symbols, 22 relationships
  total n/a | parse 1218ms | dbFlush 27ms | discovery 77ms | startup 990ms
  mode worker-pool | workers 1 | noop no
  db: <data-dir>/projects/<projectId>/brain.db
```

Real output from a fixture. Two things to know when reading it: `workers 1` on a
small project is correct (see
[`troubleshooting.md`](troubleshooting.md#cause-6--only-one-worker-and-that-is-correct)),
and `n/a` appears for any timing the recorded run did not persist.

`bb stats` gives the committed counts at any time, including during a run, and
prints the database path.

## One index run at a time

Indexing takes a single-flight per-project lock (`src/ast/index-lock.ts`). A
second concurrent run refuses rather than interleaving writes, and names the
holder:

```
✗ another index run is already active for this project (pid 4821, started 2026-10-02T17:41:03.000Z, kind=index); wait for it to finish, or if it crashed the stale lock at .index.lock is reclaimed automatically on the next run
```

A lock left behind by a crashed process is reclaimed automatically; you do not
need to delete it by hand.

## Related

- `website/index-commands.md` — the user-facing command reference, same flags
- [`docs/EMBEDDINGS.md`](../EMBEDDINGS.md) — what the vector layer is and is not
- [`docs/TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) — general `bb` troubleshooting