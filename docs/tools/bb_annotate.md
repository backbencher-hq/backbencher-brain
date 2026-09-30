# `bb_annotate`

Attach an agent-authored annotation to a symbol in the shared index. Provenance is enforced: the row records author class 'agent' (never spoofable), the calling tool identity, and timestamps. Re-annotating the same symbol+path updates the note in place — one note per author per location, enforced by a unique index over (project, symbol, author, path). The symbol is NOT checked against the index, so a note may name anything; instead the reply MEASURES whether an editor surface can show it and says so in `surfacing` (`editor`, `matchedAs`, `matchedNames`, `statement`) — a typo'd name or a qualified name is stored and reported honestly rather than promised to a surface it cannot reach. `path` is resolved to the index's own spelling, so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. Annotations are opinions layered on evidence, never index facts. To change source code use bb_edit; to read notes back use bb_annotations.

## Contract

- Category: `annotations`
- Mutability: `write`
- Requires index: `false`
- Modes: `annotate`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbol": {
      "type": "string",
      "description": "symbol name to annotate (`target`/`query` are accepted as aliases)"
    },
    "body": {
      "type": "string",
      "description": "annotation text (max 2000 chars)"
    },
    "path": {
      "type": "string",
      "description": "optional file path to disambiguate same-named symbols; resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path all reach the same note"
    },
    "toolIdentity": {
      "type": "string",
      "description": "optional name of the calling agent/tool (recorded verbatim)"
    }
  },
  "required": [
    "symbol",
    "body"
  ]
}
```

## Returns

- Stored annotation row with its enforced provenance (author class `agent`, never spoofable) and the calling tool identity, recorded verbatim
- `surfacing` — whether an editor surface can actually show this note, MEASURED against the index rather than promised: `editor` (bool, the AND of `nameMatched` and `pathMatched` — the editor needs BOTH), `nameMatched`, `pathMatched`, `matchedAs` (`name` and/or `qualifiedName`), `matchedNames`, and a `statement` saying what is and is not true. The name matching is necessary but not sufficient: a note on a symbol the index holds, written against a path it has never seen, can never be selected by a file-scoped hover, and is reported `editor: false` with the reason. This replaced a `surfaces` field that claimed the note "renders in the editor hover section and graph badge" for every note; measured on a real corpus, 100% of notes written under a symbol's qualified name matched no symbol name at all, so that claim was false exactly where it sounded most confident
- The path handling: `surfacing.pathNote` when a path was resolved to the index's own spelling, `surfacing.pathWarning` when no indexed file matches the given path (stored under that spelling, no editor surface will scope it to a file), and a name-level note statement when no path was given

## Examples

`{"symbol":"handleRequest","body":"Legacy auth path — scheduled for removal in Q3."}`

## Errors

- Missing or blank symbol
- Empty body (a refusal, not a silent no-op)
- Body exceeds the declared 2000-char limit, counted in characters (an astral glyph is one character, not two UTF-16 units)
- toolIdentity exceeds the declared 200-char limit — refused, never truncated
- toolIdentity containing a control character or line break — a label is a name, not a document. Refused, because a newline in that field rendered (measured, through the real renderer) as a SECOND provenance line that could claim to be a human note

## Limitations

- Annotations are opinions layered on index evidence, never index truth
- Annotation store semantics are owned by the M28 workstream
- Any symbol name is accepted. Reachability is reported, not enforced: a name no indexed symbol carries is stored and declared `surfacing.editor: false`
- The note is keyed on the name as given. A name that matches several indexed symbols (a name is one symbol per file/line — `force` in 8 files of a real corpus) is one note shown wherever that name appears, unless `path` scopes it to a file
- `path` is resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path are the SAME note. A path matching no indexed file is stored verbatim and declared
- `toolIdentity` is the caller's own label. It is recorded verbatim and never verified — `author_class` is the enforced field
- The editor renderer escapes EVERY interpolated field, not only the body: `author_class`, `tool_identity` and `body` all go through the escaper, and a line break in any of them is flattened to a space. Markup escaping alone is not enough — a newline is what turns one annotation into two in a markdown list, which is how a caller's own label once forged a line reading 'human note by the-review-team'. So a row that already carries such a value — written before the guard, or by any other writer — still renders as exactly one line
- One note is kept per location, so a second agent annotating the same symbol+path REPLACES the first note. The replacement is reported in `replaced` with the previous body, but the previous note does not survive in the store. Annotating a DIFFERENT path (or no path) keeps a separate note per location

## Performance

Constant-time store write bounded by the 2000-char body limit. `surfacing` adds two indexed lookups (name, qualified name) plus one file-row lookup for the path.

## Safety

Write-capable against the annotation store only. It never modifies source files.

## Evidence Semantics

Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation. `author_class` is constrained to {agent, human} by a storage-level trigger, so a row cannot carry a third claim that every reader would then render verbatim.

## Relationship to other tools

To change source code use `bb_edit`; this tool stores provenance-enforced notes on symbols.

## Staleness

This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
