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
      ],
      "description": "Edit kind: write (create or overwrite a file), update (replace a symbol body), insert (add code relative to a symbol), delete (remove a symbol), or refactor (identifier-aware rename)"
    },
    "dryRun": {
      "type": "boolean",
      "description": "Preview the planned changes without writing any file (default false)"
    },
    "filePath": {
      "type": "string",
      "description": "write: project-relative target file to create or overwrite. Other modes: disambiguates symbolName when it appears in multiple files"
    },
    "symbolName": {
      "type": "string",
      "description": "Name of the symbol to update, delete, or refactor (named-symbol edits require a fresh index)"
    },
    "lineStart": {
      "type": "number",
      "description": "Declaration line of the target symbol, used with symbolName/filePath to disambiguate repeated names"
    },
    "content": {
      "type": "string",
      "description": "Full file content for write mode; also accepted in place of newContent for update and insert"
    },
    "newContent": {
      "type": "string",
      "description": "Replacement source: update swaps the symbol body for this text; insert adds this text relative to targetSymbolName"
    },
    "targetSymbolName": {
      "type": "string",
      "description": "insert: symbol whose body or boundary receives the new code (required for insert)"
    },
    "position": {
      "type": "string",
      "enum": [
        "before",
        "after",
        "inside-top",
        "inside-bottom"
      ],
      "description": "insert anchor relative to targetSymbolName (default after)"
    },
    "newName": {
      "type": "string",
      "description": "refactor: the valid identifier the symbol is renamed to"
    },
    "force": {
      "type": "boolean",
      "description": "delete: allow removal when indexed callers or live references survive; leftovers are reported as warnings (default false)"
    },
    "format": {
      "type": "boolean",
      "description": "Run the project formatter on written files after the edit (default true)"
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

## Relationship to other tools

To attach human-visible notes to symbols use `bb_annotate`; this tool mutates source files.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
