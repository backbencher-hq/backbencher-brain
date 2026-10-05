# `bb_index`

Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. The path MUST be inside this project: an absolute path elsewhere, a `../` traversal and a foreign directory are all REFUSED, because an out-of-tree file would be stored with a `relative_path` that is not relative to anything and every scoped query, file name and freshness check for it would then be wrong. The report says what happened rather than only how much: `outcome` is `indexed`, `partial`, `no-op` or `indexed`, and a `no-op` carries a `reason` distinguishing "nothing changed" from "this file holds nothing the indexer extracts"; when errors occurred, `errorDetail` names the file and the message beside the `errors` count. Paths in the report are PROJECT-RELATIVE, so the same request returns the same bytes on any machine. The counts are stable between identical calls; the `ms` fields are measured wall-clock and are expected to vary.

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
      "description": "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project whose derived phases should be re-run. REQUIRED in every mode, and for mode=post it is checked rather than ignored. Must resolve INSIDE the project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused too."
    },
    "mode": {
      "type": "string",
      "enum": [
        "auto",
        "file",
        "dir",
        "post"
      ],
      "description": "auto (default) infers file vs dir from path; file reindexes one file; dir runs an incremental directory index; post re-runs derived phases (relationships/taints/health) without re-parsing"
    }
  },
  "required": [
    "path"
  ]
}
```

## Returns

- Indexed, deleted, error and skipped counts for the refreshed path
- Mode actually applied (auto resolved to file or dir, or the mode named)
- `outcome` — `indexed`, `partial`, or `no-op` — and, for a no-op, a `reason` distinguishing "nothing changed, the file already matches the index" from "this file holds nothing the indexer extracts"
- `errorDetail`: the file and the message for each failure, beside the `errors` count
- For mode=post, the per-phase report (relationships, enrichment, gravity, taint, health, integrity, vectorBlobs, analyze) with its timings

## Examples

`{"path":"src/new-file.ts"}`

`{"path":"src","mode":"dir"}`

`{"path":"post","mode":"post"}`

## Errors

- Missing or blank path
- A path that resolves OUTSIDE the project — an absolute path elsewhere, a `../` traversal, a foreign directory, or a symlink inside the project pointing out of it
- mode=file on a directory, or mode=dir on a file
- mode=post with a path that does not exist — the schema requires `path`, so it is checked rather than ignored
- Another indexer holding the project lock, as a declared refusal

## Limitations

- A file reindex updates only that file's evidence; cross-file relationships refresh on the next full or incremental dir index
- Dir mode reuses the incremental indexer: unchanged files are skipped by design, and a settled tree answers `unchanged: true`
- The COUNTS in a report are stable between identical calls, but the `ms` fields are measured wall-clock and DO vary. Byte-stability is therefore not a property of this tool's answers and a diff of two reports will show timing drift
- A file the indexer declines — a binary, an unsupported type, or one with no extractable symbols — is reported as `skipped` or as a `no-op` with a reason. It is never silently absent, and never counted as a success
- Derived data (relationships, enrichment, gravity, taints, health) is not refreshed by a single-file reindex unless `derived.pass` says it was; `deferred` means it was not, and `mode: post` is the remediation

## Performance

A single file reindex is bounded by that file's parse cost; dir mode is bounded by the changed-file set, and reports how many candidates it found against how many it processed.

## Safety

Write-capable against INDEX data only — it never modifies source files. It will only index paths inside this project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused, and a symlink to a file inside it is allowed.

## Evidence Semantics

Counts come from the real parse/store pipeline. The report's own assertions are checked against the store by fixtures/analyze/index.test.ts, which edits real files and asks the database rather than reading the answer back.

## Relationship to other tools

The CLI twin is `bb index` (same semantics; see docs/MCP_CLI_INDEXER_GUIDE.md). Refresh changed files after agent edits with mode `dir`/`file` or the CLI `--changed`.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
