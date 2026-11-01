// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_security: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_security (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_security.md, validation/tools/bb_security/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_security/handler.ts, script/tool-docs/curation/bb_security.ts, and docs/tools/bb_security.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_security",
    // Corrected against the code, not paraphrased. The previous text claimed
    // "hardcoded secrets" (no writer emits any secret vulnerability type — that
    // rule lives in bb_patterns, not here) and "weak crypto" (emitted only as an
    // isolated sink with no co-located source, so it is classified `unresolved`
    // and reported as an unvalidated observation, never as a finding).
    // "Cross-language" is retained because cross-file taint resolution exists
    // and is reported, but docs/BB_SECURITY.md now states precisely what the
    // flag does and does not mean.
    description: "Taint-flow security scan over the indexed source-to-sink flows: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. Flows whose endpoints both resolve to indexed symbols are findings; one-sided flows are reported separately as unvalidated observations, never as confirmed exploits. Findings whose underlying file changed after indexing carry a staleness marker.",
    inputSchema: { type: "object", properties: { history: { type: "boolean", description: "return persisted security history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" }, limit: { type: "number", description: "history run limit (default 20)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["findings"],
    plannedModes: ["flow", "summary", "hotspots"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Taint-flow findings over the index, with optional persisted run history. A flow is a finding only when both endpoints resolve to indexed symbols; one-sided flows are reported as unvalidated observations. Every response states the census so a capped scan is never mistaken for a complete one. Not detected: hardcoded secrets; genuine cross-language taint; standalone weak crypto.", defaults: { history: false, recordRun: false, limit: 20 }, examples: [{}, { recordRun: true }, { history: true }] },
}
