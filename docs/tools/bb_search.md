<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_search: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_search through any MCP host, the CLI (`bb tool bb_search`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_search/descriptor.ts, src/mcp/tools/bb_search/handler.ts, script/tool-docs/curation/bb_search.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_search --write`.
-->
# `bb_search`

Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis. `symbols` (default) searches indexed symbol NAMES with exact, prefix and substring phases, optional case folding (default: case-insensitive over every Unicode case pair), exact-name restriction, regex name matching (the query is then a JavaScript RegExp source, validated and bounded), language/symbolKind filters (case-insensitive against the indexed vocabulary), snippets and paging; it answers as text lines plus a final machine-readable match-set line (`[match-set] searchMode=symbols totalMatches=… returned=… truncated=… staleCount=…`) so a short page is never read as a complete one. `content` searches the indexed symbol corpus — name, qualified name, docstring and the stored bounded symbol body — case-insensitively, and answers as JSON declaring the match set (`total`, `returned`, `truncated`, `truncationReason`), HOW it matched (`matchMode` phrase when the query appeared verbatim, terms when nothing matched verbatim and the query's content words were matched instead, with `termMatch` naming which words carried the best hit), `bodyCoverage` ({ withBody, symbols, ratio }) so 'nothing matched' is distinguishable from 'nothing could match', and a freshness block. `symbol` returns the exact indexed symbol record(s) with byte bounds, language and per-match freshness, declaring `found` and `totalMatches` (the complete match set; this mode has no paging). `file` returns current source for one indexed project-relative file, bounded to 100,000 characters with `contentLength`/`truncated` and a file-scoped freshness block; it never auto-refreshes. `symbol`, `content` and `symbols` modes auto-refresh stale files they touch within a bounded budget and declare the decision in an `autoRefresh` field; `refresh:false` opts out. Stale rows carry `stale:true` and the freshness block's remediation names the manual reindex command (file scope names that exact file). `limit` is a page size and a work budget: 0 returns no rows, values above 2000 are refused rather than clamped, and `limit`/`offset` are accepted only by the modes that page (`symbols`, `content`). `language`/`symbolKind` values the index does not contain are errors naming the indexed vocabulary; options a mode cannot honour are refused naming that mode's accepted set; an invalid regex is a named error; a candidate cap, projection cap or time budget is reported as `truncated` with `truncationReason` instead of a complete-looking page.

## Contract

- Category: `search`
- Mutability: `read`
- Requires index: `true`
- Modes: `symbols`, `content`, `symbol`, `file`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"mode":"symbols","limit":15,"includeContent":false,"exact":false,"caseSensitive":false,"regex":false,"offset":0}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "symbols",
        "content",
        "symbol",
        "file"
      ],
      "description": "retrieval mode (default symbols)"
    },
    "query": {
      "type": "string",
      "description": "symbol/content/regex query, trimmed before use; also accepted as the exact symbol name in symbol mode. Not accepted in file mode"
    },
    "symbolName": {
      "type": "string",
      "description": "exact symbol name for symbol mode; supplying it with a different query is an error"
    },
    "filePath": {
      "type": "string",
      "description": "file target for file mode, or symbol disambiguation in symbol mode. Not accepted in symbols/content modes"
    },
    "limit": {
      "type": "number",
      "description": "max results (default 15; 0 returns no rows; above 2000 is refused; whole number). symbols/content modes page; symbol mode returns the COMPLETE match set when omitted and pages when given (its `totalMatches` is always the complete set size)"
    },
    "language": {
      "type": "string",
      "description": "filter by language, case-insensitive (e.g. typescript, python, go); a language this project does not index is an error. symbols/content modes only"
    },
    "symbolKind": {
      "type": "string",
      "description": "filter by symbol kind, case-insensitive (function, class, variable, interface, enum, ...); a kind this project does not index is an error. symbols/content modes only"
    },
    "includeContent": {
      "type": "boolean",
      "description": "include a code snippet per result (default false). symbols mode only"
    },
    "exact": {
      "type": "boolean",
      "description": "only exact name matches (default false); obeys caseSensitive. symbols mode only"
    },
    "caseSensitive": {
      "type": "boolean",
      "description": "case-sensitive matching (default false); folds every Unicode case pair, not only ASCII. symbols mode only"
    },
    "regex": {
      "type": "boolean",
      "description": "treat query as a regex against symbol names (default false). symbols mode only"
    },
    "offset": {
      "type": "number",
      "description": "pagination offset (default 0). symbols/content modes, and symbol mode when `limit` is given"
    },
    "refresh": {
      "type": "boolean",
      "description": "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering). Accepted by symbols/content/symbol; file mode never auto-refreshes and does not accept it"
    }
  },
  "required": []
}
```

## Returns

- `symbols` mode: one text line per match (name [kind] file:line (language), plus a snippet when includeContent is set) and a final machine-readable `[match-set] searchMode=symbols totalMatches=… returned=… truncated=… staleCount=…` line
- `content` mode: JSON with the match set (`total`, `returned`, `truncated`, optional `truncationReason`), the route (`matchMode` phrase/terms, `termMatch` on the terms route), `bodyCoverage`, page-local `staleCount`/`freshCount`/`pageStaleCount`, and a `freshness` block
- `symbol` mode: JSON `matches` of exact indexed symbol records (id, fileId, name, symbolType, lineStart, byteStart, byteEnd, language), `found`, `totalMatches`, `returned`/`truncated` when paged, per-match `stale`, and a `freshness` block
- A `filePath` with directories scopes symbol lookup to that exact indexed file. The file is checked for freshness even if no symbols match. A bare filename retains basename lookup across indexed directories.
- `file` mode: JSON source envelope (`searchMode`, project-relative `file`, `fileId`, `language`, `content`, `contentLength`, `truncated` at 100,000 characters, `totalMatches: 1`, `stale`) plus a file-scoped `freshness` block

## Examples

`{"mode":"symbols","query":"handleRequest","limit":5}`

`{"mode":"content","query":"serialize cache entry"}`

`{"mode":"symbol","symbolName":"handleRequest"}`

`{"mode":"file","filePath":"src/app.ts"}`

## Errors

- Missing or blank mode-specific query, symbolName or filePath
- Invalid regular expression: a named error carrying the pattern and the engine's reason
- `exact` combined with `regex` in symbols mode (they ask for different things)
- `limit` above 2000: refused, never clamped
- `language`/`symbolKind` value the index does not contain: the message names the indexed vocabulary
- Option that the chosen mode cannot honour: the message names that mode's accepted set
- Project has no index: the message names the reindex command
- File mode: path escapes the project root, path is not a file, or the file is not indexed

## Limitations

- Content search is lexical over the indexed symbol corpus (name, qualified name, docstring and the stored bounded body). It is not full-text file search and it is not semantic — use bb_ask for semantic discovery.
- A body-only word is unreachable when the index was built by an analyzer that does not store symbol bodies. `bodyCoverage` reports how much of the corpus carries a searchable body so 'nothing matched' is distinguishable from 'nothing could match'.
- Regex matching scans at most 20,000 candidate symbol names under a 2,000 ms matching budget. A cut scan is reported as `truncated` with `truncationReason` and is never presented as a complete answer.
- `symbol` mode returns the complete match set unless `limit` is given; with `limit` it pages over that complete set (`totalMatches` always names the whole set).
- Results reflect the index and may be stale. Stale/missing files are flagged per row and in the freshness block, and the remediation names the manual reindex command.

## Performance

Indexed name lookup (symbols/symbol) is bounded by a candidate cap that scales with the page and answers in milliseconds on small projects and within seconds on a 310,423-symbol index. Content mode runs bounded candidate phases on projects large enough for them and a single ranked corpus pass otherwise; neither is a full-text file scan. Regex scans are hard-bounded by the candidate cap and the matching budget. Measured warm on a 6,452-file / 310,423-symbol index: symbols p95 3.6 s, content p95 3.3 s, symbol p95 29 ms, file p95 38 ms.

## Safety

No source file is ever modified. `symbols`/`content`/`symbol` reindex stale files they touch within a bounded budget unless BB_NO_AUTO_REFRESH=1 or refresh=false (declared in `autoRefresh`); `file` never auto-refreshes. A content read does not persist schema in the index database: the durable search index is built by maintenance, and the ranking table a query needs is created in the connection's temp schema.

## Evidence Semantics

Paths, line ranges, symbol kinds, byte bounds and snippets are indexed evidence; per-row `stale` flags plus the freshness block qualify it. In content mode `matchMode`/`termMatch` say whether a hit is a verbatim phrase or a keyword coincidence, and `bodyCoverage` says how much of the corpus could match at all.

## Relationship to other tools

For lexical/exact retrieval use this tool. For natural-language questions over the codebase use `bb_ask` (semantic, cited answers).

## Deep guides

- [Search semantics and modes](../BB_SEARCH.md)

## Staleness

Freshness modes (registered as `freshnessModes`): `symbol`, `content`, `file`. Staleness surfaces as: per-row `stale` flags + `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`). When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --file "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
