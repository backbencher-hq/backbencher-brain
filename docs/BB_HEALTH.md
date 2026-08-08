# Unified Health (M9.14)

`bb_health` is the canonical read-only health report for an indexed project.
The CLI and MCP handler use the same provider, so the core metrics are
consistent across both interfaces.

## Report

The report includes:

- file, symbol, relationship, import, and syntax-error counts
- index status, indexed-file count, and recorded indexing errors
- freshness status, either sampled (default) or complete
- stale and missing relative paths
- embedding totals, models, dimensions, and symbol coverage
- schema version, migration name, table count, and runtime information
- typed warnings for refresh, integrity, indexing, syntax, and freshness issues
- optional analysis run and finding totals

## CLI

```text
bb health [dir]
bb health [dir] --complete
bb health [dir] --sample-size 50
bb health [dir] --refresh [--force]
bb health [dir] --integrity
```

`--refresh` reindexes before producing the report. `--force` performs an
in-place full rebuild and implies refresh. `--no-wait` disables waiting for a
refresh operation. A health command exits non-zero when the provider reports
an error-severity warning.

## MCP

`bb_health` accepts `refresh`, `force`, `wait`, `freshness`, `sampleSize`,
`integrity`, and `includeAnalysisRuns`. `history` retains the persisted
analysis-history response and combines it with the health report.

`bb_refresh` is a compatibility adapter that runs the same provider with
`refresh: true` and returns the post-refresh health report.

## Safety

Refresh is synchronous by default and keeps the existing database file and
live handles in place. A failed refresh is represented as a typed warning and
does not silently claim completion. Status-only calls do not mutate the index.

Verification: `script/verify-health.ts` covers sampled and complete freshness,
formatted output, observable refresh completion, processed-file reporting, and
count preservation.
