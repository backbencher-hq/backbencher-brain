// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_search (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_search (rendered into docs/tools/bb_search.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_search.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_search/descriptor.ts, src/mcp/tools/bb_search/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Indexed matches with file and line provenance", "Exact symbol or bounded file source in retrieval modes", "Freshness state where available"],
    errors: ["Missing mode-specific query, symbolName, or filePath", "Invalid regular expression", "Unknown or mode-irrelevant option"],
    limitations: ["Results reflect the current index and may be stale", "Content search is lexical; use bb_ask for semantic discovery"],
    performance: "Pagination and result limits bound retrieval; exact indexed lookup is preferred over content scanning.",
    safety: "Read-only. It does not refresh the index or modify source files.",
    evidence: "Paths, line ranges, symbol kinds, and source snippets are indexed evidence; stale flags qualify that evidence.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For lexical/exact retrieval use this tool. For natural-language questions over the codebase use `bb_ask` (semantic, cited answers)."
