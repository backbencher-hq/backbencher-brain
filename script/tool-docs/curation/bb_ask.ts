// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_ask (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_ask (rendered into docs/tools/bb_ask.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/descriptor.ts, src/mcp/tools/bb_ask/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Natural-language answer", "Ranked semantic matches", "Similarity and source provenance"],
    errors: ["Empty query", "Unavailable index or embedding state", "Unknown option"],
    limitations: ["Semantic similarity discovers candidates but does not independently prove a claim", "Local word vectors provide lexical-quality fallback rather than model-quality semantics"],
    performance: "The limit bounds returned semantic matches; embedding coverage and model choice affect ranking quality.",
    safety: "Read-only. It does not write source or silently rebuild embeddings.",
    evidence: "Treat matched symbols and resolvable source locations as evidence; treat generated explanation as interpretation.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For exact symbol/content/file retrieval use `bb_search`; this tool answers natural-language questions with citations."
