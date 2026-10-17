# Unified Editing (M9.13)

`bb_edit` is the canonical mutation tool. Its required discriminator is
`mode`: `write`, `update`, `insert`, `delete`, `refactor`, or `batch`. The legacy
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
created safely. Existing files are replaced atomically — with one guard, because
this is the tool's only capability where a single wrong parameter destroys
content:

- **Omitted `overwrite`** replaces the file, but a replacement that removes
  **at least half** of a file's lines **and at least 5 lines** is refused as a
  probable mistake (a body fragment sent to `write` instead of `update`, or the
  wrong `filePath`). The refusal names the file, both line counts, the share that
  would be lost, and both ways forward.
- **`overwrite: true`** replaces it whatever the size — the acknowledgement for a
  deliberate whole-file rewrite.
- **`overwrite: false`** is create-only: an existing file is refused instead of
  replaced.

The refusal happens at PLAN time, so `dryRun: true` reports the same refusal the
real call would: a preview that says `ok` about a write the commit then refuses
would be a preview of a different call.

### `update`

Required: `symbolName`, plus `newContent` (or its alias `content`). Optional
`filePath` and `lineStart` disambiguate overloaded/same-name symbols.

`newContent` is read as either the symbol's **full declaration** or a **body
fragment**, and which one it is is decided by parsing it, not by matching a
keyword: the fragment's own declarations are read from each declaration node's
`name` field, and if one of them declares `symbolName` outside a nested
statement body, `newContent` is a declaration and replaces the symbol's
declaration. Otherwise it is a fragment and replaces the body block, keeping the
declaration and signature; if there is no brace body to splice (an
expression-bodied declaration), the edit is refused with that diagnostic rather
than guessed at. A method fragment (`target(): number { … }`) is recognised by
re-parsing it inside a class wrapper, because it is a valid method but not a
valid statement.

The replaced range is the **declaration**, which can be wider than the indexed
byte span: where the index records a symbol from its name (Java methods, Kotlin
functions), the span is widened to the declaration on the parse's evidence — so
changing a return type is part of the update, and the prefix is never
duplicated.

### `insert`

Required: `targetSymbolName`, plus `newContent` (or its alias `content`).
`position` is optional and defaults to `after`; the accepted positions are
`before`, `after`, `inside-top`, and `inside-bottom`. Optional `filePath` and
`lineStart` disambiguate same-name targets.

### `delete`

Required: `symbolName`. Optional `filePath` and `lineStart` disambiguate
same-name symbols. Import cleanup runs after deletion. Caller protection
is enabled by default; `force` bypasses the block explicitly. Regardless of
`force`, any reference sites that survive the deletion (e.g. a `private :name`
or `alias` line) are reported in `warnings` — never silently left behind.

### `refactor`

Required: `symbolName`, `newName`. The declaration name is renamed, and then
**every reference occurrence of the name in the declaration file** that the AST
classifier marks as a reference (not a binding, not a member/property key, not
inside a same-name shadow scope) is renamed with it. This is independent of
whether the index recorded an edge for the symbol — completeness does not
silently degrade when the analyzer missed a relationship.

### `batch`

Required: `edits` — a non-empty list of edits, each a complete request in one of
the five single-file modes. Optional `files` turns the list into a **fan-out**:
each entry applies once per listed path, which is the "one edit across many
files" shape (`files` supplies the `filePath` of every entry, so an entry must
not name its own). `dryRun` and `format` belong to the call as a whole.

The point of the mode is what happens **once** instead of N times: every entry is
planned into one plan, the plan→commit pre-image check reads every target before
the first write, and formatting, validation and reindexing each run one time for
the whole call. A refusal anywhere in planning writes nothing; a failure after the
writes rolls every committed file back to its exact bytes and mode.

```json
{"mode":"batch","edits":[{"mode":"update","symbolName":"helper","newContent":"export function helper() { return 2 }"},{"mode":"delete","symbolName":"oldFlag"}]}
```

```json
{"mode":"batch","edits":[{"mode":"insert","targetSymbolName":"init","position":"inside-top","newContent":"const started = true"}],"files":["src/a.ts","src/b.ts"]}
```

Cross-file reach is built on two independent sources, because neither is
complete on its own:

- **index caller edges**, whose spans make the rename precise when the call site
  sits inside an indexed symbol; and
- **`brain_import`**, for every file that imports the declaration module and names
  this symbol, which is the only index row that carries the importing FILE (a
  `calls` row has no file column, and its source symbol is NULL for any call
  outside an indexed symbol — a module-top-level call). The import specifier is
  rewritten in that file, and when the import binds the symbol under its own name
  the file's reference sites are renamed with it. An **aliased** import
  (`import { target as t }`) rewrites only the specifier: `t` is the caller's
  chosen local name and is left alone.

Two refusals keep the result honest, both by name and with the affected sites:

- a plan that would leave a reference it has **evidence about** unrenamed is
  refused rather than reported as a complete rename; and
- a refactor that resolves **zero** sites is refused. A rename that covers nothing
  is a failure, not a result — this is the shape a grammar with no identifier
  reference produces (a YAML mapping key, a Makefile rule target, and any Erlang
  symbol, whose grammar exposes no occurrence for the name at all).

The tool reports `summary.renamedSites` and `summary.renamedFiles` so callers can
audit the exact reach.

## Which Modes Need an Index

`requiresIndex` is a tool-level boolean and this tool's answer is per **mode**, so
the registry carries the split itself (`indexFreeModes: ["write"]`) instead of the
server keeping a second list beside it.

| mode | needs an index | what it resolves |
|---|---|---|
| `write` | **no** | the request's `content`/`newContent` and the bytes on disk; it reindexes the file it wrote |
| `update` | yes | `symbolName` (+ `filePath`/`lineStart`) through the indexed AST bytes |
| `insert` | yes | `targetSymbolName` (+ `filePath`/`lineStart`) |
| `delete` | yes | `symbolName` (+ `filePath`/`lineStart`) |
| `refactor` | yes | `symbolName` plus the stored caller/import evidence for the rename |

A project the indexer has never run over is therefore editable: `write` creates
the first file and, reporting `reindexed: true`, leaves rows behind that the next
call's symbol modes can resolve — the bootstrap path. Before this was true, the
MCP server refused **every** mode with `No index found … Run: bb index …`
(measured on all five), and it returned that refusal without `isError`, so a
client branching on the flag read a write tool's refusal as a success. The
refusal is now mode-aware and is an error: it names the reindex command and the
modes that still work.

On the engine path — the CLI door (`bb tool bb_edit`), which does not gate on
`requiresIndex`, and any caller of the handler — the two causes are told apart
instead of sharing one sentence. A name that is genuinely absent from a real
index is still `symbol <name> not found or has no byte bounds`; an unindexed
project says so and names the remedy (`this project has no index (0 files
indexed), so the name cannot be found in it — index it first: bb index …`).
The old text was the second sentence for both, and on an unindexed project it is
plainly false: the symbol is on disk, and nothing could have found it.

## Per-Mode Arguments

Each mode accepts a fixed set; an option the mode cannot honor is **refused**,
never silently ignored:

| mode | accepted options |
|---|---|
| `write` | `mode`, `dryRun`, `filePath`, `content`, `newContent`, `format`, `overwrite` |
| `update` | `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `content`, `newContent`, `format` |
| `insert` | `mode`, `dryRun`, `filePath`, `targetSymbolName`, `position`, `lineStart`, `content`, `newContent`, `format` |
| `delete` | `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `force`, `format` |
| `refactor` | `mode`, `dryRun`, `filePath`, `symbolName`, `lineStart`, `newName`, `format` |
| `batch` | `mode`, `dryRun`, `edits`, `files`, `format` |

`content` is taken wherever `newContent` is (the two are one value under two
names); `dryRun` and `format` apply to every mode; `overwrite` belongs to
`write` alone, which is the only mode that replaces a whole file. `batch` accepts
no per-file option at the top level: `filePath`, `symbolName`, `content` and the
rest are the **entries'** business, and a batch that carries one is refused rather
than having it silently ignored. Each entry is validated by the same per-mode rule
as the single call it mirrors, and an entry's rejection carries its index
(`bb_edit batch entry 2: update mode does not accept: position`). A rejection names the
offending options **and** the set the mode does accept, and when an option belongs
to exactly one other mode it says which:

```
bb_edit update mode does not accept: position (position is accepted for insert) — accepted for update: mode, dryRun, filePath, symbolName, lineStart, content, newContent, format
```

The sets above are not transcribed from the docs: they are
`EDIT_OPTIONS_BY_MODE` in `src/mcp/tool-validation.ts`, which is what the
rejection builds its message from, what the generated page renders, and what the
M13 boundary gate pins in both directions (accepted options never trigger the
rejection; every other schema option always does).

## Batch: One Plan, One Cycle, One Envelope

A batch is not N edits run in a row; it is one edit operation over N targets.

- **One plan.** Every entry is planned before anything is written. A refusal in
  any entry — an unresolvable symbol, a `write` the overwrite guard turns back —
  means the call writes nothing at all, and the refusal names the entry that
  failed and the file it was aimed at.
- **One pre-image check.** The hashes the plan recorded are compared against the
  bytes on disk for **every** target, immediately before the first write. A target
  that moved refuses the whole batch, including the entries whose own plan was
  fine, because a half-applied batch is the one failure a rollback cannot express:
  there is nothing to roll back to when the file moved out from under the plan.
- **One cycle.** Formatting, validation and reindexing each run once for the call:
  the answer carries a single `formatting` array with one entry per target and a
  single `derived` block, where N separate calls carry N of each.
- **One envelope.**

### The per-file envelope

Every answer — and every refusal — carries `envelope`, the per-file outcome of the
call, because "is my working tree back?" is a per-file question that one boolean
cannot answer:

```json
{
  "atomic": true,
  "committed": 3,
  "restored": 3,
  "failed": [],
  "entries": [
    {"path":"src/a.ts","entry":2,"mode":"update","planned":true,"committed":true,"restored":true,"bytesBefore":812,"bytesAfter":812}
  ]
}
```

`entry` is the index of the `edits` element that planned the file, so a caller can
map a reported failure back onto their own request. `bytesBefore` is the size the
plan measured; `bytesAfter` is measured on disk when the call ends, so a
successful rollback shows the size back where it started rather than a claim that
it is. `failed` names any file a restore could **not** put back, with the reason —
an empty list is the ordinary case, and a non-empty one is the only situation in
which the working tree is not in its pre-edit state (the same event the handler
reports as `rolledBack: false`).

### Two entries, one file

Refused, by entry index, naming the file:

```
bb_edit wrote nothing: batch entries 0 and 1 both resolve to src/a.ts — each entry is planned from the file's pre-edit bytes, so applying both would discard one of them. Edit that file in one entry, or make a second bb_edit call after this one.
```

Both entries are planned against the same pre-edit bytes, so the second write
would replace the first entry's change with its own — the silent lost update the
refusal exists to prevent. Composition is two sequential calls, which is also what
makes each one's plan read what the previous one wrote.

### The entry cap

One batch plans at most **200** edits, counted after fan-out (`edits` × `files`).
It is a capability bound rather than a safety judgement: one plan, one formatting
pass, one validation pass and one reindex hold every target at once, and the
answer carries each target's before/after text. A request over the cap is refused
by the number, before anything is planned, so a caller meets a limit rather than a
timeout.

### An index is needed

The server's index gate is per **mode**, and `batch` is not exempt the way `write`
is. A batch of `write` entries would in fact run without an index, but the mode
cannot promise of a list what a single entry's plan proves, so the gate is
conservative: the refusal names `write` as the mode that still works, and the
bootstrap path is one `write` call followed by the batch.

## Plan to Commit: the Pre-Image Check

Planning and writing are two reads of the same file with a window between them.
The plan reads each target's bytes, resolves spans from them, and returns the
`after` text; the commit writes that text. Until recently nothing re-checked the
file in between, so a file that changed in the window — an editor saving the
declaration file while a multi-file `refactor` walks it — was overwritten from a
plan computed against its previous contents, silently, because the committed
bytes come from the plan and not from disk.

Every target's **sha256 is now taken as the plan reads it**, and the bytes the
commit is about to replace (the same bytes a rollback would restore) are compared
against those hashes immediately **before the first write of the batch**. A
mismatch refuses the whole edit and says nothing was written:

```
bb_edit wrote nothing: 1 target file(s) changed on disk between planning and committing — src/a.ts (planned 3f2a1b0c9d4e, now c81de0a17b52). The edit was planned from those bytes, so applying it now would overwrite content it never read; re-run the edit to re-plan against the current file.
```

A path the plan intended to **create** (no hash recorded) must still not exist:
a file that appeared there in the window is the same surprise in the opposite
direction, and it is refused the same way (`planned no file at that path, now
…`). The check runs for the whole batch before anything is written, because a
half-applied batch is the one failure its rollback envelope cannot express —
there is nothing to roll back to when the file moved out from under the plan.

## Dry Run and Recovery

Set `dryRun: true` for every mode to receive exact `{path,before,after}` planned
changes. Dry runs do not format, validate, write, or reindex. Normal edits write
temporary files and atomically rename them, then format (unless `format:false`),
validate with the AST parser, and reindex every changed file. If validation or
reindexing fails, all changed files are restored from snapshots; a **formatter**
failure does not discard the edit — formatting is best-effort and its outcome is
reported (see below), not enforced.

### What `formatted` means

`formatted` is a **measurement, not an echo of the request**. It is `true` only
when every changed file was handed to the formatter its extension maps to and that
process **exited 0**. `format:false`, a dry run, an extension with no mapping, a
formatter that is not installed, a non-zero exit, and the 1.5s timeout all leave it
`false` — each of those used to return `true`, because the field restated
`request.format` and the formatter step's own outcome was discarded.

Every response that requested formatting carries `formatting`, one entry per
changed file, so the outcome can be audited rather than assumed:

```json
{
  "formatted": false,
  "formatting": [
    {"path":"src/a.ts","formatter":"prettier","ran":true,"ok":true},
    {"path":"src/b.rb","formatter":null,"ran":false,"ok":false,"reason":"no formatter mapped for .rb"},
    {"path":"src/c.ts","formatter":"prettier","ran":true,"ok":false,"reason":"prettier exited 3: <first stderr line>"}
  ]
}
```

A formatter that **ran and failed** (non-zero exit, or killed at the 1.5s budget)
also adds a `format: <path>: <reason>` warning. "No mapping" and "not installed"
are reported in `formatting` only: they are facts about the machine, not anomalies,
and warning on them would fire on every edit in a repository without a formatter.

Mapping: `.ts .tsx .js .jsx .json .html .css .md` → `prettier --write` (with
`--end-of-line crlf` on a CRLF file, so a formatter never rewrites the file's line
endings); `.rs` → `rustfmt`; `.go` → `gofmt -w`; `.c .cpp .h .hpp` →
`clang-format -i`; `.py` → `black`, falling back to `ruff format`. The binary is
resolved from the nearest `node_modules/.bin` walking up from the edited file, then
from `PATH`, and it is invoked with `execFile` — an argv array, no shell — so a file
**name** is never interpreted (a name like `inj$(touch pwned).ts` used to execute
`touch pwned` through the old command string).

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
safety. `script/m13/verify-edit-unit.ts` (E7) covers the formatter contract
measured above — no mapping, success with its own output bytes, a non-zero exit, a
hang killed at the budget, no formatter installed (PATH-scrubbed), `format:false`,
dry run, the multi-file aggregate, and a file NAME that must not execute.
