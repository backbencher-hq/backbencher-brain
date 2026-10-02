# Indexing performance — measured findings

All figures measured on this machine (12 cores, effective pool concurrency 11,
node v22.23.3), not estimated.

## The worker pool is worth ~46×. Losing it is the single biggest perf cliff.

Same 300-file TypeScript fixture, identical flags, warm cache, back to back:

| Mode | Wall clock |
|---|---|
| Worker pool | **9.9 s** |
| In-process (serial) | **455.4 s** |

**46× slower.** This reframes the "pool workers don't start" bug: it is not a
cosmetic warning. A user whose pool silently failed to start waits 46× longer
for the same index, on a large repo that is the difference between minutes and
most of a day.

This is why the pool diagnosis work matters more than its line count suggests.
Before this change the failure printed one generic line and the run continued
looking fine.

## Where the 1 h 4 m on the real repo went

Measured on `backbencher-brain` itself: 7,220 files, 386,336 symbols, 543,762
relationships, 79,649 embeddings in 3,850 s.

Composition of the work:

- 3,478 TypeScript + 2,522 JSON files are 83% of the file count. JSON is parsed
  by tree-sitter like everything else, which is far more expensive per byte than
  a line-oriented format warrants.
- 141 files are flagged with parse errors, 11 hit the 45 s worker timeout.
- 5 files exceed the 1 MB cap and get basic extraction instead of a full parse
  (correct, and cheap).
- Only 352 files were newly parsed on the run that reported 1 h 4 m; the other
  6,146 were unchanged. So the headline number was dominated by the incremental
  check plus the **full derived pass** — relationship resolution, enrichment,
  gravity, taint and health over 386k symbols — not by parsing.

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

`BB_POOL_WORKER=0` is honoured by `resolvePoolWorkerForkSafe`, which reports
`pool-disabled-by-env` rather than failing opaquely.