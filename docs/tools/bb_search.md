# `bb_search`

Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis. Symbol/content/file modes carry a freshness block ({ fresh, stale, missing, staleRatio, mode, remediation }) stating whether results reflect the current files; rows may carry stale=true. Remediation names the exact reindex command. When a read finds stale/missing files within budget, the handler auto-refreshes exactly those files (reindexFilesParallel) before answering and declares it in an autoRefresh field; refresh=false opts out and answers from existing data with the staleness block.

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
      "description": "symbol/content query; also accepted as the exact symbol name"
    },
    "symbolName": {
      "type": "string",
      "description": "exact symbol name for symbol mode"
    },
    "filePath": {
      "type": "string",
      "description": "file target or symbol disambiguation"
    },
    "limit": {
      "type": "number",
      "description": "max results (default 15)"
    },
    "language": {
      "type": "string",
      "description": "filter by language (e.g. typescript, python, go)"
    },
    "symbolKind": {
      "type": "string",
      "description": "filter by symbol kind (function, class, variable, interface, enum, ...)"
    },
    "includeContent": {
      "type": "boolean",
      "description": "include a code snippet per result (default false)"
    },
    "exact": {
      "type": "boolean",
      "description": "only exact name matches (default false)"
    },
    "caseSensitive": {
      "type": "boolean",
      "description": "case-sensitive matching (default false)"
    },
    "regex": {
      "type": "boolean",
      "description": "treat query as a regex against symbol names (default false)"
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
