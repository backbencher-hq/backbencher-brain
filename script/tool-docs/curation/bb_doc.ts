// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_doc (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_doc (rendered into docs/tools/bb_doc.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_doc.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_doc/descriptor.ts, src/mcp/tools/bb_doc/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Markdown or structured JSON documentation", "Resolvable citations and evidence classifications", "Quality and website reference metadata"],
    errors: ["Missing target for target-based mode", "Unsupported format or mode", "Unavailable indexed evidence"],
    limitations: ["Unknown facts remain explicit rather than inferred without support", "Stale evidence is qualified and cannot silently become current"],
    performance: "Evidence count and maxTokens impose explicit response budgets.",
    safety: "Read-only. It never refreshes implicitly, writes source, or invokes bb_edit.",
    evidence: "Claims are classified as extracted, inferred, generated, or unknown and carry resolvable citations where applicable.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For raw symbol metadata use `bb_search` mode `symbol`; this tool composes documented, cited explanations."
