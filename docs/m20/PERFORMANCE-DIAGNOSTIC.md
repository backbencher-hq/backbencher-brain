# M20 indexing performance diagnostic

**Generated:** 2026-08-28  
**Evidence:** `validation/m20/results/PERF-DIAGNOSTIC.json`, `validation/m20/results/X2.json`

## Conclusion

The multi-hour indexing report is a real user-impacting signal, but the current evidence does **not** identify embeddings as its cause. The diagnostic must therefore remain open until cold indexing is measured with phase-level telemetry.

## Observed evidence

- The bounded IntelliJ incremental run selected 12 existing files and failed with `database is locked` after 10,595 ms. Source hashes were unchanged and database counts were unchanged.
- IntelliJ's existing index contains 69,509 files, 1,071,964 symbols, and 3,524,679 relationships. It has zero persisted embedding rows in the sampled database.
- The bounded ASP.NET Core incremental run selected 12 unchanged files and completed in 113 ms. This is a no-op measurement, not a cold-index benchmark.
- The current Rake database is empty (`0` files, `0` symbols), so it was excluded from tool-latency measurements rather than treated as a successful index.
- The local TypeScript checkout exists but has no corresponding database under the configured data directory, so it was not measured.
- Earlier real-repository evidence measured 43 Rake files at 16,568 ms, 131 Rebar3 files at 14,139 ms, and a 79-file TypeScript compiler slice at 519 ms for indexing. The same TypeScript slice took 103,865 ms in `bb_patterns`; this demonstrates that parsing is not automatically the dominant cost for every tool path.
- The indexer reports `stats.endTime` and `filesPerSecond` before optional relationship resolution, enrichment, gravity, taint, health, and integrity work. The completion event therefore does not represent total command wall-clock time.
- `performance_stats` exists in the schema but is not populated by `BrainDatabase.updateIndexStatus`. Normal completion also writes `indexing_errors` as `[]`, so persisted health cannot reconstruct prior worker/WASM failures.
- The Node SQLite adapter enables WAL but neither Node nor Bun configures a busy timeout. Bun also does not enable WAL. This is a confirmed configuration gap relevant to the observed lock, not yet a proven root cause for the multi-hour run.

## What is not established

- No evidence currently proves that embeddings caused the hours-long run. The bounded run produced zero embeddings, and no provider/API timing was available.
- No evidence currently proves that Tree-sitter/WASM parsing caused the hours-long run.
- No cold full-index timing was collected by the new diagnostic. Existing full-index evidence is not phase-complete.
- The `LIMIT/OFFSET` relationship-enrichment loop is a scalability risk worth benchmarking, but it is not declared a confirmed bottleneck from these runs.

## Required next evidence

1. Add phase timers for discovery, worker parse, DB flush, relationship resolution, enrichment, gravity, taint/health, and embedding queue/flush.
2. Persist those timers and counts without overwriting prior errors; expose worker crashes, WASM load failures, retries, fallback-parser use, and dropped embedding batches.
3. Run a cold index on a controlled fixture and a large real repository with embeddings disabled, local embeddings, and configured-provider embeddings where available.
4. Run the same corpus under one writer and concurrent-reader conditions to reproduce and classify SQLite locks.
5. Benchmark relationship enrichment at increasing relationship counts and replace or justify offset pagination based on measured results.

Until those gates pass, the honest status is **diagnostic known-gap**, not “performance fixed” and not “embeddings are responsible.”
