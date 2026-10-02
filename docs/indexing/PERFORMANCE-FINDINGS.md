# Indexing performance — measured findings

> **Read the provenance warning.** Every number on this page was measured on a
> developer machine and **no evidence file for any of it exists in this
> repository** — there is nothing under `validation/` recording the 9.9 s /
> 455.4 s pair, and nothing recording the 3,850 s real-repo run. Every other
> timings page in this directory
> ([`performance.md`](performance.md)) cites a specific evidence file and line
> for each number, precisely so a reader can check it. This page cannot be
> checked that way, so treat it as a set of observations to re-derive, not as
> citable evidence. `script/verify-docs-indexing.ts` cannot verify it either:
> the gate checks claims against `src/` and against a live run, and there is
> nothing here for either to check.
>
> Host for all figures: 12 cores, effective pool concurrency 11, node v22.23.3.

## The worker pool was worth ~46× on one machine. Losing it is the real perf cliff.

Same 300-file TypeScript fixture, identical flags, warm cache, back to back
(**unverified — no evidence file recorded**):

| Mode | Wall clock |
|---|---|
| Worker pool | **9.9 s** |
| In-process (serial) | **455.4 s** |

**46× slower.** The *direction* is not in doubt and is corroborated by the
measured bottleneck classification in [`performance.md`](performance.md) — the
pool is where the parallelism lives, and losing it is single-threaded. The
*magnitude* is one machine, one fixture, one run, unrecorded. Do not quote 46×.

This reframes the "pool workers don't start" bug: it is not a cosmetic warning.
This is why the pool diagnosis work matters more than its line count suggests.
Before this change the failure printed one generic line and the run continued
looking fine.

## Where the 1 h 4 m on the real repo went

Measured on `backbencher-brain` itself (**unverified — no evidence file
recorded**): 7,220 files, 386,336 symbols, 543,762 relationships, 79,649
embeddings in 3,850 s.

Composition of the work:

- 3,478 TypeScript + 2,522 JSON files are 83% of the file count. JSON is parsed
  by tree-sitter like everything else, which is far more expensive per byte than
  a line-oriented format warrants.
- 141 files were flagged with parse errors, 11 hit the worker file timeout
  (`BB_FILE_TIMEOUT_MS`, default 45 s).
- 5 files exceed the 1 MB `FULL_AST_LIMIT` and get structural extraction instead
  of a full parse (`src/ast/parallel-indexer.ts:850-877`) — correct, and cheap.
- Only 352 files were newly parsed on the run that reported 1 h 4 m; the other
  6,146 were unchanged. So the headline number was dominated by the incremental
  check plus the **full derived pass** — relationship resolution, enrichment,
  gravity, taint and health over 386k symbols — not by parsing.

Note what that last bullet rests on: the run parsed *something*, so it took the
`full` derived path. A run that parses nothing reports
`derived: skipped-unchanged` and runs no derived pass at all — that is the
common case on a second run, and it is verified live by
`script/verify-docs-indexing.ts --live`.

## The honest conclusion

The parse phase is not the bottleneck on a large index; the derived-data pass
over hundreds of thousands of symbols is. Two consequences:

1. A faster pool does not make the derived pass faster. Raising concurrency
   further has a ceiling and will not move the 3,850 s much.
2. `bb index --skip-post-processing` followed by `bb index --post` is the
   documented way to split that work, and `--changed` should be preferred over a
   full run when files have not changed. Both are already implemented; the CLI
   help and docs now describe them.

Not yet measured: whether the derived pass is memory-bound or CPU-bound, and
where inside it the time goes. That is the next profiling step before any
optimisation attempt — guessing at it would be how the previous duplicate-VALUES
bug shipped.

## Reproducing the pool comparison

```bash
# pool
node bin/bb index <fixture> --force

# serial, same fixture
BB_POOL_WORKER=0 node bin/bb index <fixture> --force
```

`BB_POOL_WORKER=0` is honoured by `resolvePoolWorkerForkSafe`, which returns the
`pool-disabled-by-env` failure reason rather than failing opaquely
(`src/ast/pool-diagnostics.ts:80`, `:190-201`). `0` is one of five disabling
values: `0`, `false`, `off`, `no`, `none`.

This is the one mechanism on this page that **is** gated: the reason string, the
value set, and the "the env var is not a supported opt-out" rule are all asserted
by `script/verify-docs-indexing.ts` against `src/`, and the env-var behaviour is
described in [`troubleshooting.md`](troubleshooting.md#cause-5--bb_pool_worker-is-set-in-your-environment).
The timings are not.

## To make this page citable

Each number above needs a `validation/<milestone>/results/<id>.json` recording
the command, the host, and the parsed counts — the shape
`performance.md` cites throughout. Until that exists, this page is a note to
self.