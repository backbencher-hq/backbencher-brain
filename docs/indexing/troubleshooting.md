# Troubleshooting the worker pool

> Gated by `script/verify-docs-indexing.ts` (see [`README.md`](README.md)). Source
> of truth: `resolvePoolWorkerFork` (`src/ast/parallel-indexer.ts:1246-1269`),
> the diagnosing resolver `resolvePoolWorkerForkSafe`
> (`src/ast/pool-diagnostics.ts`), the fork pre-flight test
> (`src/ast/parallel-indexer.ts:4770-4825`), the startup watchdog
> (`:1593-1600`), and the fallback decision (`:4816-4825`). Every message
> quoted below is emitted verbatim by that code, and the gate checks it.

## The symptom, in your words

> "The index takes forever."
>
> "It says it indexed everything but it's crawling."
>
> "My 32-core machine is running one thread."
>
> "Is it even using the workers?"

Underneath all of those is one observable fact. Every index run prints a line
saying which parse path it used (`src/cli/index.ts:376-384`):

```
  parsed with the worker pool
```

```
  parsed in-process — the worker pool was unavailable, so this run was serial and is correspondingly slower
```

There is also a fourth possibility, and it means what it says:

```
  parsed: mode not recorded for this run (pre-dates the parseMode field)
```

and a fifth, for a run that parsed nothing at all:

```
  parsed nothing — no files needed parsing, so no parse mode was used
```

If you are seeing the middle line, the run lost its worker pool and fell back
to **single-threaded** parsing. Every other number on the summary still reads
perfectly — `errors: 0`, `timeouts: 0` — because in-process parsing is
*correct*, just slow. This line is the only thing that reveals it, which is why
it exists.

## Diagnose it

Run these three, in order. The first two are read-only.

### 1. Ask the last run

```
bb status
```

```
✓ last index of /proj: 8 files, 24 symbols, 22 relationships
  total n/a | parse 1218ms | dbFlush 27ms | discovery 77ms | startup 990ms
  mode worker-pool | workers 1 | noop no
  db: <data-dir>/projects/<projectId>/brain.db
```

Real output from a fixture. Two fields matter:

- **`mode`** — `worker-pool`, or `in-process`.
- **`workers`** — how many were actually spawned. It is `0` for every
  in-process run. On a no-op run (nothing to parse) it is `0` too, because no
  worker was ever needed; check `noop` before concluding the pool failed.

`bb status` also shows an in-flight run, so you can watch `workerCount` and
`filesPerSecond` while the run is still going.

### 2. Turn the logs up

```
bb index --verbose
```

`--verbose` sets `BB_LOG_LEVEL=debug` (`src/cli/index.ts:713`, `:720-723`).
There is **no `-v` short form** — `-v` is `--version`. This matters here more
than anywhere else: without `--verbose`, workers default to `error` and
deliberately swallow everything below it (`src/ast/pool-worker.ts:20-22`), so
WASM-load failures, engine-load failures and pool diagnostics are **invisible**.

What to look for:

| Log line | Meaning |
| --- | --- |
| `worker pool fork test passed — using parallel workers` | The pool is healthy. |
| `worker pool fork unavailable, falling back to in-process` | The pre-flight test failed; see causes 1–3. |
| `worker pool unavailable — no tsx binary found (dev mode)` | Cause 1. |
| `starting worker pool` with `numWorkers` / `files` / `batchSize` | The pool sized itself; useful for the "only one worker" question. |
| `Worker did not become ready within startup timeout — killing` | Cause 3. |
| `worker N engine load FAILED: …` (stderr, prefixed `[brain]`) | Cause 4. |
| `[worker] …` / `[worker-out] …` on stderr | Raw worker stderr/stdout. **Only relayed when `BB_WORKER_ECHO=1`** — otherwise it is drained and discarded (`src/ast/parallel-indexer.ts:1621-1632`). |
| `[BB-PARSE-ERR] <lang> \| <path> \| <msg>` | Per-file parse failure. Full detail also lands in `~/.bb/logs/parse-errors.log` (`src/ast/pool-worker.ts:846`). |

One caveat on the relay: echoing every worker line produced a wall of
`[worker] [INFO] [ast-engine] …` that buried the progress line, so the echo is
opt-in. If you need it for one diagnosis, set `BB_WORKER_ECHO=1` alongside
`--verbose`.

### 3. Check for the environment mistake

```
echo "BB_POOL_WORKER=[$BB_POOL_WORKER]"
```

If that prints anything other than empty, see [Cause 5](#cause-5--bb_pool_worker-is-set-in-your-environment).

## Causes and fixes

### Cause 1 — `tsx` cannot be found (development checkouts)

```
worker pool unavailable — no tsx binary found (dev mode)
```

Worker fork targets are resolved by `resolvePoolWorkerFork`
(`src/ast/parallel-indexer.ts:1246-1269`):

| Situation | Fork target |
| --- | --- |
| Compiled `dist/` | `dist/pool-worker.js` — the module itself, no loader needed |
| Node running from `src/` | the `tsx` binary **plus** `src/ast/pool-worker.ts` |
| Bun running from `src/` | `src/ast/pool-worker.ts` directly (Bun runs TypeScript natively) |

In the Node-from-`src` case the resolver looks for `node_modules/.bin/tsx`
first, then `tsx` on `PATH` (`src/ast/parallel-indexer.ts:1262-1263`). If
neither exists it returns no worker path at all, and every file in the queue is
failed with:

```
worker pool unavailable (startup failure)
```

(`src/ast/parallel-indexer.ts:1553`).

**This cannot happen in a normal published install** — a `dist/` build forks
`dist/pool-worker.js` directly and never looks for `tsx`. It does not need
`node_modules` at all beyond its own runtime deps.

**Fix:** install dependencies (`npm install`), or make `tsx` resolvable on
`PATH`. If you are running from `src/`, you are in a development checkout and
dependencies are expected to be installed.

### Cause 2 — the fork pre-flight test fails

Before any real parsing, `bb index` forks one worker and waits for it to answer
`ready` (`src/ast/parallel-indexer.ts:4784-4813`). The wait is **not** a separate
60-second constant: it is `poolStartupTimeoutMs()` — the *same* knob and the
same value as the pool's own startup watchdog, `BB_WORKER_STARTUP_TIMEOUT_MS`,
default **30 000 ms** (`src/ast/pool-diagnostics.ts:77-90`,
`src/ast/parallel-indexer.ts:4789`). It used to be hardcoded at 60s while the
watchdog was 30s, so a slow machine could fail the real pool at 30s and then sit
through another 60s waiting for a probe that was never going to pass.

The failure reasons are specific:

| Rejection message | Meaning |
| --- | --- |
| `worker fork test timed out after 30s` | The worker started but never became ready — usually a broken runtime, or a machine so loaded that booting the engine took over the timeout. The number is your configured timeout, rounded to seconds. |
| `worker exited with code N` | The worker crashed during boot. `N` is its exit code. Note the `exit` handler only rejects a **non-zero** code, so a worker that exits 0 without sending `ready` is caught by the timeout, not by this branch. |
| Any `error` event from `fork()` | The fork itself failed. |

Any of these makes the run fall back to in-process parsing
(`src/ast/parallel-indexer.ts:4816-4825`). Because the timeout is the same
knob, `BB_WORKER_STARTUP_TIMEOUT_MS` moves both — see
[Cause 3](#cause-3--the-startup-watchdog-fires).

**Fix:**

1. Re-run with `--verbose` and read the reason. That is the whole diagnosis.
2. If it is a timeout, the machine is overloaded or the disk is very slow.
   Close other builds, wait for load to drop, retry.
3. If it is a crash, check for missing tree-sitter grammar `.wasm` assets —
   see [Cause 4](#cause-4--the-workers-engine-failed-to-load).
4. Confirm the run still completes. An in-process run indexes every file
   correctly; it is only slower. Let it finish before you escalate.

### Cause 3 — the startup watchdog fires

```
Worker did not become ready within startup timeout — killing
```

Each forked worker gets a startup watchdog. If it has not signalled `ready`
within `BB_WORKER_STARTUP_TIMEOUT_MS` (default **30 000 ms**), it is `SIGKILL`ed
and counted as a startup failure (`src/ast/parallel-indexer.ts:1593-1600`).
The pool allows at most `max(numWorkers, 2)` startup attempts
(`MAX_STARTUP_FAILURES`, `src/ast/parallel-indexer.ts:1545`) before failing the
remaining queue visibly, so a broken runtime cannot produce an infinite
spawn-kill loop (`src/ast/parallel-indexer.ts:1728-1730`).

A garbage or non-positive `BB_WORKER_STARTUP_TIMEOUT_MS` does **not** become
`setTimeout(fn, NaN)`: the reader falls back to the 30 s default
(`src/ast/pool-diagnostics.ts:85-89`), because that would report every worker as
hung.

**Fix:** raise the watchdog for a loaded or slow machine:

```
BB_WORKER_STARTUP_TIMEOUT_MS=120000 bb index --verbose
```

This is a legitimate production knob, not a test hook, and it governs **both**
the fork pre-flight and the per-worker watchdog. Raising it fixes a *timeout*;
it cannot fix a crash. If raising it does not help, the worker is failing to
boot for another reason.

### Cause 4 — the workers' engine failed to load

```
[brain] worker 3 engine load FAILED: <error>
```

The process forked and answered, but the AST engine inside it did not load —
usually a missing or unreadable tree-sitter grammar `.wasm`. The worker is not
pooled in this case; it is kept idle so its regex-based fallback extractor can
still handle files (`src/ast/parallel-indexer.ts:1640-1653`).

**Fix:**

1. `bb index --verbose` — a WASM-load failure is suppressed at default log
   level and only appears here.
2. Check that the grammar assets are present. They are resolved from the
   package's `wasm/` directory, from `~/.bb/wasm/`, or from the install
   directory.
3. Reinstall the package that ships the grammars if they are missing.
4. If a single language's grammar is broken, exclude that language's files with
   `.bbignore` so the rest of the project indexes cleanly.

Note that files can also fail individually with a 45-second per-file timeout
(`BB_FILE_TIMEOUT_MS`, default 45 000 ms — `src/ast/parallel-indexer.ts:130`).
Such a file is killed, retried up to 3 times (`MAX_FILE_RETRIES`,
`src/ast/parallel-indexer.ts:1411`), and then recorded as a poison pill with the
error `Max retries exceeded (poison pill)` (`:1517-1521`). It shows up in the
`breakdown:` line as `timeouts`, not as a startup problem.

Note also that the pool's own success message hardcodes the file timeout in its
prose — `worker pool available — using parallel indexing with 45s timeouts`
(`src/ast/parallel-indexer.ts:4814`) — so that "45s" is **not** evidence your
`BB_FILE_TIMEOUT_MS` took effect. It is a literal in a string, not the
configured value.

### Cause 5 — `BB_POOL_WORKER` is set in your environment

```
$ echo "[$BB_POOL_WORKER]"
[1]
```

`BB_POOL_WORKER=1` is how the parent tells a forked child "you are a pool
worker". The parent sets it on every fork
(`src/ast/parallel-indexer.ts:4781`, `:1515`). **You should never set it
yourself** — in particular do not try to "force in-process" with it.

Setting `BB_POOL_WORKER=0` looks like a supported opt-out and is not one; it is
what `resolvePoolWorkerForkSafe` treats as a disable request
(`src/ast/pool-diagnostics.ts:80`, `:190-201`), which makes the whole run fall
back to in-process parsing.

If you export `BB_POOL_WORKER=1` in your own shell, every forked child warns on
stderr (`src/ast/pool-worker.ts:1454-1458`) because a real child should not have
inherited it from you:

```
[BB-WORKER-STARTUP] forked with BB_POOL_WORKER=1 rather than "1"; serving anyway — unset BB_POOL_WORKER to use in-process indexing
```

(The `rather than "1"` in that message is the *correct* value — the line exists to
be read, not matched.) The older and worse failure was that such a child skipped
the keep-alive, exited 0 **without ever sending `ready`**, and the fork probe —
which only rejects a non-zero exit — then hung for its full timeout before
reporting a failure that named nothing. That is fixed; the keep-alive is now
gated on `process.connected` (the IPC channel), not on the env var
(`src/ast/pool-worker.ts:1453`, and the reasoning at `:1432-1452`).

**Fix:**

```
unset BB_POOL_WORKER
```

If you set it in a `.env`, `.zshrc`, `.bashrc`, or a CI config, remove it.

### Cause 6 — only one worker, and that is correct

```
$ bb index --verbose
... starting worker pool {"numWorkers":1, "files":7, "batchSize":10}
```

This is **not** a bug. The pool sizes itself as
`min(concurrency, ceil(files / batchSize))` with `batchSize = 10`
(`src/ast/parallel-indexer.ts:1310-1311`, `:136`). Seven files means
`ceil(7/10) = 1`, so one worker — on any machine, with any core count.

`concurrency` itself is `max(2, min(cpus - 1, 12))`
(`src/ast/parallel-indexer.ts:125`), so the ceiling is **12 workers** no matter
how many cores you have. Verified live: this box reports 12 CPUs and the pool
logs `concurrency: 11`.

**Confirm** with `bb status` → `mode` and `workers`.

**Fix:** none for small projects. If you genuinely have thousands of files and
still see `workers: 1`, that is a real degradation — go back to Cause 1.

And do not assume more workers is faster. The one controlled comparison in this
repository (`validation/m19/results/S3.json:37-101`, 100-file disjoint samples)
found 12 workers slightly faster on the throughput control but *slower* on the
memory control, and the evidence file states plainly that the samples were
disjoint and sequential, "not a same-input benchmark".

## Environment variables that control worker behaviour

| Variable | Default | Effect |
| --- | --- | --- |
| `BB_POOL_WORKER` | unset | Set to `1` **by the parent** on every forked worker (`src/ast/parallel-indexer.ts:4781`). `0`/`false`/`off`/`no`/`none` are read as a request to disable the pool entirely (`src/ast/pool-diagnostics.ts:80`). Any other value you export yourself is inherited by children and warned about. See [Cause 5](#cause-5--bb_pool_worker-is-set-in-your-environment). |
| `BB_POOL_WORKER_SELFTEST` | unset | Set to `1` to make a pool worker print a machine-readable startup line and exit — a one-shot check of the worker alone, without running a whole index (`src/ast/pool-worker.ts:1519`). Run it directly: `BB_POOL_WORKER_SELFTEST=1 node dist/pool-worker.js`. Start here when `bb doctor` reports the pool unavailable and you want the worker's own view rather than the parent's. |
| `BB_WORKER_STARTUP_TIMEOUT_MS` | `30000` | How long a forked worker has to signal `ready` before it is `SIGKILL`ed and counted as a startup failure (`src/ast/pool-diagnostics.ts:77-90`, `src/ast/parallel-indexer.ts:1593-1600`). Governs the fork pre-flight test too. A non-positive or unparseable value falls back to 30 s. Raise it on loaded machines. |
| `BB_FILE_TIMEOUT_MS` | `45000` | Per-file hard timeout. A file exceeding it is killed and retried up to 3 times (`src/ast/parallel-indexer.ts:130`, `:1411`). |
| `BB_LOG_LEVEL` | `error` inside workers | Workers default to `error` and suppress everything below (`src/ast/pool-worker.ts:20-22`). `--verbose` sets `debug`; `--quiet` sets `warn` (`src/cli/index.ts:720-727`). An explicit value you export is inherited by workers rather than overridden. |
| `BB_DATA_DIR` | `~/.bb` | Relocates the whole data directory (`src/util/bb-data-dir.ts:11-13`). Workers resolve their diagnostics log from it too (`src/ast/pool-worker.ts:27-28`). |

**Concurrency has no env var.** Worker count is derived from `os.cpus().length`
and the file count; there is no supported way to set it from the environment.

**Worker output echo has one**, and it is undocumented on purpose: `BB_WORKER_ECHO=1`
relays raw worker stdout/stderr as `[worker]` / `[worker-out]`. It defaults to
off because unconditional echoing buried the progress line. The gate records
this deliberate omission in `KNOWN_UNDOCUMENTED`.

### Test-only hooks — do not use in production

These require `BB_TEST_HOOKS=1` and exist to make failure modes
deterministically testable. They are quarantined behind that flag so a stray
environment variable cannot stall a real index (`src/ast/pool-worker.ts:1292`,
`:1385`).

| Variable | Requires | Effect |
| --- | --- | --- |
| `BB_TEST_HOOKS` | — | Gate for the three below. Unset in normal use. |
| `BB_WORKER_DELAY_READY_MS` | `BB_TEST_HOOKS=1` | Delays the `ready` signal, exercising the startup watchdog. |
| `BB_WORKER_CRASH_ON_BATCH` | `BB_TEST_HOOKS=1` | Makes a worker crash on a batch. |
| `BB_WORKER_DELAY_PARSE_MS` | `BB_TEST_HOOKS=1` | Delays parsing inside a worker. |
| `BB_TEST_INDEX_LOCK_OFF` | `BB_TEST_HOOKS=1` | Disables the single-flight index lock (`src/ast/index-lock.ts:322`). |

If you have `BB_TEST_HOOKS=1` exported, unset it. It also unlocks a freshness
short-circuit in the MCP tool handlers (`src/mcp/tool-handlers.ts:880`).

## The related lock error

Shape of the message (`src/ast/index-lock.ts:115`; the pid, host and timestamp are
interpolated, so do not match on them):

```
✗ another index run is already active for this project (pid 4821, started 2026-10-02T17:41:03.000Z, kind=index); wait for it to finish, or if it crashed the stale lock at .index.lock is reclaimed automatically on the next run
```

This is not a worker problem — the pool never started because the run never
started. Indexing is single-flight per project
(`src/ast/index-lock.ts:105-115`). Either another `bb index` / MCP index is
live, or a previous one crashed; the message says which, and a stale lock from a
crashed process is reclaimed automatically on the next run. Do not delete the
lock file by hand.

`--force` acquires the same lock *before* it wipes
(`src/cli/index.ts:168-180`), so a `--force` run cannot slip between another
run's wipe and its parse.

## Related

- [`README.md`](README.md) — flag semantics
- [`performance.md`](performance.md) — why a serial run is so much slower
- [`docs/TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) — general `bb` troubleshooting