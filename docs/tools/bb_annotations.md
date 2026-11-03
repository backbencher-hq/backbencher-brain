<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_annotations: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_annotations through any MCP host, the CLI (`bb tool bb_annotations`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_annotations/descriptor.ts, src/mcp/tools/bb_annotations/handler.ts, script/tool-docs/curation/bb_annotations.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_annotations --write`.
-->
# `bb_annotations`

Read annotations for a symbol, one file's copy of a symbol (optional `path`), or all annotations up to the declared limit, with full provenance on every row: author class, tool identity, and timestamps. Every answer declares its bound: `count` is the page size, `totalCountIfKnown` the true total, and `truncated`/`truncationReason` fire when the limit actually dropped rows — a short page is never mistaken for a complete one, and at the declared cap the reason names narrowing the filter instead of an impossible limit raise. A `symbol` matches notes written under either name form the index publishes — the symbol's simple name AND its qualified name — the same pair the editor hover matches, so a note written as `render` is found by `Widget.render` and the other way round. A `path` is resolved to the index's own spelling before filtering. A project with no store yet is a declared absence; this read creates nothing. To write a note use bb_annotate.

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
      "description": "symbol name, simple name or qualified name; both forms resolve to the same notes. Omit to read the whole project. `target`/`query` are accepted as aliases"
    },
    "path": {
      "type": "string",
      "description": "optional file path; resolved to the index's own spelling first, so `src/a.ts`, `./src/a.ts` and the absolute path are the same filter. A path without a symbol returns that file's own notes only — pass `includeNameLevel` for the project's name-level notes as well. Combined with a symbol, it returns that file's copy of the symbol plus name-level notes about that symbol. Omit to read every file for the symbol"
    },
    "limit": {
      "type": "number",
      "description": "max rows returned (default 50, min 1, max 200); a truncated answer states the true total and a reason",
      "default": 50,
      "minimum": 1,
      "maximum": 200
    },
    "includeNameLevel": {
      "type": "boolean",
      "description": "with `path` and no `symbol`, also return name-level notes (written with no path), which apply wherever their name appears. Off by default, so a path filter answers the question as asked rather than mixing in the whole project. With a symbol present the flag has no effect: name-level notes about that symbol always apply"
    }
  },
  "required": []
}
```

## Returns

- Typed annotations for a symbol, a file, or the whole project, with full provenance on every row (author class, tool identity, timestamps)
- `count` (the page size), `totalCountIfKnown` (the true number of matching annotations) and `truncated` with a `truncationReason` naming an action the caller can take — at the declared cap the reason asks for a narrower filter instead of a limit raise it cannot honour
- `includeNameLevel` echoes the accepted flag and `nameLevelIncluded` states the filter actually applied (a symbol request always includes name-level notes about that symbol)
- `symbolIndexed` says whether the requested spelling named an indexed symbol; a spelling the index does not publish falls back to the literal stored name, so a note written under an arbitrary name is still findable
- `storeAbsent` is true when the project has no annotation store yet: the answer is a declared absence and the read created nothing
- Declared-absent result when none exist — absence is never an error

## Examples

`{"symbol":"handleRequest","path":"src/server.ts"}`

`{"symbol":"Widget.render"}`

`{"includeNameLevel":true,"path":"src/index.ts"}`

## Errors

- limit outside the declared 1-200 range (0, negative, above 200, fractional, or not a number) is refused with the rule named
- an option the tool does not accept is refused with the accepted option set named, and a conflicting alias/canonical pair is refused rather than silently resolved

## Limitations

- Reads only stored annotations, and does not create, migrate or repair the store while reading; absence is declared, not inferred
- Without `path`, a symbol that lives in several files returns every file's notes together; pass `path` (or read each row's `symbol_path`) to separate them
- A `symbol` resolves to the simple name AND the qualified name of every symbol it names, the same pair the editor hover matches, so a note written under either form is found from either spelling. This is the editor's predicate, not a prose promise
- A `path` is resolved to the index's own spelling before filtering, so a reader passing `./src/a.ts` finds the note a writer stored as `src/a.ts`; a path the index does not know is used as given
- A `path` filter WITHOUT a `symbol` returns that file's own notes only and excludes the project's name-level notes by default; pass `includeNameLevel: true` for the broader set. With a `symbol` AND a `path`, name-level notes about THAT symbol are always included
- The registry declares one nominal action name for the store (`annotate`); the tool takes no `mode` option — every call is a read and a request carrying `mode` is refused as an unknown option

## Performance

A symbol read and its declared total are indexed lookups by project and symbol name (`brain_annotation_location_idx`; the earlier `brain_annotation_project_symbol_idx` is superseded by it). The project-wide shapes seek by project and then sort the matched rows (`ORDER BY time_updated DESC, id`), and a path-only read scans the project's annotation rows because the store has no index on `symbol_path` — the cost is proportional to the number of notes in the project, not to the number of files. On a 206-note fixture the path scan measures 0.14 ms and the project-wide page 0.34 ms.

## Safety

Read-only, measured: the store is opened byte-read-only, so a read does not create a database for an unindexed project, does not recreate a missing annotation table in a legacy store, and does not move the write-ahead log. It does not modify source files, index data, or annotations.

## Evidence Semantics

Rows come from brain_annotation with provenance fields preserved.

## Relationship to other tools

To write a note use `bb_annotate`; this tool reads stored annotations, declares absence, and opens the store without writing it.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
