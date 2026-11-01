// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_search: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_search (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_search.md, validation/tools/bb_search/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_search/handler.ts, script/tool-docs/curation/bb_search.ts, and docs/tools/bb_search.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_search",
    description: "Unified indexed retrieval for symbol lists, content, exact symbol source, or files — retrieval, not natural-language explanation or code analysis. `symbols` (default) searches indexed symbol NAMES with exact, prefix and substring phases, optional case folding (default: case-insensitive over every Unicode case pair), exact-name restriction, regex name matching (the query is then a JavaScript RegExp source, validated and bounded), language/symbolKind filters (case-insensitive against the indexed vocabulary), snippets and paging; it answers as text lines plus a final machine-readable match-set line (`[match-set] searchMode=symbols totalMatches=… returned=… truncated=… staleCount=…`) so a short page is never read as a complete one. `content` searches the indexed symbol corpus — name, qualified name, docstring and the stored bounded symbol body — case-insensitively, and answers as JSON declaring the match set (`total`, `returned`, `truncated`, `truncationReason`), HOW it matched (`matchMode` phrase when the query appeared verbatim, terms when nothing matched verbatim and the query's content words were matched instead, with `termMatch` naming which words carried the best hit), `bodyCoverage` ({ withBody, symbols, ratio }) so 'nothing matched' is distinguishable from 'nothing could match', and a freshness block. `symbol` returns the exact indexed symbol record(s) with byte bounds, language and per-match freshness, declaring `found` and `totalMatches` (the complete match set; this mode has no paging). `file` returns current source for one indexed project-relative file, bounded to 100,000 characters with `contentLength`/`truncated` and a file-scoped freshness block; it never auto-refreshes. `symbol`, `content` and `symbols` modes auto-refresh stale files they touch within a bounded budget and declare the decision in an `autoRefresh` field; `refresh:false` opts out. Stale rows carry `stale:true` and the freshness block's remediation names the manual reindex command (file scope names that exact file). `limit` is a page size and a work budget: 0 returns no rows, values above 2000 are refused rather than clamped, and `limit`/`offset` are accepted only by the modes that page (`symbols`, `content`). `language`/`symbolKind` values the index does not contain are errors naming the indexed vocabulary; options a mode cannot honour are refused naming that mode's accepted set; an invalid regex is a named error; a candidate cap, projection cap or time budget is reported as `truncated` with `truncationReason` instead of a complete-looking page.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["symbols", "content", "symbol", "file"], description: "retrieval mode (default symbols)" },
        query: { type: "string", description: "symbol/content/regex query, trimmed before use; also accepted as the exact symbol name in symbol mode. Not accepted in file mode" },
        symbolName: { type: "string", description: "exact symbol name for symbol mode; supplying it with a different query is an error" },
        filePath: { type: "string", description: "file target for file mode, or symbol disambiguation in symbol mode. Not accepted in symbols/content modes" },
        limit: { type: "number", description: "max results (default 15; 0 returns no rows; above 2000 is refused; whole number). symbols/content modes page; symbol mode returns the COMPLETE match set when omitted and pages when given (its `totalMatches` is always the complete set size)" },
        language: { type: "string", description: "filter by language, case-insensitive (e.g. typescript, python, go); a language this project does not index is an error. symbols/content modes only" },
        symbolKind: { type: "string", description: "filter by symbol kind, case-insensitive (function, class, variable, interface, enum, ...); a kind this project does not index is an error. symbols/content modes only" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false). symbols mode only" },
        exact: { type: "boolean", description: "only exact name matches (default false); obeys caseSensitive. symbols mode only" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false); folds every Unicode case pair, not only ASCII. symbols mode only" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false). symbols mode only" },
        offset: { type: "number", description: "pagination offset (default 0). symbols/content modes, and symbol mode when `limit` is given" },
        refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering). Accepted by symbols/content/symbol; file mode never auto-refreshes and does not accept it" },
      },
      required: [],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbols", "content", "symbol", "file"],
    freshnessModes: ["symbol", "content", "file"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Unified lexical, content, exact-symbol, and file retrieval.", defaults: { mode: "symbols", limit: 15, includeContent: false, exact: false, caseSensitive: false, regex: false, offset: 0 }, examples: [{ mode: "symbols", query: "handleRequest", limit: 5 }, { mode: "content", query: "serialize cache entry" }, { mode: "symbol", symbolName: "handleRequest" }, { mode: "file", filePath: "src/app.ts" }] },
}
