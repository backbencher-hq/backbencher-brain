<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written reference for bb_search: the four modes, every
  option and its mode scope, the output shapes, the declared bounds, the staleness
  behaviour, and the verification commands that prove them.
WHO IT IS FOR — callers of bb_search through any MCP host, the CLI (`bb tool bb_search`),
  and the owner maintaining the search engines.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_search/{descriptor,handler}.ts,
  src/intelligence/search/{symbol,content,regex}-search.ts, regex-scan-worker.ts,
  script/tool-docs/curation/bb_search.ts, docs/tools/bb_search.md (generated),
  script/verify-search-modes.ts, script/m13/verify-search-*.ts.
-->

# bb_search Reference

`bb_search` retrieves indexed code and, in `mode:"file"`, reads one indexed file's
current source. Symbol/content/symbol modes query the indexed `brain_symbol` /
`brain_file` tables; file mode is the deliberate source-retrieval exception.

> **Semantic mode: NONE.** `bb_search` has **no** semantic/vector mode. Its modes
> are `symbols` / `content` / `symbol` / `file` — all lexical or exact. Semantic
> (vector) retrieval is **`bb_ask`-only**. `regex:true` routes `symbols` mode
> through a bounded name-pattern scan; it is still lexical.

## Modes

| Mode | Engine | What it searches | Ranking |
| --- | --- | --- | --- |
| `symbols` (default) | `symbol-search.ts` | Indexed symbol **names**, with exact/prefix/substring phases | relevance, production-before-tests, complexity, path, name |
| `symbol` | `ASTEngine.findSymbol` | One exact indexed symbol's record(s), with byte bounds | exact name, optional `filePath` disambiguation |
| `content` | `content-search.ts` | Indexed symbol corpus: name + qualified name + **docstring + stored bounded body** | name-weight phrase hits, or the terms route (bm25 when the maintenance trigram index exists) |
| `file` | handler | One indexed project-relative file's current source | exact path |
| `regex` | `regex-search.ts` via `regex:true` | Indexed symbol names matched against a JS `RegExp` source | production-before-tests, complexity, path, name |

`regex` is reachable only through `symbols` mode with `regex: true`. `symbol` mode
returns the complete match set by default and pages over it when `limit` is given;
`file` mode requires an indexed project-relative `filePath`. Empty queries, path
escapes and unindexed file paths are refused at the public boundary.

## Options (and which modes honour them)

An option a mode does not honour is REFUSED with a message naming that mode's
accepted set — never silently ignored.

| Option | Type | Default | Modes | Behaviour |
| --- | --- | --- | --- | --- |
| `mode` | `"symbols" \| "content" \| "symbol" \| "file"` | `symbols` | all | retrieval mode |
| `query` | string | — | symbols, content, symbol | search term; in symbol mode an alias for `symbolName`; a `RegExp` source when `regex:true` |
| `symbolName` | string | — | symbol | exact symbol name |
| `filePath` | string | — | symbol, file | symbol disambiguation; file-mode target (project-relative) |
| `limit` | number | 15 | symbols, content, symbol | page size, 0–2000; `0` returns no rows, `>2000` is refused (never clamped); symbol mode without `limit` returns the COMPLETE set |
| `offset` | number | 0 | symbols, content, symbol | pagination offset (symbol mode with `limit`) |
| `language` | string | — | symbols, content | case-insensitive filter against the indexed language vocabulary; an unknown value is an error naming the vocabulary |
| `symbolKind` | string | — | symbols, content | case-insensitive filter against the indexed `symbol_type` vocabulary; an unknown value is an error |
| `includeContent` | boolean | false | symbols | attach a snippet per result (engine cap 12 lines; the symbols text renderer shows 8) |
| `exact` | boolean | false | symbols | whole-name match only; obeys `caseSensitive`; cannot be combined with `regex` |
| `caseSensitive` | boolean | false | symbols | case-sensitive matching; default folds every Unicode case pair |
| `regex` | boolean | false | symbols | treat `query` as a JavaScript `RegExp` source matched against names |
| `refresh` | boolean | auto | symbols, content, symbol | `false` opts out of the bounded inline auto-refresh of stale files; `file` never auto-refreshes and refuses this option |

## Output

**`symbols`** is text: one line per match — `name [kind] file:line (language)` plus
`[STALE]` and a snippet when requested — followed by a machine-readable match-set
line:

```
[match-set] searchMode=symbols totalMatches=25 returned=5 truncated=false staleCount=0
```

`totalMatches` is the size of the ranked match set the page was cut from;
`returned` is the page; `truncated` is true when a candidate cap or the noise
filter kept matches out; `truncationReason` is appended when truncated.

**`content`** is JSON:

- `searchMode: "content"`, `query`, `total` (match set), `returned` (page),
  `truncated`, optional `truncationReason`
- `matchMode`: `phrase` when the query appeared verbatim, `terms` when nothing
  matched verbatim and the query's content words were matched instead
- `termMatch`: on the terms route, `{ queryTerms, topMatched }` — the words that
  carried the best hit
- `bodyCoverage`: `{ withBody, symbols, ratio }` — how much of the corpus has a
  searchable stored body. A project indexed before bodies were stored reports
  `withBody: 0`, so "nothing matched" is distinguishable from "nothing could match"
- `staleCount` / `freshCount` / `pageStaleCount` (page-local, compatibility alias
  included) and a `freshness` block
- `results[]` rows: `file`, `fileId`, `line`, `column`, `context`, `symbolName`,
  `symbolType`, `language`, `matchType: "content"`, `snippet`, `complexity`,
  `stale`, `_relevance`

**`symbol`** is JSON: `matches[]` with `id`, `fileId` (the indexed file path),
`name`, `symbolType`, `lineStart`, `byteStart`, `byteEnd`, `language`,
`relativePath`, `stale`; plus `found`, `totalMatches`, `returned`, `truncated`
(true only when `limit` produced a page smaller than the set), optional
`truncationReason`/`nextOffset`, and a `freshness` block.

**`file`** is JSON: `searchMode: "file"`, project-relative `file`, indexed
`fileId`, `language`, current `content`, `contentLength`, `truncated` (hard
100,000-character cap on the returned content), `totalMatches: 1`, `stale`, and a
file-scoped `freshness` block.

## Contents vs freshness

`file` mode reads current bytes from disk for an indexed path and compares them
with the indexed hash, so its `stale` flag is a measured comparison. The other
modes search the index; their rows carry `stale: true` when the file changed or
disappeared after indexing. Stale/missing files are flagged, never dropped, and
the freshness block's remediation names the manual repair (`bb index --changed`,
or `bb index "<file>"` for file scope).

`symbols`, `content` and `symbol` auto-refresh the stale files they touch within a
bounded budget (25 files / 2 MiB by default) before answering and declare the
decision in `autoRefresh`; `BB_NO_AUTO_REFRESH=1` or `refresh:false` disables it.
`file` mode never auto-refreshes — its remediation says so and names the manual
command, because it does not accept `refresh`.

## Bounds and failure modes

- Candidate caps scale with the page and are reported as `truncated` with a
  `truncationReason`; a short page is never presented as a complete one.
- Content scans are bounded by phase caps on large corpora; a capped phase sets
  `truncated`.
- Regex matching scans at most 20,000 candidate names and runs under a 2,000 ms
  matching budget enforced by terminating the worker. A cut scan returns a
  declared bounded answer ("this is NOT a complete answer"), never a silent empty
  page. Worker startup is not charged to the matching budget.
- An invalid pattern raises a named `InvalidRegexError` (through MCP: `isError`
  with `invalid regex "<pattern>": <reason>`), before the index is opened.
- `exact` + `regex` is refused; `limit > 2000` is refused; unknown
  `language`/`symbolKind` values are refused with the indexed vocabulary.
- A content read never creates schema in the index database. The durable trigram
  search index, when present, is built by maintenance; the ranking table a query
  needs lives in the connection's temp schema.

## Determinism

Ranking is computed over the full candidate set collected from the query phases,
then sorted with a locale-independent tie-break and paginated. Regex results are
deterministic for the same pattern and corpus; a worker that cannot start runs the
same matching loop inline and declares `unisolated-scan`.

## Verification

```bash
BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 \
  bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/verify-search-modes.ts
BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 \
  bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/m13/verify-search-honesty.ts
BB_DATA_DIR=$PWD/validation/tools/bb_search/bbdata BB_NO_AUTO_REFRESH=1 \
  BB_CORPUS_ROOT=$HOME/fixtures/repositories \
  bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/m13/verify-search-corpus.ts
bun --preload ./validation/tools/bb_search/work/harness-redirect.ts ./script/m13/verify-search-docs.ts
npx tsx validation/tools/bb_search/work/regex-edge-tests.ts
npx tsx script/tools/verify-regex-policy.ts
npx tsx script/verify-tool-docs.ts --only bb_search
```

`script/m13/verify-search-e2e.ts` exercises both transports (compiled CLI and a
real MCP stdio session) and `script/m15/verify-search-complete.ts` is the
behavioural gate; both pass the parent environment through to spawned servers so
`BB_DATA_DIR` reaches them.

## Migration from bb_select

`bb_select` was removed from the public surface. Exact single-symbol retrieval is
`mode:"symbol"`; exact file retrieval is `mode:"file"` with `filePath`.
