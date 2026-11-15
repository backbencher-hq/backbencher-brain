---
name: bb-edit-safety
description: Use when changing source through bb_edit, or reading and writing symbol annotations — dry runs, pre-image checks, batch atomicity, refusals, formatters and reindexing.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_edit", "bb_index", "bb_annotate", "bb_annotations"]
---
# Change code through `bb_edit`, with its guards intact

`bb_edit` is a validated mutation surface: it plans against the index and the disk, checks
pre-images, protects callers, rolls back on a failed check, then reindexes. Use the guards
rather than working around them.

## Modes

`write` (new file or guarded replacement), `update` (replace a symbol body), `insert`
(relative to a symbol), `delete` (remove a symbol), `refactor` (identifier-aware rename),
`batch` (several edits as ONE atomic call). `mode` is required.

## Workflow

1. **Preview first.** `dryRun: true` returns the plan without writing. Read it.
2. **Edit.** Keep `format: true` (default) unless the project has no formatter.
3. **Check the answer's fields**: `planned`/`committed`/`restored` per file, `reindexed`,
   and any warnings. A refused call carries the same envelope — nothing was written.
4. **Refresh derived data if needed.** A file/scoped reindex covers the edited file; after
   a batch, `bb_index` with `mode: "post"` re-derives relationships/graph for the project.

## Refusals are correct outcomes

`delete` refuses when the symbol has indexed callers or is named by an import/re-export;
`update`/`delete` need an index (only `write` does not); a target that changed since the
plan was read is refused rather than overwritten; a `write` replacing a file removes a
large share of its lines only with `overwrite: true`. Report the refusal and its reason —
do not rerun it with a shell `rm`/`sed` to get past the guard.

## Annotations (same skill, adjacent workflow)

- `bb_annotate` attaches an agent note to a symbol: one note per author per location,
  re-annotation updates in place; `path` scopes a note to one file's copy.
- `bb_annotations` reads notes back, by symbol, by file, or the whole store (bounded).
- Use annotations for findings that other agents/runs should read; use code comments only
  when the finding belongs to the source itself.

## Do not

- Do not skip the dry run for `batch` or `refactor`; a multi-file plan read before writing
  is the point of the tool.
- Do not retry a refusal with different arguments that route around the safety check
  (for example `force` on `delete` when callers exist) without telling the user what the
  guard said and why they are overriding it.
- Do not present a committed edit as verified beyond what the answer says: `reindexed`,
  `restored` and per-file envelopes are the evidence.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
