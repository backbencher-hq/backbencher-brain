# `bb_search`

Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis. Symbol/content/file modes carry a freshness block ({ fresh, stale, missing, staleRatio, mode, remediation }) stating whether results reflect the current files; rows may carry stale=true. Remediation names the exact reindex command. When a read finds stale/missing files within budget, the handler auto-refreshes exactly those files (reindexFilesParallel) before answering and declares it in an autoRefresh field; refresh=false opts out and answers from existing data with the staleness block. Every response declares its match set: totalMatches is the number of matching symbols the page was cut from (not the page size) and truncated is true when a candidate cap or the noise filter kept matches out, so a short page is never mistaken for a complete one. Options a mode cannot honor are rejected with an error naming that mode's accepted options, never silently ignored. language and symbolKind are matched case-insensitively against the indexed vocabulary, and a value the index does not contain is reported as an error rather than as zero results.

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
      "description": "max results (default 15); 0 returns no rows; must be a whole number. symbols/content/symbol modes only"
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
      "description": "pagination offset (default 0)"
    },
    "refresh": {
      "type": "boolean",
      "description": "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering)"
    }
  },
  "required": []
}
```

## Returns

- Indexed matches with file and line provenance
- Exact symbol or bounded file source in retrieval modes
- Freshness state where available

## Examples

`{"mode":"symbols","query":"handleRequest","limit":5}`

`{"mode":"content","query":"serialize cache entry"}`

`{"mode":"symbol","symbolName":"handleRequest"}`

`{"mode":"file","filePath":"src/app.ts"}`

## Errors

- Missing mode-specific query, symbolName, or filePath
- Invalid regular expression
- Unknown or mode-irrelevant option

## Limitations

- Results reflect the current index and may be stale
- Content search is lexical; use bb_ask for semantic discovery

## Performance

Pagination and result limits bound retrieval; exact indexed lookup is preferred over content scanning.

## Safety

Read-only. It does not refresh the index or modify source files.

## Evidence Semantics

Paths, line ranges, symbol kinds, and source snippets are indexed evidence; stale flags qualify that evidence.

## Relationship to other tools

For lexical/exact retrieval use this tool. For natural-language questions over the codebase use `bb_ask` (semantic, cited answers).

## Staleness

Freshness modes (registered as `freshnessModes`): `symbol`, `content`, `file`. Staleness surfaces as: per-row `stale` flags + `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`). When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
