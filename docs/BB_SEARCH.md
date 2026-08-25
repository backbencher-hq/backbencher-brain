# bb_search Reference

`bb_search` retrieves indexed code and, in `mode:"file"`, reads the requested
indexed file to return bounded current source with an explicit freshness flag.
Symbol/content/regex modes query the indexed `brain_symbol` / `brain_file` tables;
file mode is the deliberate source-retrieval exception.

> **Semantic mode: NONE.** `bb_search` has **no** semantic/vector mode.
> Its modes are `symbols` / `content` / `symbol` / `file` — all lexical or
> exact. Semantic (vector) retrieval is **`bb_ask`-only**. No UI, doc, or
> CLI output may imply `bb_search` ranks results semantically.

## Modes

The public tool supports four retrieval modes. The engine (`src/intelligence/search/`)
provides symbol, content, and regex search; the handler adds a bounded file-source
mode. Every response is tagged with `searchMode`.

| Mode | Engine module | What it searches | Ranking |
| --- | --- | --- | --- |
| `symbols` (default) | `symbol-search.ts` | Symbol names, with exact/prefix/substring phases | relevance, then production-before-tests, complexity, path |
| `symbol` | `ASTEngine.findSymbol` | One exact indexed symbol and its byte/source bounds | exact name plus optional file disambiguation |
| `content` | `content-search.ts` | Indexed symbol corpus: name + qualified name + docstring | BM25 (FTS5) when available, else weighted LIKE |
| `regex` | `regex-search.ts` via `regex: true` | Symbol names matched against a JS `RegExp` | production-before-tests, complexity, path, name |
| `file` | public handler | One indexed file's current source, with freshness metadata | exact project-relative path |

`regex` is reachable through the public schema via `regex: true`. `symbol` mode
resolves one exact indexed symbol, while `file` mode requires an indexed
project-relative `filePath`. Empty queries and path escapes are rejected at the
public validation/handler boundary.

## Parameters

| Parameter | Type | Default | Behavior |
| --- | --- | --- | --- |
| `query` | string | required for symbols/content/regex | Search term; a `RegExp` source when `regex: true` |
| `filePath` | string | required for file mode | Project-relative indexed file path |
| `mode` | `"symbols" \| "content" \| "symbol" \| "file"` | `symbols` | Public retrieval mode |
| `exact` | boolean | `false` | Symbols mode: exact name match only |
| `symbolName` | string | — | Exact name for symbol mode; query is accepted as an alias |
| `regex` | boolean | `false` | Route symbol search through regex mode |
| `caseSensitive` | boolean | `false` | Case-sensitive matching (symbols and regex) |
| `symbolKind` | string | — | Filter by `symbol_type` (e.g. `function`, `class`) |
| `language` | string | — | Filter by file language |
| `includeContent` | boolean | `false` | Attach a source snippet (`line_start..line_end`, 12-line cap) |
| `limit` | number | `15` | Page size |
| `offset` | number | `0` | Pagination offset |

## Output fields

File mode returns a JSON envelope rather than a symbol-result array:

- `searchMode: "file"`
- project-relative `file`, indexed `fileId`, and `language`
- current `content`, `contentLength`, and `truncated` (hard 100,000-character cap)
- `stale` comparing current bytes with the indexed file hash

Each symbol/content/regex result:

- `file`, `fileId`, `line`, `column`
- `context`, `symbolName`, `symbolType`, `language`
- `matchType`: `"symbol"` or `"content"`
- `snippet`
- `complexity`
- `stale` (true when the indexed file changed on disk)
- `_relevance`

Result-set metadata:

- `searchMode`: `"symbol"`, `"content"`, or `"regex"` for engine result arrays; `"file"` for the file envelope
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

`bb_select` was removed from the public surface. Exact single-symbol retrieval is
provided by `mode:"symbol"`; exact file retrieval is provided by
`mode:"file"` with `filePath`.

## Verification

`script/verify-search-modes.ts` covers exact, prefix, substring, duplicate
disambiguation, pagination, regex (match, non-match, invalid, `regex:true`
routing), content/FTS retrieval, language/kind filters, public-boundary mode
validation, file-source retrieval, freshness metadata, and path traversal rejection.
