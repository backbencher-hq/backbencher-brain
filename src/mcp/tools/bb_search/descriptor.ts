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
    description: "Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis. Symbol/content/file modes carry a freshness block ({ fresh, stale, missing, staleRatio, mode, remediation }) stating whether results reflect the current files; rows may carry stale=true. Remediation names the exact reindex command. When a read finds stale/missing files within budget, the handler auto-refreshes exactly those files (reindexFilesParallel) before answering and declares it in an autoRefresh field; refresh=false opts out and answers from existing data with the staleness block. Every response declares its match set: totalMatches is the number of matching symbols the page was cut from (not the page size) and truncated is true when a candidate cap or the noise filter kept matches out, so a short page is never mistaken for a complete one. Options a mode cannot honor are rejected with an error naming that mode's accepted options, never silently ignored. Content mode also declares HOW it matched: matchMode is phrase when the query appeared verbatim in the name, qualified name, docstring or symbol body, and terms when nothing matched verbatim and the query's content words were matched instead — a phrase hit means the code contains this text, a terms hit means it discusses the same words, which is weaker evidence. It declares bodyCoverage ({ withBody, symbols, ratio }) because a project indexed before bodies were stored has no searchable body at all, so 'nothing matched' from such a project means something different from 'nothing could match'. language and symbolKind are matched case-insensitively against the indexed vocabulary, and a value the index does not contain is reported as an error rather than as zero results.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["symbols", "content", "symbol", "file"], description: "retrieval mode (default symbols)" },
        query: { type: "string", description: "symbol/content/regex query, trimmed before use; also accepted as the exact symbol name in symbol mode. Not accepted in file mode" },
        symbolName: { type: "string", description: "exact symbol name for symbol mode; supplying it with a different query is an error" },
        filePath: { type: "string", description: "file target for file mode, or symbol disambiguation in symbol mode. Not accepted in symbols/content modes" },
        limit: { type: "number", description: "max results (default 15); 0 returns no rows; must be a whole number. symbols/content/symbol modes only" },
        language: { type: "string", description: "filter by language, case-insensitive (e.g. typescript, python, go); a language this project does not index is an error. symbols/content modes only" },
        symbolKind: { type: "string", description: "filter by symbol kind, case-insensitive (function, class, variable, interface, enum, ...); a kind this project does not index is an error. symbols/content modes only" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false). symbols mode only" },
        exact: { type: "boolean", description: "only exact name matches (default false); obeys caseSensitive. symbols mode only" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false); folds every Unicode case pair, not only ASCII. symbols mode only" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false). symbols mode only" },
        offset: { type: "number", description: "pagination offset (default 0)" },
        refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering)" },
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
