# `bb_annotations`

Read annotations for a symbol, one file's copy of a symbol (optional `path`), or all annotations up to the declared limit, with full provenance on every row: author class, tool identity, and timestamps. Every answer declares its bound: `count` is the page size, `totalCountIfKnown` the true total, and `truncated`/`truncationReason` fire when the limit actually dropped rows — a short page is never mistaken for a complete one. A `symbol` also matches notes written under a symbol's qualified name, the same predicate the editor uses. No annotations is a declared absence, never an error. To write a note use bb_annotate.

## Contract

- Category: `annotations`
- Mutability: `read`
- Requires index: `false`
- Modes: `annotate`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"limit":50}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name (omit to list all annotations); `target`/`query` are accepted as aliases"
    },
    "path": {
      "type": "string",
      "description": "optional file path; resolved to the index's own spelling first, so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. Returns that file's copy's notes plus any name-level notes (written with no path). Omit to return every note for the symbol"
    },
    "limit": {
      "type": "number",
      "description": "max rows returned (default 50, cap 200)"
    },
    "includeNameLevel": {
      "type": "boolean",
      "description": "with `path` and no `symbol`, also return name-level notes (written with no path), which apply wherever their name appears. Off by default, so a path filter answers the question as asked rather than mixing in the whole project"
    }
  },
  "required": []
}
```

## Returns

- Typed annotations for a symbol or the whole project, with full provenance on every row (author class, tool identity, timestamps)
- `count` (the page size), `totalCountIfKnown` (the true number of matching annotations) and `truncated` with a `truncationReason` naming the fix — a bounded read declares its bound, like bb_search and bb_graph. This door used to return only `count`, so a project with 300 notes and the default limit answered a flat `count: 50` with no way to know 250 more existed
- Declared-absent result when none exist — absence is never an error

## Examples

`{"symbol":"handleRequest"}`

`{"limit":100}`

## Errors

- limit outside the declared 1-200 range

## Limitations

- Reads only stored annotations; absence is declared, not inferred
- Annotation store semantics are owned by the M28 workstream
- Without `path`, a symbol that lives in several files returns every file's notes together; pass `path` (or read each row's symbol_path) to separate them
- A `symbol` filter also matches notes written under a symbol's QUALIFIED name, because that is one of the two name forms the editor accepts. This is the same predicate `surfacing` reports, so a reader and the editor always agree on which notes exist
- `path` is resolved to the index's own spelling before filtering, so a reader passing `./src/a.ts` finds the note a writer stored as `src/a.ts`
- A `path` filter WITHOUT a `symbol` returns that file's own notes only. It used to also return every NAME-LEVEL note in the project, because a name-level note does apply wherever its name appears — but that made a narrow question answer mostly-global: measured on a real corpus, a path read returned 2 notes for the file and 48 name-level notes from the whole project, and the file's own notes were nearly cut off by the default limit. Pass `includeNameLevel: true` for the broader set. With a `symbol` AND a `path`, name-level notes about THAT symbol are still included, because they are about the symbol you asked for

## Performance

Indexed lookup by project and symbol (brain_annotation_project_symbol_idx). The declared total is a second COUNT over the same predicate, so `totalCountIfKnown` costs one indexed count.

## Safety

Read-only. It does not modify source files, index data, or annotations.

## Evidence Semantics

Rows come from brain_annotation with provenance fields preserved.

## Relationship to other tools

To write a note use `bb_annotate`; this tool reads stored annotations and declares absence.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
