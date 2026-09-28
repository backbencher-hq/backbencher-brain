# `bb_index`

Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. Returns indexed/deleted/error counts, or the per-phase post-processing report.

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
      "description": "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project whose derived phases should be re-run"
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

- Indexed, deleted, and error counts for the refreshed path
- Mode actually applied (auto resolved, file, or dir)
- Per-file error names for any file that failed to reindex

## Examples

`{"path":"src/new-file.ts"}`

`{"path":"src","mode":"dir"}`

`{"path":"post","mode":"post"}`

## Errors

- Missing path
- Path outside the project root
- Parse or store failure for an individual file

## Limitations

- A file reindex updates only that file's evidence; cross-file relationships refresh on the next full or incremental dir index
- Dir mode reuses the incremental indexer: unchanged files are skipped by design

## Performance

A single file reindex is bounded by that file's parse cost; dir mode is bounded by the changed-file set.

## Safety

Write-capable against index data only. It never modifies source files.

## Evidence Semantics

Counts come from the real parse/store pipeline; errors name the file that failed rather than swallowing it.

## Relationship to other tools

The CLI twin is `bb index` (same semantics; see docs/MCP_CLI_INDEXER_GUIDE.md). Refresh changed files after agent edits with mode `dir`/`file` or the CLI `--changed`.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
