<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written guide to bb_annotate: the provenance
  rules, declared bounds, replacement semantics, and the `surfacing` measurement
  that tells a writer whether an editor can actually show the note.
WHO IT IS FOR — agents and humans leaving notes on symbols, and the gates that
  hold this page to the registry and the handler.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_annotate/descriptor.ts,
  src/mcp/tools/bb_annotate/handler.ts, src/brain/annotations/*,
  script/tool-docs/curation/bb_annotate.ts.
-->

# Writing annotations — provenance is enforced, surfacing is measured

`bb_annotate` stores an agent-authored note on a symbol (optionally scoped to one
file's copy) and reports what the note replaced and whether an editor surface can
show it. The store's declared mode label is `annotate`; the tool takes no `mode`
option. It writes only an annotation row: it does not touch source files, index
data, or schema.

## Parameters

| Parameter | Type | Meaning |
| --- | --- | --- |
| `symbol` | string (required) | Symbol name to annotate, max 500 chars. `target` and `query` are accepted spellings. The name does not have to exist in the index: reachability is measured and reported, not enforced. |
| `body` | string (required) | Annotation text, max 2000 chars counted in code points (an astral glyph is one character). Empty or whitespace-only is refused. |
| `path` | string | Optional file path scoping the note to one file's copy of the symbol, max 1024 chars. Resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. |
| `toolIdentity` | string | Optional caller label, max 200 chars, recorded verbatim. Line breaks and control characters are refused: a label is a name, not a document. |

## Provenance: what is enforced vs what is declared

- `author_class` is hardcoded to `agent` for tool writes. It is not a caller
  input: an option named `author_class` or `authorClass` is rejected by name, and
  the answer names the accepted options.
- `tool_identity` is the caller's own label. It is recorded verbatim and never
  verified — `author_class` is the enforced field.
- The row records `time_created` and `time_updated`. One note is kept per author
  per location, so a second agent annotating the same symbol+path REPLACES the
  first note. The replacement is reported in `replaced` with the previous author
  class, tool identity, body and timestamps; the previous note does not survive in
  the store. Annotating a different path (or no path) keeps a separate note per
  location.
- Annotations are opinions layered on index evidence, never index truth.

## Surfacing is a measurement, not a promise

The answer's `surfacing` block measures whether an editor can show the note:
`editor` is the JOINT truth — the name (or qualified name) must be indexed AND
declared in the resolved file, because the hover and graph badge select notes by
the file under the cursor. `nameMatched`, `pathMatched`, `fileMatched` and
`matchedAs` publish the individual halves; a name indexed only in a DIFFERENT file
than the path resolves to is reported `editor: false` with that reason. `pathNote`
says when a path was resolved to the index's own spelling, `pathWarning` when no
indexed file matches the given spelling, and a name-level note says so when no
path was given.

## Bounds and refusals

Declared, never silently truncated: `symbol` 500 chars, `body` 2000 code points,
`path` 1024 chars, `toolIdentity` 200 chars. Exceeding any bound is a refusal.
Empty or whitespace-only body is a refusal, not a silent no-op. Unknown options
and wrong types are rejected by the shared validator with the accepted option
list. On a project that has never been indexed, the first write creates that
project's annotation store; the reply still reports `surfacing.editor: false`
because no symbol can be matched yet.

## Reading notes back

Use `bb_annotations` with the same spelling: a symbol request matches both the
simple and qualified name forms, a path request returns that file's own notes
(unless `includeNameLevel` widens it), and absence is a declared result rather
than an error. To change source code, use `bb_edit`.

## Measured cost

Measured through the real MCP stdio door on isolated indexes, five warm runs per
tier (raw runs in `validation/tools/bb_annotate/LATENCY.json`): p50 83.4 /
p95 96.1 ms on the 5-file polyglot fixture, p50 5.8 / p95 12.1 ms on the 97-file
fixture, p50 5.7 / p95 17.9 ms on the 564-file graphql-js corpus, p50 3.5 /
p95 5.1 ms on the 109-file rake corpus, and p50 3.8 / p95 5.8 ms on the
6,452-file / 310,423-symbol reference index. The first call in a fresh server
process opens the project index read-write and runs its additive migrations
(measured 1.8 s on the reference-index snapshot); the write itself is indexed name
lookups, an optional file-row lookup and a location upsert.

## Verifying this page

```bash
npx tsx script/verify-tool-docs.ts --only bb_annotate
npx tsx script/m28/verify-annotation-store.ts
bun run script/m48/verify-d1-doc-truth.ts
```
