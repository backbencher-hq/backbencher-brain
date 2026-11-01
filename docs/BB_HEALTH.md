<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference guide to `bb_health`: what the report measures, the two behaviours (status and the explicit refresh), every option and its cost, what the answer honestly cannot claim, and the measured latency.
WHO IT IS FOR — an agent or developer deciding whether the index may be trusted, and the operator who has to repair it.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_health/{descriptor,handler}.ts, src/intelligence/health/health-provider.ts, script/tool-docs/curation/bb_health.ts, docs/tools/bb_health.md (generated), and the gates listed under Verification.
-->

# `bb_health` — index health and freshness

`bb_health` answers "is this index complete, fresh, and healthy?". The CLI
(`bb health`) and the MCP tool call the same provider, so their numbers and
wording agree. A broken index is a successful REPORT, not a tool failure: the
report names the problem and sets `healthy: false`; only bad input is refused
with `isError`.

There is **no `mode` parameter**. A call reports status; `refresh` and `force`
are the two flags that select the one behaviour that changes the index.

## What a status call measures

- file, symbol, relationship, import and syntax-error counts;
- schema version/migration and table count, runtime, and the cost of the call
  itself (`this call: total=…` with the phases that ran);
- embedding rows, distinct embedded entities, symbol coverage, and the models
  and dimensions present;
- freshness, either a deterministic SAMPLE (default) or a COMPLETE census;
- why each checked file was classified as it was: fresh by content hash, fresh
  by mtime+size only (the file was not read), stale (content changed), missing
  (deleted), missing (unreadable), or missing (no index row);
- the index status record, labelled when its counters describe the last index
  RUN rather than the index itself;
- typed warnings, each with a severity. Error-severity warnings (for example an
  empty index, an incomplete index, a failed refresh) make `healthy: false`.

Optional answers, each opt-in because it costs real work:

| Option | Answer | Cost |
|---|---|---|
| `verbose: true` | per-language file/symbol counts, per-language searchability, embedded/unembedded symbol kinds, embedding config and provider chain, bounded stale/missing file names | runs the per-symbol embedding aggregates — the only value that does |
| `freshness: "complete"` | exact stale/missing counts instead of a sample | one stat per indexed file, content hash when metadata differs |
| `integrity: true` | the integrity check list with status and remediation | with the default sampled freshness, a complete disk pass over the indexed files |
| `checkUnindexed: true` | files on disk the indexer would index but the index does not contain | one stat per eligible file (a project walk) |
| `includeAnalysisRuns: true` | persisted analysis run/finding totals | two full-table counts |
| `history: true` | JSON `{ health, history, healthy }`; uses `limit` (default 20, minimum 1) | reads the analysis-history tables |
| `paths: [...]` | a separate five-state block for the named files (fresh / stale / gone / not-indexed / absent) | O(files named) — checks only those files |
| `refresh: true` | report computed after an incremental reindex (bounded derived pass) | a reindex |
| `force: true` | report computed after a full wipe-and-rebuild; destructive | a full reindex |
| `wait: false` | with refresh/force: return the current snapshot and detach the rebuild; the NEXT call reports the outcome once | none |

Options the selected call cannot honour are refused rather than ignored: a
`limit` without `history: true`, a `wait` without `refresh`/`force`, and a
`sampleSize` with `freshness: "complete"` each come back as an `isError` naming
the accepted form.

## Reading the answer

```
files=6452 symbols=310423 relationships=820040 imports=25122 syntaxErrors=100
freshness: 194 fresh / 6 of 200 sampled stale (~194 of 6452 estimated) / 0 missing (200/6452 checked, sampled — SAMPLE, not a census)
freshness why: 194 fresh by mtime+size only (file not read …); 6 stale: content changed (reindex these) — over the 200-file SAMPLE, not the project
index: version=v1.0.0 indexedFiles=1/1 (last-run counters, not an index total) status=complete errors=0
this call: total=211ms (freshness=18ms aggregates=58ms)
```

- In sampled mode the stale count is a **lower bound** on the project; pass
  `freshness: "complete"` when you need the exact census.
- `metadata-fast-path` fresh verdicts never read the file; a same-size edit that
  preserves the mtime reads fresh (the same trade-off as git's stat-cache).
- `healthy` is on the MCP result object and inside the history JSON.

## MCP usage

```json
{ "verbose": true }
{ "freshness": "complete" }
{ "integrity": true }
{ "includeAnalysisRuns": true }
{ "history": true, "limit": 5 }
{ "paths": ["src/mcp/server.ts"] }
{ "checkUnindexed": true }
{ "refresh": true }
{ "force": true }
```

`refresh`/`force` are the only mutations. `force` wipes before rebuilding and
leaves nothing behind if the rebuild fails; the report says so. A detached
rebuild (`wait: false`) is reported by the next call exactly once, success and
failure alike.

## CLI

```bash
bb health [dir]
bb health [dir] --complete
bb health [dir] --sample-size 50
bb health [dir] --integrity
bb health [dir] --verbose-config
bb health [dir] --refresh            # incremental + bounded derived pass
bb health [dir] --refresh --force    # wipe and full rebuild (destructive)
bb health [dir] --refresh --no-wait  # detach the rebuild
```

The CLI exits non-zero when the report contains an error-severity warning; the
same condition sets `healthy: false` on the MCP result.

## Measured latency

Default arguments, warm, through the MCP door, five runs
(`validation/tools/bb_health/LATENCY.json`):

| Tier | Subject | p50 | p95 |
|---|---|---|---|
| T0 | `test/fixtures/polyglot` (5 files) | 53 ms | 58 ms |
| T1 | `.perf-fixtures/bb-scale/n100` (97 files) | 35 ms | 65 ms |
| T2 | workspace index, 6,452 files / 310,423 symbols / 3.6 GB | 816 ms | 882 ms |
| T2-scale | 1,283,638-symbol copy of that index | 2.6 s | 3.3 s |

First call after a cold start measured 8.3 s (T2) and 25.3 s (the 1.28M-symbol
copy); the default call is bounded by file count and the freshness sample, not
by the symbol count, which is what keeps those numbers inside a typical MCP
client timeout.

## Verification

- `npx tsx script/verify-health.ts`
- `npx tsx script/m13/verify-health-mutability.ts`, `-verbose`, `-integrity`,
  `-refresh`, `-e2e-corpus`; `bun run script/m13/verify-health-docs.ts`
- `npx tsx script/m15/verify-health-deep.ts`
- `npx tsx script/m40/verify-a6-health-refresh.ts`
- `npx tsx script/m51/verify-a2-health-split.ts`
- `npx tsx script/m64/verify-{sample-coverage,refresh-integrity,coverage-and-partial,freshness-reasons,actionability,unindexed,paths,embed-scan,health-deep,evidence}.ts`;
  `bun run script/m64/verify-wire.ts`

Gates run against fixture projects under an isolated `BB_DATA_DIR`; set
`BB_NO_AUTO_REFRESH=1` for measurement reads so an index is never refreshed by
the act of measuring it.
