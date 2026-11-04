<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_index: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_index through any MCP host, the CLI (`bb tool bb_index`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_index/descriptor.ts, src/mcp/tools/bb_index/handler.ts, script/tool-docs/curation/bb_index.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_index --write`.
-->
# `bb_index`

Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. Every mode requires `path`, and it MUST resolve inside this project: an absolute path elsewhere, a `../` traversal, a foreign directory and a symlink inside the project pointing out of it are all REFUSED, because an out-of-tree file would be stored with a `relative_path` that is not relative to anything and every scoped query, file name and freshness check for it would then be wrong. For mode=post the path must additionally NOT be a file: the phases are project-wide, so pass the project root (or a directory inside it). The report says what happened rather than only how much: `outcome` is `indexed`, `partial` or `no-op`; a no-op carries a `reason` that distinguishes "nothing changed: the file already matches the index (mtime, size and sha256 agree)" from "this file holds nothing the indexer extracts", and `unchanged`/`declined`/`skipped` say how many files fell into each case. When errors occurred, `errorDetail` names the file and the message beside the `errors` count, and `walCheckpointed` says whether the write WAL was reclaimed after the run. Paths in the report are PROJECT-RELATIVE, so the same request returns the same bytes on any machine. The counts are stable between identical calls; the `ms` fields are measured wall-clock and are expected to vary.

## Contract

- Category: `operations`
- Mutability: `write`
- Requires index: `false`
- Modes: `auto`, `file`, `dir`, `post`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"mode":"auto"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project root or a directory inside it whose derived phases should be re-run (a file path is refused). REQUIRED in every mode and checked rather than ignored. Must resolve INSIDE the project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused too."
    },
    "mode": {
      "type": "string",
      "enum": [
        "auto",
        "file",
        "dir",
        "post"
      ],
      "description": "auto (default) infers file vs dir from path; file reindexes one file (unchanged files answer no-op instead of being re-parsed); dir runs an incremental directory index; post re-runs derived phases (relationships/taints/health) without re-parsing"
    }
  },
  "required": [
    "path"
  ]
}
```

## Returns

- `indexed`, `deleted`, `errors`, `unchanged`, `declined` and `skipped` counts for the refreshed path
- The mode actually applied (`auto` resolves to `file` or `dir`; `file`/`dir`/`post` are reported as named)
- `outcome` — `indexed`, `partial`, or `no-op`. A no-op also carries `reason`, and the two reasons are different facts: "nothing changed" (mtime, size and sha256 all still match the stored row) versus "this file holds nothing the indexer extracts" (an extension the indexer does not parse)
- `errorDetail`: the file and the message for each failure, beside the `errors` count
- `walCheckpointed`: whether the write-ahead log was reclaimed after the run (a refused checkpoint — another reader holding a snapshot — reports false, never success)
- For mode=dir, `candidates` (files the walk found changed) beside `processed`, so a partial dir index is visible as a count, and `unchanged: true` when the tree is settled
- For mode=post, the per-phase report (relationships, enrichment, gravity, taint, health, integrity, planner stats, vector blobs, analysis) with each phase's timing and outcome, `totalMs`, and the post-run `integrityHealth` score

## Examples

`{"path":"src/new-file.ts"}`

`{"path":"src","mode":"dir"}`

`{"path":".","mode":"post"}`

## Errors

- Missing or blank path
- A path that resolves OUTSIDE the project — an absolute path elsewhere, a `../` traversal, a foreign directory, or a symlink inside the project pointing out of it — for file, dir, auto AND post mode
- mode=post with a path that does not exist, or with a FILE path: the post pass re-derives project-wide phases, so it takes the project root (or a directory inside it)
- mode=file on a directory, or mode=dir on a file
- Unknown mode, or an option this tool does not accept (the refusal names the accepted set)
- Another LIVE indexer holding the project lock; the refusal names the holder's pid, host and start time, and the remedy. A lock whose holder is dead, a lock naming no process once it is older than the grace window, and a foreign-host lock past its 24h expiry are reclaimed automatically

## Limitations

- A file reindex updates only that file's evidence; cross-file relationships are repaired within the bounded post-pass for the touched files (see `derived.pass`), while callers in unrelated files can lag until the next dir or full index
- Dir mode reuses the incremental indexer: unchanged files are skipped by design, a settled tree answers `unchanged: true`, and a file the walk's skip rules exclude is left untouched in the index rather than being treated as deleted — an index row is deleted only when the file is genuinely gone from disk
- File mode's `no-op` is a real no-op: an unchanged file is detected by mtime+size and confirmed by comparing the stored sha256 with the bytes on disk, so a repeated call does not re-parse (and does not pay a parse's latency)
- The COUNTS in a report are stable between identical calls; the `ms` fields are measured wall-clock and DO vary, so a diff of two reports will show timing drift
- Dir mode walks with the indexer's own skip rules; a directory that the indexer excludes from DISCOVERY (build output, dependency trees) is not revisited by an incremental dir walk. The walk's skip list matches discovery's for the names that matter here — `vendor` is indexed, because it is first-party source in Go and in repositories that curate code under src/vendor
- A reindex does not run the full derived pipeline: `derived.pass` is `bounded` for incremental runs, and mode=post is the explicit remedy when derived data looks stale

## Performance

A single-file reindex is bounded by that file's parse cost plus the incremental post-pass; dir mode is bounded by the changed-file set and reports how many candidates it found against how many it processed. A no-op refresh (unchanged file or settled directory) performs no parse at all. Measured on an isolated tiny fixture, a warm file-mode call was 11.8 s when it always re-parsed and 0.0 s–0.1 s as a no-op; the parse path is dominated by worker-pool startup, not the file.

## Safety

Write-capable against INDEX data only — it never modifies source files, and it never deletes an index row for a file that still exists on disk. It will only index paths inside this project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused and a symlink to a file inside it is allowed. Concurrent index runs are refused by the project index lock rather than interleaved.

## Evidence Semantics

Counts come from the real parse/store pipeline. The report's own assertions are checked by the m40 A1/A3 gates (post entry, write-path parity including the delete guard and the unchanged-file no-op), m43 P1 (lock), m22 E1/D3 (agent-fresh), and by real MCP stdio door probes under validation/tools/bb_index/.

## Relationship to other tools

The CLI twin is `bb index`. The MCP path is incremental only: `auto`/`file`/`dir` refresh changed files, `post` re-derives the heavy phases; a full rebuild is the CLI's `bb index --force`. Refresh changed files after agent edits with mode `dir`/`file` or the CLI `--changed`.

## Deep guides

- [Indexing guide: flags, resume, performance, troubleshooting](../indexing/README.md)

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
