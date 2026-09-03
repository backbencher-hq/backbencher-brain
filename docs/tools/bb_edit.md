# `bb_edit`

Unified, validated source mutation. Discriminated by mode: write, update, insert, delete, or refactor. Supports dry-run previews, separator/symlink-safe paths, AST byte bounds, caller protection, rollback on validation failure, formatting, and reindexing.

## Contract

- Category: `operations`
- Mutability: `write`
- Requires index: `true`
- Modes: `write`, `update`, `insert`, `delete`, `refactor`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"dryRun":false,"format":true,"force":false}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "write",
        "update",
        "insert",
        "delete",
        "refactor"
      ]
    },
    "dryRun": {
      "type": "boolean"
    },
    "filePath": {
      "type": "string"
    },
    "symbolName": {
      "type": "string"
    },
    "lineStart": {
      "type": "number"
    },
    "content": {
      "type": "string"
    },
    "newContent": {
      "type": "string"
    },
    "targetSymbolName": {
      "type": "string"
    },
    "position": {
      "type": "string",
      "enum": [
        "before",
        "after",
        "inside-top",
        "inside-bottom"
      ]
    },
    "newName": {
      "type": "string"
    },
    "force": {
      "type": "boolean"
    },
    "format": {
      "type": "boolean"
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Structured mutation result or dry-run preview
- Validation, formatting, rollback, and reindex status
- Affected paths and caller protection outcomes

## Examples

`{"mode":"update","symbolName":"helper","newContent":"export function helper() { return 2 }"}`

`{"mode":"insert","targetSymbolName":"main","position":"inside-top","newContent":"const started = true"}`

`{"mode":"write","filePath":"src/new.ts","content":"export const value = 1"}`

## Errors

- Path escape or symlink escape
- Stale or ambiguous indexed symbol bounds
- Caller protection, parse, formatting, or reindex failure

## Limitations

- Named symbol edits require a fresh index
- Refactoring is identifier-aware static rewriting, not a full language-server proof

## Performance

Only affected files are written, formatted, validated, and reindexed.

## Safety

Write-capable. Uses project-root path checks, atomic writes, snapshots, validation, and rollback; use dryRun before risky edits.

## Evidence Semantics

Mutation bounds come from indexed AST bytes; validation and reindex state report whether post-edit evidence is current.

## Staleness

This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
