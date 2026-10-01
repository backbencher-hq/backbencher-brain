# `bb_edit`

Unified, validated source mutation. Discriminated by mode: write, update, insert, delete, or refactor. Supports dry-run previews, separator/symlink-safe paths, AST byte bounds, caller protection, rollback on validation failure, formatting, and reindexing. If the target file changed since it was indexed, this tool refreshes that one file and re-resolves the symbol before editing (reported in warnings) — an edit is never applied to stale byte bounds, and a symbol that was renamed or removed is refused by name.

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
      "description": "Name of the symbol to update, delete, or refactor (the index must contain it; a target file changed since indexing is refreshed automatically before the edit)"
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
- Ambiguous symbol name (the message names filePath/lineStart)
- Symbol renamed or removed since the target file was indexed (refreshed first, then refused by name)
- Caller protection, parse, formatting, or reindex failure

## Limitations

- Named symbol edits need an INDEX, not a fresh one: when the target file changed after it was indexed, the tool refreshes that ONE file's rows and re-resolves the symbol before planning, so bounds always come from the bytes on disk and never from a stale span (M59.A11, #890). The refresh is reported in `warnings`; if the symbol was renamed or removed in the meantime the edit is refused by name instead of guessing a span
- Directly after a write, the file's own evidence is current but cross-file relationships are only re-derived within the bounded post-pass, so a caller in an unrelated file may lag until the next dir index (same bound as bb_index)
- Refactoring is identifier-aware static rewriting, not a full language-server proof
- Per-mode argument rejection names the offending fields but not the accepted set for the mode (e.g. `bb_edit update mode does not accept: position` does not say that `update` accepts only `mode, dryRun, filePath, symbolName, lineStart, content/newContent, format`); callers must consult the mode contract in this page when constructing payloads. Known gap in `validateEditArguments` (src/mcp/tool-validation.ts). proof
- Body-fragment updates (`newContent` that is a statement, not a declaration) require a BRACE-bodied language. TypeScript, JavaScript, Go, Rust, Java, C/C++, Swift, Kotlin, Scala and PHP all take this path. In an indentation- or keyword-delimited language — Python, Ruby, YAML — there is no `{ ... }` range to splice and the tool REFUSES rather than guessing; the refusal names the remedy and passing the full declaration then works. Elixir's `do ... end` is likewise refused. Measured across Python (2-space, 4-space and tab indentation), Ruby at two nesting depths, Go, Rust, Java and Elixir.
- A symbol cannot be edited twice in a row unless the first edit's reindex succeeded. Every edit reindexes the file it touched, and a failed reindex leaves the file on disk correct but the index stale, which makes the NEXT edit's freshness check refuse. That refusal names the stale file and the remedy (`bb_index` for that file); it is the tool declining to write to bytes it cannot vouch for, not a lost edit.
- `delete` refuses when the symbol has indexed callers OR when an import or re-export specifier in another file names it, which covers `import { x as alias }` — the analyzer records no call edge there because it never resolved the alias. The specifier is matched by RESOLVING the module path, not by name, so `../models/user` and `./user` are both caught and a same-named module in a different directory is not. It does NOT refuse for a side-effect-only `import './x'`, a namespace import, or a file with a local that merely shares the name, because none of those can dangle. A forced delete always warns and names every surviving specifier and its file.
- KNOWN GAP in `delete`: a tsconfig path alias (`@/models/user`, `~/models/user`) is not caught. The indexer records no import row for a non-relative specifier, so there is nothing to resolve; such a project's only remaining signal is the indexed `calls` edge. A bare package specifier (`react`, `lodash/fp`) is likewise unresolved, correctly, since it cannot be shown to refer to a project file.

## Performance

Only affected files are written, formatted, validated, and reindexed.

## Safety

Write-capable. Uses project-root path checks, atomic writes, snapshots, validation, and rollback; use dryRun before risky edits. dryRun writes no source file, but a stale target file is still refreshed in the INDEX first (derived data only), because the bounds it previews must be the bounds the real edit would use.

## Evidence Semantics

Mutation bounds come from indexed AST bytes, re-resolved from the file on disk whenever the indexed rows are stale; validation and reindex state report whether post-edit evidence is current.

## Relationship to other tools

To attach human-visible notes to symbols use `bb_annotate`; this tool mutates source files.

## Staleness

No freshness flags are returned — this tool does not summarize OTHER files' staleness, and it does not read stale data: a stale TARGET file is refreshed (that file only) and the symbol re-resolved from the bytes on disk before the edit is planned, and the refresh is named in `warnings`. If that change renamed or removed the symbol, the edit is refused by name rather than applied to a stale span. For unrelated files, remediation stays manual: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
