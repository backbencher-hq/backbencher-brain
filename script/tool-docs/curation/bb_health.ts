// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_health (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_health (rendered into docs/tools/bb_health.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_health.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_health/descriptor.ts, src/mcp/tools/bb_health/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Index, schema, runtime, freshness, and embedding health", "Optional integrity and analysis-history summaries", "Typed warnings and refresh outcome"],
    errors: ["Invalid freshness or sample settings", "Refresh/index failure", "Unknown option"],
    limitations: ["Sampled freshness is not a complete filesystem proof", "Embedding coverage reports stored state, not semantic quality"],
    performance: "Sampled freshness is the default; complete freshness and integrity checks intentionally cost more.",
    safety: "Status is read-only. refresh=true explicitly mutates only index data; force=true performs a full in-place reindex.",
    evidence: "Counts and versions come from the brain database; freshness compares indexed metadata with the filesystem.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For index size/counts use `bb index status` (CLI) or the stats surface; this tool reports index health and integrity."
