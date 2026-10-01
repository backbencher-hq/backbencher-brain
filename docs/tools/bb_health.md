# `bb_health`

Unified index health: file/symbol/relationship/imports counts, embedding model + coverage, schema version, runtime, file freshness, and what this call cost. The default output names WHY each file was classified: `freshness why` separates fresh-verified-by-content-hash from fresh-verified-by-mtime+size-only (the file was not read), and names content-changed, deleted-from-disk, unreadable and unindexed separately, because those need different fixes and a single 'N stale' number is not actionable. Every report also carries a top-level `healthy` boolean. Use verbose=true for a per-language breakdown, PER-LANGUAGE SEARCHABILITY (the share of each language's symbols a semantic query can reach — a language at 0% is invisible to bb_ask), the embedded/unembedded symbol kinds, and stale-file names; refresh=true to reindex before reporting; force=true to force a full in-place reindex (this WIPES the index before rebuilding it); integrity=true for the index integrity check battery, which NAMES each non-ok check with its remediation rather than only a score; freshness="complete" (not a `complete` option) to check every indexed file instead of a sample; includeAnalysisRuns=true for persisted run/finding totals; history=true for persisted analysis history. Freshness defaults to a DETERMINISTIC sample spread across the whole index: `stale` is then a lower bound on the project, not a total, and the report says so — pass freshness="complete" when you need the exact count.

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
      "description": "include stale/missing file names and the embedded/unembedded symbol kinds (default false)"
    },
    "history": {
      "type": "boolean",
      "description": "return persisted analysis history (default false). CHANGES THE OUTPUT SHAPE: this mode answers with a JSON object { health, history } instead of the text report, so a caller must not parse the text form when asking for it. Every other option still applies, and the result carries the same top-level `healthy` boolean as the text form (false when the report contains an error-severity finding)"
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
      "description": "force a full in-place reindex before reporting — DESTRUCTIVE: the index is wiped before it is rebuilt, so a failure leaves it empty"
    },
    "wait": {
      "type": "boolean",
      "description": "wait for refresh to finish (default true); wait=false detaches it and the NEXT call reports whether it completed"
    },
    "freshness": {
      "type": "string",
      "enum": [
        "sampled",
        "complete"
      ],
      "description": "freshness mode (default sampled — a deterministic, unbiased sample spread over every indexed file, NOT the first N)"
    },
    "sampleSize": {
      "type": "number",
      "description": "freshness sample count (default 200); must be >= 1"
    },
    "integrity": {
      "type": "boolean",
      "description": "run the index integrity check battery"
    },
    "includeAnalysisRuns": {
      "type": "boolean",
      "description": "include persisted analysis run/finding totals"
    },
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "report the state of these project-relative files INSTEAD of a project-wide freshness answer — for the question an agent actually has after an edit, at O(files named) rather than O(project). At most 50. The answer is a SEPARATE self-describing block, so every other number in the report stays project-wide and the two can never be read as one. Each path is FIVE-state, not a boolean: fresh (indexed, on disk, unchanged), stale (content changed), gone (indexed but deleted from disk), NOT-INDEXED (on disk, the indexer has not run since it appeared — a freshness verdict here would be meaningless), or absent (no such path). Paths that resolve outside the project, or through a symlink out of it, are REFUSED and reported as unchecked rather than answered"
    },
    "checkUnindexed": {
      "type": "boolean",
      "description": "WALK the project and report files on disk that the indexer would index but the index does NOT contain — the direction freshness cannot see (freshness reports files IN the index and gone from disk). Costs a stat per eligible file, i.e. the discovery phase of an index run, so it is opt-in. Uses the INDEXER'S OWN discovery rules, so gitignored files, node_modules, unsupported extensions and >5MB files are correctly NOT counted, and the output names that population. Without this option, index completeness is not asserted at all"
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
