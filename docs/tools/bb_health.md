<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_health: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_health through any MCP host, the CLI (`bb tool bb_health`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_health/descriptor.ts, src/mcp/tools/bb_health/handler.ts, script/tool-docs/curation/bb_health.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_health --write`.
-->
# `bb_health`

Unified index health: file/symbol/relationship/imports counts, embedding model + coverage, schema version, runtime, file freshness, what this call cost, and (when asked) the integrity battery, analysis-history totals and index completeness. There is no `mode` parameter: a call reports status, and `refresh`/`force` select the one behaviour that mutates the index. The default output names WHY each file was classified: `freshness why` separates fresh-verified-by-content-hash from fresh-verified-by-mtime+size-only (the file was not read), and names content-changed, deleted-from-disk, unreadable and unindexed separately, because those need different fixes and a single 'N stale' number is not actionable. Every report carries a top-level `healthy` boolean on the tool result (and inside the JSON payload when history=true): false exactly when the report contains an error-severity finding; a broken index is a successful REPORT, not a tool error (isError stays false), while wrong input is refused with isError. Options the chosen call cannot honour are refused: `limit` needs history=true; `wait` needs refresh/force; `sampleSize` belongs to sampled freshness only. Use verbose=true for a per-language breakdown, PER-LANGUAGE SEARCHABILITY (the share of each language's symbols a semantic query can reach — a language at 0% is invisible to bb_ask), the embedded/unembedded symbol kinds and stale-file names; verbose=true is also the only call that runs the per-symbol embedding aggregates, so a default call is bounded by the file count, not the symbol count. integrity=true runs the index integrity check battery, which NAMES each non-ok check with its remediation; with the default sampled freshness the battery falls back to a COMPLETE disk pass over the indexed files (it content-hashes files whose metadata changed), so it is materially more expensive than a status call. freshness="complete" (not a `complete` option) checks every indexed file instead of a sample; includeAnalysisRuns=true adds persisted run/finding totals; history=true answers with a JSON object { health, history, healthy } instead of the text report and is the only caller of `limit` (minimum 1, default 20). checkUnindexed=true walks the project and reports files the indexer would index but the index does not contain — a stat per eligible file, opt-in because a default call must not silently acquire a walk. refresh=true reindexes before reporting (`wait` defaults true; wait=false detaches it and the NEXT call reports the outcome once, success or failure); force=true wipes and rebuilds first and is DESTRUCTIVE. Freshness defaults to a DETERMINISTIC sample spread across the whole index: `stale` is then a lower bound on the project, not a total, and the report says so — pass freshness="complete" when you need the exact count.

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
      "description": "include the per-language breakdown, per-language searchability, embedded/unembedded symbol kinds, embedding config/chain and stale/missing file names (default false). This is the only value that runs the per-symbol embedding aggregates; a default call skips them so it stays bounded by the file count"
    },
    "history": {
      "type": "boolean",
      "description": "return persisted analysis history (default false). CHANGES THE OUTPUT SHAPE: this mode answers with a JSON object { health, history, healthy } instead of the text report, so a caller must not parse the text form when asking for it; the result also carries the same top-level `healthy` boolean as the text form"
    },
    "limit": {
      "type": "number",
      "description": "analysis-history page size (default 20); must be a whole number >= 1 and is only read when history=true — supplying it without history is REFUSED"
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
      "description": "applies to refresh/force only (default true; supplying it without refresh/force is REFUSED). wait=false detaches the rebuild and returns the current snapshot; the NEXT call reports the detached outcome once — completion as well as failure"
    },
    "freshness": {
      "type": "string",
      "enum": [
        "sampled",
        "complete"
      ],
      "description": "freshness mode (default sampled — a deterministic, unbiased sample spread over every indexed file, NOT the first N; freshness=\"complete\" checks every indexed file and makes the stale count exact)"
    },
    "sampleSize": {
      "type": "number",
      "description": "freshness sample count (default 200); must be a whole number >= 1 and applies to freshness=\"sampled\" only — supplying it together with freshness=\"complete\" is REFUSED"
    },
    "integrity": {
      "type": "boolean",
      "description": "run the index integrity check battery (14 checks, each named with its remediation when not ok). Cost: with the default sampled freshness the battery performs a COMPLETE disk pass over the indexed files (content-hashing those whose metadata changed), so this is the most expensive opt-in"
    },
    "includeAnalysisRuns": {
      "type": "boolean",
      "description": "add persisted analysis run/finding totals (full-table counts, not a page length)"
    },
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "report the state of these project-relative files INSTEAD of a project-wide freshness answer — for the question an agent actually has after an edit, at O(files named) rather than O(project). At most 50, no duplicates, no blank entries. The answer is a SEPARATE self-describing block, so every other number in the report stays project-wide and the two can never be read as one. Each path is FIVE-state, not a boolean: fresh (indexed, on disk, unchanged), stale (content changed), gone (indexed, no longer readable on disk — `reason` distinguishes file-gone from unreadable), NOT-INDEXED (on disk, the indexer has not run since it appeared — a freshness verdict here would be meaningless), or absent (no such path). Paths that resolve outside the project, or through a symlink out of it, are REFUSED and reported as unchecked rather than answered"
    },
    "checkUnindexed": {
      "type": "boolean",
      "description": "WALK the project and report files on disk that the indexer would index but the index does NOT contain — the direction freshness cannot see (freshness reports files IN the index and gone from disk). Costs a stat per eligible file, i.e. the discovery phase of an index run, so it is opt-in. Uses the INDEXER'S OWN discovery rules, so gitignored files, node_modules, unsupported extensions and >5MB files are correctly NOT counted, and the output names that population. Without this option, index completeness is not asserted at all"
    }
  }
}
```

## Returns

- Counts (files, symbols, relationships, imports, syntax-error files), schema version, runtime, embedding model/coverage and a `freshness` block that states whether it checked a SAMPLE or the whole index
- The freshness reason mix per file (content-changed, deleted, unreadable, unindexed) and, on verbose, the bounded stale/missing file names
- When `paths` is given: a separate five-state block (fresh / stale / gone / not-indexed / absent) for exactly those files, while every other number stays project-wide
- When `checkUnindexed` is given: files on disk the indexer would index but the index does not contain, with the population named
- When `integrity` is given: the integrity checks with their status and remediation, naming each non-ok check rather than only a score
- When `includeAnalysisRuns` is given: persisted run/finding totals as full-table counts; `history` instead answers with JSON `{ health, history, healthy }`
- A `healthy` boolean on the result (and inside the history JSON): false exactly when the report contains an error-severity finding

## Examples

`{"verbose":true}`

`{"history":true,"limit":5}`

`{"refresh":true,"wait":false}`

`{"force":true}`

`{"integrity":true}`

`{"freshness":"complete"}`

`{"includeAnalysisRuns":true}`

`{"paths":["src/mcp/server.ts"]}`

`{"checkUnindexed":true}`

## Errors

- An option the selected behaviour cannot honour: `limit` without `history=true`, `wait` without `refresh`/`force`, `sampleSize` with `freshness="complete"` — each refused with the accepted form named
- Invalid values: unknown `freshness`, `sampleSize` below 1, a non-integer `limit` (and `limit: 0` with `history=true`)
- `paths` problems: an empty list, more than 50 entries, duplicate entries, blank entries, or a path that escapes the project (directly or through a symlink)
- An index that cannot be opened read-only is reported as an EMPTY_INDEX error finding, not as a tool failure: a broken index is a successful report

## Limitations

- Sampled freshness (the default) is a deterministic sample, so `stale` is a LOWER BOUND on the project, not a total; `freshness="complete"` is the exact census
- A `fresh` verdict reached through the mtime+size fast path never read the file: a same-size edit that preserves the mtime reads fresh (the same trade-off as git's stat-cache)
- Embedding coverage reports stored vectors, not semantic quality or retrieval accuracy; verbose=true is what joins it to per-language searchability
- `integrity: true` with the default sampled freshness performs a COMPLETE disk pass over the indexed files, and `checkUnindexed: true` walks the project — both are opt-in precisely because a default call must not acquire them
- The default call does not run the per-symbol embedding aggregates (per-language symbol counts, searchable-by-language, embedded/unembedded kinds, provider chain); those run only for verbose=true, which is what keeps a default answer bounded by file count rather than symbol count
- No `mode` parameter exists: a call reports status, and `refresh`/`force` are the only behaviours selected by flags

## Performance

Measured warm through the MCP door on the campaign checkout: a default call answers in about 0.8 s p50 / 0.9 s p95 on the workspace index (6,452 files / 310,423 symbols / 3.6 GB), and about 2.6 s p50 / 3.3 s p95 on a 1,283,638-symbol copy of that index; the first call after a cold start measured 8.3 s and 25.3 s respectively on those two indexes. The 5-file polyglot fixture measures ~53 ms p50 and the 100-file synthetic fixture ~35 ms p50 through the same code path. `verbose=true` adds the per-symbol embedding aggregates, `integrity=true` adds a complete disk pass, `freshness="complete"` hashes/indexes every file, and `checkUnindexed=true` adds a project walk — all opt-in and declared for that reason.

## Safety

A status call is read-only: the index is opened through the driver's read-only mode, so no migrations, healers or WAL writes run. refresh=true and force=true are the only index mutations and are explicit: refresh reindexes, force WIPES the index before rebuilding and is destructive; wait=false detaches a rebuild and the next call reports its outcome once. `healthy:false` never means the tool failed — the report is the answer.

## Evidence Semantics

Counts, schema version and embedding rows are measured from the brain database; freshness compares indexed metadata with the filesystem and names the reason per file, separating content-verified fresh verdicts from mtime+size fast-path ones; integrity results are computed from stored rows and disk state; sampled answers declare that they are samples. `brain_index_status` counters are labelled when they describe the last index RUN rather than the index itself.

## Relationship to other tools

For index size/counts use `bb index status` (CLI) or the stats surface; this tool reports index health, freshness, completeness and integrity.

## Deep guides

- [Index health and freshness](../BB_HEALTH.md)

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: a top-level `freshness` block on every report (`{ mode, requestedMode, checked, total, fresh, stale, missing, staleFiles, missingFiles, unresolved, isComplete, reasons }`) — `mode` is what was actually CHECKED, `isComplete` is the boolean to branch on before reading `stale` as a project total, `unresolved` is counted as neither fresh nor stale, and `reasons` carries the verdict mix (`{ byKind, freshVerifiedByContent, freshVerifiedByMetadata, isSample }`) so a consumer can tell a content-hash-verified file from an `mtime+size` fast-path one without reading the prose. `paths` answers per-path state for named files; `verbose` adds the stale/missing file NAMES. It does not auto-refresh on a read: the report DESCRIBES the index and a reindex happens only when asked for (`refresh: true` reindexes before reporting, `force: true` wipes and rebuilds first and is destructive, `wait: false` detaches it), so a stale report is a measurement, not a repair. When the report names stale or missing files, repair them with the manual interface: run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only), or pass `paths` to check named files instead of scanning the project. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
