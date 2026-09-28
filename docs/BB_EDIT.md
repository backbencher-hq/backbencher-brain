# Unified Editing (M9.13)

`bb_edit` is the canonical mutation tool. Its required discriminator is
`mode`: `write`, `update`, `insert`, `delete`, or `refactor`. The legacy
`bb_write`, `bb_update`, `bb_insert`, `bb_delete`, and `bb_refactor` names remain
adapters over the same engine.

## Safety

- Paths are resolved with `path.relative`, not string-prefix checks.
- Existing path components are canonicalized with `realpath`; symlink escapes
  are rejected. New nested files are allowed only below the canonical project root.
- Symbol operations require a unique indexed symbol with byte bounds and a fresh
  indexed file hash. Stale bounds fail before any write.
- `insert` body positions use code-aware brace matching, preserving nested braces
  and ignoring strings/comments.
- `delete` checks active `calls`, `instantiates`, `references`, and `uses` edges
  AND performs an AST-level dangling-reference scan of the post-delete file.
  If any reference to the deleted symbol survives, the delete is refused unless
  `force=true` is passed; a forced delete lists every surviving reference in
  `warnings` so it is never silent.
- `refactor` validates the new identifier and renames **every AST-classified
  reference site** of the symbol — the declaration plus all occurrence sites in
  the declaration file where the classifier says the name is used (never
  member names, comments, or string literals). Rename classification is
  position-aware: in `x = target`, `const x = target`, or `{k: target}` the
  value/right side is a reference, only the left/name side binds. Occurrences
  inside a nested scope that re-declares the same name are left alone (shadow
  guard). The response carries `summary` (files/sites renamed) and `warnings`
  — a rename never silently under-reports itself.

## Modes

### `write`

Required: `filePath`, plus `content` or `newContent`. Parent directories are
created safely. Existing files are replaced atomically.

### `update`

Required: `symbolName`, `newContent`. Optional `filePath` and `lineStart`
disambiguate overloaded/same-name symbols. The indexed byte span is replaced.

### `insert`

Required: `targetSymbolName`, `position`, and `newContent`. Positions are
`before`, `after`, `inside-top`, and `inside-bottom`.

### `delete`

Required: `symbolName`. Import cleanup runs after deletion. Caller protection
is enabled by default; `force` bypasses the block explicitly. Regardless of
`force`, any reference sites that survive the deletion (e.g. a `private :name`
or `alias` line) are reported in `warnings` — never silently left behind.

### `refactor`

Required: `symbolName`, `newName`. The declaration name is renamed, and then
**every reference occurrence of the name in the declaration file** that the AST
classifier marks as a reference (not a binding, not a member/property key, not
inside a same-name shadow scope) is renamed with it. This is independent of
whether the index recorded an edge for the symbol — completeness does not
silently degrade when the analyzer missed a relationship. Cross-file caller
files are handled from index caller edges on top of the file-local scan. The
tool reports `summary.renamedSites` so callers can audit the exact reach.

## Dry Run and Recovery

Set `dryRun: true` for every mode to receive exact `{path,before,after}` planned
changes. Dry runs do not format, validate, write, or reindex. Normal edits write
temporary files and atomically rename them, then format (unless `format:false`),
validate with the AST parser, and reindex every changed file. If formatting,
validation, or reindexing fails, all changed files are restored from snapshots.

## Permissions and Failure Semantics

`bb_edit` is a write-mutation tool and is explicitly classified as `mutability:
write` in the MCP registry. The server returns structured error text and does
not expose partial successful changes. Generated test code is never produced.

## Examples

```json
{"mode":"update","symbolName":"helper","filePath":"src/util.ts","newContent":"export function helper() { return 2 }","dryRun":true}
```

```json
{"mode":"insert","targetSymbolName":"main","position":"inside-top","newContent":"const started = true"}
```

```json
{"mode":"delete","symbolName":"obsoleteHelper","force":false}
```

Verification: `script/verify-edit.ts` covers path escapes, sibling prefixes,
symlink escapes, nested writes, dry-run no-write behavior, nested braces,
ambiguity, stale bytes, caller protection, rollback, and rename string/comment
safety.
