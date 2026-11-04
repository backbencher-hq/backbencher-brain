<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written guide to bb_annotations: the three read
  shapes, the filter predicates, the declared bounds, and the difference between
  "no notes" and "no store".
WHO IT IS FOR — anyone reading notes back out of the store, and the gates that
  hold this page to the registry and the read-door evidence.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_annotations/descriptor.ts,
  src/mcp/tools/bb_annotations/handler.ts, src/brain/annotations/*,
  validation/tools/bb_annotations/verify-read-door.ts.
-->

# Reading annotations — filters, bounds, and declared absence

`bb_annotations` reads stored annotations for a symbol, for one file's copy of a
symbol, or for the whole project, with full provenance on every row. The tool
takes no `mode` option: every call is one read, and a request carrying `mode` is
refused as an unknown option. The store's mode label is `annotate`.

## Parameters

| Parameter | Type | Meaning |
| --- | --- | --- |
| `symbol` | string | Symbol name: simple or qualified. Both forms resolve to the same notes, the same pair the editor hover matches, so a note written as `render` is found by `Widget.render` and the other way round. Omit to read the whole project. `target` and `query` are accepted spellings. |
| `path` | string | Optional file path, resolved to the index's own spelling first, so `./src/a.ts` finds a note stored as `src/a.ts`. A path WITHOUT a symbol returns that file's own notes only; pass `includeNameLevel` for the broader set. With a symbol present, it selects one file's copy of the symbol. |
| `limit` | number | Maximum rows returned (default 50, min 1, max 200). Out-of-range, fractional or non-number values are refused with the rule named, never clamped. |
| `includeNameLevel` | boolean | With `path` and no `symbol`, also return name-level notes (notes written with no path), which apply wherever their name appears. With a symbol present the flag has no effect: name-level notes about that symbol are always included. |

## What an answer declares

- **`count`** — the page size. **`totalCountIfKnown`** — the true number of
  matching annotations. **`truncated`** with a `truncationReason` naming an action
  the caller can take: at the declared cap the reason asks for a narrower filter
  instead of a limit raise the store cannot honour.
- **`includeNameLevel`** echoes the accepted flag and **`nameLevelIncluded`**
  states the filter actually applied.
- **`symbolIndexed`** says whether the requested spelling named an indexed symbol.
  A spelling the index does not publish falls back to the literal stored name, so
  a note written under an arbitrary name is still findable.
- **`storeAbsent`** is true when the project has no annotation store yet: the
  answer is a declared absence and the read created nothing. Absence is never an
  error.
- Every row carries author class, tool identity, `time_created`/`time_updated`,
  the symbol, its file and its source position, so provenance travels with the
  note.

## Absence vs empty

The three states are deliberately distinct:

1. **No store** — `storeAbsent: true`, declared absence; the read did not create a
   database for an unindexed project and did not recreate a missing annotation
   table in a legacy store.
2. **Store present, no matching notes** — a declared-absent result with
   `count: 0` and `totalCountIfKnown: 0`; absence is never an error.
3. **Notes filtered out by the request** — `truncated` explains when the page cut
   rows, and `totalCountIfKnown` keeps the true total visible.

## How the read stays read-only

The store is opened byte-read-only, so a read does not create a database, does not
recreate a missing annotation table, and does not move the write-ahead log. It
does not modify source files, index data, or annotations. This is measured by the
read-door gate, not assumed.

## Refusals

- `limit` outside 1..200, fractional, or not a number.
- An unknown option, or a conflicting alias/canonical pair (for example `symbol`
  and `target` with different values) — refused rather than silently resolved.
- A request carrying `mode` — the tool has no mode option.

## Measured cost

A symbol read and its declared total are indexed lookups by project and symbol
name; the project-wide shapes seek by project and then sort matched rows. A
path-only read scans the project's annotation rows because the store has no index
on `symbol_path` — the cost is proportional to the number of notes in the
project, not to the number of files. On a 206-note fixture: path scan 0.14 ms,
project-wide page 0.34 ms (raw runs in
`validation/tools/bb_annotations/`).

## Verifying this page

```bash
npx tsx script/verify-tool-docs.ts --only bb_annotations
npx tsx script/m28/verify-annotation-store.ts
npx tsx validation/tools/bb_annotations/verify-read-door.ts
```
