# `bb_health`

Unified index health: file/symbol/relationship/imports counts, embedding model + coverage, schema version, runtime, and file freshness. Use verbose=true for per-language breakdown and stale-file names, refresh=true to reindex before reporting, force=true to force a full in-place reindex before reporting, integrity=true for the 12-point index health check, complete=true for full (not sampled) freshness, includeAnalysisRuns=true for persisted run/finding totals, history=true for persisted analysis history.

## Contract

- Category: `lifecycle`
- Mutability: `read`
- Requires index: `false`
- Modes: `status`, `refresh`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"verbose":false,"history":false,"limit":20,"refresh":false,"force":false,"wait":true,"freshness":"sampled","sampleSize":200,"integrity":false,"includeAnalysisRuns":false}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "verbose": {
      "type": "boolean",
      "description": "include stale/missing file names (default false)"
    },
    "history": {
      "type": "boolean",
      "description": "return persisted analysis history (default false)"
    },
    "limit": {
      "type": "number",
      "description": "history run limit (default 20)"
    },
    "refresh": {
      "type": "boolean",
      "description": "reindex the project before reporting"
    },
    "force": {
      "type": "boolean",
      "description": "force a full in-place reindex before reporting"
    },
    "wait": {
      "type": "boolean",
      "description": "wait for refresh to finish (default true)"
    },
    "freshness": {
      "type": "string",
      "enum": [
        "sampled",
        "complete"
      ],
      "description": "freshness mode (default sampled)"
    },
    "sampleSize": {
      "type": "number",
      "description": "freshness sample count (default 200)"
    },
    "integrity": {
      "type": "boolean",
      "description": "run the 12-point index integrity check"
    },
    "includeAnalysisRuns": {
      "type": "boolean",
      "description": "include persisted analysis run/finding totals"
    }
  }
}
```

## Returns

- Index, schema, runtime, freshness, and embedding health
- Optional integrity and analysis-history summaries
- Typed warnings and refresh outcome

## Examples

`{"verbose":true}`

`{"history":true}`

`{"refresh":true,"force":true}`

`{"integrity":true}`

`{"freshness":"complete"}`

`{"includeAnalysisRuns":true}`

## Errors

- Invalid freshness or sample settings
- Refresh/index failure
- Unknown option

## Limitations

- Sampled freshness is not a complete filesystem proof
- Embedding coverage reports stored state, not semantic quality

## Performance

Sampled freshness is the default; complete freshness and integrity checks intentionally cost more.

## Safety

Status is read-only. refresh=true explicitly mutates only index data; force=true performs a full in-place reindex.

## Evidence Semantics

Counts and versions come from the brain database; freshness compares indexed metadata with the filesystem.

## Relationship to other tools

For index size/counts use `bb index status` (CLI) or the stats surface; this tool reports index health and integrity.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
