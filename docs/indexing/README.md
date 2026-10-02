# Indexing

> Source of truth: `bb index --help` (`src/cli/index.ts:672-698`), the executable
> semantics matrix at `src/cli/index.ts:87-114`, and `indexProjectParallel`
> (`src/ast/parallel-indexer.ts`). Every flag, label and exit code below is quoted
> from code, not described from memory.

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

`dir` defaults to the current working directory (`src/cli/index.ts:76-78`), so
`cd my-project && bb index` and `bb index ../my-project` are equivalent.

## What a full index actually does

`bb index` with no flags is a single run with six phases. The boundaries matter
because almost every confusion below comes from attributing a symptom to the
wrong phase.

1. **Discovery.** Walk the project and decide what is a file worth indexing.
   `.gitignore` is always respected; a project-level `.bbignore` (same syntax)
   is loaded on top of it and wins (`src/ast/parallel-indexer.ts:761-772`,
   `:889-894`, `:969-971`). Built-in skip patterns exclude `node_modules`,
   `bower_components`, `dist`, `build`, `out`, `target`, `coverage`,
   `__pycache__`, `.venv`/`venv`, `.next`, `.nuxt`, `.svelte-kit` and friends
   (`src/ast/parallel-indexer.ts:249-274`).
2. **Size tiering.** Files over **5 MB** are skipped entirely. Files over
   **1 MB** get structural extraction instead of a full AST
   (`src/ast/parallel-indexer.ts:810-838`). A file over the limit is counted in
   `skipped`, not in `errors` — that is expected, not a failure.
3. **Worker-pool fork test.** One worker is forked and asked to say `ready`. If
   it cannot, the whole run degrades to serial in-process parsing
   (`src/ast/parallel-indexer.ts:4535-4577`). See
   [`troubleshooting.md`](troubleshooting.md).
4. **Parse + store.** Files are parsed in parallel workers and flushed to the
   database in batches of 20 (`src/ast/parallel-indexer.ts:1591`).
5. **Derived phases.** `runPostProcessing` runs the five derived phases —
   `relationships`, `enrichment`, `gravity`, `taint`, `health` — plus an
   integrity check (`src/ast/parallel-indexer.ts:5260-5360`). This is the
   expensive half on a large project.
6. **Background embeddings.** Vectors are queued and drained after the parse,
   not during it. Coverage is therefore always a per-run measurement, never a
   fixed product number (`docs/EMBEDDINGS.md` §3).

## The eight legal flag combinations

The CLI holds an explicit whitelist of legal combinations
(`src/cli/index.ts:98-107`). **Any combination not on the list is rejected
before any work starts**, with exit code 1 (`src/cli/index.ts:108-113`):

| Flags | Defined behavior |
| --- | --- |
| *(none)* | full index + all post-processing |
| `--changed` | incremental parse + bounded post-pass |
| `--resume` | incremental from checkpoint + bounded post-pass |
| `--post` | no parse; re-run 5 derived phases only |
| `--skip-post-processing` | parse+store only; derived data deferred |
| `--file <path>` | single-file reindex + scoped post-pass |
| `--import <db>` | adopt DB, then incremental top-up |
| `--force` | wipe + full index + full post-processing |

`bb index --force --changed` therefore prints:

```
✗ conflicting bb index options: force changed
  This combination has no defined behavior. See the semantics matrix: bb index --help, docs/m40/PLAN.md
  Remediations: --force alone rebuilds everything; --post alone re-runs derived-data phases; --changed/--resume alone run the bounded pass.
```

`--no-setup` is **not** part of this matrix. It is orthogonal — it only skips the
first-run embedding prompt (`src/cli/index.ts:79-80`) — so it may be combined
with any of the eight rows above.

## `bb index` — full

```
bb index
```

**Does:** discovers, parses every eligible file, stores symbols/imports, then
runs all five derived phases and the integrity check.

**Use when:** first index of a project, or after a large structural change.

**Does NOT:** skip files whose size and mtime are unchanged. A re-run still
walks the whole tree and still runs every derived phase. If you want the
cheap path, that is `--changed`, not a bare re-run.

The run ends with:

```
✓ indexed 2580 files, 27781 symbols, 47480 relationships, 0 embeddings in 151.8s
  stats: {"totalFiles":2580,"processedFiles":2580,"errorFiles":249}
  breakdown: 2331 newly parsed | 0 unchanged | 249 skipped | 0 symbol-loss | 0 errors | 0 timeouts
  parsed with the worker pool
  derived: full (derived data fully re-processed)
  consistency: 0 unresolved relationships — every stored relationship is attached to a symbol
```

Read those lines carefully; they are the run's own report on itself.

- `breakdown:` — `newly parsed | unchanged | skipped | symbol-loss | errors |
  timeouts` (`src/cli/index.ts:305`).
- `parsed with the worker pool` / `parsed in-process …` — which parse path ran
  (`src/cli/index.ts:318-325`). `in-process` means the run was **serial** and is
  correspondingly slower, even though every other number on the line looks
  pristine.
- `derived:` — one of `full`, `bounded`, `deferred`, `skipped-unchanged`,
  `partial`, with its own note (`src/cli/index.ts:348-359`). **`deferred` means
  the relationships/enrichment/gravity/taints/health data in your index is
  stale.** Finish it with `bb index --post`.
- `consistency:` — how many stored relationships are not attached to a symbol.
  Non-zero means those edges are counted above but traversed by nothing
  (`src/cli/index.ts:367-381`).

## `bb index --changed` — incremental

```
bb index --changed
```

**Does:** sets the run to incremental mode (`src/cli/index.ts:215`). Discovery
compares each file against the stored record and **skips files whose mtime and
size both match** (`src/ast/parallel-indexer.ts:848-856`); the rest are parsed.
Then it runs a **bounded** derived pass scoped to what this run touched, plus a
purge of files that no longer exist on disk
(`src/ast/parallel-indexer.ts:4466-4480`, `:4997`).

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
incrementally (`src/cli/index.ts:225-238`). Because resume is incremental, the
mtime/size skip means strictly fewer files are processed than a fresh run.

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
the derived pass is scoped to it (`src/cli/index.ts:207-214`).

**Use when:** an agent just created or edited a function and you want it
queryable immediately.

**Does NOT:** reindex neighbours. If the edit changed an import or a call site
elsewhere, that other file is stale too — use `--changed` instead. Note the
mtime/size check applies to `--file` as well, so a file whose mtime and size
did not change is skipped and the run reports `skipped-unchanged`.

## `bb index --post` — derived phases only

```
bb index --post
```

**Does:** parses nothing. Re-runs the five derived phases and the integrity
check over the existing index (`src/cli/index.ts:118-135`), printing per-phase
timings and outcome:

```
✓ post-processing complete in 8.5s
  ✓ relationships   2299ms
  ✓ enrichment      3091ms
  ✓ gravity          409ms
  ✓ taint           2582ms
  ✓ health           124ms
```

Exits 1 if any phase failed, and the index is marked `partial`
(`src/cli/index.ts:126-130`). If the project has no index at all it refuses:
`no index for project … — post-processing derives from indexed symbols; run bb index first`
(`src/ast/parallel-indexer.ts:5276-5280`).

**Use when:** `derived: deferred`, or `consistency:` reported unresolved
relationships. This is the documented remediation for both.

**Does NOT:** parse, so it cannot fix a file whose symbols were never extracted.

## `bb index --force` — wipe and rebuild

```
bb index --force
```

**Does:** takes the project's index lock first, then wipes the project's data
**in place — the `brain.db` file itself is kept** so a running MCP server's open
handle is not orphaned onto a stale view (`src/cli/index.ts:178-202`), then
does a full parse and all derived phases.

**Use when:** the index is genuinely corrupt, or you changed analyzer settings.

**Does NOT:** preserve anything. This is the most expensive mode there is — every
eligible file is re-parsed from scratch and every derived phase is recomputed.
See the measured costs in [`performance.md`](performance.md).

## `bb index --skip-post-processing` — parse and stop

```
bb index --skip-post-processing
```

**Does:** parses and stores, then stops. The run reports
`derived: deferred (derived data deferred — run: bb index --post)`
(`src/cli/index.ts:354`).

**Use when:** you want symbols searchable immediately and do not need
relationships, enrichment, gravity, taints or health yet.

**Does NOT:** update any derived data. Until you run `bb index --post`, the
cross-file layer of the index is stale, and anything that reads it will be
reading stale data. This is the fastest route to "my new symbol is in the
index", not a way to skip work permanently.

## Other flags

| Flag | Does |
| --- | --- |
| `--import <db>` | Adopt an existing `brain.db` onto this checkout's project id, then top up incrementally. For a project you moved or copied to another machine (`src/cli/index.ts:139-149`, `:153-173`). |
| `--no-setup` | Skip the first-run embedding prompt. Orthogonal to the semantics matrix. |
| `-v, --verbose` | Raise log level to `debug` (`src/cli/index.ts:652-658`). This is how you see worker-pool and WASM diagnostics — workers default to `error` and swallow everything below it. |
| `-q, --quiet` | Raise log level to `warn`. |

`--import` deserves a caveat: adoption matches on the **codebase fingerprint**.
If no adopted index matches, `bb index` just builds a new one. Adoption also
implies incremental mode, because a move preserves mtimes and a full re-parse
would duplicate symbol rows (`src/cli/index.ts:216-219`).

## Watching a run

The progress line goes to **stderr** so stdout stays clean for anything
consuming it (`src/cli/index.ts:243-256`):

```
312/2580 files (12%) 18.4/s ETA 2m 9s — src/components/button.ts
```

From another shell, `bb status` reports the in-flight run, and afterwards the
last run's per-phase breakdown — parse, dbFlush, discovery, startup, worker
count, and post-processing timings (`src/cli/index.ts:563-593`):

```
✓ last index of /proj: 2580 files, 27781 symbols, 47480 relationships
  total 151805ms | parse 141079ms | dbFlush 169079ms | discovery 646ms | startup 322ms
  post-processing: relationships=2299ms, enrichment=3091ms, gravity=409ms, taint=2582ms, health=124ms
  mode worker-pool | workers 7 | noop no
```

`bb stats` gives the committed counts at any time, including during a run.

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