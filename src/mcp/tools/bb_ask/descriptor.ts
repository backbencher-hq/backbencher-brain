// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_ask: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_ask (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_ask.md, validation/tools/bb_ask/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/handler.ts, script/tool-docs/curation/bb_ask.ts, and docs/tools/bb_ask.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_ask",
    description: "Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "natural-language question" }, limit: { type: "number", description: "max results (default 5)" } }, required: ["query"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["answer"],
    plannedModes: ["explain", "feature"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Natural-language answers and semantic matches.", defaults: { limit: 5 }, examples: [{ query: "how does request handling work?" }] },
}
