# Unified Health (M9.14)

`bb_health` is the canonical health and index-lifecycle report for a project.
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
in-place full rebuild and implies refresh. `--no-wait` starts the refresh in the
background and returns the current snapshot. Refreshes are serialized per project.
A health command exits non-zero when the provider reports
an error-severity warning.

## MCP

`bb_health` accepts `refresh`, `force`, `wait`, `freshness`, `sampleSize`,
`integrity`, and `includeAnalysisRuns`. `history` retains the persisted
analysis-history response and combines it with the health report.

The former `bb_refresh` alias was removed in `0.3.0`; use `bb_health` with
`refresh: true`.

## Safety

Refresh is synchronous by default and keeps the existing database file and
live handles in place. A failed refresh is represented as a typed warning and
does not silently claim completion. Status-only calls do not mutate the index.

Verification: `script/verify-health.ts` covers sampled and complete freshness,
formatted output, observable refresh completion, processed-file reporting, and
count preservation.
