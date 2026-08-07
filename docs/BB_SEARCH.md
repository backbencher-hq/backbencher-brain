# bb_search Reference

`bb_search` retrieves indexed code from the brain database. It supports multiple
retrieval modes over the AST index. It never reads or scans raw project files at
query time; it queries the indexed `brain_symbol` / `brain_file` tables.

## Modes

The engine (`src/intelligence/search/`) supports three retrieval modes. Every
result set is tagged with `searchMode`.

| Mode | Engine module | What it searches | Ranking |
| --- | --- | --- | --- |
| `symbols` (default) | `symbol-search.ts` | Symbol names, with exact/prefix/substring phases | relevance, then production-before-tests, complexity, path |
| `content` | `content-search.ts` | Indexed symbol corpus: name + qualified name + docstring | BM25 (FTS5) when available, else weighted LIKE |
| `regex` | `regex-search.ts` | Symbol names matched against a JS `RegExp` | production-before-tests, complexity, path, name |

`regex` is reachable today through the frozen `bb_search` schema via `regex: true`.
The `mode` parameter and the full mode surface are registered with the
consolidated tool surface in M9.18; the engine already implements them.

## Parameters

| Parameter | Type | Default | Behavior |
| --- | --- | --- | --- |
| `query` | string | required | Search term; a `RegExp` source when `regex: true` |
| `mode` | `"symbols" \| "content" \| "regex"` | `symbols` | Retrieval mode (engine-level) |
| `regex` | boolean | `false` | Legacy alias for `mode: "regex"` |
| `exact` | boolean | `false` | Symbols mode: exact name match only |
| `caseSensitive` | boolean | `false` | Case-sensitive matching (symbols and regex) |
| `symbolKind` | string | — | Filter by `symbol_type` (e.g. `function`, `class`) |
| `languages` | string[] | — | Filter by file language |
| `includeContent` | boolean | `false` | Attach a source snippet (`line_start..line_end`, 12-line cap) |
| `maxResults` | number | `100` | Page size |
| `offset` | number | `0` | Pagination offset |

## Output fields

Each result:

- `file`, `fileId`, `line`, `column`
- `context`, `symbolName`, `symbolType`, `language`
- `matchType`: `"symbol"` or `"content"`
- `snippet`
- `complexity`
- `stale` (true when the indexed file changed on disk)
- `_relevance`

Result-set metadata:

- `searchMode`: `"symbol"`, `"content"`, or `"regex"`
- `staleCount`, `freshCount` (symbols/regex modes)
- `truncated` (regex mode; true when the scan cap was reached)

## Determinism

Ranking is computed over the full candidate set collected from the query
phases, then sorted and paginated. It does not silently discard matches beyond
an arbitrary unsorted prefix.

## Regex

- `query` is compiled with `new RegExp(query, caseSensitive ? "" : "i")`.
- An invalid pattern raises `InvalidRegexError` rather than returning silently.
- The candidate scan is capped (`REGEX_SCAN_CAP = 20000` rows). When the cap is
  reached, `truncated` is `true`.

## Content / FTS5

- Content mode builds an ephemeral FTS5 table over `name`, `qualified_name`, and
  `docstring` for the project's indexed symbols and ranks with `bm25()`.
- FTS5 availability is probed once per process. If unavailable, content mode
  degrades to weighted `LIKE` scoring (name > qualified name > docstring).
- Limitation: the brain does not store raw file source, so content search covers
  the indexed symbol + documentation corpus, not full-text file contents. When
  an analyzer does not populate `docstring`, content search effectively ranks by
  name and qualified name.

## Migration from bb_select

`bb_select` returns a single symbol's exact source. The symbols mode of
`bb_search` returns ranked matches; exact single-symbol retrieval is preserved
through `bb_select` and, in the consolidated surface, through a symbol-read mode.
Existing `bb_select` behavior is unchanged by this issue.

## Verification

`script/verify-search-modes.ts` covers exact, prefix, substring, duplicate
disambiguation, pagination, regex (match, non-match, invalid, `regex:true`
routing), content/FTS retrieval and mode tagging, and language/kind filters.
