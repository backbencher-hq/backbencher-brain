<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_edit: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_edit through any MCP host, the CLI (`bb tool bb_edit`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_edit/descriptor.ts, src/mcp/tools/bb_edit/handler.ts, script/tool-docs/curation/bb_edit.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_edit --write`.
-->
# `bb_edit`

Unified, validated source mutation. Discriminated by mode: write, update, insert, delete, or refactor. Supports dry-run previews, separator/symlink-safe paths, AST byte bounds, caller protection, rollback on validation failure, formatting, and reindexing. If the target file changed since it was indexed, this tool refreshes that one file and re-resolves the symbol before editing (reported in warnings) — an edit is never applied to stale byte bounds, and a symbol that was renamed or removed is refused by name. The bytes each target had when the edit was PLANNED are re-checked immediately before the write, so a file that changed in between (an editor saving during a multi-file refactor, say) is refused with nothing written rather than overwritten from a plan computed against its previous contents. A project with no index is not a dead end: `write` plans from the request and the disk, resolves no symbol, and reindexes the file it wrote (so `reindexed` is how a brand-new project gets its first indexed rows), while `update`, `insert`, `delete` and `refactor` resolve their target through the index and are refused — with the mode that still works named beside the reindex command — until one exists. `write` replacing an existing file is guarded: a replacement that removes at least half of a file's lines (and at least 5 lines) is refused as a probable mistake unless `overwrite: true` is passed, and `overwrite: false` makes the write create-only — the refusal names the file, the line counts and both options. `batch` applies several edits, or one edit across several files, as ONE atomic call: every entry is planned before anything is written (so a refusal anywhere writes nothing), the bytes of EVERY target are re-checked together immediately before the first write, and formatting, validation and reindexing each run ONCE for the whole call. Two entries may not resolve to the same file — each is planned from its file's pre-edit bytes, so the second would discard the first, and that is refused by entry index. Every answer carries a per-file `envelope` (`planned`, `committed`, `restored`, and the pre/post byte counts), and a refused call carries the same envelope on the error, so "is my working tree back?" is answered per file rather than by one boolean. Unlike `write`, `batch` needs an index: the mode cannot promise of a list what a single entry's plan proves.

## Contract

- Category: `operations`
- Mutability: `write`
- Requires index: `true` (except `write`, which needs no index at all: it plans from the request and the disk, resolves no symbol, and reindexes the file it wrote — so it works on a project the indexer has never run over, and that is how such a project gets its first indexed rows)
- Modes: `write`, `update`, `insert`, `delete`, `refactor`, `batch`
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
        "refactor",
        "batch"
      ],
      "description": "Edit kind: write (create or overwrite a file), update (replace a symbol body), insert (add code relative to a symbol), delete (remove a symbol), refactor (identifier-aware rename), or batch (apply several edits, or one edit across several files, as one atomic call)"
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
    },
    "overwrite": {
      "type": "boolean",
      "description": "write only. Omitted: replace the file, but refuse a replacement that removes at least half of a file's lines and at least 5 lines (a probable mistake, such as a body fragment sent to write instead of update). true: replace it whatever the size. false: create-only — refuse when the file already exists."
    },
    "edits": {
      "type": "array",
      "description": "batch only, required there: the edits to apply, each a complete request in one of the five single-file modes (write|update|insert|delete|refactor), e.g. [{mode:'update',symbolName:'helper',newContent:'...'},{mode:'delete',symbolName:'oldFlag'}]. Entries may not set dryRun or format (those belong to the batch, which previews, formats and reindexes once), may not nest a batch, and may not two of them resolve to the same file — each entry is planned from its file's pre-edit bytes, so a second entry on one file would discard the first (refused by entry index).",
      "items": {
        "type": "object",
        "description": "one edit: `mode` (required: write|update|insert|delete|refactor) plus exactly the options THAT mode accepts at the top level — write takes filePath+content/newContent (+overwrite), update takes symbolName+newContent, insert takes targetSymbolName+newContent (+position), delete takes symbolName (+force), refactor takes symbolName+newName; every entry may also take filePath and lineStart to disambiguate. An option the entry's own mode would not accept at the top level is refused here too, by name, so an entry is validated by the same rule as the single-mode call it mirrors."
      }
    },
    "files": {
      "type": "array",
      "description": "batch only: the fan-out form — each entry applies once per listed project-relative path, and `files` supplies the filePath of every entry (so an entry with `files` must not name its own). Omit it to let each entry name its own target. The list may not repeat a path.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Structured mutation result or dry-run preview
- Validation, rollback, and reindex status, plus the measured per-file formatter outcome (`formatting`)
- Affected paths and caller protection outcomes
- `envelope` — the per-file outcome of the call (`planned`, `committed`, `restored`, the pre/post byte counts, and any restore that FAILED with its reason), on the answer and on a refusal alike, so `batch`'s per-file question is answered per file
- `batch` (batch only) — one row per `edits` entry with the mode it ran and the files it reached

## Examples

`{"mode":"update","symbolName":"helper","newContent":"export function helper() { return 2 }"}`

`{"mode":"insert","targetSymbolName":"main","position":"inside-top","newContent":"const started = true"}`

`{"mode":"write","filePath":"src/new.ts","content":"export const value = 1"}`

## Errors

- Path escape or symlink escape
- Ambiguous symbol name (the message names filePath/lineStart)
- Symbol renamed or removed since the target file was indexed (refreshed first, then refused by name)
- Symbol renamed or removed since the target file was indexed (refreshed first, then refused by name)
- `update`, `insert`, `delete` or `refactor` on a project with NO index — the refusal names the reindex command and says that `write` still works, because the symbol modes resolve their target through the index and `write` resolves none
- Caller protection, parse, or reindex failure — a FORMATTER failure is not an error: the edit stands and the outcome is reported per file in `formatting` with `formatted: false`
- `batch`: an empty or missing `edits`, an entry with no mode or with an option its own mode does not accept (the refusal names the entry index), a per-entry `dryRun`/`format` (they belong to the call), an entry that names its own `filePath` while `files` supplies the targets, a repeated path in `files`, two entries that resolve to ONE file, or more than 200 planned edits — each refused with the run's own reason and nothing written

## Limitations

- Named symbol edits need an INDEX, not a fresh one: when the target file changed after it was indexed, the tool refreshes that ONE file's rows and re-resolves the symbol before planning, so bounds always come from the bytes on disk and never from a stale span (M59.A11, #890). The refresh is reported in `warnings`; if the symbol was renamed or removed in the meantime the edit is refused by name instead of guessing a span
- Directly after a write, the file's own evidence is current but cross-file relationships are only re-derived within the bounded post-pass, so a caller in an unrelated file may lag until the next dir index (same bound as bb_index)
- Refactoring is identifier-aware static rewriting, not a full language-server proof
- Per-mode arguments are enforced in BOTH directions and the accepted set is named, so a rejection can be acted on: `bb_edit update mode does not accept: position (position is accepted for insert) — accepted for update: mode, dryRun, filePath, symbolName, lineStart, content, newContent, format`. An option this mode cannot honor is REFUSED, never silently ignored, and an option that belongs to exactly one other mode says which one. The mode contract: `write` → `mode`, `dryRun`, `filePath`, `content`, `newContent`, `format`, `overwrite`; `update` → `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `content`, `newContent`, `format`; `insert` → `mode`, `dryRun`, `filePath`, `targetSymbolName`, `position`, `lineStart`, `content`, `newContent`, `format`; `delete` → `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `force`, `format`; `refactor` → `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `newName`, `format`; `batch` → `mode`, `dryRun`, `edits`, `files`, `format`.
- Body-fragment updates (`newContent` that is a statement, not a declaration) require a BRACE-bodied language. TypeScript, JavaScript, Go, Rust, Java, C/C++, Swift, Kotlin, Scala and PHP all take this path. In an indentation- or keyword-delimited language — Python, Ruby, YAML — there is no `{ ... }` range to splice and the tool REFUSES rather than guessing; the refusal names the remedy and passing the full declaration then works. Elixir's `do ... end` is likewise refused. Measured across Python (2-space, 4-space and tab indentation), Ruby at two nesting depths, Go, Rust, Java and Elixir.
- A symbol cannot be edited twice in a row unless the first edit's reindex succeeded. Every edit reindexes the file it touched, and a failed reindex leaves the file on disk correct but the index stale, which makes the NEXT edit's freshness check refuse. That refusal names the stale file and the remedy (`bb_index` for that file); it is the tool declining to write to bytes it cannot vouch for, not a lost edit.
- `delete` refuses when the symbol has indexed callers OR when an import or re-export specifier in another file names it, which covers `import { x as alias }` — the analyzer records no call edge there because it never resolved the alias. The specifier is matched by RESOLVING the module path, not by name, so `../models/user` and `./user` are both caught and a same-named module in a different directory is not. It does NOT refuse for a side-effect-only `import './x'`, a namespace import, or a file with a local that merely shares the name, because none of those can dangle. A forced delete always warns and names every surviving specifier and its file.
- KNOWN GAP in `delete`: a tsconfig path alias (`@/models/user`, `~/models/user`) is not caught. The indexer records no import row for a non-relative specifier, so there is nothing to resolve; such a project's only remaining signal is the indexed `calls` edge. A bare package specifier (`react`, `lodash/fp`) is likewise unresolved, correctly, since it cannot be shown to refer to a project file.
- Formatting is best-effort and MEASURED, never assumed: an extension with no mapping (`.rb`, `.swift`, `.kt`, `.yaml`, …), a formatter that is not installed, a non-zero exit, and the 1.5s timeout all report `formatted: false` with the per-file reason in `formatting`. The tool never installs a formatter and does not read a project's own formatter configuration — it invokes the standard binary for the extension (prettier/rustfmt/gofmt/clang-format/black-or-ruff) that it can resolve from `node_modules/.bin` or `PATH`.
- `write` replacing an existing file is GUARDED rather than free: with `overwrite` omitted, a replacement that removes at least half of the file's lines and at least 5 lines is refused as a probable mistake (a body fragment sent to `write` instead of `update`, or the wrong `filePath`), and the refusal states both line counts, the share that would be lost, and both ways forward. `overwrite: true` replaces it whatever the size; `overwrite: false` is create-only. Measured before the guard existed: a 41-line file replaced by one line, reported `ok`, with nothing in the result distinguishing it from an intentional rewrite (script/m71/probe-edit-review.ts, case H4)
- The pre-image check covers staleness on the WRITE side too, and it is not about the index: every target's sha256 is taken as the plan reads it and compared with the bytes the commit is about to replace, immediately before the first write of the batch. A file that changed in that window — an editor saving during a multi-file refactor — is refused with NOTHING written and both hashes named, rather than overwritten from a plan computed against its previous contents. A path the plan intended to create must still not exist; a file that appeared there is refused the same way.

## Performance

Only affected files are written, formatted, validated, and reindexed. A missing formatter costs no formatter subprocess at all: the binary is resolved first, so nothing is attempted — and nothing is spawned — when there is none to run. `batch` pays each of those steps ONCE for the whole call rather than once per file: N targets in one batch mean one formatting pass, one validation pass and one reindex with N files in them, where the same N edits as N calls would repeat all three. The mode's own bound is 200 planned edits (after fan-out), refused by the number before anything is planned.

## Safety

Write-capable. Uses project-root path checks, atomic writes, snapshots, validation, and rollback; use dryRun before risky edits. dryRun writes no source file, but a stale target file is still refreshed in the INDEX first (derived data only), because the bounds it previews must be the bounds the real edit would use. `write` on an existing file is guarded against the catastrophic case — a replacement that removes at least half of a file's lines and at least 5 lines needs `overwrite: true`, and `overwrite: false` makes the write create-only — and every committed batch re-checks that the bytes it is replacing are the bytes the plan read, refusing with nothing written when they moved. The guard's refusal is raised at PLAN time, so a dry run reports exactly what the real call would. `batch` plans every entry before the first write, so a refusal anywhere is a refusal of the whole call; the pre-image check then reads every target of the call at once — a target that moved refuses all of it, including entries whose own plan was fine; and a failure AFTER the writes restores each committed file and reports what happened in `envelope` rather than in one boolean. Two entries that resolve to one file are refused rather than composed, because both are planned from that file's pre-edit bytes.

## Evidence Semantics

Mutation bounds come from indexed AST bytes, re-resolved from the file on disk whenever the indexed rows are stale; validation and reindex state report whether post-edit evidence is current. The plan's own pre-images are checked against disk immediately before the write, so a plan is applied only to the bytes it was computed from. `write` is the one mode that consumes no indexed row: it takes its bytes from the request and the disk, which is why it is also the one mode usable on a project with no index.

## Relationship to other tools

To attach human-visible notes to symbols use `bb_annotate`; this tool mutates source files.

## Staleness

No freshness flags are returned — this tool does not summarize OTHER files' staleness, and it does not read stale data: a stale TARGET file is refreshed (that file only) and the symbol re-resolved from the bytes on disk before the edit is planned, and the refresh is named in `warnings`. If that change renamed or removed the symbol, the edit is refused by name rather than applied to a stale span. For unrelated files, remediation stays manual: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`.

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
