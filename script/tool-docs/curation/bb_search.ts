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
    returns: [
        "`symbols` mode: one text line per match (name [kind] file:line (language), plus a snippet when includeContent is set) and a final machine-readable `[match-set] searchMode=symbols totalMatches=… returned=… truncated=… staleCount=…` line",
        "`content` mode: JSON with the match set (`total`, `returned`, `truncated`, optional `truncationReason`), the route (`matchMode` phrase/terms, `termMatch` on the terms route), `bodyCoverage`, page-local `staleCount`/`freshCount`/`pageStaleCount`, and a `freshness` block",
        "`symbol` mode: JSON `matches` of exact indexed symbol records (id, fileId, name, symbolType, lineStart, byteStart, byteEnd, language), `found`, `totalMatches`, `returned`/`truncated` when paged, per-match `stale`, and a `freshness` block",
        "A `filePath` with directories scopes symbol lookup to that exact indexed file. The file is checked for freshness even if no symbols match. A bare filename retains basename lookup across indexed directories.",
        "`file` mode: JSON source envelope (`searchMode`, project-relative `file`, `fileId`, `language`, `content`, `contentLength`, `truncated` at 100,000 characters, `totalMatches: 1`, `stale`) plus a file-scoped `freshness` block",
    ],
    errors: [
        "Missing or blank mode-specific query, symbolName or filePath",
        "Invalid regular expression: a named error carrying the pattern and the engine's reason",
        "`exact` combined with `regex` in symbols mode (they ask for different things)",
        "`limit` above 2000: refused, never clamped",
        "`language`/`symbolKind` value the index does not contain: the message names the indexed vocabulary",
        "Option that the chosen mode cannot honour: the message names that mode's accepted set",
        "Project has no index: the message names the reindex command",
        "File mode: path escapes the project root, path is not a file, or the file is not indexed",
    ],
    limitations: [
        "Content search is lexical over the indexed symbol corpus (name, qualified name, docstring and the stored bounded body). It is not full-text file search and it is not semantic — use bb_ask for semantic discovery.",
        "A body-only word is unreachable when the index was built by an analyzer that does not store symbol bodies. `bodyCoverage` reports how much of the corpus carries a searchable body so 'nothing matched' is distinguishable from 'nothing could match'.",
        "Regex matching scans at most 20,000 candidate symbol names under a 2,000 ms matching budget. A cut scan is reported as `truncated` with `truncationReason` and is never presented as a complete answer.",
        "`symbol` mode returns the complete match set unless `limit` is given; with `limit` it pages over that complete set (`totalMatches` always names the whole set).",
        "Results reflect the index and may be stale. Stale/missing files are flagged per row and in the freshness block, and the remediation names the manual reindex command.",
    ],
    performance: "Indexed name lookup (symbols/symbol) is bounded by a candidate cap that scales with the page and answers in milliseconds on small projects and within seconds on a 310,423-symbol index. Content mode runs bounded candidate phases on projects large enough for them and a single ranked corpus pass otherwise; neither is a full-text file scan. Regex scans are hard-bounded by the candidate cap and the matching budget. Measured warm on a 6,452-file / 310,423-symbol index: symbols p95 3.6 s, content p95 3.3 s, symbol p95 29 ms, file p95 38 ms.",
    safety: "No source file is ever modified. `symbols`/`content`/`symbol` reindex stale files they touch within a bounded budget unless BB_NO_AUTO_REFRESH=1 or refresh=false (declared in `autoRefresh`); `file` never auto-refreshes. A content read does not persist schema in the index database: the durable search index is built by maintenance, and the ranking table a query needs is created in the connection's temp schema.",
    evidence: "Paths, line ranges, symbol kinds, byte bounds and snippets are indexed evidence; per-row `stale` flags plus the freshness block qualify it. In content mode `matchMode`/`termMatch` say whether a hit is a verbatim phrase or a keyword coincidence, and `bodyCoverage` says how much of the corpus could match at all.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For lexical/exact retrieval use this tool. For natural-language questions over the codebase use `bb_ask` (semantic, cited answers)."
