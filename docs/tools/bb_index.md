# `bb_index`

Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). Returns indexed/deleted/error counts.

## Contract

- Category: `operations`
- Mutability: `write`
- Requires index: `false`
- Modes: `auto`, `file`, `dir`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"mode":"auto"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "mode": {
      "type": "string",
      "enum": [
        "auto",
        "file",
        "dir"
      ]
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

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
